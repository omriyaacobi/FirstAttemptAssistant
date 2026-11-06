// router.test.js
// Checks the menu of destinations and their fallback chains.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { MODELS, DESTINATIONS, DEFAULT_CHAIN, chainForDestination, chainForType } = require("./router");

test("the default chain starts with Claude Sonnet", () => {
  assert.deepStrictEqual(DEFAULT_CHAIN[0], MODELS.claudeSonnet);
});

test("every destination has a first choice and at least one fallback", () => {
  for (const [name, chain] of Object.entries(DESTINATIONS)) {
    assert.ok(chain.length >= 2, `${name} needs a fallback`);
  }
});

test("Claude inside agy is never a first choice, only a last resort", () => {
  for (const [name, chain] of Object.entries(DESTINATIONS)) {
    assert.notStrictEqual(chain[0].model, MODELS.claudeInAgy.model, `${name} starts with the smallest quota`);
  }
});

test("flash on low effort is not on the menu any more", () => {
  const allModels = Object.values(DESTINATIONS).flat().map((m) => m.model);
  assert.ok(!allModels.includes("gemini-3.8-flash-low"));
});

test("chainForDestination only returns known destinations", () => {
  assert.strictEqual(chainForDestination("claude-sonnet"), DESTINATIONS["claude-sonnet"]);
  assert.strictEqual(chainForDestination("made-up-model"), null);
  assert.strictEqual(chainForDestination("toString"), null); // inherited object properties are not destinations
  assert.strictEqual(chainForDestination("__proto__"), null);
});

test("chainForType maps planner types to chains and falls back to the default", () => {
  assert.strictEqual(chainForType("code")[0].provider, "claude");
  assert.strictEqual(chainForType("hard")[0].model, "gemini-4-argon-medium");
  assert.strictEqual(chainForType("nonsense"), DEFAULT_CHAIN);
});

test("every model says which quota pool(s) it draws from; the Claude CLI models draw from the Claude plan", () => {
  const { poolsOf, CLAUDE_PLAN } = require("./router");
  for (const [name, m] of Object.entries(MODELS)) {
    assert.ok(poolsOf(m).length > 0, `${name} has no pool`);
    assert.strictEqual(poolsOf(m).includes(CLAUDE_PLAN), m.provider === "claude", `${name}: only the claude CLI draws from the Claude plan`);
  }
});

test("poolsForModel finds a model's pools by provider and name; unknown models have none", () => {
  const { poolsForModel, CLAUDE_PLAN, CLAUDE_OPUS_WEEK } = require("./router");
  assert.deepStrictEqual(poolsForModel("claude", "opus"), [CLAUDE_PLAN, CLAUDE_OPUS_WEEK]);
  assert.deepStrictEqual(poolsForModel("agy", "gemini-4-argon-low"), ["Gemini 4 Argon"]);
  assert.deepStrictEqual(poolsForModel("agy", "nothing"), []);
});

test("every destination ends with a Claude model (a Claude pool or Claude inside agy), so there is always a last resort", () => {
  for (const [name, chain] of Object.entries(DESTINATIONS)) {
    assert.match(chain[chain.length - 1].model, /claude|sonnet|opus/, name);
  }
});

test("web destinations only use models that can search, so nobody answers from memory", () => {
  for (const name of ["web-search", "web-research"]) {
    assert.ok(chainForDestination(name).length >= 2);
    for (const m of chainForDestination(name)) assert.ok(["web", "research"].includes(m.provider), name);
  }
  assert.strictEqual(chainForDestination("web-search")[0].provider, "web");
  assert.strictEqual(chainForDestination("web-research")[0].provider, "research");
});

test("planner steps can use the web too", () => {
  assert.strictEqual(chainForType("web"), chainForDestination("web-search"));
  assert.strictEqual(chainForType("research"), chainForDestination("web-research"));
});
