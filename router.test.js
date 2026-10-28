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

test("every model says which quota pool it draws from (null for the Claude CLI)", () => {
  for (const [name, m] of Object.entries(MODELS)) {
    assert.ok(m.pool === null || typeof m.pool === "string", `${name} has no pool field`);
    assert.strictEqual(m.pool === null, m.provider === "claude", `${name}: only the claude CLI has no pool`);
  }
});
