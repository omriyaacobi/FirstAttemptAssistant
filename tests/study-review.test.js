// tests/study-review.test.js
// BOT KEEPS TRACK OF WHERE OMRI IS (Omri, 2026-11-14): the end-of-day review proposes position updates from Omri's own quoted
// words, the study coach checks and stores them, says so in one message, and Omri can undo for 48 hours (also after a restart).
// Made-up courses and sentences, a fake model, no network.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { createThreadStore } = require("../thread-store");
const { createSummaries, checkSummary, transcriptOf, promptFor } = require("../thread-summary");

const HOUR = 3600 * 1000;
const START = new Date("2026-11-07T12:00:00+02:00").getTime();
const filler = (n) => Array.from({ length: n }, (_, i) => `Made-up sentence ${i} about the topic at hand.`).join("\n");
const DOC = [{ fileId: "d1", fileName: "all-notes.html", page: 1, text: ["# Intro", filler(40), "# Memory management", filler(40), "# Paging", filler(40), "# Scheduling", filler(40)].join("\n") }];
const DB = { id: "b".repeat(16), name: "Databases Demo" }; // no timetable, one notes document with four headings
const CO = { id: "c".repeat(16), name: "Compilers Demo" }; // no timetable, no files
const COURSES = [DB, CO];

function make(dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-review-"))) {
  const clock = { now: START };
  const courses = { list: () => COURSES, allPages: (id) => (id === DB.id ? DOC : []) };
  const coach = createStudyCoach({ dir, courses, askChain: async () => ({ answer: "{}", used: { model: "fake" } }), now: () => clock.now });
  const ref = (c) => coach.tracker.refsFor(COURSES).find((r) => r.courseId === c.id);
  return { coach, clock, dir, pos: (c) => coach.tracker.progress(ref(c)) };
}
const item = (course, fields, quote, at = START - HOUR) => ({ course, fields, quote, at, msg: "m_1" });

test("a proposed position is checked like study_position, stored, and said in one message; nothing becomes understood", () => {
  const w = make();
  const r = w.coach.reviewPositions([
    item("Databases Demo", { mode: "selfStudy", where: { type: "section", name: "Paging" } }, "finished the paging chapter of databases on my own"),
    item("Invented Course", { mode: "attending" }, "something"), // not one of Omri's courses
    item("Compilers Demo", { where: { type: "section", name: "Quantum parsing" } }, "did quantum parsing"), // no such heading: nothing fits
    item("Compilers Demo", { understood: true, mode: "wizard" }, "I know it all"), // not fields Bot has
  ], { lang: "en", day: "2026-11-07" });
  assert.deepStrictEqual(r.lines.map((l) => l.course), ["Databases Demo"]);
  const p = w.pos(DB);
  assert.strictEqual(p.position.mode, "selfStudy");
  assert.deepStrictEqual(p.position.where, { type: "section", name: "Paging" });
  assert.strictEqual(p.position.said, "finished the paging chapter of databases on my own", "Omri's own words are kept");
  assert.strictEqual(p.understood, 0);
  assert.strictEqual(w.pos(CO).positionKnown, false, "a course where nothing fitted is not touched");
  assert.match(r.text, /^From what you wrote today I updated where you are:\n- Databases Demo: studying from the notes alone; .*Paging.* \(you wrote: "finished the paging chapter of databases on my own"\)\nIf one is wrong, tell me "undo Databases Demo" \(it works for 48 hours\)\. This is only where you are: "understood" still comes only from my quiz\.$/);
  assert.doesNotMatch(r.text, /Compilers|Invented/);
});

test("nothing to say when nothing changed: the same position again, or no items", () => {
  const w = make();
  w.coach.reviewPositions([item("Databases Demo", { mode: "selfStudy" }, "I study databases alone")]);
  w.clock.now += HOUR;
  const again = w.coach.reviewPositions([item("Databases Demo", { mode: "selfStudy" }, "still alone on databases", w.clock.now)]);
  assert.deepStrictEqual(again, { lines: [], text: "" });
  assert.deepStrictEqual(w.coach.reviewPositions([]), { lines: [], text: "" });
  assert.deepStrictEqual(w.coach.reviewPositions(null), { lines: [], text: "" });
});

test("a record that is newer than the quoted message is not overwritten", () => {
  const w = make();
  w.coach.brainTools.position({ courseId: DB.id, fields: { where: { type: "section", name: "Scheduling" } }, said: "Databases Demo: I am at scheduling" });
  const r = w.coach.reviewPositions([item("Databases Demo", { where: { type: "section", name: "Paging" } }, "I was at paging this morning", START - 3 * HOUR)]);
  assert.strictEqual(r.text, "");
  assert.strictEqual(w.pos(DB).position.where.name, "Scheduling");
});

