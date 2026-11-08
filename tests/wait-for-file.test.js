// wait-for-file.test.js
// A question to a course must not be answered "the file is not there yet" while that course's files are still being read.
// Code decides (the state of the files), no model: Bot says ONE short line, waits without a slow slot, then answers as a second
// message under the same question. Fake models and made-up courses only; temporary folders only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { handleTask } = require("../core");
const { createJobs, describeProgress } = require("../jobs");
const { createThreadStore } = require("../thread-store");
const { createStore } = require("../store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-waitfile-"));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const COURSES = [{ id: "aaaaaaaaaaaaaaa1", name: "Calculus 2" }, { id: "aaaaaaaaaaaaaaa2", name: "Systems Programming" }];
const file = (status, extra = {}) => ({ id: "f1", name: "assignment-3.pdf", status, pages: 0, pagesTotal: 30, bytes: 900000, error: "", ...extra });

// A made-up reader: the test changes `state.files` like the real reader would.
function reader(files) {
  const state = { files };
  return { state, courseFiles: (courseId) => ({ files: courseId === COURSES[0].id ? state.files : [] }) };
}
const fakes = (overrides = {}) => ({
  chainForDestination: () => [{ provider: "agy", model: "fake" }], chainForType: () => [], lowPools: async () => [], refreshQuota: () => {}, prewarmAnswer: () => {}, speculate: null,
  about: () => "", facts: () => [], addFact: () => { throw new Error("no"); }, askChain: async () => ({ answer: "model answer", used: { model: "fake" } }),
  waitPollMs: 5, waitTimeoutMs: 400, ...overrides,
});
const desk = (course, studyIntent = "ask") => async () => ({ action: "course", destination: null, answer: "", reason: "r", course, studyIntent });

test("a course question while a file is queued/reading waits, says so once, and then answers from the new material", async () => {
  const r = reader([file("reading")]);
  const notes = [];
  let askedWhen = null;
  const deps = fakes({ ...r, decide: desk(COURSES[0]), courseAnswer: async () => { askedWhen = r.state.files[0].status; return { mode: "course", courseId: COURSES[0].id, answer: "It covers pages 12 to 18 of the summary.", sources: [] }; } });
  const run = handleTask("I added the assignment; when you finish reading it, tell me which pages it covers", { deps, courses: COURSES, notify: (t) => notes.push(t) });
  await tick(60);
  assert.strictEqual(askedWhen, null, "the notebook must not be asked while the file is being read");
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /still being read/);
  r.state.files = [file("ready", { pages: 30 })];
  const result = await run;
  assert.strictEqual(askedWhen, "ready");
  assert.strictEqual(result.answer, "It covers pages 12 to 18 of the summary.");
  assert.strictEqual(notes.length, 1, "only one acknowledgement");
});

test("the wait does not need any phrase: a plain question waits too, in Hebrew the line is Hebrew without gendered verbs", async () => {
  const r = reader([file("queued")]);
  const notes = [];
  const deps = fakes({ ...r, decide: desk(COURSES[0]), courseAnswer: async () => ({ mode: "course", answer: "ok", sources: [] }) });
  const run = handleTask("עד איזה עמוד בסיכום ההגשה מכסה?", { deps, courses: COURSES, notify: (t) => notes.push(t) });
  await tick(40);
  r.state.files = [file("ready")];
  await run;
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /[֐-׿]/);
  assert.doesNotMatch(notes[0], /\bאני\b|\bתקרא\b|\bתחכה\b/);
});

test("a course whose files are all ready never waits; another course never waits for this one", async () => {
  const notes = [];
  const deps = fakes({ ...reader([file("reading")]), decide: desk(COURSES[1]), courseAnswer: async () => ({ mode: "course", answer: "ok", sources: [] }) });
  const result = await handleTask("question about the other course", { deps, courses: COURSES, notify: (t) => notes.push(t) });
  assert.strictEqual(result.answer, "ok");
  assert.deepStrictEqual(notes, []);
  const ready = reader([file("ready")]);
  const deps2 = fakes({ ...ready, decide: desk(COURSES[0]), courseAnswer: async () => ({ mode: "course", answer: "ok", sources: [] }) });
  assert.strictEqual((await handleTask("q", { deps: deps2, courses: COURSES, notify: (t) => notes.push(t) })).answer, "ok");
  assert.deepStrictEqual(notes, []);
});

test("fast actions (reminder, calendar, plain answer) never wait for a file", async () => {
  const notes = [];
  const deps = fakes({ ...reader([file("reading")]), decide: async () => ({ action: "answer", destination: null, answer: "hello", reason: "t" }) });
  const t0 = Date.now();
  const result = await handleTask("hi", { deps, courses: COURSES, notify: (t) => notes.push(t) });
  assert.ok(Date.now() - t0 < 300);
  assert.deepStrictEqual(notes, []);
  assert.ok(result);
});

test("the waiting does not hold a slow slot: the gate is called only after the files are ready", async () => {
  const r = reader([file("reading")]);
  const order = [];
  const deps = fakes({ ...r, decide: desk(COURSES[0]), courseAnswer: async () => ({ mode: "course", answer: "ok", sources: [] }) });
  const run = handleTask("q", { deps, courses: COURSES, notify: () => order.push("note"), gate: async () => { order.push("gate"); } });
  await tick(40);
  assert.deepStrictEqual(order, ["note"]);
  r.state.files = [file("ready")];
  await run;
  assert.deepStrictEqual(order, ["note", "gate"]);
});

