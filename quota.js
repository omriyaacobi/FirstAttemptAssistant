// quota.js
// Makes routing quota-aware. `agy -p "/usage"` says how much is left in each quota "pool"
// (a pool is a bucket of usage that several models share). When a pool is nearly empty, Bot
// moves models from that pool to the END of their fallback chain, so a pool that still has
// room is tried first.
//
// Three small parts:
//   lowPools()    - PURE function (no I/O): from the usage rows, which pools are low?
//   prioritize()  - PURE function: reorder a chain so models in low pools come last.
//   createQuota() - fetches the usage and NEVER throws. A task never waits for a refresh: it gets
//                   the last known value and the refresh runs in the background. If nothing is
//                   known yet (first lookup failed or slow) it says "nothing is low".
//
// Note: the Claude CLI plan has no numbers in /usage, so Bot cannot see it and never treats it as low.

const { execFile } = require("node:child_process");

const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

const LOW_THRESHOLD = 15; // a pool is "low" when any of its windows has less than this % left
const CACHE_MS = 5 * 60 * 1000; // reuse a successful lookup this long
const RETRY_MS = 60 * 1000; // after a failed lookup, wait this long before asking again
const LOOKUP_TIMEOUT_MS = 15000; // a lookup that takes longer than this counts as failed
const FIRST_WAIT_MS = 5000; // the very first lookup is waited for at most this long (a normal one takes ~3.6 s)

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
    execFile(AGY_CMD, ["-p", "/usage"], { timeout: LOOKUP_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).slice(0, 200)));
      resolve(parseUsage(stdout));
    });
  });
}

// fetchRows and now are parameters so tests can fake them.
// Stale-while-revalidate: once a value is known, get() returns it AT ONCE, even if it is old, and
// refreshes it in the background. Only the very first lookup ever has to wait, and only up to
// firstWaitMs. A failed refresh keeps the last known value instead of forgetting it.
function createQuota({ fetchRows = fetchUsage, now = Date.now, cacheMs = CACHE_MS, retryMs = RETRY_MS, threshold = LOW_THRESHOLD, firstWaitMs = FIRST_WAIT_MS } = {}) {
  let cached = null; // { low, until }
  let pending = null; // a lookup already running, so parallel tasks share one

  function refresh() {
    if (!pending) {
      pending = fetchRows()
        .then((rows) => { cached = { low: lowPools(rows, threshold), until: now() + cacheMs }; })
        .catch(() => { cached = { low: cached ? cached.low : [], until: now() + retryMs }; }) // failed: keep what we knew
        .finally(() => { pending = null; });
    }
    return pending;
  }

  async function get() {
    if (cached) {
      if (now() >= cached.until) refresh(); // not awaited: the caller gets the old value now
      return cached.low;
    }
    // Nothing known yet: wait for the first lookup, but not forever. It keeps running in the background.
    let timer;
    const tooSlow = new Promise((resolve) => { timer = setTimeout(resolve, firstWaitMs); });
    await Promise.race([refresh(), tooSlow]);
    clearTimeout(timer);
    return cached ? cached.low : [];
  }
  return { get };
}

// The one shared instance Bot uses.
const quota = createQuota();

module.exports = { parseUsage, lowPools, prioritize, createQuota, getLowPools: quota.get, LOW_THRESHOLD };
