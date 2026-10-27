// router.test.js
// Checks that the routing rules send example tasks where we expect.
// Run with:  node --test
// Node has a built-in test runner, so no extra library is needed.

const test = require("node:test");
const assert = require("node:assert");
const { route } = require("./router");

test("Google products go to Gemini", () => {
  assert.strictEqual(route("What is on my calendar tomorrow?").rule, "google");
  assert.strictEqual(route("Draft a gmail reply to my professor").provider, "agy");
});

test("deep-reasoning tasks go to the strongest model", () => {
  const choice = route("Compare the trade-offs of two database designs for a chat app");
  assert.strictEqual(choice.rule, "hard");
  assert.strictEqual(choice.model, "gemini-4-argon-medium");
});

test("very long tasks count as hard", () => {
  assert.strictEqual(route("x ".repeat(700)).rule, "hard");
});

test("coding tasks go to Claude Sonnet", () => {
  const choice = route("Fix this function, it throws an error when the list is empty");
  assert.strictEqual(choice.rule, "code");
  assert.strictEqual(choice.provider, "claude");
});

test("short simple questions go to the cheap model", () => {
  assert.strictEqual(route("What is the capital of France?").rule, "quick");
});

test("medium-length plain tasks use the fallback", () => {
  const task = "Write a friendly paragraph introducing myself to my new roommates, mentioning that I study computer science and enjoy hiking.";
  assert.strictEqual(route(task).rule, "fallback");
});

test("Google beats code when both match", () => {
  assert.strictEqual(route("Write a script that reads my calendar").rule, "google");
});
