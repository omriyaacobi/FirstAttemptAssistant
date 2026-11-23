// tests/brain-quota.test.js
// The brain's model order when quota runs low (experiments/2026-11-11-quota-stretch.md). Fake models and fake pool levels only:
// no agy, no claude, no network.
//   - the chain is Neon low -> Hydrogen medium -> agy Claude Sonnet low -> Claude Code Sonnet (2026-11-23: Argon left), and Flash is not in it
//   - the Gemini Models pool steps aside at 25% (its reserve), other pools at the normal 15%, Claude Code Sonnet stays the last resort
//   - agy prompts always go through the streaming call (stdin), never the command line (ENAMETOOLONG)
//   - pools are looked up again after every message, and a limit error is reported to quota.js

const test = require("node:test");
const assert = require("node:assert");

// Replace providers.ask BEFORE brain.js loads (brain.js takes ask from providers.js when it is first required).
const providers = require("../providers");
const asked = [];
providers.ask = async (provider, model, question, onText) => { asked.push({ provider, model, streams: typeof onText === "function" }); return "fine"; };

const { createBrain, CHAIN, PHOTO_CHAIN, RESERVES, orderChain } = require("../brain");
const { lowWithReserve } = require("../quota");
const { MODELS } = require("../router");

const GEMINI_POOL = MODELS.neonLow.pool, AGY_CLAUDE = MODELS.sonnetInAgy.pool, PLAN = "Claude plan";
const names = (chain) => chain.map((m) => m.model);
const levels = (o) => Object.entries(o).map(([pool, remaining]) => ({ pool, remaining }));

test("the brain chain: Neon low, Hydrogen medium, agy Claude Sonnet low, then Claude Code Sonnet; no Flash, no Argon (2026-11-23)", () => {
  assert.deepStrictEqual(names(CHAIN), ["gemini-4-neon-low", "gemini-4-hydrogen-medium", "claude-sonnet-5-5-low", "sonnet"]);
  assert.strictEqual(CHAIN[0].pool, "Gemini Models");
  assert.strictEqual(CHAIN[1].pool, "Gemini Models"); // Neon and Hydrogen share one pool
  assert.strictEqual(CHAIN[2].provider, "agy");
  assert.strictEqual(CHAIN[2].pool, "Claude and GPT models"); // agy's own pool, not the Claude Pro plan
  assert.strictEqual(CHAIN[3].provider, "claude");
  assert.ok(!CHAIN.some((m) => /flash/.test(m.model)), "Flash never writes the brain's answers");
  assert.ok(!CHAIN.some((m) => /argon/.test(m.model)), "Argon is in no chain: it spends the same pool as Neon (experiments/2026-11-23-argon-pool.md)");
  assert.deepStrictEqual(PHOTO_CHAIN.map((m) => m.model), ["gemini-4-neon-low", "gemini-4-hydrogen-medium"]);
  assert.strictEqual(RESERVES[GEMINI_POOL], 25);
});

test("lowWithReserve: a reserve makes a pool low sooner, never later", () => {
  const l = levels({ [GEMINI_POOL]: 22, [AGY_CLAUDE]: 14 });
  assert.deepStrictEqual(lowWithReserve(l, { [GEMINI_POOL]: 25 }).map((p) => p.pool), [GEMINI_POOL, AGY_CLAUDE]);
  assert.deepStrictEqual(lowWithReserve(l, {}).map((p) => p.pool), [AGY_CLAUDE]);
  assert.deepStrictEqual(lowWithReserve(levels({ [GEMINI_POOL]: 10 }), { [GEMINI_POOL]: 5 }).map((p) => p.pool), [GEMINI_POOL]); // 15% still applies
  assert.deepStrictEqual(lowWithReserve(levels({ [GEMINI_POOL]: 30 }), { [GEMINI_POOL]: 25 }), []);
  assert.deepStrictEqual(lowWithReserve([{ pool: GEMINI_POOL, remaining: NaN }, null], { [GEMINI_POOL]: 25 }), []); // unreadable rows say nothing
});

