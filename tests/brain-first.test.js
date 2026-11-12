// BOT_BRAIN_FIRST=claude puts Claude Code Sonnet (the Pro plan) first; anything else keeps the normal brain order.
const test = require("node:test");
const assert = require("node:assert");
const { CHAIN, chainFor, orderChain } = require("../brain");

test("no switch or an unknown value keeps the normal order", () => {
  assert.deepStrictEqual(chainFor(undefined), CHAIN);
  assert.deepStrictEqual(chainFor(""), CHAIN);
  assert.deepStrictEqual(chainFor("argon"), CHAIN);
});

test("claude puts Claude Code Sonnet first and keeps every model", () => {
  const c = chainFor(" Claude ");
  assert.strictEqual(c[0].model, CHAIN[CHAIN.length - 1].model);
  assert.strictEqual(c.length, CHAIN.length);
  assert.deepStrictEqual(c.map((m) => m.model).sort(), CHAIN.map((m) => m.model).sort());
});

test("the 15% rule still moves Claude to the end when the plan is nearly used", () => {
  const c = chainFor("claude");
  const levels = [{ pool: c[0].pool, window: "Five Hour Limit Remaining", remaining: 10 }];
  const order = orderChain(c, levels);
  assert.strictEqual(order[order.length - 1].model, c[0].model);
});
