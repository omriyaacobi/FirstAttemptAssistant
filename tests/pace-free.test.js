// tests/pace-free.test.js
// Omri's rule of 2026-11-24: while the Gemini Models pool has more than 75% of its WEEK left, Neon low answers first, with no pacing
// against agy's Claude pool and no Claude-first. Below that, the pacing works as before. Fake pools and fake models only.
// Run with:  node --test tests/pace-free.test.js

const test = require("node:test");
const assert = require("node:assert");
const { paceFree, PACE_FREE_ABOVE } = require("../quota");
const { createBrain, CHAIN } = require("../brain");

const NOW = Date.parse("2026-11-24T12:00:00Z");
const inDays = (d) => new Date(NOW + d * 24 * 3600 * 1000).toISOString();
const week = (pool, remaining, daysLeft) => ({ pool, window: "Weekly Limit Remaining", remaining, resets: inDays(daysLeft) });
const five = (pool, remaining) => ({ pool, window: "Five Hour Limit Remaining", remaining, resets: inDays(0.1) });
const { CLAUDE_PLAN: CLAUDE } = require("../router");
const GEMINI = "Gemini Models", AGY_CLAUDE = "Claude and GPT models";

test("paceFree: only a known Gemini week above 75% frees the order", () => {
  assert.strictEqual(PACE_FREE_ABOVE, 75);
  assert.strictEqual(paceFree(CHAIN, [week(GEMINI, 89, 6)], { now: NOW }).free, true);
  assert.match(paceFree(CHAIN, [week(GEMINI, 89, 6)], { now: NOW }).note, /Gemini Models has 89% of its week left \(above 75%\)/);
  assert.strictEqual(paceFree(CHAIN, [week(GEMINI, 75, 6)], { now: NOW }).free, false); // exactly 75: the pacing starts
  assert.strictEqual(paceFree(CHAIN, [week(GEMINI, 60, 6)], { now: NOW }).free, false);
  assert.strictEqual(paceFree(CHAIN, [five(GEMINI, 95)], { now: NOW }).free, false); // the five-hour row is not the week
  assert.strictEqual(paceFree(CHAIN, [week(GEMINI, 95, -1)], { now: NOW }).free, false); // that week is over: unknown
  assert.strictEqual(paceFree(CHAIN, [], { now: NOW }).free, false);
  assert.strictEqual(paceFree(CHAIN, [week(AGY_CLAUDE, 99, 6)], { now: NOW }).free, false); // another pool does not count
});

function brainWith(rows, levels = []) {
  const asked = [], logs = [];
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    poolRows: async () => rows, poolLevels: async () => levels, refreshPools: () => {}, notePoolFailure: () => {},
    askOne: async (provider, model) => { asked.push(model); return "Fine."; }, now: () => NOW, chain: CHAIN,
  });
  return async () => { asked.length = 0; await brain.handle("hello", { history: [], courses: [], log: (l) => logs.push(l) }); return asked[0]; };
}

// agy's Claude pool far ahead of its week, and the Claude plan too (so pacing and Claude-first would both move Neon back)
const ahead = [week(AGY_CLAUDE, 100, 6.9), week(CLAUDE, 100, 6.9), five(CLAUDE, 100)];

test("Gemini week above 75%: Neon low answers first even when agy's Claude pool and the Claude plan are far ahead of their pace", async () => {
  const send = brainWith([week(GEMINI, 80, 6.9), ...ahead]); // Gemini 80% but behind its week (pace -19)
  assert.strictEqual(await send(), "gemini-4-neon-low");
});

test("Gemini week at 75% or below: the pacing with agy's Claude pool and the Claude plan starts as before", async () => {
  const send = brainWith([week(GEMINI, 70, 6.5), ...ahead]); // Gemini behind its week (pace -23)
  assert.notStrictEqual(await send(), "gemini-4-neon-low");
  const paced = brainWith([week(GEMINI, 70, 6.5), week(AGY_CLAUDE, 100, 6.9)]); // no Claude plan rows: agy's Claude pool by pace
  assert.strictEqual(await paced(), "claude-sonnet-5-5-medium");
});

test("the safety rules still win above 75%: a Gemini pool nearly empty in its five-hour window steps back", async () => {
  const send = brainWith([week(GEMINI, 90, 6.9), ...ahead], [{ pool: GEMINI, remaining: 10 }, { pool: AGY_CLAUDE, remaining: 100 }]);
  assert.notStrictEqual(await send(), "gemini-4-neon-low");
});
