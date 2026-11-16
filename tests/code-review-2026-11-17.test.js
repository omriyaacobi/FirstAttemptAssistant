// tests/code-review-2026-11-17.test.js
// Tests for what the second part of the code review fixed (experiments/2026-11-16-code-review.md, part 2). Made-up data only:
// fake models, no network, temp folders.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const NOW = new Date("2026-11-07T12:00:00+02:00").getTime(); // Saturday

// ---- Hebrew written by code uses no gendered "you" (CLAUDE.md) ----

// Forms that are only masculine (or only feminine) when said TO someone. "את" alone is left out: it is also the plain word before an object.
const GENDERED = /(?<![א-ת])(?:אתה|ספר לי|ספרי לי|שלח את|שלחי את|תגיד|תגידי|שתלחץ|שתלחצי|מקדים|מקדימה)(?![א-ת])/;

test("Study page: the questions Bot writes in Hebrew address nobody as a man or a woman", () => {
  const { createTracker } = require("../study-tracker");
  const { studyOverview } = require("../study-page");
  const tracker = createTracker({ dir: tmp("bot-review2-study-"), now: () => NOW });
  const coach = { tracker, pendingProposal: () => null };
  const r = studyOverview({ coach, courseList: [{ id: "a".repeat(16), name: "Systems Programming" }], now: NOW, lang: "he" });
  const questions = r.courses[0].questions;
  assert.ok(questions.length >= 2, "an unknown position and a lecture without material both ask something");
  for (const q of questions) { assert.match(q, /[א-ת]/); assert.doesNotMatch(q, GENDERED, q); }
  const en = studyOverview({ coach, courseList: [{ id: "a".repeat(16), name: "Systems Programming" }], now: NOW, lang: "en" });
  assert.match(en.courses[0].questions[0], /^Where are you in Systems Programming\?/, "the English text is unchanged");
});

test("Confirm cards for links and Moodle files: the Hebrew line about the tap is not gendered", () => {
  const { createLinkBatches } = require("../link-batch");
  const batches = createLinkBatches({ fetchLink: async () => { throw new Error("never fetched in this test"); }, readPage: async () => { throw new Error("never read"); }, addFetched: () => ({}), now: () => NOW });
  const urls = ["https://example.org/a.pdf", "https://example.org/b.pdf"];
  for (const mode of ["save", "moodle"]) {
    const p = batches.propose({ courseId: "a".repeat(16), courseName: "קורס לדוגמה", urls, mode, lang: "he", source: "רשימה", runOne: async () => ({ ok: true }) });
    assert.match(p.text, /לפני לחיצה על אישור/);
    assert.doesNotMatch(p.text, GENDERED, p.text);
  }
});

test("The page's own Hebrew words (Study tab, first-open notice) are not gendered", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const at = html.indexOf('title: "לימודים"');
  assert.ok(at > 0, "the Hebrew block of the Study tab is there");
  const block = html.slice(at, html.indexOf("locale: \"he-IL\"", at));
  assert.ok(block.length > 500);
  assert.doesNotMatch(block, GENDERED);
});

// ---- a quiz reply: the brain says what it is, the tutor does not look for words in the answer ----

const DB = { id: "b".repeat(16), name: "Databases Demo" };
function quizWorld(brainReplies, graderJson) {
  const { createStudyCoach } = require("../study-coach");
  const { createBrain } = require("../brain");
  const coachPrompts = [];
  const askChain = async (chain, prompt) => { coachPrompts.push(prompt); return { answer: /Grade ONE answer/.test(prompt) ? JSON.stringify(graderJson) : "Think about what a page table maps.", used: { model: chain[0].model } }; };
  const courses = { list: () => [DB], allPages: () => [] };
  const coach = createStudyCoach({ dir: tmp("bot-review2-quiz-"), courses, askChain, now: () => NOW });
  let i = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [DB], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "t", text: "page text" }),
    askOne: async () => { const r = brainReplies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const ref = coach.tracker.refsFor([DB])[0];
  const open = () => coach.tracker.setSession(ref, { id: "s1", mode: "quiz", lang: "en", startedAt: NOW, target: { type: "lecture", date: null, n: 1 }, current: 0,
    questions: [{ id: "q1", q: "What does a page table do?", key: "It maps virtual pages to physical frames.", topic: "paging", attempts: 0, hints: 0, state: "open", verdict: null, revealed: false },
      { id: "q2", q: "What is a page fault?", key: "An access to a page that is not in memory.", topic: "paging", attempts: 0, hints: 0, state: "open", verdict: null, revealed: false }] });
  const ask = (task) => brain.handle(task, { history: [], courses: [DB] });
  return { coach, ref, open, ask, coachPrompts, session: () => coach.tracker.getSession(ref) };
}
const RIGHT = { verdict: "right", feedback: "Yes, that is the mapping.", note: "", relevant: true };

test("quiz: a real answer that holds the words 'reveal', 'stuck' and 'hint' is GRADED, not shown the answer", async () => {
  const w = quizWorld(['CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"answer"}'], RIGHT);
  w.open();
  const r = await w.ask("It maps virtual pages to frames, so a lookup can reveal where a stuck process keeps its data; the TLB is only a hint.");
  assert.match(r.answer, /^Right\. Yes, that is the mapping\./);
  assert.doesNotMatch(r.answer, /Here is the answer|Hint 1 of 3/);
  const q = w.session().questions[0];
  assert.strictEqual(q.verdict, "right");
  assert.strictEqual(q.revealed, false);
  assert.strictEqual(q.hints, 0, "no hint was counted against the answer");
  assert.ok(w.coachPrompts.some((p) => /Grade ONE answer/.test(p)), "the grader was asked");
});

test("quiz: 'hint' and 'show' come from what the brain understood, whatever words Omri used", async () => {
  const w = quizWorld(['CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"hint"}', 'CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"show"}'], RIGHT);
  w.open();
  const h = await w.ask("can you nudge me a little?");
  assert.match(h.answer, /^Hint 1 of 3: Think about what a page table maps\./);
  assert.strictEqual(w.session().questions[0].hints, 1);
  const s = await w.ask("no idea, what is it?");
  assert.match(s.answer, /^Here is the answer: It maps virtual pages to physical frames\./);
  assert.strictEqual(w.session().questions[0].verdict, "wrong", "a shown answer counts as wrong, as before");
  assert.ok(!w.coachPrompts.some((p) => /Grade ONE answer/.test(p)), "nothing was graded");
});

test("quiz: a claim is still not an attempt, and without 'ask' the tutor behaves as before", async () => {
  const tutor = require("../tutor");
  assert.deepStrictEqual(tutor.ASK_KINDS, ["answer", "hint", "show", "skip"]);
  const w = quizWorld(['CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"answer"}', 'CALL {"tool":"quiz_answer","course":"Databases Demo"}', 'CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"delete everything"}'], RIGHT);
  w.open();
  const c = await w.ask("I understand it all");
  assert.match(c.answer, /does not count: show me/);
  assert.strictEqual(w.session().questions[0].attempts, 0);
  const old = await w.ask("just show me the answer"); // no "ask" from the model: the old words still work
  assert.match(old.answer, /^Here is the answer:/);
  const odd = await w.ask("An access to a page that is not in memory."); // an unknown "ask" value is dropped by code: the message is graded
  assert.match(odd.answer, /^Right\./);
});
