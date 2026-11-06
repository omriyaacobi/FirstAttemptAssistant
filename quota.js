// quota.js
// Makes routing quota-aware. A quota "pool" is a bucket of usage that several models share. When a pool is nearly
// empty, Bot moves models from that pool to the END of their fallback chain, so a pool that still has room is tried first.
//
// Where the numbers come from (all of it is read-only and local; nothing here logs in or reads a secret file):
//   Gemini + Claude-inside-agy  `agy -p "/usage"` prints one tab-separated line per pool and window.
//   Claude plan (the claude CLI) has no /usage command for scripts, but `claude -p --output-format stream-json --verbose`
//                               prints "rate_limit_event" messages: {status, rateLimitType: five_hour | seven_day |
//                               seven_day_opus | ..., utilization: 0..1, resetsAt: seconds}. (Found in the CLI's own
//                               message schema; see PROGRESS.md.) A tiny background Haiku call reads them.
//   Any model, as a fallback    when a call FAILS with a limit error ("You've hit your limit - resets 3pm"), that pool is marked
//                               low until the reset time in the message (or for 30 minutes when there is none).
//
// Parts:
//   lowPools()    - PURE: from the rows, which pools are low?  (rows whose reset time has passed are ignored)
//   prioritize()  - PURE: reorder a chain so models in low pools come last; if ALL are low, put the one with most room first.
//   parse...()    - PURE: turn agy / claude text into rows. Model output is untrusted, so every field is checked.
//   createQuota() - the in-memory state. A task never waits for it: get() answers at once from memory. After each answer Bot
//                   calls refresh(), which looks things up in the background for the NEXT message.

const { exec, execFile } = require("node:child_process");
const fs = require("node:fs");
const { poolsOf, poolsForModel, CLAUDE_PLAN, CLAUDE_OPUS_WEEK } = require("./router");
const { CLAUDE_CMD, claudeEnv, SANDBOX_DIR, killTree } = require("./providers");

const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

const LOW_THRESHOLD = 15; // a pool is "low" when any of its windows has less than this % left (the same for Claude and Gemini)
const LOOKUP_TIMEOUT_MS = 15000; // an agy lookup that takes longer than this counts as failed
const CLAUDE_PROBE_TIMEOUT_MS = 40000; // the tiny Haiku call that reads Claude's limits
const CLAUDE_PROBE_EVERY_MS = 60 * 1000; // ...at most once a minute (each one costs a few tokens of the Claude plan)
const LIMIT_BACKOFF_MS = 30 * 60 * 1000; // a limit error with no reset time in it: treat the pool as low this long
const CLAUDE_SONNET_WEEK = "Claude plan (Sonnet)";

// ---- agy ----

// agy prints tab-separated lines like: Gemini Models<TAB>Five Hour Limit Remaining<TAB>99%<TAB>2026-10-28T01:41:40Z
// (server.js has the same parser for the web page; kept separate because server.js is a protected file.)
function parseUsage(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 4)
    .map(([pool, window, remaining, resets]) => ({ pool, window, remaining: parseInt(remaining, 10), resets }));
}

// ---- Claude ----

// The window names the claude CLI uses, mapped to our pools. "overage" (paid extra usage) is deliberately not here.
const CLAUDE_WINDOWS = {
  five_hour: { pool: CLAUDE_PLAN, window: "Five Hour Limit Remaining" },
  seven_day: { pool: CLAUDE_PLAN, window: "Weekly Limit Remaining" },
  seven_day_opus: { pool: CLAUDE_OPUS_WEEK, window: "Opus Weekly Limit Remaining" },
  seven_day_sonnet: { pool: CLAUDE_SONNET_WEEK, window: "Sonnet Weekly Limit Remaining" },
};

