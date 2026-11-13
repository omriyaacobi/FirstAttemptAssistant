// study-qa.test.js: regressions from the 2026-11-07 QA run (study group). Made-up courses WITHOUT a timetable (like Omri's first days),
// fake models only. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { studyOverview } = require("../study-page");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const LA = { id: "e".repeat(16), name: "Linear Algebra Demo" };
const IP = { id: "f".repeat(16), name: "Intro Programming Demo" };
const COURSES = [LA, IP];
const PAGES = { [LA.id]: [
  { fileId: "f1", fileName: "lecture1.txt", page: 1, text: "Eigenvalues and eigenvectors of a matrix." },
  { fileId: "f2", fileName: "lecture2.txt", page: 1, text: "Determinants and invertibility." },
] };

function make() {
  const calls = [];
  const askChain = async (chain, prompt) => {
    calls.push(prompt);
    let answer = "?";
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else if (/received an assignment/.test(prompt)) answer = '{"title": "Invented title", "due": null, "needs": ["x"]}';
    return { answer, used: { model: chain[0].model } };
  };
  const courses = { list: () => COURSES, allPages: (id) => PAGES[id] || [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-qa-"));
  const coach = createStudyCoach({ dir, courses, askChain, now: () => NOW });
  return { coach, calls };
}
const pos = (coach, ref) => coach.tracker.progress(ref);

test("a), a message about homework or a claim is NOT saved as a position", async () => {
  const { coach } = make();
  const refs = coach.tracker.refsFor(COURSES);
  await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  await coach.answerStudy({ studyIntent: "update", text: "my homework is due next Sunday" });
  await coach.answerStudy({ studyIntent: "update", text: "I understand everything already" });
  assert.strictEqual(pos(coach, refs[0]).positionKnown, false);
  assert.strictEqual(pos(coach, refs[0]).understood, 0);
});

test("a), when a position cannot be placed, the help names the user's own courses, never other ones", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "my last Biology lecture was Monday" });
  assert.match(r.answer, /Linear Algebra Demo/);
  assert.doesNotMatch(r.answer, /Calculus|Systems Programming|Algorithms/);
});

test("b), a question about homework answers from the saved assignments and never makes a proposal card", async () => {
  const { coach, calls } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  coach.tracker.addAssignment(ref, { title: "Homework 1", needs: [] });
  const r = await coach.answerStudy({ studyIntent: "assignment", text: "Which course do I have a homework for?" });
  assert.match(r.answer, /Homework 1/);
  assert.match(r.answer, /Linear Algebra Demo/);
  assert.strictEqual(r.proposal, undefined);
  assert.strictEqual(coach.pendingProposal(), null);
  assert.strictEqual(calls.length, 0);
});

test("c), the Study page lists a confirmed assignment even when the course has no timetable", () => {
  const { coach } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  coach.tracker.addAssignment(ref, { title: "Homework 1", needs: [] });
  const page = studyOverview({ coach, courseList: COURSES, now: NOW });
  const c = page.courses.find((x) => x.name === LA.name);
  assert.deepStrictEqual(c.assignments.map((a) => a.title), ["Homework 1"]);
});

test("c), 'quiz me on lecture 1' works when the lecture file was uploaded, even with no timetable", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "quiz", text: "quiz me on lecture 1 linear algebra", courseId: LA.id });
  assert.doesNotMatch(r.answer, /has not been held yet/);
  assert.match(r.answer, /Question 1 of 3/);
});

test("c), uploaded-lecture quiz never sets 'understood' by itself", async () => {
  const { coach } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  await coach.answerStudy({ studyIntent: "quiz", text: "quiz me on lecture 1", courseId: LA.id });
  assert.strictEqual(pos(coach, ref).understood, 0);
});

test("c), 'today's class in <course> was cancelled' for a course with no timetable is understood and explained", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "today's class in Intro Programming was cancelled" });
  assert.match(r.answer, /Intro Programming Demo/);
  assert.match(r.answer, /no timetable/i);
  assert.doesNotMatch(r.answer, /I did not catch/);
  assert.doesNotMatch(r.answer, /Calculus|Systems Programming|Algorithms/);
});

// QA round 2: a file was filed and its assignment card waits for Confirm. Asking "which homework do I have?" must mention it.