test("if the read FAILS, the answer says so plainly and still answers with what exists", async () => {
  const r = reader([file("reading")]);
  const deps = fakes({ ...r, decide: desk(COURSES[0]), courseAnswer: async () => ({ mode: "course", answer: "From the older material: topic A.", sources: [] }) });
  const run = handleTask("which pages does it cover?", { deps, courses: COURSES, notify: () => {} });
  await tick(30);
  r.state.files = [file("failed", { error: "could not read" })];
  const result = await run;
  assert.match(result.answer, /could not read "assignment-3\.pdf"/);
  assert.match(result.answer, /From the older material: topic A\./);
});

test("on timeout it says the file is still not read and answers with what exists, labelled", async () => {
  const r = reader([file("reading")]);
  const deps = fakes({ ...r, waitTimeoutMs: 60, decide: desk(COURSES[0]), courseAnswer: async () => ({ mode: "course", answer: "From the older material.", sources: [] }) });
  const result = await handleTask("which pages does it cover?", { deps, courses: COURSES, notify: () => {} });
  assert.match(result.answer, /not finished reading "assignment-3\.pdf"/);
  assert.match(result.answer, /From the older material\./);
});

test("the coach's model intents wait too (a quiz must not be built from half the material)", async () => {
  const r = reader([file("reading")]);
  let coached = 0;
  const deps = fakes({ ...r, decide: desk(COURSES[0], "quiz"), studyAnswer: async () => { coached++; return { mode: "study", answer: "quiz", sources: [] }; } });
  const run = handleTask("quiz me", { deps, courses: COURSES, notify: () => {} });
  await tick(40);
  assert.strictEqual(coached, 0);
  r.state.files = [file("ready")];
  await run;
  assert.strictEqual(coached, 1);
});

// ---- jobs.js: the thread ----
function setup(handle, onFinish = () => {}) {
  const thread = createThreadStore(tmp());
  const jobs = createJobs({ handle, thread, store: createStore(tmp()), courses: () => COURSES, courseName: (id) => (COURSES.find((c) => c.id === id) || {}).name, onFinish });
  return { thread, jobs };
}
async function done(jobs, id) { for (let i = 0; i < 300; i++) { const j = jobs.get(id); if (j && j.status !== "running") return j; await tick(5); } throw new Error("job did not finish"); }

test("thread: the acknowledgement is a message under the question, the answer is a second one, and only the answer is pushed", async () => {
  let release;
  const wait = new Promise((r) => (release = r));
  const pushes = [];
  const handle = async (task, options) => {
    options.log("[queue] waiting for the file to be read");
    options.notify("The file is still being read; I will answer when it is done (about 2 min).");
    await wait;
    return { mode: "course", courseId: COURSES[0].id, answer: "pages 1 to 3", sources: [] };
  };
  const { thread, jobs } = setup(handle, (info) => pushes.push(info));
  const job = jobs.startThread({ task: "which pages?" });
  await tick(30);
  assert.match(jobs.get(job.id).step, /Waiting for the file to be read/);
  const mid = [...thread.all()];
  assert.strictEqual(mid.length, 2);
  assert.strictEqual(mid[1].replyTo, mid[0].id);
  assert.strictEqual(mid[1].ack, true);
  assert.strictEqual(pushes.length, 0, "no push for the acknowledgement");
  release();
  await done(jobs, job.id);
  await tick(20);
  const all = [...thread.all()];
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[2].text, "pages 1 to 3");
  assert.strictEqual(all[2].replyTo, all[0].id);
  assert.strictEqual(all[2].ack, undefined);
  assert.strictEqual(pushes.length, 1);
});

test("restart: a question that only got the acknowledgement is not counted as answered", () => {
  const thread = createThreadStore(tmp());
  const q = thread.append({ role: "user", text: "which pages?", at: Date.now() - 1000 });
  thread.append({ role: "assistant", text: "The file is still being read.", replyTo: q.id, ack: true, at: Date.now() - 900 });
  assert.strictEqual(thread.markUnanswered(), 1);
  const last = [...thread.all()].pop();
  assert.strictEqual(last.error, true);
  assert.strictEqual(last.replyTo, q.id);
});

test("restart: a question with a real answer after the acknowledgement is left alone, and the acknowledgement stays out of the model's memory", () => {
  const thread = createThreadStore(tmp());
  const q = thread.append({ role: "user", text: "which pages?", at: Date.now() - 1000 });
  thread.append({ role: "assistant", text: "The file is still being read.", replyTo: q.id, ack: true, at: Date.now() - 900 });
  thread.append({ role: "assistant", text: "pages 1 to 3", replyTo: q.id, at: Date.now() - 800 });
  assert.strictEqual(thread.markUnanswered(), 0);
  const { buildHistory } = require("../thread-context");
  const texts = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) }).map((h) => h.text);
  assert.ok(texts.includes("pages 1 to 3"));
  assert.ok(!texts.some((t) => /still being read/.test(t)));
});

test("progress line: waiting for the file", () => {
  assert.match(describeProgress(["[queue] waiting for the file to be read"]), /Waiting for the file to be read/);
});
