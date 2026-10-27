// router.test.js
// Checks the routing rules and the fallback logic without calling any real model.
// Run with:  node --test
// Node has a built-in test runner, so no extra library is needed.

const test = require("node:test");
const assert = require("node:assert");
const { route } = require("./router");
const { askChain } = require("./providers");

// chain[0] is the first-choice model for a task
const first = (task) => route(task).chain[0];

test("Google products go to Gemini", () => {
  assert.strictEqual(route("What is on my calendar tomorrow?").rule, "google");
  assert.strictEqual(first("Draft a gmail reply to my professor").provider, "agy");
});

test("deep-reasoning tasks go to Argon", () => {
  const plan = route("Compare the trade-offs of two database designs for a chat app");
  assert.strictEqual(plan.rule, "hard");
  assert.strictEqual(plan.chain[0].model, "gemini-4-argon-medium");
});

test("very long tasks count as hard", () => {
  assert.strictEqual(route("x ".repeat(700)).rule, "hard");
});

test("coding tasks go to Claude Sonnet first", () => {
  const plan = route("Fix this function, it throws an error when the list is empty");
  assert.strictEqual(plan.rule, "code");
  assert.strictEqual(plan.chain[0].provider, "claude");
});

test("short simple questions go to the cheap Gemini model", () => {
  const plan = route("What is the capital of France?");
  assert.strictEqual(plan.rule, "quick");
  assert.strictEqual(plan.chain[0].model, "gemini-3.8-flash-low");
});

test("medium-length plain tasks use the Gemini default", () => {
  const task = "Write a friendly paragraph introducing myself to my new roommates, mentioning that I study computer science and enjoy hiking.";
  const plan = route(task);
  assert.strictEqual(plan.rule, "default");
  assert.strictEqual(plan.chain[0].provider, "agy");
});

test("Google beats code when both match", () => {
  assert.strictEqual(route("Write a script that reads my calendar").rule, "google");
});

test("Claude inside agy is never the first choice", () => {
  for (const task of ["hi", "fix this bug", "design a system", "check my calendar", "x ".repeat(700)]) {
    assert.notStrictEqual(first(task).model, "claude-sonnet-5-5-medium");
  }
});

test("askChain falls back to the next model when one fails", async () => {
  const calls = [];
  const fakeAsk = async (provider, model) => {
    calls.push(`${provider}/${model}`);
    if (model === "bad") throw new Error("out of quota");
    return "the answer";
  };
  const chain = [{ provider: "agy", model: "bad" }, { provider: "claude", model: "sonnet" }];
  const result = await askChain(chain, "hi", { askOne: fakeAsk });
  assert.strictEqual(result.answer, "the answer");
  assert.deepStrictEqual(result.used, { provider: "claude", model: "sonnet" });
  assert.deepStrictEqual(calls, ["agy/bad", "claude/sonnet"]);
});

test("askChain stops at the first success", async () => {
  const calls = [];
  const fakeAsk = async (provider, model) => { calls.push(model); return "ok"; };
  await askChain([{ provider: "a", model: "one" }, { provider: "b", model: "two" }], "hi", { askOne: fakeAsk });
  assert.deepStrictEqual(calls, ["one"]);
});

test("askChain treats an empty answer as a failure", async () => {
  const fakeAsk = async (provider, model) => (model === "empty" ? "" : "real answer");
  const result = await askChain([{ provider: "a", model: "empty" }, { provider: "b", model: "good" }], "hi", { askOne: fakeAsk });
  assert.strictEqual(result.answer, "real answer");
});

test("askChain throws when every model fails", async () => {
  const fakeAsk = async () => { throw new Error("nope"); };
  await assert.rejects(askChain([{ provider: "a", model: "x" }, { provider: "b", model: "y" }], "hi", { askOne: fakeAsk }), /Every model in the chain failed/);
});
