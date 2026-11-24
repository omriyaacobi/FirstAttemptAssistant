// tests/quota-guard.test.js
// The helper for live-test sessions (tools/quota-guard.js): read the weekly level first, stop at a set share of it. Fake rows only.
// Run with:  node --test tests/quota-guard.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { levelsOf, budgetOf, judge, createGuard } = require("../tools/quota-guard");

const GEMINI = "Gemini Models";
const row = (window, remaining, resets = "2026-11-30T20:57:07Z", pool = GEMINI) => ({ pool, window, remaining, resets });
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-qg-")), "g.json");

test("budgetOf: share of what is left, at least one point", () => {
  assert.strictEqual(budgetOf(89, 10), 8.9);
  assert.strictEqual(budgetOf(100, 10), 10);
  assert.strictEqual(budgetOf(5, 10), 1);
});

test("levelsOf: the weekly and the 5-hour rows of one pool", () => {
  const l = levelsOf([row("Weekly Limit Remaining", 89), row("Five Hour Limit Remaining", 99), row("Weekly Limit Remaining", 46, "x", "Claude and GPT models")]);
  assert.strictEqual(l.week.remaining, 89);
  assert.strictEqual(l.five.remaining, 99);
  assert.deepStrictEqual(levelsOf([]), { week: null, five: null });
});

test("judge: go on until the share is spent, then STOP; low 5-hour window and a missing row also stop", () => {
  const note = { start: 89, share: 10, resets: "R" };
  const at = (remaining, five = 90, resets = "R") => ({ week: { remaining, resets }, five: { remaining: five } });
  assert.strictEqual(judge(note, at(89)).ok, true);
  assert.strictEqual(judge(note, at(82)).ok, true); // 7 of 8.9
  const stop = judge(note, at(80)); // 9 >= 8.9
  assert.strictEqual(stop.ok, false);
  assert.match(stop.why, /STOP/);
  assert.strictEqual(judge(note, at(88, 10)).ok, false);
  assert.strictEqual(judge(note, { week: null, five: null }).ok, false);
  const renewed = judge(note, at(100, 90, "NEW"));
  assert.strictEqual(renewed.ok, true);
  assert.match(renewed.why, /new weekly period/);
});

test("createGuard: begin writes the level down; allow reads it again; no begin means stop; a low week refuses to start", async () => {
  const f = file();
  let weekly = 89;
  const readRows = async () => [row("Weekly Limit Remaining", weekly), row("Five Hour Limit Remaining", 99)];
  const g = createGuard({ share: 10, file: f, readRows });
  assert.strictEqual((await g.allow()).ok, false, "no begin yet");
  const b = await g.begin();
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.budget, 8.9);
  assert.strictEqual((await g.allow()).ok, true);
  weekly = 79;
  assert.strictEqual((await g.allow()).ok, false);
  weekly = 30;
  assert.strictEqual((await createGuard({ share: 10, min: 40, file: f, readRows }).begin()).ok, false);
  assert.strictEqual((await createGuard({ file: f, readRows: async () => [] }).begin()).ok, false);
});