test("orderChain: Neon, then Hydrogen, while their pool has room; the 25% reserve and the 15% rule still work; Claude Code Sonnet kept last", () => {
  const order = (o) => names(orderChain(CHAIN, levels(o)));
  const NH = ["gemini-4-neon-low", "gemini-4-hydrogen-medium"], GEM = GEMINI_POOL, SA = "claude-sonnet-5-5-low";
  assert.deepStrictEqual(order({}), [...NH, SA, "sonnet"]); // nothing known (e.g. no Argon row any more): as written
  assert.deepStrictEqual(order({ [GEM]: 30 }), [...NH, SA, "sonnet"]);
  assert.deepStrictEqual(order({ [GEM]: 22 }), [SA, ...NH, "sonnet"]); // the reserve: everyday chat goes to agy Sonnet first
  // the Gemini pool in its reserve AND agy's Claude pool low: the reserve is used before Omri's Claude Pro plan
  assert.deepStrictEqual(order({ [GEM]: 22, [AGY_CLAUDE]: 10 }), [...NH, "sonnet", SA]);
  // the Gemini pool under 15%: the normal rule, everywhere the same
  assert.deepStrictEqual(order({ [GEM]: 10 }), [SA, "sonnet", ...NH]);
  // everything low: the one with the most room first
  assert.deepStrictEqual(order({ [GEM]: 1, [AGY_CLAUDE]: 5, [PLAN]: 2 }), [SA, "sonnet", ...NH]);
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

test("the brain reads the pool levels (awaited) and asks agy Sonnet first when the Gemini Models pool is in its reserve", async () => {
  const { brain, seen } = brainWith({ poolLevels: async () => levels({ [GEMINI_POOL]: 22 }) });
  const lines = [];
  const r = await run(brain, "hi", { log: (s) => lines.push(s) });
  assert.deepStrictEqual(seen.models, ["claude-sonnet-5-5-low"]);
  assert.strictEqual(r.used.model, "claude-sonnet-5-5-low");
  assert.ok(lines.some((l) => /Gemini Models 22% left.*: asking claude-sonnet-5-5-low first/.test(l)), lines.join("\n"));
});

test("with room in Gemini Models the brain asks Neon low first; a broken quota lookup changes nothing", async () => {
  const a = brainWith({ poolLevels: async () => levels({ [GEMINI_POOL]: 60 }) });
  await run(a.brain);
  assert.deepStrictEqual(a.seen.models, ["gemini-4-neon-low"]);
  const b = brainWith({ poolLevels: async () => { throw new Error("agy is gone"); } });
  await run(b.brain);
  assert.deepStrictEqual(b.seen.models, ["gemini-4-neon-low"]);
});

test("after every message the pools are looked up again; a limit error is reported to quota", async () => {
  let n = 0;
  const { brain, seen } = brainWith({ askOne: async (provider, model) => { seen.models.push(model); if (n++ === 0) throw new Error("You've hit your limit - resets 3pm"); return "ok"; } });
  const r = await run(brain);
  assert.strictEqual(r.answer, "ok");
  assert.deepStrictEqual(seen.models, ["gemini-4-neon-low", "gemini-4-hydrogen-medium"]);
  assert.strictEqual(seen.failures.length, 1);
  assert.strictEqual(seen.failures[0][0], "gemini-4-neon-low");
  assert.strictEqual(seen.refreshed, 1);
});

test("agy prompts always go through the streaming call (stdin), even when nothing is shown while writing", async () => {
  asked.length = 0;
  // An agy model WITHOUT a warm spare takes this cold path (2026-11-23: every model the brain or the picker can put first is warm
  // now, so the test uses agy's Claude medium; with a warm model this test would start a REAL agy, the pool is not faked here).
  const { WARM_MODELS } = require("../brain");
  assert.ok(!WARM_MODELS.has(MODELS.claudeInAgy.model));
  const { brain } = brainWith({ askOne: undefined, chain: [MODELS.claudeInAgy, MODELS.claudeSonnet] });
  const r = await run(brain);
  assert.strictEqual(r.answer, "fine");
  assert.deepStrictEqual(asked, [{ provider: "agy", model: MODELS.claudeInAgy.model, streams: true }]);
});

test("OMRI'S CHOICE (model-choice.js): the picked model is asked first, the answer says so, and if it fails the normal order answers", async () => {
  const pick = { get: () => ({ key: "neonMedium", label: "Neon medium", until: Date.parse("2026-11-11T13:00:00Z"), model: MODELS.neonMedium }) };
  const { brain, seen } = brainWith({ modelChoice: pick });
  const r = await run(brain);
  assert.strictEqual(seen.models[0], MODELS.neonMedium.model);
  assert.match(r.reason, /your choice$/);
  const failing = brainWith({ modelChoice: pick, askOne: async (provider, model) => { if (model === MODELS.neonMedium.model) throw new Error("down"); return "An answer."; } });
  const r2 = await run(failing.brain);
  assert.notStrictEqual(r2.used.model, MODELS.neonMedium.model);
  assert.match(r2.reason, /your choice failed, the next model answered/);
  const none = brainWith({ modelChoice: { get: () => null } });
  await run(none.brain);
  assert.strictEqual(none.seen.models[0], CHAIN[0].model);
});
