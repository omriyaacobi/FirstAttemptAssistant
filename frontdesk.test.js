// frontdesk.test.js
// Tests the checks around the front desk model, without calling any real model.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { decide, validateDecision, buildPrompt, ACTIONS, SCHEMA, BRIEF_FILE } = require("./frontdesk");
const { DESTINATIONS } = require("./router");

test("validateDecision accepts each kind of good decision", () => {
  assert.deepStrictEqual(validateDecision({ action: "answer", destination: "none", answer: " 56 ", reason: "simple" }),
    { action: "answer", destination: null, answer: "56", reason: "simple" });
  assert.strictEqual(validateDecision({ action: "clarify", destination: "none", answer: "What do you mean?", reason: "vague" }).action, "clarify");
  assert.strictEqual(validateDecision({ action: "delegate", destination: "claude-sonnet", answer: "", reason: "code" }).destination, "claude-sonnet");
  assert.strictEqual(validateDecision({ action: "split", destination: "none", answer: "", reason: "three jobs" }).action, "split");
});

test("improve: accepted with a reply, rejected without one", () => {
  const d = validateDecision({ action: "improve", destination: "none", answer: "Use the button below.", reason: "wants a redesign" });
  assert.deepStrictEqual(d, { action: "improve", destination: null, answer: "Use the button below.", reason: "wants a redesign" });
  assert.strictEqual(validateDecision({ action: "improve", destination: "none", answer: "", reason: "x" }), null);
});

test("SECURITY: a destination that is not on the menu is rejected", () => {
  for (const bad of ["rm -rf /", "gemini-9-ultra", "none", "", "toString", "__proto__", "claude-sonnet; whoami", 42, null]) {
    assert.strictEqual(validateDecision({ action: "delegate", destination: bad, answer: "", reason: "x" }), null, String(bad));
  }
});

test("validateDecision rejects unknown actions and malformed input", () => {
  assert.strictEqual(validateDecision({ action: "run_command", destination: "none", answer: "", reason: "" }), null);
  assert.strictEqual(validateDecision(null), null);
  assert.strictEqual(validateDecision("delegate"), null);
  assert.strictEqual(validateDecision({}), null);
});

test("answer and clarify need real text, and not too much of it", () => {
  assert.strictEqual(validateDecision({ action: "answer", destination: "none", answer: "   ", reason: "x" }), null);
  assert.strictEqual(validateDecision({ action: "clarify", destination: "none", answer: "", reason: "x" }), null);
  assert.strictEqual(validateDecision({ action: "answer", destination: "none", answer: "x".repeat(9000), reason: "x" }), null);
});

test("the reason is trimmed and cut", () => {
  const d = validateDecision({ action: "split", destination: "none", answer: "", reason: "  " + "r".repeat(500) });
  assert.strictEqual(d.reason.length, 200);
});

test("the schema only allows the menu names (plus none)", () => {
  assert.deepStrictEqual([...SCHEMA.properties.destination.enum].sort(), [...Object.keys(DESTINATIONS), "none"].sort());
  assert.deepStrictEqual(SCHEMA.properties.action.enum, ACTIONS);
});

test("the briefing describes every destination and every action", () => {
  const brief = fs.readFileSync(BRIEF_FILE, "utf8");
  for (const name of Object.keys(DESTINATIONS)) assert.ok(brief.includes(name), `router-brief.md does not mention ${name}`);
  for (const action of ACTIONS) assert.ok(brief.includes(action), `router-brief.md does not mention ${action}`);
});

test("the prompt contains the briefing, the history and the message between markers", () => {
  const prompt = buildPrompt("what is 7 times 8?", { history: "Conversation so far (oldest first), for context only:\nUser: hi", brief: "BRIEF TEXT" });
  assert.match(prompt, /^BRIEF TEXT/);
  assert.match(prompt, /User: hi/);
  assert.match(prompt, /<message>\nwhat is 7 times 8\?\n<\/message>/);
  assert.match(prompt, /Splitting is allowed/);
});

test("the prompt says so when splitting is turned off, and when there is no history", () => {
  const prompt = buildPrompt("x", { allowSplit: false, brief: "B" });
  assert.match(prompt, /do NOT choose the action "split"/);
  assert.match(prompt, /\(none, this is the first message\)/);
});

test("decide returns a validated decision from the model's reply", async () => {
  let seen = null;
  const fake = async (prompt, model, schema) => {
    seen = { prompt, model, schema };
    return { action: "delegate", destination: "gemini-flash", answer: "", reason: "easy" };
  };
  const decision = await decide("summarize this", { askStructured: fake, brief: "B" });
  assert.strictEqual(decision.destination, "gemini-flash");
  assert.strictEqual(seen.model, "gemini-3.8-flash-high");
  assert.strictEqual(seen.schema, SCHEMA);
});

test("decide throws when the reply is unusable, so the caller can fall back", async () => {
  await assert.rejects(decide("x", { askStructured: async () => ({ action: "delegate", destination: "evil" }), brief: "B" }), /unusable/);
  await assert.rejects(decide("x", { askStructured: async () => { throw new Error("agy down"); }, brief: "B" }), /agy down/);
});
