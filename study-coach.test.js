// study-coach.test.js: the front-desk interface of the study coach, with fake courses and a fake Argon. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("./study-coach");

const clock = { now: new Date("2026-11-07T12:00:00+02:00").getTime() };
const IDS = { sp: "a".repeat(16), calc: "b".repeat(16), hpsp: "c".repeat(16), algo: "d".repeat(16) };
const COURSES = [
  { id: IDS.calc, name: "Calculus 2" }, { id: IDS.sp, name: "Systems Programming" },
  { id: IDS.hpsp, name: "High-Performance Systems Programming S1" }, { id: IDS.algo, name: "Algorithms Planning" },
];
// Calculus 2 has a whole notebook (8 lectures, 2 pages each); the others have nothing yet.
const NOTEBOOK = Array.from({ length: 16 }, (_, i) => ({ fileId: "nb", fileName: "calc.pdf", page: i + 1, text: i % 2 === 0 ? `Lecture ${i / 2 + 1}\nintegrals` : "more integrals" }));

function make() {
  clock.now = new Date("2026-11-07T12:00:00+02:00").getTime();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-coach-"));
  const calls = [];
  const askChain = async (chain, prompt) => {
    calls.push({ chain: chain.map((m) => m.model), prompt });
    let answer = "?";
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else if (/received an assignment/.test(prompt)) answer = '{"title": "Exercise 4", "due": "2026-11-12", "needs": ["fork", "pipes"]}';
    else if (/Teach the topic/.test(prompt)) answer = "Lesson [S1].";
    return { answer, used: { model: chain[0].model } };
  };
  const courses = { list: () => COURSES, allPages: (id) => (id === IDS.calc ? NOTEBOOK : []) };
  const coach = createStudyCoach({ dir, courses, askChain, now: () => clock.now });
  const refs = coach.tracker.refsFor(COURSES);
  return { coach, calls, dir, calc: refs[0], sp: refs[1] };
}

test("without anything told, the first study answer asks where you are and invents nothing", async () => {
  const { coach, calls } = make();
  const r = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(r.answer, /Systems Programming: 6 lectures held/);
  assert.match(r.answer, /I do not know where you are in this course yet/);
  assert.match(r.answer, /where are you in Calculus 2, Systems Programming/);
  assert.match(r.answer, /I will not mark anything as understood from this/);
  assert.strictEqual(calls.length, 0); // progress is code only
  assert.strictEqual(r.study.courses.every((c) => c.understood === 0), true);
});

test("the front-desk line is short, from code, and empty when nothing is tracked", () => {
  const { coach } = make();
  const line = coach.studyLine();
  assert.match(line, /^Study \(from the tracker, today 2026-11-07\)/);
  assert.match(line, /Systems Programming: 6 lectures held, 0 checked as understood, 5 behind, student's position unknown/);
  assert.ok(line.length < 900);
  const empty = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-coach-")), courses: { list: () => [], allPages: () => [] }, askChain: async () => ({}), now: () => clock.now });
  assert.strictEqual(empty.studyLine(), "");
});

test("the studyLine never throws, even when the course list breaks", () => {
  const c = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-coach-")), courses: { list: () => { throw new Error("boom"); }, allPages: () => [] }, askChain: async () => ({}), now: () => clock.now });
  assert.strictEqual(c.studyLine(), "");
});

test("'no lecture this week' removes that course's lectures of this week and moves the numbers", async () => {
  const { coach } = make();
  const before = coach.tracker.slots("sp").length;
  const r = await coach.answerStudy({ studyIntent: "update", text: "no Systems Programming lecture this week" });
  assert.match(r.answer, /Removed Systems Programming: Sunday 1 Nov, Thursday 5 Nov/);
  assert.strictEqual(coach.tracker.slots("sp").length, before - 2);
  const p = await coach.answerStudy({ studyIntent: "progress", text: "Systems Programming" });
  assert.match(p.answer, /4 lectures held so far by the timetable \(cancelled ones removed\)/);
  const undo = await coach.answerStudy({ studyIntent: "update", text: "there was a Systems Programming lecture on 2026-11-05" });
  assert.match(undo.answer, /back in the count/);
  assert.strictEqual(coach.tracker.slots("sp").length, before - 1);
});

test("a cancelled day, 'no classes' for everyone, and a day with no such lecture", async () => {
  const { coach } = make();
  const r1 = await coach.answerStudy({ studyIntent: "update", text: "no classes on 24 Dec" });
  assert.match(r1.answer, /every course: Thursday 24 Dec/);
  const r2 = await coach.answerStudy({ studyIntent: "update", text: "no Algorithms lecture on 2026-11-10" });
  assert.match(r2.answer, /has no lecture on/);
  const r3 = await coach.answerStudy({ studyIntent: "update", text: "no lecture" });
  assert.match(r3.answer, /I did not catch/);
});

test("telling where you are: a weekday, a number, per course on separate lines", async () => {
  const { coach, sp } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "Systems Programming: my last lecture was Thursday\nCalculus: I'm at lecture 3" });
  assert.match(r.answer, /Systems Programming: noted that you are up to Thursday 5 Nov/);
  assert.match(r.answer, /Calculus 2: noted that you are up to Monday 26 Oct/);
  const p = coach.tracker.progress(sp);
  assert.strictEqual(p.positionKnown, true);
  assert.strictEqual(p.understood, 0); // telling is never understanding
  const bad = await coach.answerStudy({ studyIntent: "update", text: "Algorithms: I'm at lecture 99" });
  assert.match(bad.answer, /no held lecture/);
});

