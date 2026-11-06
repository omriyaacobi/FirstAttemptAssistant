// core-speculate.test.js
// The speculative answer: the model behind "gemini-flash" is asked at the same moment as the front desk, and its answer is used
// only if the front desk then picks gemini-flash. All with fakes: no real model, no agy.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { handleTask } = require("./core");
const { MODELS } = require("./router");

const FLASH = MODELS.flashMedium;
const sonnet = { provider: "claude", model: "sonnet", pool: null };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake speculative call: answers `text` after `ms`, streams it in two pieces, and records its signal.
function fakeSpeculate({ ms = 20, text = "speculative answer", fail = null, record = {} } = {}) {
  return (question, { signal, onText }) => {
    record.question = question;
    record.signal = signal;
    record.calls = (record.calls || 0) + 1;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { record.aborted = true; reject(new Error("aborted")); });
      setTimeout(() => onText(text.slice(0, 5)), Math.floor(ms / 2));
      setTimeout(() => (fail ? reject(new Error(fail)) : (onText(text), resolve(text))), ms);
    });
  };
}

const desk = (action, extra = {}) => async () => ({ action, destination: null, answer: "", reason: "test", ...extra });
const flashDesk = desk("delegate", { destination: "gemini-flash" });

const fakes = (overrides = {}) => ({
  decide: flashDesk,
  chainForDestination: (name) => (name === "gemini-flash" ? [FLASH, sonnet] : [sonnet]),
  chainForType: () => [sonnet],
  lowPools: async () => [],
  about: () => "",
  refreshQuota: () => {},
  prewarmAnswer: () => {},
  askChain: async (chain) => ({ answer: "normal chain answer", used: chain[0], attempts: [] }),
  speculate: fakeSpeculate(),
  ...overrides,
});

test("speculative: the front desk picks gemini-flash, so the answer already being written is used and no chain runs", async () => {
  let chainRan = false;
  const record = {};
  const logs = [];
  const result = await handleTask("what is a mutex?", { deps: fakes({ speculate: fakeSpeculate({ record }), askChain: async () => { chainRan = true; } }), log: (l) => logs.push(l) });
  assert.strictEqual(result.answer, "speculative answer");
  assert.strictEqual(chainRan, false);
  assert.deepStrictEqual(result.used, FLASH);
  assert.strictEqual(result.timing.attempts[0].speculative, true);
  assert.ok(logs.some((l) => l.startsWith("[router] answered by agy/gemini-3.8-flash-medium")));
  assert.ok(logs.some((l) => l.startsWith("[timing]") && l.includes("started together with the front desk")));
  assert.match(record.question, /what is a mutex\?/); // the same question text the real call would get
});

test("speculative: the text so far is shown while it is written, but only once the front desk chose gemini-flash", async () => {
  const seen = [];
  let writeText, finish, releaseDesk;
  const gate = new Promise((r) => { releaseDesk = r; });
  const speculate = (q, { onText }) => new Promise((resolve) => { writeText = onText; finish = resolve; });
  const gatedDesk = async () => { await gate; return { action: "delegate", destination: "gemini-flash", answer: "", reason: "t" }; };
  const running = handleTask("q", { deps: fakes({ decide: gatedDesk, speculate }), onPartial: (t) => seen.push(t) });
  await wait(20);
  writeText("hello"); // written while the front desk is still deciding: must NOT reach the page yet
  assert.deepStrictEqual(seen, []);
  releaseDesk(); // the front desk chooses gemini-flash
  await wait(20);
  assert.deepStrictEqual(seen, ["hello"]); // what was already written is shown at once
  writeText("hello world");
  finish("hello world");
  const result = await running;
  assert.deepStrictEqual(seen, ["hello", "hello world"]);
  assert.strictEqual(result.answer, "hello world");
});

