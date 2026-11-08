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

test("a), 'my last linear algebra lecture was lecture 1' is saved as the position (no timetable needed)", async () => {
  const { coach } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  const r = await coach.answerStudy({ studyIntent: "update", text: "my last linear algebra lecture was lecture 1" });
  assert.match(r.answer, /Linear Algebra Demo: noted that you are up to lecture 1/);
  assert.strictEqual(pos(coach, ref).positionKnown, true);
  assert.doesNotMatch(r.answer, /0 lectures held/);
  assert.strictEqual(pos(coach, ref).understood, 0); // a position never marks anything understood
});

test("a), the answer to Bot's own 'where are you' question ('it was last Thursday') is saved for the course it asked about", async () => {
  const { coach } = make();
  const refs = coach.tracker.refsFor(COURSES);
  const ask = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(ask.answer, /where are you in Linear Algebra Demo, Intro Programming Demo/);
  const r = await coach.answerStudy({ studyIntent: "update", text: "it was last Thursday" });
  assert.match(r.answer, /Linear Algebra Demo: noted that you are up to Thursday 5 Nov/);
  assert.strictEqual(pos(coach, refs[0]).positionKnown, true);
  assert.strictEqual(pos(coach, refs[1]).positionKnown, false); // the other course stays unknown, nothing invented
});

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

test("b), a question with nothing saved says so and still creates no card", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "assignment", text: "do I have any assignments?" });
  assert.match(r.answer, /no assignment saved/i);
  assert.strictEqual(coach.pendingProposal(), null);
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

test("c), 'I skipped class today' says what was missed in a few lines, not the status wall", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "progress", text: "I skipped class today, what did I miss?" });
  assert.ok(r.answer.split("\n").length <= 4, r.answer);
  assert.match(r.answer, /timetable/i);
  assert.doesNotMatch(r.answer, /Material in Bot for/);
});

test("c), 'I skipped class today' with a timetable names the lecture that was missed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-qa-"));
  const calc = { id: "b".repeat(16), name: "Calculus 2" };
  const coach = createStudyCoach({ dir, courses: { list: () => [calc], allPages: () => [] }, askChain: async () => ({ answer: "?" }), now: () => new Date("2026-11-09T18:00:00+02:00").getTime() }); // a Monday evening
  const r = await coach.answerStudy({ studyIntent: "progress", text: "I skipped class today, what did I miss?" });
  assert.match(r.answer, /Calculus 2 lecture \d+/);
  assert.ok(r.answer.split("\n").length <= 4, r.answer);
});

test("c), 'today's class in <course> was cancelled' for a course with no timetable is understood and explained", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "today's class in Intro Programming was cancelled" });
  assert.match(r.answer, /Intro Programming Demo/);
  assert.match(r.answer, /no timetable/i);
  assert.doesNotMatch(r.answer, /I did not catch/);
  assert.doesNotMatch(r.answer, /Calculus|Systems Programming|Algorithms/);
});

test("b), the same question classed as 'progress' by the front desk also answers from the saved assignments", async () => {
  const { coach } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  coach.tracker.addAssignment(ref, { title: "Homework 1", needs: [] });
  const r = await coach.answerStudy({ studyIntent: "progress", text: "Which course do I have a homework for?" });
  assert.match(r.answer, /Homework 1.*Linear Algebra Demo/);
  assert.strictEqual(coach.pendingProposal(), null);
});

// QA round 2: a file was filed and its assignment card waits for Confirm. Asking "which homework do I have?" must mention it.
test("r2), a question about homework mentions the card that waits for Confirm (no dead end)", async () => {
  const { coach } = make();
  const ref = coach.tracker.refsFor(COURSES)[0];
  const up = await coach.onUpload({ courseId: ref.courseId, files: [{ fileId: "f1", fileName: "hw1.txt", pages: 1 }], text: "Homework 1. Write a function.", dateText: "this is the homework" });
  assert.ok(up.proposal, "a card is waiting");
  const r = await coach.answerStudy({ studyIntent: "progress", text: "Which course do I have a homework for?" });
  assert.match(r.answer, /Invented title/);
  assert.match(r.answer, /Confirm/i);
  assert.match(r.answer, /Linear Algebra Demo/);
  assert.ok(coach.pendingProposal(), "the card is still there, nothing was saved or created");
});
