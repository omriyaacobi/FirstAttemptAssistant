// study-coach.test.js: the front-desk interface of the study coach, with fake courses and a fake Argon. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");

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
  const r = await coach.brainTools.teach({ courseId: null, part: "" });
  assert.match(r.answer, /Which course do you mean\?/);
});

test("every tutor answer says mode study (jobs.js reads result.answer only for that mode; the night check found teach became an empty answer)", async () => {
  const { coach } = make();
  for (const intent of ["teach", "quiz"]) { // teach comes through the brain's teach_next (brainTools.teach), quiz through answerStudy
    const r = intent === "teach" ? await coach.brainTools.teach({ courseId: IDS.calc, part: "" }) : await coach.answerStudy({ studyIntent: intent, text: intent + " me lecture 3", courseId: IDS.calc });
    assert.strictEqual(r.mode, "study", intent);
    assert.ok(r.answer.length > 10, intent);
    assert.ok(r.study && r.study.mode, "the tutor's own mode stays in study.mode");
  }
});

test("an assignment message becomes a proposal; nothing is saved until Confirm, and Confirm works once", async () => {
  const { coach, sp } = make();
  const r = await coach.onUpload({ kind: "assignment", text: "exercise 4 is due Thursday 12 Nov, write a shell", courseId: IDS.sp });
  assert.match(r.answer, /"Exercise 4", due Thursday 12 Nov, needing: fork, pipes/);
  assert.strictEqual(coach.tracker.progress(sp).assignments.length, 0);
  const id = r.proposal.id;
  assert.match(coach.confirmProposal(id).answer, /Saved "Exercise 4"/);
  assert.strictEqual(coach.confirmProposal(id).ok, false); // single use
  assert.strictEqual(coach.tracker.progress(sp).assignments.length, 1);
});

test("'yes' and 'no' reach the latest proposal; an expired one cannot be confirmed", async () => {
  const { coach } = make();
  await coach.onUpload({ kind: "assignment", text: "exercise due 2026-11-12", courseId: IDS.sp });
  const no = await coach.answerStudy({ studyIntent: "cancel", text: "no" });
  assert.match(no.answer, /Nothing was saved/);
  const r = await coach.onUpload({ kind: "assignment", text: "exercise due 2026-11-12", courseId: IDS.sp });
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

