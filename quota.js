// quota.js
// Makes routing quota-aware. `agy -p "/usage"` says how much is left in each quota "pool"
// (a pool is a bucket of usage that several models share). When a pool is nearly empty, Bot
// moves models from that pool to the END of their fallback chain, so a pool that still has
// room is tried first.
//
// Three small parts:
//   lowPools()    - PURE function (no I/O): from the usage rows, which pools are low?
//   prioritize()  - PURE function: reorder a chain so models in low pools come last.
//   createQuota() - an in-memory flag. A task never waits for quota: it reads the flag (starts as "nothing
//                   is low"). After each answer Bot refreshes the flag in the background, for the next task.
//
// Note: the Claude CLI plan has no numbers in /usage, so Bot cannot see it and never treats it as low.

const { execFile } = require("node:child_process");

const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

const LOW_THRESHOLD = 15; // a pool is "low" when any of its windows has less than this % left
const LOOKUP_TIMEOUT_MS = 15000; // a lookup that takes longer than this counts as failed

// agy prints tab-separated lines like: Gemini Models<TAB>Five Hour Limit Remaining<TAB>99%<TAB>2026-10-28T01:41:40Z
// (server.js has the same parser for the web page; kept separate because server.js is a protected file.)
function parseUsage(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 4)
    .map(([pool, window, remaining, resets]) => ({ pool, window, remaining: parseInt(remaining, 10), resets }));
}

// Pure. Returns [{ pool, remaining }] for each pool whose lowest window is under the threshold.
function lowPools(rows, threshold = LOW_THRESHOLD) {
  const lowest = new Map();
  for (const { pool, remaining } of rows || []) {
    if (!Number.isFinite(remaining)) continue; // a line we could not read says nothing
    if (!lowest.has(pool) || remaining < lowest.get(pool)) lowest.set(pool, remaining);
  }
  return [...lowest].filter(([, remaining]) => remaining < threshold).map(([pool, remaining]) => ({ pool, remaining }));
}

// Pure. Moves models whose pool is low to the end, keeping the order inside each group.
// Never removes anything, and if EVERY model is low the chain stays as it was.
// Returns { chain, moved } where moved lists the models that were pushed back.
function prioritize(chain, low) {
  const lowNames = new Set(low.map((p) => p.pool));
  const isLow = (m) => m.pool && lowNames.has(m.pool);
  const fine = chain.filter((m) => !isLow(m));
  const poor = chain.filter(isLow);
  if (fine.length === 0 || poor.length === 0) return { chain, moved: [] };
  // Nothing to report if the low models were already last.
  const reordered = [...fine, ...poor];
  const changed = reordered.some((m, i) => m !== chain[i]);
  return { chain: reordered, moved: changed ? poor : [] };
}

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

// A simple in-memory "are any pools low?" flag (Omri's design). It starts as "nothing is low" every time Bot
// starts, so it resets every session. A message NEVER waits for quota: get() returns the flag at once, even
// for the very first message after a start. After each answer, Bot calls refresh(), which asks agy in the
// background and updates the flag for the NEXT message. A failed lookup leaves the flag as it was, and a
// lookup is not started while another is still running. fetchRows is a parameter so tests can fake it.
function createQuota({ fetchRows = fetchUsage, threshold = LOW_THRESHOLD } = {}) {
  let low = [];
  let pending = null;

  async function get() {
    return low;
  }

  // Never rejects and never needs to be awaited (tests await it to know when it is done).
  function refresh() {
    if (!pending) {
      pending = fetchRows()
        .then((rows) => { low = lowPools(rows, threshold); })
        .catch(() => { /* keep the last known flag */ })
        .finally(() => { pending = null; });
    }
    return pending;
  }
  return { get, refresh };
}

// The one shared instance Bot uses.
const quota = createQuota();

module.exports = { parseUsage, lowPools, prioritize, createQuota, getLowPools: quota.get, refreshQuota: quota.refresh, LOW_THRESHOLD };
