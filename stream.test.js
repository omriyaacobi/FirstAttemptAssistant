// stream.test.js
// Streaming of the answer (providers.askAgyStream, askChain's onText, the job's growing "partial").
// Uses a FAKE agy (a node script that prints the same stream-json events), so no real model is called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyStream, askChain } = require("./providers");
const { createJobs } = require("./jobs");
const { createStore } = require("./store");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-fakestream-"));
const fake = path.join(dir, "fake-agy.js");
// FAKE_MODE: "" = two pieces then a result, "die" = one piece then the process exits, "status" = result with an error status,
// "twosteps" = a piece in step 1 and another in step 3 (a tool ran in between)
fs.writeFileSync(fake, `
const mode = process.env.FAKE_MODE || "";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const piece = (step_index, text_delta) => out({ event: "step_update", step_update: { step_index, step_type: "agent_response", state: "ACTIVE", text_delta } });
out({ event: "init" });
process.stdin.once("data", () => {
  out({ event: "step_update", step_update: { step_index: 0, step_type: "user_input", state: "DONE" } });
  piece(1, "Hello ");
  setTimeout(() => {
    if (mode === "die") return process.exit(1);
    if (mode === "status") return out({ event: "result", result: { status: "ERROR" } });
    if (mode === "twosteps") { piece(3, "second"); return out({ event: "result", result: { status: "SUCCESS", response: "first\\n\\nsecond" } }); }
    piece(1, "world");
    out({ event: "result", result: { status: "SUCCESS", response: "Hello world" } });
  }, 30);
});
`);
const opts = { command: process.execPath, prefixArgs: [fake] };
const withMode = async (mode, fn) => { process.env.FAKE_MODE = mode; try { return await fn(); } finally { delete process.env.FAKE_MODE; } };

test("askAgyStream: onText gets the growing text, the result is the answer", async () => {
  const seen = [];
  const answer = await askAgyStream("q", "gemini-3.8-flash-low", (t) => seen.push(t), opts);
  assert.deepStrictEqual(seen, ["Hello ", "Hello world"]);
  assert.strictEqual(answer, "Hello world");
});

test("askAgyStream: a second reply step starts a new paragraph", async () => {
  const seen = [];
  await withMode("twosteps", () => askAgyStream("q", "gemini-3.8-flash-low", (t) => seen.push(t), opts));
  assert.strictEqual(seen[seen.length - 1], "Hello \n\nsecond");
});

test("askAgyStream: rejects if agy dies midway or reports an error, and a broken onText does not matter", async () => {
  await withMode("die", () => assert.rejects(askAgyStream("q", "gemini-3.8-flash-low", () => {}, opts), /closed before/));
  await withMode("status", () => assert.rejects(askAgyStream("q", "gemini-3.8-flash-low", () => {}, opts), /agy status ERROR/));
  const answer = await askAgyStream("q", "gemini-3.8-flash-low", () => { throw new Error("page bug"); }, opts);
  assert.strictEqual(answer, "Hello world");
});

test("askAgyStream: refuses a suspicious model name", () => {
  assert.throws(() => askAgyStream("q", "x; rm -rf /", () => {}, opts), /Suspicious/);
});

test("askChain: passes onText on, and clears the partial text when a model fails after writing some", async () => {
  const shown = [];
  const askOne = async (provider, model, q, onText) => {
    if (model === "a") { onText("half an ans"); throw new Error("died"); }
    onText("the real answer");
    return "the real answer";
  };
  const chain = [{ provider: "agy", model: "a" }, { provider: "agy", model: "b" }];
  const result = await askChain(chain, "q", { askOne, onText: (t) => shown.push(t) });
  assert.deepStrictEqual(shown, ["half an ans", "", "the real answer"]);
  assert.strictEqual(result.answer, "the real answer");
});

test("askChain: without onText the models are asked as before (no extra argument)", async () => {
  let args;
  await askChain([{ provider: "claude", model: "m" }], "q", { askOne: async (...a) => { args = a; return "ok"; } });
  assert.strictEqual(args[3], undefined);
});

test("jobs: the growing answer is on the running job, and gone once it is done", async () => {
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), "bot-streamjobs-")));
  let release;
  const gate = new Promise((r) => { release = r; });
  const jobs = createJobs({ handle: async (task, { onPartial }) => { onPartial("Hello wor"); await gate; return { mode: "single", answer: "Hello world" }; }, store });
  const started = jobs.start({ task: "hi" });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(jobs.get(started.id).partial, "Hello wor");
  assert.strictEqual(jobs.list()[0].partial, "Hello wor");
  release();
  await new Promise((r) => setTimeout(r, 50));
  const done = jobs.get(started.id);
  assert.strictEqual(done.status, "done");
  assert.strictEqual(done.partial, undefined);
  assert.strictEqual(store.get(started.conversationId).messages.at(-1).text, "Hello world"); // the saved answer is the whole one
});
