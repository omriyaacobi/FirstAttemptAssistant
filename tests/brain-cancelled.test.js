// tests/brain-cancelled.test.js
// The brain's class_cancelled tool (brain.js -> study-coach.js brainTools.classCancelled) with a REAL coach and FAKE models.
// What is checked: the model only hands in a course and a date; code keeps the date only when the timetable really has a
// lecture of that course on it; study_undo puts it back; a web page can never cause it. All text here is invented.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { createBrain } = require("../brain");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime(); // Saturday
const CALC = { id: "a".repeat(16), name: "Calculus 2 Demo" }; // the default timetable: lectures on Monday and Wednesday
const OTHER = { id: "d".repeat(16), name: "Pottery Demo" }; // not in the timetable

function world(replies) {
  const courses = { list: () => [CALC, OTHER], allPages: () => [] };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-cancelled-")), courses, askChain: async (chain) => ({ answer: "?", used: { model: chain[0].model } }), now: () => NOW });
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [CALC, OTHER], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "t", text: "page text" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const ask = (task, opts = {}) => brain.handle(task, { history: [], courses: [CALC, OTHER], ...opts });
  const dates = () => coach.tracker.slots("calculus").map((s) => s.date);
  return { coach, prompts, ask, dates };
}

test("class_cancelled: a real lecture date leaves the count, the numbers after it move up, and study_undo puts it back", async () => {
  const w = world(['CALL {"tool":"class_cancelled","course":"Calculus 2 Demo","date":"2026-11-09"}\nNoted, no lecture on Monday.', 'CALL {"tool":"study_undo"}\nIt is back.']);
  const before = w.coach.tracker.slotOn("calculus", "2026-11-11").n;
  const r = await w.ask("the calculus lecture this monday is cancelled");
  assert.strictEqual(r.answer, "Noted, no lecture on Monday.");
  assert.ok(!w.dates().includes("2026-11-09"));
  assert.deepStrictEqual(w.coach.tracker.state().skips, [{ date: "2026-11-09", course: "calculus" }]);
  assert.strictEqual(w.coach.tracker.slotOn("calculus", "2026-11-11").n, before - 1);

  const u = await w.ask("sorry, it does take place");
  assert.strictEqual(u.answer, "It is back.");
  assert.ok(w.dates().includes("2026-11-09"));
  assert.deepStrictEqual(w.coach.tracker.state().skips, []);
});

test("class_cancelled: a date with no lecture of that course is refused, nothing is stored, and the model gets the nearby lecture dates", async () => {
  const w = world(['CALL {"tool":"class_cancelled","course":"Calculus 2 Demo","date":"2026-11-10"}\nNoted.', "Calculus has no lecture on Tuesday. Did you mean Monday or Wednesday?"]);
  const r = await w.ask("no calculus on tuesday");
  assert.deepStrictEqual(w.coach.tracker.state().skips, []);
  assert.match(w.prompts[1], /FAILED, nothing was done: Calculus 2 Demo has no lecture on 2026-11-10/);
  assert.match(w.prompts[1], /2026-11-09, 2026-11-11/);
  assert.strictEqual(r.answer, "Calculus has no lecture on Tuesday. Did you mean Monday or Wednesday?", "the early 'Noted.' is not shown");
});

test("class_cancelled: not a date, a date outside the semester and a course outside the timetable are all refused", async () => {
  const w = world([]);
  const tool = w.coach.brainTools.classCancelled;
  assert.throws(() => tool({ courseId: CALC.id, date: "2026-02-30" }), /real date/);
  assert.throws(() => tool({ courseId: CALC.id, date: "2027-03-01" }), /no lecture on 2027-03-01/);
  assert.throws(() => tool({ courseId: OTHER.id, date: "2026-11-09" }), /no lectures in the timetable/);
  assert.throws(() => tool({ courseId: "f".repeat(16), date: "2026-11-09" }), /not in the study tracker/);
  assert.deepStrictEqual(w.coach.tracker.state().skips, []);
});

test("class_cancelled: the same date twice is stored once and said plainly; the Hebrew sentence is Hebrew", async () => {
  const w = world([]);
  const tool = w.coach.brainTools.classCancelled;
  assert.match(tool({ courseId: CALC.id, date: "2026-11-09" }), /^Noted: no Calculus 2 Demo lecture/);
  assert.match(tool({ courseId: CALC.id, date: "2026-11-09" }), /already noted/);
  assert.strictEqual(w.coach.tracker.state().skips.length, 1);
  assert.match(tool({ courseId: CALC.id, date: "2026-11-11", lang: "he" }), /^נרשם: אין הרצאה/);
  assert.match(w.coach.brainTools.undo({ lang: "he" }), /^בוטל\. ההרצאה/);
  assert.deepStrictEqual(w.coach.tracker.state().skips, [{ date: "2026-11-09", course: "calculus" }], "undo takes back only the last one");
});

test("class_cancelled is refused after a web page was read in the same message", async () => {
  const w = world(['CALL {"tool":"read_link","url":"https://example.org/x"}', 'CALL {"tool":"class_cancelled","course":"Calculus 2 Demo","date":"2026-11-09"}', "I read the page; I changed nothing."]);
  await w.ask("what does https://example.org/x say about calculus?");
  assert.deepStrictEqual(w.coach.tracker.state().skips, []);
  assert.match(w.prompts[2], /FAILED, nothing was done/);
});
