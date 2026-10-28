// core.test.js
// Tests handleTask (the engine shared by the command line and the web page) with fake models.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { handleTask } = require("./core");

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

test("forced chains skip routing and planning", async () => {
  let asked = null;
  const deps = fakes({ looksMultiPart: () => true, askChain: async (chain) => { asked = chain; return { answer: "x", used: chain[0] }; } });
  const result = await handleTask("a then b", { forced: "claude:opus,agy:x", deps });
  assert.strictEqual(result.rule, "forced");
  assert.deepStrictEqual(asked, [{ provider: "claude", model: "opus" }, { provider: "agy", model: "x" }]);
});
