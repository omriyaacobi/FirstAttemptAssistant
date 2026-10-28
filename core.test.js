// core.test.js
// Tests handleTask (the engine shared by the command line and the web page) with fake models.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { handleTask, historyBlock, withContext, resultText, MAX_HISTORY_CHARS } = require("./core");
const { DEFAULT_CHAIN } = require("./router");

const used = { provider: "agy", model: "fake" };
const chain = [used];

// Fakes that stand in for the real front desk, planner and models.
const fakes = (overrides = {}) => ({
  decide: async () => ({ action: "delegate", destination: "claude-sonnet", answer: "", reason: "test" }),
  chainForDestination: () => chain,
  chainForType: () => chain,
  lowPools: async () => [], // never the real agy /usage in tests
  askChain: async () => ({ answer: "model answer", used }),
  plan: async () => ({ subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }], plannedBy: "fake-planner" }),
  runPlan: async (subtasks) => subtasks.map((s) => ({ ...s, answer: "step answer", used })),
  ...overrides,
});

const decision = (action, extra = {}) => async () => ({ action, destination: null, answer: "", reason: "test", ...extra });

test("answer: the front desk replies itself and no other model is called", async () => {
  let asked = false;
  const deps = fakes({ decide: decision("answer", { answer: "56" }), askChain: async () => { asked = true; } });
  const result = await handleTask("7 times 8?", { deps });
  assert.strictEqual(result.mode, "single");
  assert.strictEqual(result.answer, "56");
  assert.strictEqual(result.rule, "answered directly");
  assert.strictEqual(asked, false);
});

test("clarify: the question comes back as the answer", async () => {
  const deps = fakes({ decide: decision("clarify", { answer: "What do you mean?" }) });
  const result = await handleTask("make it appear", { deps });
  assert.strictEqual(result.answer, "What do you mean?");
  assert.strictEqual(result.rule, "asked you a question");
});

test("improve: the reply carries the request for the page's button, and nothing else runs", async () => {
  let asked = false;
  let planned = false;
  const deps = fakes({
    decide: decision("improve", { answer: "Use the button below." }),
    askChain: async () => { asked = true; },
    plan: async () => { planned = true; },
  });
  const result = await handleTask("make the page pink", { deps });
  assert.strictEqual(result.mode, "single");
  assert.strictEqual(result.rule, "a change to Bot");
  assert.strictEqual(result.answer, "Use the button below.");
  assert.deepStrictEqual(result.improve, { request: "make the page pink" });
  assert.strictEqual(asked, false);
  assert.strictEqual(planned, false);
});

test("only an improve decision offers the Improve button", async () => {
  const result = await handleTask("7 times 8?", { deps: fakes({ decide: decision("answer", { answer: "56" }) }) });
  assert.strictEqual(result.improve, undefined);
});

test("delegate: runs the chosen destination's chain", async () => {
  let destinationAsked = null;
  let chainUsed = null;
  const deps = fakes({
    decide: decision("delegate", { destination: "gemini-argon-medium" }),
    chainForDestination: (name) => { destinationAsked = name; return chain; },
    askChain: async (c) => { chainUsed = c; return { answer: "done", used }; },
  });
  const result = await handleTask("hard thing", { deps });
  assert.strictEqual(destinationAsked, "gemini-argon-medium");
  assert.strictEqual(chainUsed, chain);
  assert.strictEqual(result.rule, "gemini-argon-medium");
});

test("split: the planner splits it and every step is returned", async () => {
  const deps = fakes({
    decide: decision("split"),
    plan: async () => ({
      subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }, { id: 2, task: "b", type: "code", needs: [] }],
      plannedBy: "fake-planner",
    }),
  });
  const result = await handleTask("a then b", { deps });
  assert.strictEqual(result.mode, "split");
  assert.strictEqual(result.steps.length, 2);
});

test("split but the planner finds one job: it is handled as one", async () => {
  const result = await handleTask("also this", { deps: fakes({ decide: decision("split") }) });
  assert.strictEqual(result.mode, "single");
});

test("noPlan: a split decision is handled as one job and the planner is never asked", async () => {
  let plannerCalled = false;
  let allowSplitSeen = null;
  const deps = fakes({
    decide: async (t, opts) => { allowSplitSeen = opts.allowSplit; return { action: "split", destination: null, answer: "", reason: "t" }; },
    plan: async () => { plannerCalled = true; },
  });
  const result = await handleTask("a then b", { noPlan: true, deps });
  assert.strictEqual(result.mode, "single");
  assert.strictEqual(plannerCalled, false);
  assert.strictEqual(allowSplitSeen, false);
});