const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// One rate_limit_info object (from a "rate_limit_event") -> one row, or null if it says nothing usable.
// status "rejected" means the limit is hit; utilization is the share USED, from 0 to 1.
function rowFromRateLimitInfo(info, now = Date.now()) {
  if (!info || typeof info !== "object") return null;
  const status = typeof info.status === "string" ? info.status : "";
  const known = Object.hasOwn(CLAUDE_WINDOWS, info.rateLimitType) ? CLAUDE_WINDOWS[info.rateLimitType] : null;
  if (!known && status !== "rejected") return null; // an unknown window that still has room tells us nothing
  const where = known || { pool: CLAUDE_PLAN, window: "Limit Remaining" };

  let remaining = 100;
  const used = Number(info.utilization);
  if (Number.isFinite(used) && used >= 0) remaining = Math.max(0, Math.min(100, Math.round((1 - (used > 1 ? used / 100 : used)) * 100)));
  else if (status === "allowed_warning") remaining = 10; // a warning without a number: assume it is low
  if (status === "rejected") remaining = 0;

  const resetsAt = Number(info.resetsAt) * 1000; // seconds -> milliseconds
  const resets = isoOrNull(resetsAt) || (status === "rejected" ? isoOrNull(now + LIMIT_BACKOFF_MS) : null);
  return { ...where, remaining, resets, source: "claude" };
}

// Reads the output of `claude -p --output-format stream-json --verbose`: one JSON object per line. Returns the rows from the
// rate_limit_event lines, plus the text of an error result (a failed call prints its error as the result), if any.
function parseClaudeStream(text, now = Date.now()) {
  const rows = [];
  let errorText = "";
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch (error) { continue; }
    if (!event || typeof event !== "object") continue;
    if (event.type === "rate_limit_event") {
      const row = rowFromRateLimitInfo(event.rate_limit_info, now);
      if (row) rows.push(row);
    } else if (event.type === "result" && event.is_error && typeof event.result === "string") {
      errorText = event.result.slice(0, 300);
    }
  }
  return { rows, errorText };
}

// ---- limit errors (the fallback for any model) ----

const LIMIT_WORDS = /hit your (?:\w+ )?limit|usage limit|limit reached|rate.?limit|out of (?:extra )?usage|quota|resource.?exhausted|too many requests|\b429\b/i;

// The clock time the day after `now`'s local day if it already passed today, in time zone tz (system zone when tz is missing or wrong).
function nextClockTime(hour, minute, tz, now) {
  const parts = (ms, zone) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    return Object.fromEntries(f.formatToParts(ms).map((p) => [p.type, Number(p.value)]));
  };
  let zone = tz;
  try { parts(now, zone); } catch (error) { zone = undefined; }
  const p = parts(now, zone);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now / 1000) * 1000; // zone time minus UTC
  let at = Date.UTC(p.year, p.month - 1, p.day, hour, minute) - offset;
  if (at <= now) at += 24 * 3600 * 1000;
  return at;
}

// When does the limit in this message reset? Epoch ms, or null. Understands "...|1730000000" (seconds), an ISO time,
// and "resets 3pm (Asia/Jerusalem)" / "resets 15:30".
function parseResetTime(text, now = Date.now()) {
  const s = String(text);
  const epoch = s.match(/\|\s*(\d{9,13})\b/);
  if (epoch) return epoch[1].length > 11 ? Number(epoch[1]) : Number(epoch[1]) * 1000;
  const iso = s.match(/\b(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:?\d\d)?)/);
  if (iso && Number.isFinite(Date.parse(iso[1]))) return Date.parse(iso[1]);
  const clock = s.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d\d))?\s*(am|pm)?(?:\s*\(([^)]{1,40})\))?/i);
  if (clock) {
    let hour = Number(clock[1]);
    if (clock[3]) hour = (hour % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0);
    if (hour <= 23 && Number(clock[2] || 0) <= 59) return nextClockTime(hour, Number(clock[2] || 0), clock[4], now);
  }
  return null;
}

