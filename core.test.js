// core.test.js
// Tests handleTask (the engine shared by the command line and the web page) with fake models.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { handleTask, historyBlock, withContext, resultText, MAX_HISTORY_CHARS } = require("./core");

const used = { provider: "agy", model: "fake" };

// Fakes that stand in for the real planner, router and models.
const fakes = (overrides = {}) => ({
  looksMultiPart: () => false,
  route: () => ({ chain: [used], rule: "quick", reason: "test" }),
  chainForType: () => [used],
  askChain: async () => ({ answer: "single answer", used }),
  plan: async () => ({ subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }], plannedBy: "fake-planner" }),
  runPlan: async (subtasks) => subtasks.map((s) => ({ ...s, answer: "step answer", used })),
  ...overrides,
});

test("a simple task runs as a single job and never calls the planner", async () => {
  let plannerCalled = false;
  const deps = fakes({ plan: async () => { plannerCalled = true; } });
  const result = await handleTask("hi", { deps });
  assert.strictEqual(result.mode, "single");
  assert.strictEqual(result.answer, "single answer");
  assert.strictEqual(plannerCalled, false);
});

test("a multi-part task is split and returns every step", async () => {
  const deps = fakes({
    looksMultiPart: () => true,
    plan: async () => ({
      subtasks: [
        { id: 1, task: "a", type: "quick", needs: [] },
        { id: 2, task: "b", type: "code", needs: [] },
      ],
      plannedBy: "fake-planner",
    }),
  });
  const result = await handleTask("a then b", { deps });
  assert.strictEqual(result.mode, "split");
  assert.strictEqual(result.steps.length, 2);
  assert.strictEqual(result.plannedBy, "fake-planner");
});

test("noPlan keeps a multi-part task as one job", async () => {
  const deps = fakes({ looksMultiPart: () => true });
  const result = await handleTask("a then b", { noPlan: true, deps });
  assert.strictEqual(result.mode, "single");
});

test("if the planner fails, it falls back to one job", async () => {
  const logs = [];
  const deps = fakes({ looksMultiPart: () => true, plan: async () => { throw new Error("planner down"); } });
  const result = await handleTask("a then b", { deps, log: (l) => logs.push(l) });
  assert.strictEqual(result.mode, "single");
  assert.ok(logs.some((l) => l.includes("planner down")));
});

test("if the planner finds only one job, it is handled as one", async () => {
  const deps = fakes({ looksMultiPart: () => true });
  const result = await handleTask("also this", { deps });
  assert.strictEqual(result.mode, "single");
});

test("planOnly returns the plan without running anything", async () => {
  let ran = false;
  const deps = fakes({ looksMultiPart: () => true, runPlan: async () => { ran = true; }, askChain: async () => { ran = true; } });
  const result = await handleTask("a then b", { planOnly: true, deps });
  assert.strictEqual(result.mode, "plan");
  assert.strictEqual(ran, false);
});

test("log receives progress messages", async () => {
  const logs = [];
  await handleTask("hi", { deps: fakes(), log: (l) => logs.push(l) });
  assert.ok(logs.some((l) => l.startsWith("[router]")));
});

test("history is pasted in front of the new message for the models", async () => {
  let received = null;
  const deps = fakes({ askChain: async (chain, prompt) => { received = prompt; return { answer: "x", used }; } });
  const history = [{ role: "user", text: "My name is Omri" }, { role: "assistant", text: "Nice to meet you" }];
  await handleTask("What is my name?", { history, deps });
  assert.match(received, /User: My name is Omri/);
  assert.match(received, /Assistant: Nice to meet you/);
  assert.match(received, /What is my name\?$/); // the new message comes last
});

test("routing decides from the newest message only, not from the history", async () => {
  let routedOn = null;
  const deps = fakes({ route: (t) => { routedOn = t; return { chain: [used], rule: "quick", reason: "test" }; } });
  await handleTask("short follow-up", { history: [{ role: "user", text: "a very long earlier message ".repeat(50) }], deps });
  assert.strictEqual(routedOn, "short follow-up");
});

test("with no history the model gets the task unchanged", async () => {
  let received = null;
  const deps = fakes({ askChain: async (chain, prompt) => { received = prompt; return { answer: "x", used }; } });
  await handleTask("plain task", { deps });
  assert.strictEqual(received, "plain task");
});

test("a split plan also receives the history, and the planner gets it as context", async () => {
  let planContext = null;
  let runPrompt = null;
  const deps = fakes({
    looksMultiPart: () => true,
    plan: async (t, opts) => { planContext = opts.context; return { subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }, { id: 2, task: "b", type: "quick", needs: [] }], plannedBy: "p" }; },
    runPlan: async (subtasks, prompt) => { runPrompt = prompt; return subtasks.map((s) => ({ ...s, answer: "ok", used })); },
  });
  await handleTask("a then b", { history: [{ role: "user", text: "earlier" }], deps });
  assert.match(planContext, /User: earlier/);
  assert.match(runPrompt, /User: earlier/);
});

test("historyBlock keeps the newest messages when the history is too long", () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ role: "user", text: `message-${i} ` + "x".repeat(500) }));
  const block = historyBlock(history);
  assert.ok(block.length <= MAX_HISTORY_CHARS + 200); // small allowance for the heading
  assert.match(block, /message-99/); // newest kept
  assert.doesNotMatch(block, /message-0 /); // oldest dropped
});

test("historyBlock cuts one huge message and returns empty text for no history", () => {
  assert.strictEqual(historyBlock([]), "");
  assert.strictEqual(historyBlock(undefined), "");
  const block = historyBlock([{ role: "assistant", text: "y".repeat(10000) }]);
  assert.ok(block.length < 3200);
});

test("withContext and resultText", () => {
  assert.strictEqual(withContext("hi", []), "hi");
  assert.strictEqual(resultText({ mode: "single", answer: "A" }), "A");
  const split = resultText({ mode: "split", steps: [{ id: 1, task: "t1", answer: "a1" }, { id: 2, task: "t2", error: "boom" }] });
  assert.match(split, /Step 1: t1\na1/);
  assert.match(split, /Step 2: t2\n\(failed\)/);
});

test("forced chains skip routing and planning", async () => {
  let asked = null;
  const deps = fakes({ looksMultiPart: () => true, askChain: async (chain) => { asked = chain; return { answer: "x", used: chain[0] }; } });
  const result = await handleTask("a then b", { forced: "claude:opus,agy:x", deps });
  assert.strictEqual(result.rule, "forced");
  assert.deepStrictEqual(asked, [{ provider: "claude", model: "opus" }, { provider: "agy", model: "x" }]);
});
