// Claude first (quota.js claudeFirst): Claude Code answers first only when its 5-hour window is above 60%, Argon's week is under 50%
// and Claude's week is on pace. Anything unknown keeps the normal order.
const test = require("node:test");
const assert = require("node:assert");
const { claudeFirst } = require("../quota");

const NOW = Date.parse("2026-11-13T12:00:00Z");
const H = 3600 * 1000, D = 24 * H;
const at = (ms) => new Date(NOW + ms).toISOString();
const CHAIN = [
  { provider: "agy", model: "gemini-4-argon-low" },
  { provider: "agy", model: "claude-sonnet-low" },
  { provider: "claude", model: "sonnet" },
];
const names = (r) => r.chain.map((m) => m.model);
// Claude's week resets in 3.5 days (half the week left): 50% left is exactly on pace.
function rows({ five = 80, fiveResets = at(2 * H), week = 70, argon = 30, sonnetWeek = null } = {}) {
  const out = [
    { pool: "Claude plan", window: "Five Hour Limit Remaining", remaining: five, resets: fiveResets },
    { pool: "Claude plan", window: "Weekly Limit Remaining", remaining: week, resets: at(3.5 * D) },
    { pool: "Gemini 4 Argon", window: "Gemini 4 Argon Weekly Limit", remaining: argon, resets: at(2 * D) },
  ];
  if (sonnetWeek !== null) out.push({ pool: "Claude plan (Sonnet)", window: "Sonnet Weekly Limit Remaining", remaining: sonnetWeek, resets: at(3.5 * D) });
  return out;
}

test("all three hold: Claude Code moves to the front and the note says why", () => {
  const r = claudeFirst(CHAIN, rows(), { now: NOW });
  assert.deepStrictEqual(names(r), ["sonnet", "gemini-4-argon-low", "claude-sonnet-low"]);
  assert.match(r.note, /80% left.*Argon's week has 30% left/);
});

test("the 5-hour window at 60% or less keeps the normal order", () => {
  assert.deepStrictEqual(names(claudeFirst(CHAIN, rows({ five: 60 }), { now: NOW })), names({ chain: CHAIN }));
});

test("Argon at 50% or more keeps the normal order", () => {
  assert.strictEqual(claudeFirst(CHAIN, rows({ argon: 50 }), { now: NOW }).note, "");
});

test("Claude's week behind pace keeps the normal order (Omri's own coding needs it)", () => {
  assert.strictEqual(claudeFirst(CHAIN, rows({ week: 40 }), { now: NOW }).note, "");
  assert.strictEqual(claudeFirst(CHAIN, rows({ sonnetWeek: 30 }), { now: NOW }).note, "");
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ sonnetWeek: 60 }), { now: NOW }).note, "");
});

test("a 5-hour window whose reset has passed counts as full again", () => {
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ five: 10, fiveResets: at(-H) }), { now: NOW }).note, "");
});

test("unknown numbers keep the normal order", () => {
  assert.strictEqual(claudeFirst(CHAIN, [], { now: NOW }).note, "");
  assert.strictEqual(claudeFirst(CHAIN, rows().filter((r) => r.pool !== "Gemini 4 Argon"), { now: NOW }).note, "");
  assert.strictEqual(claudeFirst(CHAIN, rows().filter((r) => !/Weekly/.test(r.window) || r.pool !== "Claude plan"), { now: NOW }).note, "");
});

test("a chain without Claude Code is left alone", () => {
  const agyOnly = CHAIN.slice(0, 2);
  assert.deepStrictEqual(claudeFirst(agyOnly, rows(), { now: NOW }).chain, agyOnly);
});
