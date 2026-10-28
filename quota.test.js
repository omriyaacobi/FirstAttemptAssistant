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

test("createQuota: caches a good lookup until it expires", async () => {
  let calls = 0, time = 0;
  const q = createQuota({ fetchRows: async () => { calls++; return [row("Pool A", 5)]; }, now: () => time, cacheMs: 1000 });
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
  time = 999;
  await q.get();
  assert.strictEqual(calls, 1);
  time = 1000;
  await q.get();
  assert.strictEqual(calls, 2);
});

test("createQuota: a failing lookup returns 'nothing low' and is retried only after a pause", async () => {
  let calls = 0, time = 0;
  const q = createQuota({ fetchRows: async () => { calls++; throw new Error("agy is down"); }, now: () => time, retryMs: 500 });
  assert.deepStrictEqual(await q.get(), []);
  time = 499;
  assert.deepStrictEqual(await q.get(), []);
  assert.strictEqual(calls, 1);
  time = 500;
  await q.get();
  assert.strictEqual(calls, 2);
});

test("createQuota: tasks started at the same time share one lookup", async () => {
  let calls = 0;
  const q = createQuota({ fetchRows: async () => { calls++; return []; } });
  await Promise.all([q.get(), q.get(), q.get()]);
  assert.strictEqual(calls, 1);
});
