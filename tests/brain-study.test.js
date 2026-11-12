// tests/brain-study.test.js
// The brain's study tools (brain.js -> study-coach.js brainTools) with a REAL coach on made-up notes and FAKE models.
// What is checked: the model only hands in values, code checks them; a date or a field that does not fit is refused or dropped;
// the plan and the teaching turn are shown as code made them; nothing here sets "understood".

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { createBrain } = require("../brain");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime(); // Saturday
const filler = (word, n) => Array.from({ length: n }, (_, i) => `Made-up ${word} sentence ${i} about the topic at hand.`).join("\n");
const DOC = [{ fileId: "d1", fileName: "all-notes.txt", page: 1, text: ["# Intro", filler("intro", 20), "# Stack and heap", filler("stackword", 40), "# Pointers", filler("pointerword", 40)].join("\n") }];
const DB = { id: "b".repeat(16), name: "Databases Demo" };
const CO = { id: "c".repeat(16), name: "Compilers Demo" };

function world(replies) {
  const coachPrompts = [];
  const askChain = async (chain, prompt) => {
    coachPrompts.push(prompt);
    return { answer: /Teach in 3 short steps|Teach this ONE idea/.test(prompt) ? "Step 1 [S1]. Step 2. Step 3.\nQUESTION: What is the main idea? || KEY: The main idea is X." : "?", used: { model: chain[0].model } };
  };
  const courses = { list: () => [DB, CO], allPages: (id) => (id === DB.id ? DOC : []) };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-brainstudy-")), courses, askChain, now: () => NOW });
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [DB, CO], courseFiles: (id) => ({ files: id === DB.id ? [{ id: "d1", name: "all-notes.txt", status: "ready", pages: 1 }] : [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "t", text: "page text" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const ask = (task, opts = {}) => brain.handle(task, { history: [], courses: [DB, CO], ...opts });
  const ref = (c) => coach.tracker.refsFor([DB, CO]).find((r) => r.courseId === c.id);
  return { brain, coach, prompts, coachPrompts, ask, ref };
}

test("study_pause: the reminders stop until the date the model handed in, and resume turns them on", async () => {
  const w = world(['CALL {"tool":"study_pause","until":"2026-11-20"}\nPaused until 20 November. Good luck in the reserves.', 'CALL {"tool":"study_resume"}\nThey are on again.']);
  const r = await w.ask("I have miluim until the 20th, stop nagging me about studying");
  assert.strictEqual(r.answer, "Paused until 20 November. Good luck in the reserves.");
  assert.strictEqual(w.coach.nudges.settings().paused, true);
  assert.strictEqual(w.coach.nudges.settings().pausedUntil, "2026-11-20");
  await w.ask("I am back");
  assert.strictEqual(w.coach.nudges.settings().paused, false);
});

test("study_pause with a date in the past is refused by code and the model's early 'done' is not shown", async () => {
  const w = world(['CALL {"tool":"study_pause","until":"2026-10-01"}\nPaused.', "I could not pause: the date is in the past."]);
  const r = await w.ask("pause the study reminders until October 1");
  assert.notStrictEqual(w.coach.nudges.settings().paused, true);
  assert.match(w.prompts[1], /FAILED, nothing was done: until must be a real date/);
  assert.strictEqual(r.answer, "I could not pause: the date is in the past.");
});

test("exam_date: a real future date becomes a card that is stored only on Confirm; a bad date is refused", async () => {
  const w = world(['CALL {"tool":"exam_date","course":"Databases Demo","date":"2026-12-22"}\nA card is waiting for your tap.', 'CALL {"tool":"exam_date","course":"Databases Demo","date":"2026-02-30"}\nCard is up.', "That date does not exist."]);
  const r = await w.ask("the databases exam is on 22 December");
  assert.ok(r.proposal && r.proposal.id, "the page gets the card");
  assert.ok(!(w.coach.tracker.course(w.ref(DB)).position || {}).examDate, "nothing stored before Confirm");
  w.coach.confirmProposal(r.proposal.id);
  assert.strictEqual(w.coach.tracker.course(w.ref(DB)).position.examDate, "2026-12-22");
  const bad = await w.ask("actually the exam is on 30 February");
  assert.ok(!bad.proposal);
  assert.match(w.prompts[2], /FAILED, nothing was done: the exam date must be a real date/);
});

test("study_position: closed fields are kept, a heading that is not in the notes is dropped with a reason, and undo restores", async () => {
  const w = world([
    'CALL {"tool":"study_position","course":"Databases Demo","mode":"selfStudy","pace":"behind","goal":"concepts","where":{"type":"section","name":"Stack and heap"}}',
    "Stored: studying alone, behind, up to Stack and heap.",
    'CALL {"tool":"study_position","course":"Databases Demo","mode":"flying","where":{"type":"section","name":"Quantum gravity"},"depth":"shaky"}',
    "Kept shaky; the rest did not fit.",
    'CALL {"tool":"study_undo"}\nUndone.',
  ]);
  await w.ask("in databases I study alone from the notes, I'm behind, got to stack and heap, I want the concepts");
  let pos = w.coach.tracker.course(w.ref(DB)).position;
  assert.strictEqual(pos.mode, "selfStudy");
  assert.strictEqual(pos.pace, "behind");
  assert.strictEqual(pos.goal, "concepts");
  assert.deepStrictEqual(pos.where, { type: "section", name: "Stack and heap" });
  assert.match(pos.said, /study alone from the notes/, "Omri's own words are kept");
  assert.match(w.prompts[1], /STORED for Databases Demo/);

  await w.ask("it sits badly with me");
  pos = w.coach.tracker.course(w.ref(DB)).position;
  assert.strictEqual(pos.depth, "shaky");
  assert.strictEqual(pos.mode, "selfStudy", "a value outside the closed list changes nothing");
  assert.deepStrictEqual(pos.where, { type: "section", name: "Stack and heap" }, "a heading that is not in the notes is not stored");
  assert.match(w.prompts[3], /Quantum gravity/);
  assert.strictEqual(w.coach.tracker.progress(w.ref(DB)).understood, 0, "never 'understood'");

  const u = await w.ask("no that's wrong, undo");
  assert.strictEqual(u.answer, "Undone.");
  assert.notStrictEqual(w.coach.tracker.course(w.ref(DB)).position.depth, "shaky");
});

test("study_position is refused after a web page was read in the same message", async () => {
  const w = world(['CALL {"tool":"read_link","url":"https://example.org/x"}', 'CALL {"tool":"study_position","course":"Databases Demo","mode":"paused"}', "I read the page; I did not change your record."]);
  await w.ask("read https://example.org/x");
  assert.notStrictEqual((w.coach.tracker.course(w.ref(DB)).position || {}).mode, "paused");
  assert.match(w.prompts[2], /FAILED, nothing was done: Bot does not store where Omri stands/);
});

test("teach_next: code picks the next part of the notes, the coach's turn is the answer, and a named part is matched to the outline", async () => {
  const w = world(['CALL {"tool":"teach_next","course":"Databases Demo","part":""}', 'CALL {"tool":"teach_next","course":"Databases Demo","part":"pointers"}', 'CALL {"tool":"teach_next","course":"Databases Demo","part":"quantum gravity"}']);
  const a = await w.ask("teach me the next part of databases");
  assert.strictEqual(a.mode, "study");
  assert.match(a.answer, /Step 1/);
  assert.match(a.answer, /What is the main idea\?/);
  assert.doesNotMatch(a.answer, /KEY/, "the key is never shown");
  const teach = () => w.coachPrompts.filter((p) => /Teach in 3 short steps|Teach this ONE idea/.test(p));
  assert.match(teach()[0], /all-notes\.txt - Intro/);
  await w.ask("now pointers");
  assert.match(teach()[1], /Pointers/);
  assert.doesNotMatch(teach()[1], /stackword/, "only that part of the notes is sent");
  const c = await w.ask("teach me quantum gravity from the notes");
  assert.match(c.answer, /could not find that in the notes/);
  assert.strictEqual(w.coach.tracker.progress(w.ref(DB)).understood, 0);
});

test("study_plan: one plan across the courses, written by code, with the minutes the model handed in", async () => {
  const w = world(['CALL {"tool":"study_plan","minutes":45,"today_only":true}']);
  const r = await w.ask("I only have 45 minutes, what should I do today?");
  assert.strictEqual(r.mode, "study");
  assert.match(r.answer, /about 45 minutes a day/);
  assert.match(r.answer, /Start with:/);
  assert.strictEqual(w.prompts.length, 1, "no second model call: the plan is shown as code wrote it");
});