// A failed call's error text -> { resetsAt } if it is a limit error, else null.
function limitError(message, now = Date.now()) {
  const text = String(message || "");
  if (!LIMIT_WORDS.test(text)) return null;
  const at = parseResetTime(text, now);
  return { resetsAt: at !== null && at > now ? at : now + LIMIT_BACKOFF_MS };
}

// ---- the decision ----

// Pure. Returns [{ pool, remaining }] for each pool whose lowest window is under the threshold.
// A row whose reset time has already passed is out of date (that window has started over) and is ignored.
function lowPools(rows, threshold = LOW_THRESHOLD, now = Date.now()) {
  const lowest = new Map();
  for (const { pool, remaining, resets } of rows || []) {
    if (!Number.isFinite(remaining)) continue; // a line we could not read says nothing
    if (resets && Date.parse(resets) <= now) continue;
    if (!lowest.has(pool) || remaining < lowest.get(pool)) lowest.set(pool, remaining);
  }
  return [...lowest].filter(([, remaining]) => remaining < threshold).map(([pool, remaining]) => ({ pool, remaining }));
}

// Pure. Moves models whose pool is low to the end, keeping the order inside each group. Never removes anything.
// If EVERY model in the chain is low there is nothing better to move to, so the one with the most room left goes first
// (ties keep the chain's own order). Returns { chain, moved, allLow }: moved lists the models pushed back.
function prioritize(chain, low) {
  const left = new Map(low.map((p) => [p.pool, p.remaining]));
  const room = (m) => { // the least room among the low pools this model draws from, or null if none of them is low
    const r = poolsOf(m).filter((p) => left.has(p)).map((p) => left.get(p));
    return r.length ? Math.min(...r) : null;
  };
  const fine = chain.filter((m) => room(m) === null);
  const poor = chain.filter((m) => room(m) !== null);
  if (poor.length === 0) return { chain, moved: [], allLow: false };
  if (fine.length === 0) {
    const best = chain.map((m, i) => [m, i]).sort((a, b) => room(b[0]) - room(a[0]) || a[1] - b[1]).map(([m]) => m);
    return { chain: best, moved: [], allLow: true };
  }
  const reordered = [...fine, ...poor];
  const changed = reordered.some((m, i) => m !== chain[i]); // nothing to report if the low models were already last
  return { chain: reordered, moved: changed ? poor : [], allLow: false };
}

// "Gemini 4 Argon 4% left, Claude plan 0% left"
const describeLow = (low) => low.map((p) => `${p.pool} ${p.remaining}% left`).join(", ");

// ---- looking things up ----

function fetchUsage() {
  return new Promise((resolve, reject) => {
    const child = execFile(AGY_CMD, ["-p", "/usage"], (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) return reject(new Error(String(stderr || error.message).slice(0, 200)));
      resolve(parseUsage(stdout));
    });
    // Our own unref'd timer instead of execFile's "timeout" option (that timer would keep Bot open).
    const timer = setTimeout(() => child.kill(), LOOKUP_TIMEOUT_MS);
    timer.unref();
    // The lookup runs after the answer; it must not keep `node bot.js` open for 5 more seconds (the flag lives in memory only).
    child.unref();
    child.stdout.unref();
    child.stderr.unref();
  });
}

// The cheapest possible Claude call (Haiku, no tools, an empty folder, nothing saved), only to read the rate_limit_event it prints.
// A failed call (limit hit, login expired) exits with an error but still prints its events, so the output is parsed either way.
function probeClaude() {
  return new Promise((resolve) => {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const command = `${CLAUDE_CMD} -p --model haiku --tools "" --no-session-persistence --output-format stream-json --verbose`;
    const child = exec(command, { cwd: SANDBOX_DIR, env: claudeEnv(), maxBuffer: 1e7, windowsHide: true }, (error, stdout) => {
      clearTimeout(timer);
      resolve(parseClaudeStream(stdout));
    });
    const timer = setTimeout(() => killTree(child), CLAUDE_PROBE_TIMEOUT_MS);
    timer.unref();
    child.unref();
    child.stdout.unref();
    child.stderr.unref();
    child.stdin.on("error", () => {});
    child.stdin.end("ok");
  });
}

