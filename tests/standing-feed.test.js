// standing-feed.test.js: step 6 of the "where am I" plan. The record of how the student studies feeds the report, the plan for today, the quiz range,
// the nudges and the Study page. Made-up courses and a fake model only. Clock: Saturday 2026-11-07, 12:00 (Israel).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { createNudges } = require("../study-nudges");
const { createTracker } = require("../study-tracker");
const { studyOverview } = require("../study-page");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const body = (tag, n = 30) => Array.from({ length: n }, (_, i) => `${tag} sentence ${i} about the topic.`).join("\n");
const DOC = [{ fileId: "d1", fileName: "all-notes.html", page: 1, text: ["# Intro", body("ZZINTRO"), "# Memory management", body("ZZMEMORY"), "# Paging", body("ZZPAGING"), "# Scheduling", body("ZZSCHED")].join("\n") }];
const SP = { id: "a".repeat(16), name: "Systems Programming" }; // timetable, one big notes document, no per-lecture files
const DB = { id: "b".repeat(16), name: "Databases Demo" }; // no timetable, one big notes document
const CA = { id: "c".repeat(16), name: "Calculus 2" }; // timetable, lectures with material
const COURSES = [SP, DB, CA];

function make() {
  const prompts = [];
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    const answer = /Write exactly/.test(prompt) ? JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) }) : "{}";
    return { answer, used: { model: chain[0].model } };
  };
  const courses = { list: () => COURSES, allPages: (id) => (id === SP.id || id === DB.id ? DOC : []) };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-feed-")), courses, askChain, now: () => NOW });
  const refs = coach.tracker.refsFor(COURSES);
  const ref = (c) => refs.find((r) => r.courseId === c.id);
  return { coach, prompts, ref, set: (c, f) => coach.tracker.setStanding(ref(c), f), say: (text, intent = "progress", extra = {}) => coach.answerStudy({ studyIntent: intent, text, ...extra }) };
}

test("a course whose notes are one big document never says 'behind on N' or 'material for 0 of N'", async () => {
  const { say } = make();
  const r = await say("where am I in Systems Programming?");
  assert.doesNotMatch(r.answer, /Behind on|Material in Bot for 0 of/);
  assert.match(r.answer, /Notes in Bot: 1 file, 4 sections \(not split by lecture\)/);
  assert.match(r.answer, /lectures? held so far by the timetable/); // the timetable line stays
});

test("a student who studies alone or revises gets no catch-up count; one who attends still does (Calculus 2 has lecture material)", async () => {
  const { say, set, ref, coach } = make();
  const calc = ref(CA);
  coach.tracker.attachMaterial(calc, coach.tracker.slots(calc.key)[0].date, [{ fileId: "x", from: 1, to: 1 }]);
  const before = await say("where am I in Calculus 2?");
  assert.match(before.answer, /Behind on \d+/);
  set(CA, { mode: "selfStudy", said: "I read the notes alone" });
  const alone = await say("where am I in Calculus 2?");
  assert.doesNotMatch(alone.answer, /Behind on/);
  assert.match(alone.answer, /As I read it: studying from the notes alone/);
  set(CA, { mode: "attending", said: "I go to class" });
  assert.match((await say("where am I in Calculus 2?")).answer, /Behind on \d+/);
});

test("a course without a timetable shows the notes and the student's own reading, no counts", async () => {
  const { say, set } = make();
  set(DB, { mode: "selfStudy", where: { type: "section", name: "Paging" }, pace: "behind", said: "reading alone, in Paging, behind" });
  const r = await say("where am I in Databases Demo?");
  assert.match(r.answer, /As I read it: studying from the notes alone; at "Paging" in the notes; behind\./);
  assert.match(r.answer, /Notes in Bot: 1 file, 4 sections/);
  assert.doesNotMatch(r.answer, /lectures held|Behind on/);
});

test("the plan for today follows the mode: next piece of the notes, a quiz on what was covered, or nothing", async () => {
  const { say, set } = make();
  set(DB, { mode: "selfStudy", where: { type: "section", name: "Memory management" }, said: "x" });
  assert.match((await say("what should I study today in Databases Demo?", "plan")).answer, /The next piece of Databases Demo in your notes: "Paging"/);
  set(DB, { mode: "notStarted", said: "not started" });
  assert.match((await say("what should I study today in Databases Demo?", "plan")).answer, /next piece of Databases Demo in your notes: "Intro"/);
  set(DB, { mode: "revising", depth: "shaky", said: "revising" });
  assert.match((await say("what should I study today in Databases Demo?", "plan")).answer, /you are revising.*quiz on what you already covered, starting with the parts you say sit badly/);
  set(DB, { mode: "paused", said: "pause" });
  assert.match((await say("what should I study today in Databases Demo?", "plan")).answer, /not studying it for now, so I suggest nothing/);
});