test("if the front desk fails, Claude Sonnet takes the task", async () => {
  let chainUsed = null;
  const logs = [];
  const deps = fakes({
    decide: async () => { throw new Error("agy down"); },
    askChain: async (c) => { chainUsed = c; return { answer: "sonnet answer", used }; },
  });
  const result = await handleTask("anything", { deps, log: (l) => logs.push(l) });
  assert.strictEqual(chainUsed, DEFAULT_CHAIN);
  assert.strictEqual(DEFAULT_CHAIN[0].model, "sonnet");
  assert.strictEqual(result.rule, "fallback");
  assert.ok(logs.some((l) => l.includes("agy down")));
});

test("if the planner fails, Claude Sonnet takes the task", async () => {
  let chainUsed = null;
  const deps = fakes({
    decide: decision("split"),
    plan: async () => { throw new Error("planner down"); },
    askChain: async (c) => { chainUsed = c; return { answer: "x", used }; },
  });
  const result = await handleTask("a then b", { deps });
  assert.strictEqual(chainUsed, DEFAULT_CHAIN);
  assert.strictEqual(result.rule, "fallback");
});

test("planOnly returns the plan without running anything", async () => {
  let ran = false;
  const deps = fakes({ decide: decision("split"), runPlan: async () => { ran = true; }, askChain: async () => { ran = true; } });
  const result = await handleTask("a then b", { planOnly: true, deps });
  assert.strictEqual(result.mode, "plan");
  assert.ok(result.subtasks);
  assert.strictEqual(ran, false);
});

test("planOnly on something that is not split says there is nothing to plan", async () => {
  const result = await handleTask("hi", { planOnly: true, deps: fakes({ decide: decision("answer", { answer: "hello" }) }) });
  assert.strictEqual(result.mode, "plan");
  assert.strictEqual(result.subtasks, null);
});

test("the front desk gets the history as context and the models get it pasted in front", async () => {
  let deskHistory = null;
  let modelPrompt = null;
  const deps = fakes({
    decide: async (t, opts) => { deskHistory = opts.history; return { action: "delegate", destination: "claude-sonnet", answer: "", reason: "t" }; },
    askChain: async (c, prompt) => { modelPrompt = prompt; return { answer: "x", used }; },
  });
  const history = [{ role: "user", text: "My name is Omri" }, { role: "assistant", text: "Nice to meet you" }];
  await handleTask("What is my name?", { history, deps });
  assert.match(deskHistory, /User: My name is Omri/);
  assert.match(modelPrompt, /Assistant: Nice to meet you/);
  assert.match(modelPrompt, /What is my name\?$/); // the new message comes last
});

test("with no history the model gets the task unchanged", async () => {
  let received = null;
  const deps = fakes({ askChain: async (c, prompt) => { received = prompt; return { answer: "x", used }; } });
  await handleTask("plain task", { deps });
  assert.strictEqual(received, "plain task");
});

test("a split plan also receives the history, and the planner gets it as context", async () => {
  let planContext = null;
  let runPrompt = null;
  const deps = fakes({
    decide: decision("split"),
    plan: async (t, opts) => { planContext = opts.context; return { subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }, { id: 2, task: "b", type: "quick", needs: [] }], plannedBy: "p" }; },
    runPlan: async (subtasks, prompt) => { runPrompt = prompt; return subtasks.map((s) => ({ ...s, answer: "ok", used })); },
  });
  await handleTask("a then b", { history: [{ role: "user", text: "earlier" }], deps });
  assert.match(planContext, /User: earlier/);
  assert.match(runPrompt, /User: earlier/);
});

test("log receives progress messages from the front desk and the router", async () => {
  const logs = [];
  await handleTask("hi", { deps: fakes(), log: (l) => logs.push(l) });
  assert.ok(logs.some((l) => l.startsWith("[frontdesk]")));
  assert.ok(logs.some((l) => l.startsWith("[router]")));
});