test("two messages of one day about one course: both are applied in order, and ONE undo goes back to before the day", () => {
  const w = make();
  w.coach.brainTools.position({ courseId: DB.id, fields: { mode: "attending" }, said: "Databases Demo: I go to the lectures" });
  w.clock.now += 5 * HOUR;
  const r = w.coach.reviewPositions([
    item("Databases Demo", { where: { type: "section", name: "Paging" } }, "now at paging", START + 3 * HOUR),
    item("Databases Demo", { where: { type: "section", name: "Memory management" } }, "did memory management", START + 2 * HOUR),
  ]);
  assert.strictEqual(r.lines.length, 2);
  assert.strictEqual(w.pos(DB).position.where.name, "Paging", "the later message wins");
  assert.match(w.coach.brainTools.undo({ courseId: DB.id }), /^Undone\. Databases Demo is back/);
  const p = w.pos(DB).position;
  assert.strictEqual(p.mode, "attending");
  assert.strictEqual(p.where, undefined);
  assert.strictEqual(p.said, "Databases Demo: I go to the lectures");
});

test("undo works the next morning and after a restart, by course name; not after 48 hours; once only", () => {
  const w = make();
  w.coach.reviewPositions([item("Databases Demo", { mode: "selfStudy" }, "I study databases alone"), item("Compilers Demo", { mode: "notStarted" }, "have not started compilers")]);
  // Bot restarts: a new coach on the same folder, 10 hours later
  const next = make(w.dir);
  next.clock.now = START + 10 * HOUR;
  assert.strictEqual(next.pos(DB).position.mode, "selfStudy");
  assert.match(next.coach.brainTools.undo({ courseId: DB.id, lang: "he" }), /^בוטל\. Databases Demo חזר/);
  assert.strictEqual(next.pos(DB).positionKnown, false, "back to exactly what was there before: nothing");
  assert.strictEqual(next.pos(CO).position.mode, "notStarted", "the other course is not touched");
  assert.throws(() => next.coach.brainTools.undo({ courseId: DB.id }), /nothing to undo for Databases Demo/);
  // the other course: too late after 48 hours
  next.clock.now = START + 49 * HOUR;
  assert.throws(() => next.coach.brainTools.undo({ courseId: CO.id }), /nothing to undo/);
  assert.throws(() => next.coach.brainTools.undo({}), /nothing to undo/);
  assert.strictEqual(next.pos(CO).position.mode, "notStarted");
});

test("undo without a course: the change just made first; else the newest kept one, and the reply names it", () => {
  const w = make();
  w.coach.reviewPositions([item("Compilers Demo", { mode: "notStarted" }, "have not started compilers")]);
  w.clock.now += HOUR;
  w.coach.brainTools.position({ courseId: DB.id, fields: { mode: "selfStudy" }, said: "Databases Demo: alone" });
  assert.match(w.coach.brainTools.undo({}), /Databases Demo/);
  assert.strictEqual(w.pos(CO).position.mode, "notStarted");
  w.clock.now += 3 * HOUR;
  assert.match(w.coach.brainTools.undo({}), /^Undone\. Compilers Demo is back/);
  assert.throws(() => w.coach.brainTools.undo({}), /nothing to undo/);
});

test("Hebrew: the message is in Hebrew", () => {
  const w = make();
  const r = w.coach.reviewPositions([item("Databases Demo", { mode: "selfStudy" }, "אני לומד בסיסי נתונים לבד")], { lang: "he", day: "2026-11-07" });
  assert.match(r.text, /^לפי מה שנכתב היום עודכן המצב בקורסים:\n- Databases Demo: לימוד עצמי מהסיכומים \(נכתב: "אני לומד בסיסי נתונים לבד"\)\nאם משהו לא נכון, אפשר לכתוב "בטל Databases Demo"/);
});

// ---- the review's side (thread-summary.js) ----------------------------------------------------------------------------------------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-review-sum-"));
const T = (h, m = 0, d = 14) => new Date(2026, 10, d, h, m).getTime();
const NAMES = ["Databases Demo", "Compilers Demo"];