test("speculative: any other decision kills the call and the normal path runs", async () => {
  for (const [name, deskFn] of [
    ["another destination", desk("delegate", { destination: "claude-sonnet" })],
    ["the desk answers itself", desk("answer", { answer: "hi" })],
    ["a clarifying question", desk("clarify", { answer: "which?" })],
    ["a reminder", desk("remind", { reminder: { text: "x", at: Date.now() + 1e6, timezone: "UTC" } })],
    ["the calendar", desk("calendar", { calendar: { from: "2026-11-06", days: 1 } })],
  ]) {
    const record = {};
    await handleTask("q", { deps: fakes({ decide: deskFn, speculate: fakeSpeculate({ ms: 5000, record }), createReminder: () => ({ id: "r", text: "x", at: Date.now(), timezone: "UTC" }), readCalendar: async () => ({ events: [], days: 1, from: "2026-11-06", text: "nothing" }) }) });
    assert.strictEqual(record.aborted, true, name + ": the speculative call must be stopped");
  }
});

test("speculative: a decision for another destination runs that destination's chain, not the speculative answer", async () => {
  let ranChain = null;
  const result = await handleTask("q", { deps: fakes({ decide: desk("delegate", { destination: "claude-sonnet" }), askChain: async (chain) => { ranChain = chain; return { answer: "from sonnet", used: chain[0], attempts: [] }; } }) });
  assert.strictEqual(result.answer, "from sonnet");
  assert.deepStrictEqual(ranChain, [sonnet]);
});

test("speculative: if the speculative call failed, the normal chain answers (nothing is lost)", async () => {
  const logs = [];
  const parts = [];
  const result = await handleTask("q", { deps: fakes({ speculate: fakeSpeculate({ ms: 10, fail: "agy exploded" }) }), log: (l) => logs.push(l), onPartial: (t) => parts.push(t) });
  assert.strictEqual(result.answer, "normal chain answer");
  assert.ok(logs.some((l) => l.includes("failed after") && l.includes("agy exploded")));
  assert.strictEqual(parts[parts.length - 1], ""); // half an answer never stays on screen
});

test("speculative: an empty speculative answer falls back to the normal chain", async () => {
  const result = await handleTask("q", { deps: fakes({ speculate: fakeSpeculate({ ms: 5, text: "" }) }) });
  assert.strictEqual(result.answer, "normal chain answer");
});

test("speculative: not started when the Gemini pool is nearly empty, for a forced chain, for a photo or for plan-only", async () => {
  const lowGemini = async () => [{ pool: FLASH.pool, remaining: 3 }];
  let calls = 0;
  const countingSpeculate = () => { calls++; return new Promise(() => {}); };
  await handleTask("q", { deps: fakes({ lowPools: lowGemini, speculate: countingSpeculate }) });
  await handleTask("q", { forced: "agy:x", deps: fakes({ speculate: countingSpeculate }) });
  await handleTask("q", { planOnly: true, deps: fakes({ decide: desk("split"), speculate: countingSpeculate, plan: async () => ({ subtasks: [{ id: 1, task: "a", type: "quick", needs: [] }], plannedBy: "p" }) }) });
  await handleTask("q", { image: { path: "x.png" }, deps: fakes({ speculate: countingSpeculate, askImage: async () => "photo answer", askChain: async (chain, q, opts) => ({ answer: await opts.askOne("agy", "m", q), used: chain[0], attempts: [] }) }) });
  assert.strictEqual(calls, 0);
});

test("speculative: off when the setting is null, and a speculate that throws never breaks a task", async () => {
  assert.strictEqual((await handleTask("q", { deps: fakes({ speculate: null }) })).answer, "normal chain answer");
  assert.strictEqual((await handleTask("q", { deps: fakes({ speculate: () => { throw new Error("no agy"); } }) })).answer, "normal chain answer");
});

test("speculative: if the quota reorder puts another model first, the speculative answer is not used", async () => {
  const lowFlash = async () => [{ pool: "Some Other Pool", remaining: 3 }];
  const reordered = (name) => (name === "gemini-flash" ? [sonnet, FLASH] : [sonnet]); // the chain now starts with Sonnet
  const result = await handleTask("q", { deps: fakes({ lowPools: lowFlash, chainForDestination: reordered }) });
  assert.strictEqual(result.answer, "normal chain answer");
});

test("speculative: the call is stopped after a task that ends with an error too", async () => {
  const record = {};
  await assert.rejects(handleTask("q", { deps: fakes({ decide: desk("delegate", { destination: "claude-sonnet" }), speculate: fakeSpeculate({ ms: 5000, record }), askChain: async () => { throw new Error("every model failed"); } }) }), /every model failed/);
  assert.strictEqual(record.aborted, true);
});
