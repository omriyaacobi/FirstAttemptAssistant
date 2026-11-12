// tests/upload-words.test.js
// The words Omri sends WITH a file. Filing is code (thread-files.js); the words go to the brain as a follow-up on the SAME question:
// no second question in the thread, the brain is told the file is already filed, and "NOTHING" means no second message at all.
// Fake models and temporary folders only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobs } = require("../jobs");
const { createThreadStore } = require("../thread-store");
const { createStore } = require("../store");
const { createBrain } = require("../brain");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-upwords-"));
const COURSES = [{ id: "aaaaaaaaaaaaaaa1", name: "Calculus 2" }];
async function done(jobs, id) { for (let i = 0; i < 300; i++) { const j = jobs.get(id); if (j && j.status !== "running") return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error("job did not finish"); }

function brainWith(replies) {
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => [{ fileId: "f1", fileName: "hw3.pdf", page: 1, text: "Question 2: integrate x*e^x." }] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [{ id: "f1", name: "hw3.pdf", status: "ready", pages: 1 }] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); return replies[i++]; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
  });
  return { brain, prompts };
}

function world(replies) {
  const { brain, prompts } = brainWith(replies);
  const thread = createThreadStore(tmp());
  const pushes = [];
  const jobs = createJobs({ handle: (task, o) => brain.handle(task, o), thread, store: createStore(tmp()), courses: () => COURSES, onFinish: (x) => pushes.push(x) });
  // what thread-files.js does before the words are sent on: the question and the "Filed ..." line are already in the thread
  const question = thread.append({ role: "user", text: "(file attached: hw3.pdf) explain question 2", topic: "general", at: Date.now() });
  thread.append({ role: "assistant", text: 'Filed "hw3.pdf" under Calculus 2.', replyTo: question.id, topic: "course:aaaaaaaaaaaaaaa1", result: { mode: "study", courseId: "aaaaaaaaaaaaaaa1" }, at: Date.now() });
  return { jobs, thread, prompts, pushes, question };
}
const attached = { courseId: "aaaaaaaaaaaaaaa1", courseName: "Calculus 2", fileName: "hw3.pdf" };

test("words with a file are answered by the brain under the SAME question, with the file's course in focus", async () => {
  const { jobs, thread, prompts, question } = world(["Question 2 wants integration by parts."]);
  const job = jobs.startThread({ task: "explain question 2", questionId: question.id, attached });
  await done(jobs, job.id);
  const all = thread.page({ limit: 50 }).messages;
  assert.strictEqual(all.filter((m) => m.role === "user").length, 1, "no second question is saved");
  const answer = all[all.length - 1];
  assert.strictEqual(answer.replyTo, question.id);
  assert.strictEqual(answer.text, "Question 2 wants integration by parts.");
  assert.match(prompts[0], /Bot has ALREADY filed it under Calculus 2/);
  assert.match(prompts[0], /The course this talk is in: Calculus 2/);
});

test("words that only name the file: the model says NOTHING, so no second message and no push", async () => {
  const { jobs, thread, pushes, question } = world(["NOTHING"]);
  const before = thread.page({ limit: 50 }).messages.length;
  const job = jobs.startThread({ task: "calculus homework 3", questionId: question.id, attached });
  const end = await done(jobs, job.id);
  assert.strictEqual(end.status, "done");
  assert.strictEqual(thread.page({ limit: 50 }).messages.length, before);
  assert.strictEqual(pushes.length, 0);
});

test("thread-files hands the words on after filing, and never when there are none", () => {
  const { createThreadFiles } = require("../thread-files");
  const sent = [];
  const thread = createThreadStore(tmp());
  const tracker = { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), timetable: () => ({ courses: [] }), slots: () => [], timezone: "Asia/Jerusalem" };
  const files = createThreadFiles({ thread, coach: { tracker }, courseRoutes: { list: () => COURSES, addUpload: (id, bytes, name) => ({ id: "f9", name }) } });
  files.onWords((a) => sent.push(a));
  const pdf = Buffer.from("%PDF-1.4\n%fake\n");
  files.receive({ bytes: pdf, name: "calculus 2 hw3.pdf", text: "what is question 2 about?" });
  files.receive({ bytes: pdf, name: "calculus 2 hw4.pdf", text: "" });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].text, "what is question 2 about?");
  assert.strictEqual(sent[0].courseId, COURSES[0].id);
  assert.ok(sent[0].questionId);
});