test("quiz range, notes: only the sections up to the student's place are given to the model", async () => {
  const { say, set, prompts } = make();
  set(DB, { mode: "revising", where: { type: "section", name: "Memory management" }, said: "x" });
  await say("quiz me on Databases Demo", "quiz", { courseId: DB.id, courseName: DB.name });
  const p = prompts.find((x) => /Write exactly/.test(x));
  assert.ok(p, "the model was asked for questions");
  assert.match(p, /ZZINTRO/);
  assert.match(p, /ZZMEMORY/);
  assert.doesNotMatch(p, /ZZPAGING|ZZSCHED/); // later parts were never given
});

test("quiz range, lectures: a revising student is asked only about lectures up to their place, minus the ones they missed; 'shaky' goes first and counts as nothing", async () => {
  const { say, set, ref, coach } = make();
  const calc = ref(CA);
  const slots = coach.tracker.slots(calc.key).filter((s) => s.date <= "2026-11-07");
  assert.ok(slots.length >= 4);
  for (const s of slots) coach.tracker.attachMaterial(calc, s.date, [{ fileId: "x", from: 1, to: 1 }], { topic: `topic ${s.n}` });
  set(CA, { mode: "revising", where: { type: "lecture", n: 3 }, gaps: [{ kind: "lecture", n: 1 }], depth: "shaky", said: "x" });
  await say("quiz me", "quiz", { courseId: CA.id, courseName: CA.name });
  const session = coach.tracker.getSession(calc);
  assert.strictEqual(session.target.n, 3); // shaky: the place itself first; never later than 3, never the missed 1
  assert.strictEqual(coach.tracker.progress(calc).understood, 0); // a stated opinion never sets understood
  // when the message names a lecture, the range does not apply (the student asked otherwise)
  coach.tracker.setSession(calc, null);
  await say("quiz me on lecture 5", "quiz", { courseId: CA.id, courseName: CA.name });
  assert.strictEqual(coach.tracker.getSession(calc).target.n, 5);
});

test("nudges: revising or paused silences the catch-up nudge; an exam confirmed within a week is a real date; attending is unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-feednudge-"));
  const clock = { now: new Date("2026-11-08T08:30:00+02:00").getTime() };
  const tracker = createTracker({ dir, now: () => clock.now });
  const list = [SP];
  const nudges = createNudges({ tracker, courseList: () => list, now: () => clock.now });
  const sp = tracker.refsFor(list)[0];
  tracker.attachMaterial(sp, "2026-10-25", [{ fileId: "f", from: 1, to: 2 }]);
  assert.ok(nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setStanding(sp, { mode: "revising", said: "revising" });
  assert.ok(!nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setStanding(sp, { mode: "attending", said: "attending" });
  assert.ok(nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setStanding(sp, { mode: "paused", said: "paused" });
  assert.ok(!nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setExamDate(sp, "2026-11-12");
  const e = nudges.candidates().find((c) => c.kind === "exam");
  assert.match(e.text, /the exam is Thursday 12 Nov, in 4 days/);
  tracker.setStanding(sp, { mode: "revising", said: "again" }); // a new reading keeps the confirmed exam date
  assert.ok(nudges.candidates().find((c) => c.kind === "exam"));
  tracker.setExamDate(sp, "2026-12-30");
  assert.ok(!nudges.candidates().some((c) => c.kind === "exam")); // further than a week: no nudge
  assert.throws(() => tracker.setExamDate(sp, "2026-11-01"), /not a date I can use/); // in the past
});

test("the Study page gets the student's own reading and words; an old record shows as before", () => {
  const { coach, set } = make();
  set(DB, { mode: "selfStudy", where: { type: "section", name: "Paging" }, said: "reading alone" });
  const out = studyOverview({ coach, courseList: COURSES, now: NOW, lang: "en" });
  const db = out.courses.find((c) => c.name === DB.name);
  assert.match(db.youAre, /studying from the notes alone; at "Paging" in the notes/);
  assert.strictEqual(db.yourWords, "reading alone");
  const he = studyOverview({ coach, courseList: COURSES, now: NOW, lang: "he" }).courses.find((c) => c.name === DB.name);
  assert.match(he.youAre, /לימוד עצמי מהסיכומים/);
  const calc = out.courses.find((c) => c.name === CA.name);
  assert.strictEqual(calc.youAre, undefined);
});

test("the front desk study line says the catch-up count is not used for a student who revises", () => {
  const { coach, set } = make();
  set(SP, { mode: "revising", said: "x" });
  assert.match(coach.studyLine(), /Systems Programming: \d+ lectures held, 0 checked as understood, catch-up count not used, student says: revising/);
});