test("the prompt asks for 'study' only when there are courses, and names them", () => {
  assert.doesNotMatch(promptFor("2026-11-14", "x"), /"study"/);
  const p = promptFor("2026-11-14", "x", NAMES);
  assert.match(p, /"study": \[\{"course": one of these course names, copied exactly: \["Databases Demo","Compilers Demo"\]/);
  assert.match(p, /NOT plans or wishes/);
});

test("checkSummary keeps a study item only with an exact course name and a quote from one of OMRI'S messages", () => {
  const thread = createThreadStore(tmp());
  thread.append({ role: "user", text: "today I finished the paging chapter of databases", at: T(10), topic: "general" });
  thread.append({ role: "assistant", text: "Nice. You should also finish the scheduling chapter of databases", at: T(11), topic: "general" });
  const { byNumber } = transcriptOf(thread.readDay("2026-11-14"));
  const f = { where: { type: "section", name: "Paging" } };
  const c = checkSummary({ summary: "s", study: [
    { course: "Databases Demo", msg: 1, quote: "finished the paging chapter of databases", fields: f },
    { course: "Databases Demo", msg: 2, quote: "finish the scheduling chapter of databases", fields: f }, // Bot's words
    { course: "databases", msg: 1, quote: "finished the paging chapter of databases", fields: f }, // not an exact name
    { course: "Databases Demo", msg: 1, quote: "finished the whole course", fields: f }, // not what was written
    { course: "Databases Demo", msg: 1, quote: "finished the paging chapter of databases", fields: "lecture 5" }, // not fields
  ] }, { byNumber, courses: NAMES });
  assert.strictEqual(c.study.length, 1);
  assert.deepStrictEqual({ course: c.study[0].course, at: c.study[0].at, fields: c.study[0].fields }, { course: "Databases Demo", at: T(10), fields: f });
  assert.strictEqual(c.dropped, 4);
  assert.deepStrictEqual(checkSummary({ summary: "s", study: [{ course: "Databases Demo", msg: 1, quote: "finished the paging chapter of databases", fields: f }] }, { byNumber }).study, [], "no courses given: no study items");
});

test("the review hands each (message, course) to the coach once, also when the day's note is made again; an old day is not applied", async () => {
  const thread = createThreadStore(tmp());
  const clock = { now: T(23, 50) };
  const calls = [];
  const answer = () => JSON.stringify({ summary: "The user studied.", facts: [], tasks: [], openQuestions: [], done: [], study: [{ course: "Databases Demo", msg: 1, quote: "finished the paging chapter", fields: { where: { type: "section", name: "Paging" } } }] });
  const summaries = createSummaries({
    thread, dir: tmp(), now: () => clock.now, askChain: async () => ({ answer: answer(), used: { provider: "agy", model: "flash" } }),
    courseNames: () => NAMES, onStudy: async (day, items) => { calls.push({ day, items }); return { lines: [{ course: "Databases Demo", text: "at Paging", quote: items[0].quote }] }; },
  });
  thread.append({ role: "user", text: "finished the paging chapter today", at: T(18), topic: "general" });
  thread.append({ role: "assistant", text: "Well done", at: T(18, 1), topic: "general" });
  const first = await summaries.endOfDay();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].day, "2026-11-14");
  assert.strictEqual(calls[0].items[0].course, "Databases Demo");
  assert.strictEqual(first.study.length, 1);
  // the talk goes on: the note is made again, the same message is NOT handed over twice
  thread.append({ role: "user", text: "good night", at: T(23, 55), topic: "general" });
  clock.now = T(23, 57);
  const second = await summaries.endOfDay();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(second.study.length, 1, "what was stored stays in the note");
  // a day from 4 days ago that never got its note: summarized on catch-up, but its positions are not applied
  thread.append({ role: "user", text: "finished the paging chapter long ago", at: T(10, 0, 11), topic: "general" });
  thread.append({ role: "assistant", text: "ok", at: T(10, 1, 11), topic: "general" });
  clock.now = T(9, 0, 15);
  await summaries.catchUp();
  assert.strictEqual(calls.length, 1);
});

test("without the coach's hook the review does not ask for positions at all", async () => {
  const thread = createThreadStore(tmp());
  const prompts = [];
  const summaries = createSummaries({ thread, dir: tmp(), now: () => T(23, 50), courseNames: () => NAMES, askChain: async (chain, prompt) => { prompts.push(prompt); return { answer: JSON.stringify({ summary: "s", study: [{ course: "Databases Demo", msg: 1, quote: "finished the paging chapter", fields: {} }] }), used: {} }; } });
  thread.append({ role: "user", text: "finished the paging chapter today", at: T(18), topic: "general" });
  thread.append({ role: "assistant", text: "Well done", at: T(18, 1), topic: "general" });
  const r = await summaries.endOfDay();
  assert.doesNotMatch(prompts[0], /"study"/);
  assert.deepStrictEqual(r.study, []);
});
