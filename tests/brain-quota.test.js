// tests/brain-quota.test.js
// The brain's model order when quota runs low (experiments/2026-11-11-quota-stretch.md). Fake models and fake pool levels only:
// no agy, no claude, no network.
//   - the chain is Argon low -> agy Claude Sonnet low -> Claude Code Sonnet, and Flash is not in it
//   - Argon steps aside at 25% (its reserve), other pools at the normal 15%, Claude Code Sonnet stays the last resort
//   - agy prompts always go through the streaming call (stdin), never the command line (ENAMETOOLONG)
//   - pools are looked up again after every message, and a limit error is reported to quota.js

const test = require("node:test");
const assert = require("node:assert");

// Replace providers.ask BEFORE brain.js loads (brain.js takes ask from providers.js when it is first required).
const providers = require("../providers");
const asked = [];
providers.ask = async (provider, model, question, onText) => { asked.push({ provider, model, streams: typeof onText === "function" }); return "fine"; };

const { createBrain, CHAIN, RESERVES, orderChain } = require("../brain");
const { lowWithReserve } = require("../quota");
const { MODELS } = require("../router");

const ARGON = MODELS.argonLow.pool, AGY_CLAUDE = MODELS.sonnetInAgy.pool, PLAN = "Claude plan";
const names = (chain) => chain.map((m) => m.model);
const levels = (o) => Object.entries(o).map(([pool, remaining]) => ({ pool, remaining }));

test("the brain chain: Argon low, then agy Claude Sonnet low, then Claude Code Sonnet; no Flash", () => {
  assert.deepStrictEqual(names(CHAIN), ["gemini-4-argon-low", "claude-sonnet-5-5-low", "sonnet"]);
  assert.strictEqual(CHAIN[1].provider, "agy");
  assert.strictEqual(CHAIN[1].pool, "Claude and GPT models"); // agy's own pool, not the Claude Pro plan
  assert.strictEqual(CHAIN[2].provider, "claude");
  assert.ok(!CHAIN.some((m) => /flash/.test(m.model)), "Flash never writes the brain's answers");
  assert.strictEqual(RESERVES[ARGON], 25);
});

test("lowWithReserve: a reserve makes a pool low sooner, never later", () => {
  const l = levels({ [ARGON]: 22, "Gemini Models": 22, [AGY_CLAUDE]: 14 });
  assert.deepStrictEqual(lowWithReserve(l, { [ARGON]: 25 }).map((p) => p.pool), [ARGON, AGY_CLAUDE]);
  assert.deepStrictEqual(lowWithReserve(l, {}).map((p) => p.pool), [AGY_CLAUDE]);
  assert.deepStrictEqual(lowWithReserve(levels({ [ARGON]: 10 }), { [ARGON]: 5 }).map((p) => p.pool), [ARGON]); // 15% still applies
  assert.deepStrictEqual(lowWithReserve(levels({ [ARGON]: 30 }), { [ARGON]: 25 }), []);
  assert.deepStrictEqual(lowWithReserve([{ pool: ARGON, remaining: NaN }, null], { [ARGON]: 25 }), []); // unreadable rows say nothing
});

