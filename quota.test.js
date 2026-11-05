// quota.test.js
// Tests the quota logic with fake usage data. No model and no agy are ever called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { parseUsage, lowPools, prioritize, createQuota, LOW_THRESHOLD } = require("./quota");

const row = (pool, remaining, window = "Five Hour Limit Remaining") => ({ pool, window, remaining, resets: "x" });
const A = { provider: "agy", model: "a", pool: "Pool A" };
const B = { provider: "agy", model: "b", pool: "Pool B" };
const C = { provider: "claude", model: "c", pool: null };

test("parseUsage reads agy's tab-separated lines and skips noise", () => {
  const rows = parseUsage("Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-28T01:41:40Z\n\nnoise\n");
  assert.deepStrictEqual(rows, [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 99, resets: "2026-10-28T01:41:40Z" }]);
});

test("lowPools: uses the lowest window of each pool and the threshold", () => {
  const rows = [row("Pool A", 100, "Weekly"), row("Pool A", 10), row("Pool B", LOW_THRESHOLD), row("Pool C", 3)];
  assert.deepStrictEqual(lowPools(rows), [{ pool: "Pool A", remaining: 10 }, { pool: "Pool C", remaining: 3 }]);
  assert.deepStrictEqual(lowPools(rows, 5), [{ pool: "Pool C", remaining: 3 }]);
});

test("lowPools: unreadable numbers and missing data mean 'not low'", () => {
  assert.deepStrictEqual(lowPools([row("Pool A", NaN)]), []);
  assert.deepStrictEqual(lowPools(null), []);
  assert.deepStrictEqual(lowPools([]), []);
});

test("prioritize: a low pool's models go last, order kept, nothing removed", () => {
  const result = prioritize([A, B, C], [{ pool: "Pool A", remaining: 4 }]);
  assert.deepStrictEqual(result.chain, [B, C, A]);
  assert.deepStrictEqual(result.moved, [A]);
});

test("prioritize: models without a pool (the Claude CLI) are never moved", () => {
  const result = prioritize([C, A], [{ pool: "Pool A", remaining: 4 }]);
  assert.deepStrictEqual(result.chain, [C, A]);
  assert.deepStrictEqual(result.moved, []); // A was already last, so nothing changed
});

test("prioritize: if every model is low, the chain is left alone", () => {
  const low = [{ pool: "Pool A", remaining: 4 }, { pool: "Pool B", remaining: 2 }];
  const result = prioritize([A, B], low);
  assert.deepStrictEqual(result.chain, [A, B]);
  assert.deepStrictEqual(result.moved, []);
});

test("prioritize: no low pools means no change, and the input is not modified", () => {
  const chain = [A, B];
  const result = prioritize(chain, []);
  assert.deepStrictEqual(result.chain, [A, B]);
  assert.deepStrictEqual(chain, [A, B]);
});

const settle = () => new Promise((r) => setImmediate(r));

test("createQuota: the flag starts as 'nothing is low' and get() never starts a lookup", async () => {
  let calls = 0;
  const q = createQuota({ fetchRows: async () => { calls++; return [row("Pool A", 5)]; } });
  assert.deepStrictEqual(await q.get(), []);
  assert.strictEqual(calls, 0); // even the very first message does not look anything up
});

test("createQuota: get() answers at once even while a lookup is still running", async () => {
  const q = createQuota({ fetchRows: () => new Promise(() => {}) }); // never finishes
  q.refresh();
  assert.deepStrictEqual(await q.get(), []);
});

test("createQuota: refresh() updates the flag for the next message", async () => {
  const q = createQuota({ fetchRows: async () => [row("Pool A", 5)] });
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
});

test("createQuota: a failed refresh leaves the flag as it was", async () => {
  let calls = 0;
  const q = createQuota({ fetchRows: async () => { if (++calls > 1) throw new Error("agy is down"); return [row("Pool A", 5)]; } });
  await q.refresh();
  await q.refresh(); // fails, and does not throw
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
});

test("createQuota: no new lookup starts while one is running", async () => {
  let calls = 0, release;
  const q = createQuota({ fetchRows: () => { calls++; return new Promise((r) => { release = () => r([row("Pool A", 90)]); }); } });
  q.refresh(); q.refresh(); q.refresh();
  assert.strictEqual(calls, 1);
  release();
  await settle();
  q.refresh(); // the first one is done, so a new one may start
  assert.strictEqual(calls, 2);
});
