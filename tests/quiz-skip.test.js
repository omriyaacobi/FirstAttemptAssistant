// tests/quiz-skip.test.js
// 2026-11-17, 10:59: in a graded quiz Omri said "skip the question, we will get to it in lecture 5". "skip" only existed for the
// one check question after a lesson, so it went to the grader as an answer and the same question came back. Now a graded quiz
// question can be skipped: closed with no verdict, out of the score and the summary. Made-up data only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const DB = { id: "b".repeat(16), name: "Databases Demo" };

function world(brainReplies) {
  const { createStudyCoach } = require("../study-coach");
  const { createBrain } = require("../brain");
  const graded = [];
  const askChain = async (chain, prompt) => {
    if (/Grade ONE answer/.test(prompt)) { graded.push(prompt); return { answer: JSON.stringify({ verdict: "right", feedback: "Yes.", note: "", relevant: true }), used: { model: "f" } }; }
    return { answer: "Think again.", used: { model: "f" } };
  };
  const courses = { list: () => [DB], allPages: () => [] };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-quiz-skip-")), courses, askChain, now: () => NOW });
  let i = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [DB], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({}),
    askOne: async () => { const r = brainReplies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const ref = coach.tracker.refsFor([DB])[0];
  const q = (id, text) => ({ id, q: text, key: "k", topic: id, attempts: 0, hints: 0, state: "open", verdict: null, revealed: false });
  coach.tracker.setSession(ref, { id: "s1", mode: "quiz", lang: "en", startedAt: NOW, target: { type: "lecture", date: null, n: 1 }, current: 0, questions: [q("q1", "First?"), q("q2", "Second?")] });
  return { brain, graded, session: () => coach.tracker.getSession(ref) };
}
const ask = (kind) => `CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"${kind}"}`;

test("a graded quiz question can be skipped: no grading, the next question comes, and it is not in the score", async () => {
  const w = world([ask("skip"), ask("answer")]);
  const r1 = await w.brain.handle("skip it, we will get to it in lecture 5", { history: [], courses: [DB] });
  assert.match(r1.answer, /^Skipped\. This question counts for nothing\./);
  assert.match(r1.answer, /Second\?/, "the next question is asked");
  assert.strictEqual(w.graded.length, 0, "nothing was graded");
  assert.strictEqual(w.session().questions[0].verdict, "skipped");
  const r2 = await w.brain.handle("the answer is k", { history: [], courses: [DB] });
  assert.match(r2.answer, /1 of 1 fully right/, "the summary counts only the question really asked");
});