test("a notebook with more lectures than classes held is lined up once, and says it is an assumption", async () => {
  const { coach, calc } = make();
  const r = await coach.answerStudy({ studyIntent: "progress", text: "Calculus 2" });
  assert.match(r.answer, /Material in Bot for 6 of them/);
  assert.strictEqual(coach.tracker.course(calc).lectures["2026-10-19"].assumed, true);
  const again = await coach.answerStudy({ studyIntent: "progress", text: "Calculus 2" });
  assert.match(again.answer, /Material in Bot for 6 of them/);
});

test("quiz through the coach uses Argon only and finishes with a real check", async () => {
  const { coach, calls, calc } = make();
  const q = await coach.answerStudy({ studyIntent: "quiz", text: "quiz me on lecture 1 of Calculus" });
  assert.match(q.answer, /Question 1 of 3: Question number 1\?/);
  assert.match(q.answer, /assumed notebook lecture k/);
  assert.ok(calls.every((c) => c.chain.every((m) => /argon/.test(m))));
  const asked = await coach.answerStudy({ studyIntent: "answer", text: "I understand it all" });
  assert.match(asked.answer, /does not count/);
  assert.strictEqual(coach.tracker.progress(calc).understood, 0);
});

test("a course question without a course asks which one", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "teach", text: "teach me the next lecture" });
  assert.match(r.answer, /Which course do you mean\?/);
});

test("an assignment message becomes a proposal; nothing is saved until Confirm, and Confirm works once", async () => {
  const { coach, sp } = make();
  const r = await coach.answerStudy({ studyIntent: "assignment", text: "exercise 4 is due Thursday 12 Nov, write a shell", courseId: IDS.sp });
  assert.match(r.answer, /"Exercise 4", due Thursday 12 Nov, needing: fork, pipes/);
  assert.strictEqual(coach.tracker.progress(sp).assignments.length, 0);
  const id = r.proposal.id;
  assert.match(coach.confirmProposal(id).answer, /Saved "Exercise 4"/);
  assert.strictEqual(coach.confirmProposal(id).ok, false); // single use
  assert.strictEqual(coach.tracker.progress(sp).assignments.length, 1);
});

test("'yes' and 'no' reach the latest proposal; an expired one cannot be confirmed", async () => {
  const { coach } = make();
  await coach.answerStudy({ studyIntent: "assignment", text: "exercise due 2026-11-12", courseId: IDS.sp });
  const no = await coach.answerStudy({ studyIntent: "cancel", text: "no" });
  assert.match(no.answer, /Nothing was saved/);
  const r = await coach.answerStudy({ studyIntent: "assignment", text: "exercise due 2026-11-12", courseId: IDS.sp });
  clock.now += 13 * 3600 * 1000;
  assert.strictEqual(coach.confirmProposal(r.proposal.id).ok, false);
});

test("material with a date, and material without one, both become proposals pointing at a real slot", async () => {
  const { coach, sp } = make();
  const dated = await coach.onUpload({ courseId: IDS.sp, files: [{ fileId: "f1", fileName: "l.pdf", pages: 10 }], dateText: "slides from 29 Oct" });
  assert.match(dated.answer, /lecture of Thursday 29 Oct \(from the date you gave\)/);
  const undated = await coach.onUpload({ courseId: IDS.sp, files: [{ fileId: "f2", fileName: "m.pdf", pages: 5 }] });
  assert.match(undated.answer, /lecture of Thursday 5 Nov \(the most recent lecture that has no material yet\)/);
  assert.strictEqual(coach.tracker.progress(sp).withMaterial, 0); // nothing attached yet
  assert.match(coach.confirmProposal(undated.proposal.id).answer, /Attached it/);
  assert.strictEqual(coach.tracker.progress(sp).withMaterial, 1);
});

test("pause and resume work from chat, with a date, and an unknown intent only shows numbers", async () => {
  const { coach } = make();
  const p = await coach.answerStudy({ studyIntent: "pause", text: "pause study reminders until 2026-11-20 I have reserve duty" });
  assert.match(p.answer, /paused until Friday 20 Nov/);
  assert.strictEqual(coach.nudges.isPaused(), true);
  const r = await coach.answerStudy({ studyIntent: "resume", text: "I am back" });
  assert.match(r.answer, /on again/);
  assert.strictEqual(coach.nudges.isPaused(), false);
  const odd = await coach.answerStudy({ studyIntent: "delete-everything", text: "x" });
  assert.match(odd.answer, /lectures held/);
});

test("motivate is code-written (no model), honest, and points at the smallest next step", async () => {
  const { coach, calls, sp } = make();
  coach.tracker.attachMaterial(sp, "2026-10-22", [{ fileId: "f", from: 1, to: 2 }]);
  const r = await coach.answerStudy({ studyIntent: "motivate", text: "I do not feel like studying Systems Programming" });
  assert.match(r.answer, /smallest next step: lecture 2 \(Thursday 22 Oct\)/);
  assert.strictEqual(calls.length, 0);
});
