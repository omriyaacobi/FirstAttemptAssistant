// deskrace.test.js
// Tests the hedging and the deadline with fake "calls" and millisecond timers. No model is ever called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { race } = require("../deskrace");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A fake call that answers `value` after `ms`, and records whether it was aborted.
const fake = (ms, value, log = {}) => (signal) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(value), ms);
  signal.addEventListener("abort", () => { clearTimeout(t); log.aborted = true; reject(new Error("aborted")); });
});

test("race: a fast first call wins and the second one is never started", async () => {
  let secondStarted = false;
  const out = await race([fake(10, "A"), () => { secondStarted = true; return fake(10, "B")(new AbortController().signal); }], { hedgeAfterMs: 200, deadlineMs: 1000 });
  assert.strictEqual(out.result, "A");
  assert.strictEqual(out.index, 0);
  await wait(250);
  assert.strictEqual(secondStarted, false);
});

test("race: a slow first call is hedged, the second wins, and the first one is aborted", async () => {
  const slow = {};
  const out = await race([fake(400, "slow", slow), fake(20, "quick")], { hedgeAfterMs: 50, deadlineMs: 1000 });
  assert.strictEqual(out.result, "quick");
  assert.strictEqual(out.index, 1);
  assert.strictEqual(out.started, 2);
  assert.strictEqual(slow.aborted, true); // the loser is stopped, not left running
});

test("race: if the first call still wins after the hedge started, the second is aborted", async () => {
  const second = {};
  const out = await race([fake(80, "first"), fake(500, "second", second)], { hedgeAfterMs: 30, deadlineMs: 1000 });
  assert.strictEqual(out.result, "first");
  assert.strictEqual(second.aborted, true);
});

test("race: an invalid reply does not win; the next call is started at once, without waiting for the hedge time", async () => {
  const started = Date.now();
  const out = await race([fake(5, "bad"), fake(5, "good")], { accept: (r) => (r === "good" ? r : null), hedgeAfterMs: 5000, deadlineMs: 10000 });
  assert.strictEqual(out.result, "good");
  assert.ok(Date.now() - started < 1000);
  assert.deepStrictEqual(out.errors, ["unusable reply"]);
});

test("race: a call that throws is treated like a failed call", async () => {
  const out = await race([() => { throw new Error("agy missing"); }, fake(5, "ok")], { hedgeAfterMs: 5000, deadlineMs: 10000 });
  assert.strictEqual(out.result, "ok");
  assert.ok(out.errors[0].includes("agy missing"));
});

test("race: when every call fails it rejects with the reasons", async () => {
  await assert.rejects(race([async () => { throw new Error("one"); }, async () => { throw new Error("two"); }], { hedgeAfterMs: 5000, deadlineMs: 10000 }), /one.*two/);
});

test("race: the deadline ends the wait and aborts everything that is still running", async () => {
  const a = {}, b = {};
  const started = Date.now();
  await assert.rejects(race([fake(5000, "a", a), fake(5000, "b", b)], { hedgeAfterMs: 20, deadlineMs: 120 }), /did not answer within/);
  assert.ok(Date.now() - started < 1000);
  assert.strictEqual(a.aborted, true);
  assert.strictEqual(b.aborted, true);
});

test("race: with a single call it is just a call with a deadline", async () => {
  const out = await race([fake(10, "only")], { hedgeAfterMs: 50, deadlineMs: 500 });
  assert.strictEqual(out.result, "only");
  assert.strictEqual(out.started, 1);
});