test("orderChain: Argon first while it has room, agy Sonnet first inside Argon's reserve, Claude Code Sonnet kept last", () => {
  const order = (o) => names(orderChain(CHAIN, levels(o)));
  assert.deepStrictEqual(order({}), ["gemini-4-argon-low", "claude-sonnet-5-5-low", "sonnet"]); // nothing known: as written
  assert.deepStrictEqual(order({ [ARGON]: 30 }), ["gemini-4-argon-low", "claude-sonnet-5-5-low", "sonnet"]);
  assert.deepStrictEqual(order({ [ARGON]: 22 }), ["claude-sonnet-5-5-low", "gemini-4-argon-low", "sonnet"]); // the reserve
  // Argon in its reserve AND agy's Claude pool low: Argon's reserve is used before Omri's Claude Pro plan
  assert.deepStrictEqual(order({ [ARGON]: 22, [AGY_CLAUDE]: 10 }), ["gemini-4-argon-low", "sonnet", "claude-sonnet-5-5-low"]);
  // Argon under 15%: the normal rule, everywhere the same
  assert.deepStrictEqual(order({ [ARGON]: 10 }), ["claude-sonnet-5-5-low", "sonnet", "gemini-4-argon-low"]);
  assert.deepStrictEqual(order({ [ARGON]: 10, [AGY_CLAUDE]: 10 }), ["sonnet", "gemini-4-argon-low", "claude-sonnet-5-5-low"]);
  // everything low: the one with the most room first
  assert.deepStrictEqual(order({ [ARGON]: 10, [AGY_CLAUDE]: 5, [PLAN]: 2 }), ["gemini-4-argon-low", "claude-sonnet-5-5-low", "sonnet"]);
});

// A brain with fake stores; askOne records which model was asked.
function brainWith(extra = {}) {
  const seen = { models: [], refreshed: 0, failures: [] };
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [], create: () => ({}) },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    fallback: async () => ({ answer: "old path" }),
    askOne: async (provider, model) => { seen.models.push(model); return "An answer."; },
    poolLevels: async () => [],
    refreshPools: () => { seen.refreshed++; },
    notePoolFailure: (m, message) => { seen.failures.push([m.model, message]); },
    now: () => Date.parse("2026-11-11T12:00:00Z"),
    ...extra,
  });
  return { brain, seen };
}
const run = (brain, task = "hi", opts = {}) => brain.handle(task, { history: [], courses: [], ...opts });

test("the brain reads the pool levels (awaited) and asks agy Sonnet first when Argon is in its reserve", async () => {
  const { brain, seen } = brainWith({ poolLevels: async () => levels({ [ARGON]: 22 }) });
  const lines = [];
  const r = await run(brain, "hi", { log: (s) => lines.push(s) });
  assert.deepStrictEqual(seen.models, ["claude-sonnet-5-5-low"]);
  assert.strictEqual(r.used.model, "claude-sonnet-5-5-low");
  assert.ok(lines.some((l) => /Gemini 4 Argon 22% left: asking claude-sonnet-5-5-low first/.test(l)), lines.join("\n"));
});

test("with room in Argon the brain asks Argon first; a broken quota lookup changes nothing", async () => {
  const a = brainWith({ poolLevels: async () => levels({ [ARGON]: 60 }) });
  await run(a.brain);
  assert.deepStrictEqual(a.seen.models, ["gemini-4-argon-low"]);
  const b = brainWith({ poolLevels: async () => { throw new Error("agy is gone"); } });
  await run(b.brain);
  assert.deepStrictEqual(b.seen.models, ["gemini-4-argon-low"]);
});

test("after every message the pools are looked up again; a limit error is reported to quota", async () => {
  let n = 0;
  const { brain, seen } = brainWith({ askOne: async (provider, model) => { seen.models.push(model); if (n++ === 0) throw new Error("You've hit your limit - resets 3pm"); return "ok"; } });
  const r = await run(brain);
  assert.strictEqual(r.answer, "ok");
  assert.deepStrictEqual(seen.models, ["gemini-4-argon-low", "claude-sonnet-5-5-low"]);
  assert.strictEqual(seen.failures.length, 1);
  assert.strictEqual(seen.failures[0][0], "gemini-4-argon-low");
  assert.strictEqual(seen.refreshed, 1);
});

test("agy prompts always go through the streaming call (stdin), even when nothing is shown while writing", async () => {
  asked.length = 0;
  const { brain } = brainWith({ askOne: undefined, chain: [MODELS.sonnetInAgy, MODELS.claudeSonnet] });
  const r = await run(brain);
  assert.strictEqual(r.answer, "fine");
  assert.deepStrictEqual(asked, [{ provider: "agy", model: "claude-sonnet-5-5-low", streams: true }]);
});
