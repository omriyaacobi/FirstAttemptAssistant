// planner.test.js
// Tests the planner without calling any real model (fakes stand in for the models).
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { validatePlan, plan, runPlan, MAX_SUBTASKS } = require("./planner");

test("validatePlan accepts a good plan and trims text", () => {
  const out = validatePlan({ subtasks: [{ id: 1, task: "  a  ", type: "quick", needs: [] }] });
  assert.deepStrictEqual(out, [{ id: 1, task: "a", type: "quick", needs: [] }]);
});

test("validatePlan rejects empty, oversized and malformed plans", () => {
  assert.strictEqual(validatePlan(null), null);
  assert.strictEqual(validatePlan({ subtasks: [] }), null);
  assert.strictEqual(validatePlan({ subtasks: [{ id: 1, task: "", type: "quick", needs: [] }] }), null);
  const tooMany = Array.from({ length: MAX_SUBTASKS + 1 }, (_, i) => ({ id: i + 1, task: "t", type: "quick", needs: [] }));
  assert.strictEqual(validatePlan({ subtasks: tooMany }), null);
  assert.strictEqual(validatePlan({ subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }, { id: 1, task: "b", type: "quick", needs: [] }] }), null);
});

test("validatePlan fixes unknown types and drops bad 'needs'", () => {
  const out = validatePlan({
    subtasks: [
      { id: 1, task: "a", type: "banana", needs: [5] },
      { id: 2, task: "b", type: "code", needs: [1, 2, 9] },
    ],
  });
  assert.strictEqual(out[0].type, "general");
  assert.deepStrictEqual(out[0].needs, []);
  assert.deepStrictEqual(out[1].needs, [1]);
});

test("plan falls back to the second planner model when the first fails", async () => {
  const tried = [];
  const fake = async (prompt, model) => {
    tried.push(model);
    if (model === "gemini-3.8-flash-high") throw new Error("boom");
    return { subtasks: [{ id: 1, task: "x", type: "quick", needs: [] }] };
  };
  const result = await plan("anything", { askStructured: fake });
  assert.strictEqual(result.plannedBy, "gemini-4-argon-low"); // flash-high failed, so the next planner model answered
  assert.strictEqual(tried.length, 2);
});

test("plan passes the conversation context to the planner model", async () => {
  let seenPrompt = null;
  const fake = async (prompt) => { seenPrompt = prompt; return { subtasks: [{ id: 1, task: "x", type: "quick", needs: [] }] }; };
  await plan("do the same for Python", { askStructured: fake, context: "User: write a JS function" });
  assert.match(seenPrompt, /User: write a JS function/);
  assert.match(seenPrompt, /do the same for Python/);
});

test("plan throws when every planner model fails", async () => {
  await assert.rejects(plan("anything", { askStructured: async () => ({ nope: true }) }), /Planner failed/);
});

test("runPlan runs independent steps at the same time", async () => {
  const log = [];
  const run = async (chain, prompt) => {
    log.push("start " + prompt.split("\n").pop());
    await new Promise((r) => setTimeout(r, 30));
    log.push("end " + prompt.split("\n").pop());
    return { answer: "ok", used: chain[0] };
  };
  const subtasks = [
    { id: 1, task: "A", type: "quick", needs: [] },
    { id: 2, task: "B", type: "code", needs: [] },
  ];
  await runPlan(subtasks, "A and B", { run });
  assert.deepStrictEqual(log.slice(0, 2), ["start A", "start B"]); // both started before either ended
});

test("runPlan gives a dependent step the earlier answer", async () => {
  const prompts = {};
  const run = async (chain, prompt) => {
    const key = prompt.split("\n").pop();
    prompts[key] = prompt;
    return { answer: key === "A" ? "ANSWER-FROM-A" : "done", used: chain[0] };
  };
  const subtasks = [
    { id: 1, task: "A", type: "quick", needs: [] },
    { id: 2, task: "B", type: "general", needs: [1] },
  ];
  const results = await runPlan(subtasks, "A then B", { run });
  assert.match(prompts["B"], /ANSWER-FROM-A/);
  assert.match(prompts["B"], /A then B/); // the overall request is included as background
  assert.strictEqual(results.length, 2);
});

test("runPlan skips steps that depend on a failed step", async () => {
  const run = async (chain, prompt) => {
    if (prompt.endsWith("A")) throw new Error("model down");
    return { answer: "ok", used: chain[0] };
  };
  const subtasks = [
    { id: 1, task: "A", type: "quick", needs: [] },
    { id: 2, task: "B", type: "quick", needs: [1] },
    { id: 3, task: "C", type: "quick", needs: [] },
  ];
  const results = await runPlan(subtasks, "A B C", { run });
  assert.match(results[0].error, /model down/);
  assert.match(results[1].error, /skipped because step 1 failed/);
  assert.strictEqual(results[2].answer, "ok"); // an unrelated step still ran
});

test("runPlan does not loop forever on an impossible dependency", async () => {
  const run = async (chain) => ({ answer: "ok", used: chain[0] });
  const results = await runPlan([{ id: 1, task: "A", type: "quick", needs: [7] }], "A", { run });
  assert.match(results[0].error, /never ran/);
});