// The in-memory state. get() answers at once, even for the very first message after a start (then nothing is known, so nothing is low).
// refresh() asks agy and Claude in the background, for the NEXT message; a failed lookup leaves what was known as it was, and a
// lookup is not started while another of the same kind is running. fetchRows / fetchClaude / now are parameters so tests can fake them.
function createQuota({ fetchRows = fetchUsage, fetchClaude = probeClaude, now = Date.now, threshold = LOW_THRESHOLD, claudeEveryMs = CLAUDE_PROBE_EVERY_MS } = {}) {
  let agyRows = [];
  const claudeRows = new Map(); // "pool|window" -> the newest row for that window
  const failures = new Map(); // pool -> a row made from a limit error
  let pendingAgy = null, pendingClaude = null, lastProbe = -Infinity;

  // Calls fn and always returns a promise, even if fn throws at once.
  const safely = (fn) => { try { return Promise.resolve(fn()); } catch (error) { return Promise.reject(error); } };
  const allRows = () => [...agyRows, ...claudeRows.values(), ...failures.values()];

  async function get() {
    return lowPools(allRows(), threshold, now());
  }

  // A model's call failed. If it was a limit error, mark that model's pool low until the reset time in the message.
  function noteFailure(model, message) {
    const hit = limitError(message, now());
    if (!hit || !model) return false;
    let pools = poolsForModel(model.provider, model.model);
    if (model.provider === "claude") pools = [/opus/i.test(message) && pools.includes(CLAUDE_OPUS_WEEK) ? CLAUDE_OPUS_WEEK : CLAUDE_PLAN]; // Sonnet/Haiku/Opus share the plan
    for (const pool of pools) failures.set(pool, { pool, window: "limit error", remaining: 0, resets: new Date(hit.resetsAt).toISOString(), source: "error" });
    return pools.length > 0;
  }

  function takeClaude({ rows, errorText }) {
    for (const row of rows) claudeRows.set(`${row.pool}|${row.window}`, row);
    if (errorText) noteFailure({ provider: "claude", model: "haiku" }, errorText); // e.g. "You've hit your limit"
  }

  const claudeBlocked = () => allRows().some((r) => r.pool === CLAUDE_PLAN && r.remaining === 0 && Date.parse(r.resets) > now());

  // Never rejects and never needs to be awaited (tests await it to know when it is done).
  function refresh() {
    if (!pendingAgy) {
      pendingAgy = safely(fetchRows)
        .then((rows) => { agyRows = rows; })
        .catch(() => { /* keep the last known rows */ })
        .finally(() => { pendingAgy = null; });
    }
    // Claude: at most one probe at a time and one a minute, and none while the plan is known to be used up until its reset.
    if (!pendingClaude && now() - lastProbe >= claudeEveryMs && !claudeBlocked()) {
      lastProbe = now();
      pendingClaude = Promise.resolve()
        .then(fetchClaude)
        .then(takeClaude)
        .catch(() => { /* keep what was known */ })
        .finally(() => { pendingClaude = null; });
    }
    return Promise.all([pendingAgy, pendingClaude]).then(() => {});
  }
  return { get, refresh, noteFailure };
}

// The one shared instance Bot uses.
const quota = createQuota();

module.exports = {
  parseUsage, parseClaudeStream, rowFromRateLimitInfo, parseResetTime, limitError, lowPools, prioritize, describeLow, createQuota,
  getLowPools: quota.get, refreshQuota: quota.refresh, noteFailure: quota.noteFailure, LOW_THRESHOLD, CLAUDE_PLAN,
};