test("forced chains skip the front desk completely", async () => {
  let deskCalled = false;
  let asked = null;
  const deps = fakes({
    decide: async () => { deskCalled = true; },
    askChain: async (c) => { asked = c; return { answer: "x", used: c[0] }; },
  });
  const result = await handleTask("a then b", { forced: "claude:opus,agy:x", deps });
  assert.strictEqual(result.rule, "forced");
  assert.strictEqual(deskCalled, false);
  assert.deepStrictEqual(asked, [{ provider: "claude", model: "opus" }, { provider: "agy", model: "x" }]);
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
  assert.ok(historyBlock([{ role: "assistant", text: "y".repeat(10000) }]).length < 3200);
});

test("withContext and resultText", () => {
  assert.strictEqual(withContext("hi", []), "hi");
  assert.strictEqual(resultText({ mode: "single", answer: "A" }), "A");
  const split = resultText({ mode: "split", steps: [{ id: 1, task: "t1", answer: "a1" }, { id: 2, task: "t2", error: "boom" }] });
  assert.match(split, /Step 1: t1\na1/);
  assert.match(split, /Step 2: t2\n\(failed\)/);
});

// ---- Quota-aware routing (fake usage data; no real models) ----
const argon = { provider: "agy", model: "argon", pool: "Gemini 4 Argon" };
const sonnet = { provider: "claude", model: "sonnet", pool: null };
const lowArgon = async () => [{ pool: "Gemini 4 Argon", remaining: 4 }];

test("quota: a low pool's model moves to the end of the chain and the log says so", async () => {
  let chainUsed;
  const logs = [];
  const deps = fakes({
    lowPools: lowArgon,
    chainForDestination: () => [argon, sonnet],
    askChain: async (c) => { chainUsed = c; return { answer: "ok", used: c[0] }; },
  });
  await handleTask("hard thing", { deps, log: (l) => logs.push(l) });
  assert.deepStrictEqual(chainUsed, [sonnet, argon]);
  assert.ok(logs.some((l) => l.startsWith("[quota] low: Gemini 4 Argon 4% left")));
});

test("quota: when nothing is low the chain is untouched and nothing is logged", async () => {
  let chainUsed;
  const logs = [];
  const deps = fakes({ chainForDestination: () => [argon, sonnet], askChain: async (c) => { chainUsed = c; return { answer: "ok", used: c[0] }; } });
  await handleTask("x", { deps, log: (l) => logs.push(l) });
  assert.deepStrictEqual(chainUsed, [argon, sonnet]);
  assert.ok(!logs.some((l) => l.startsWith("[quota]")));
});

test("quota: a failing usage lookup never breaks the task", async () => {
  let chainUsed;
  const deps = fakes({
    lowPools: async () => { throw new Error("agy exploded"); },
    chainForDestination: () => [argon, sonnet],
    askChain: async (c) => { chainUsed = c; return { answer: "ok", used: c[0] }; },
  });
  const result = await handleTask("x", { deps });
  assert.strictEqual(result.answer, "ok");
  assert.deepStrictEqual(chainUsed, [argon, sonnet]);
});

test("quota: the front desk is told which pools are low", async () => {
  let seenLow;
  const deps = fakes({ lowPools: lowArgon, decide: async (task, opts) => { seenLow = opts.low; return { action: "answer", destination: null, answer: "hi", reason: "t" }; } });
  await handleTask("hi", { deps });
  assert.deepStrictEqual(seenLow, [{ pool: "Gemini 4 Argon", remaining: 4 }]);
});

test("quota: a forced chain is never reordered", async () => {
  let chainUsed;
  const deps = fakes({ lowPools: lowArgon, askChain: async (c) => { chainUsed = c; return { answer: "ok", used: c[0] }; } });
  await handleTask("x", { forced: "agy:argon,claude:sonnet", deps });
  assert.deepStrictEqual(chainUsed.map((m) => m.model), ["argon", "sonnet"]);
});

test("quota: planner steps get a reordered chain too", async () => {
  let stepChain;
  const deps = fakes({
    decide: decision("split"),
    plan: async () => ({ subtasks: [{ id: 1, task: "a", type: "hard", needs: [] }, { id: 2, task: "b", type: "hard", needs: [] }], plannedBy: "p" }),
    lowPools: lowArgon,
    chainForType: () => [argon, sonnet],
    runPlan: async (subtasks, prompt, opts) => { stepChain = opts.chainFor("hard"); return subtasks.map((s) => ({ ...s, answer: "x", used })); },
  });
  await handleTask("a then b", { deps });
  assert.deepStrictEqual(stepChain, [sonnet, argon]);
});
