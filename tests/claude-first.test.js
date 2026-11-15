// Claude first, by pace (quota.js claudeFirst, Omri 2026-11-15): Claude Code answers first only when its week is 10+ points ahead
// of its pace AND 10+ points ahead of the agy pools' pace, with more than half of its 5-hour window left. Anything unknown keeps
// the normal order. pace = quota left (%) minus week left (%).
const test = require("node:test");
const assert = require("node:assert");
const { claudeFirst } = require("../quota");
const { CHAIN } = require("../brain");

const NOW = Date.parse("2026-11-15T10:00:00Z");
const H = 3600 * 1000, D = 24 * H;
const at = (ms) => new Date(NOW + ms).toISOString();
const names = (r) => r.chain.map((m) => m.model);
const NORMAL = CHAIN.map((m) => m.model);
// All weeks reset in 3.5 days (half the week left), so 50% left is exactly on pace (pace 0).
function rows({ five = 80, fiveResets = at(2 * H), week = 70, argon = 30, agyClaude = 7, sonnetWeek = null } = {}) {
  const out = [
    { pool: "Claude plan", window: "Five Hour Limit Remaining", remaining: five, resets: fiveResets },
    { pool: "Claude plan", window: "Weekly Limit Remaining", remaining: week, resets: at(3.5 * D) },
    { pool: "Gemini 4 Argon", window: "Gemini 4 Argon Weekly Limit", remaining: argon, resets: at(3.5 * D) },
    { pool: "Claude and GPT models", window: "Claude and GPT models Weekly Limit", remaining: agyClaude, resets: at(3.5 * D) },
  ];
  if (sonnetWeek !== null) out.push({ pool: "Claude plan (Sonnet)", window: "Sonnet Weekly Limit Remaining", remaining: sonnetWeek, resets: at(3.5 * D) });
  return out;
}

test("Claude's week ahead of its pace and of Argon's: Claude Code moves to the front and the note says why", () => {
  const r = claudeFirst(CHAIN, rows(), { now: NOW }); // Claude +20, Argon -20
  assert.deepStrictEqual(names(r), ["sonnet", "gemini-4-argon-low", "claude-sonnet-5-5-low"]);
  assert.match(r.note, /Claude Code's week is \+20 against its pace, Gemini 4 Argon only -20/);
});

test("Claude only on pace (less than 10 points ahead) keeps the normal order: the week stays for Omri's coding", () => {
  assert.deepStrictEqual(names(claudeFirst(CHAIN, rows({ week: 59 }), { now: NOW })), NORMAL);
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ week: 60 }), { now: NOW }).note, "");
});

test("Argon doing as well as Claude (less than 10 points behind it) keeps the normal order", () => {
  assert.strictEqual(claudeFirst(CHAIN, rows({ week: 70, argon: 61 }), { now: NOW }).note, "");
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ week: 70, argon: 60 }), { now: NOW }).note, "");
  assert.strictEqual(claudeFirst(CHAIN, rows({ week: 70, argon: 30, agyClaude: 65 }), { now: NOW }).note, "", "agy's Claude pool counts too");
});

test("the 5-hour window at half or less keeps the normal order; one whose reset passed counts as full", () => {
  assert.strictEqual(claudeFirst(CHAIN, rows({ five: 50 }), { now: NOW }).note, "");
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ five: 10, fiveResets: at(-H) }), { now: NOW }).note, "");
});

test("a Sonnet weekly behind its pace keeps the normal order", () => {
  assert.strictEqual(claudeFirst(CHAIN, rows({ sonnetWeek: 55 }), { now: NOW }).note, "");
  assert.notStrictEqual(claudeFirst(CHAIN, rows({ sonnetWeek: 65 }), { now: NOW }).note, "");
});

test("today's real numbers (2026-11-15 morning): Claude 74% with 5.2 days left is on pace, so Argon keeps answering", () => {
  const real = [
    { pool: "Claude plan", window: "Five Hour Limit Remaining", remaining: 89, resets: at(2.4 * H) },
    { pool: "Claude plan", window: "Weekly Limit Remaining", remaining: 74, resets: at(5.2 * D) },
    { pool: "Gemini 4 Argon", window: "Gemini 4 Argon Weekly Limit", remaining: 75, resets: at(5.6 * D) },
    { pool: "Claude and GPT models", window: "Claude and GPT models Weekly Limit", remaining: 7, resets: at(5 * D) },
  ];
  assert.deepStrictEqual(names(claudeFirst(CHAIN, real, { now: NOW })), NORMAL);
});

test("unknown numbers keep the normal order; a chain without Claude Code is left alone", () => {
  assert.strictEqual(claudeFirst(CHAIN, [], { now: NOW }).note, "");
  assert.strictEqual(claudeFirst(CHAIN, rows().filter((r) => r.pool === "Claude plan"), { now: NOW }).note, "", "no agy pace known");
  assert.strictEqual(claudeFirst(CHAIN, rows().filter((r) => !/Weekly/.test(r.window) || r.pool !== "Claude plan"), { now: NOW }).note, "");
  const agyOnly = CHAIN.slice(0, 2);
  assert.deepStrictEqual(claudeFirst(agyOnly, rows(), { now: NOW }).chain, agyOnly);
});
