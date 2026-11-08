// catchup-coach.test.js: teaching from notes that are not split by lecture, the catch-up plan, and teaching through an assignment.
// Made-up notes, made-up courses and a FAKE model only. Clock: Saturday 2026-11-07, 12:00 (Israel).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("./study-coach");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const filler = (word, n) => Array.from({ length: n }, (_, i) => `Made-up ${word} sentence ${i} about the topic at hand.`).join("\n");
const DOC = [{ fileId: "d1", fileName: "all-notes.txt", page: 1, text: ["# Intro", filler("intro", 20), "# Stack and heap", filler("stackword", 40), "# Pointers", filler("pointerword", 40), "# Paging", filler("pagingword", 40)].join("\n") }];
const HE_DOC = [{ fileId: "h1", fileName: "notes-he.txt", page: 1, text: ["# מבוא", filler("alpha", 20), "# ניהול זיכרון דינמי", filler("betaword", 40), "# קבצים", filler("gamma", 40)].join("\n") }];
const DB = { id: "b".repeat(16), name: "Databases Demo" }; // no timetable, one big notes document
const HE = { id: "e".repeat(16), name: "Hebrew Notes Demo" };
const CO = { id: "c".repeat(16), name: "Compilers Demo" }; // no timetable, no files

function make({ courseList = [DB, CO], docs = { [DB.id]: DOC }, choose = [] } = {}) {
  const prompts = [];
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    let answer = "?";
    if (/Pick the 1 to 3 sections/.test(prompt)) answer = JSON.stringify({ ids: choose });
    else if (/Teach in 3 short steps|Teach this ONE idea/.test(prompt)) answer = "Step 1 [S1]. Step 2. Step 3.\nQUESTION: What is the main idea? || KEY: The main idea is X.";
    else if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question ${i}?`, key: `Key number ${i} answer`, topic: `topic ${i}` })) });
    else if (/Grade ONE/.test(prompt)) answer = JSON.stringify({ verdict: "right", feedback: "Good.", note: "", relevant: true });
    else if (/working on an assignment/.test(prompt)) answer = "Nice start. What is your first step?";
    return { answer, used: { model: chain[0].model } };
  };
  const courses = { list: () => courseList, allPages: (id) => docs[id] || [] };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-catchup-")), courses, askChain, now: () => NOW });
  const refs = coach.tracker.refsFor(courseList);
  const ref = (c) => refs.find((r) => r.courseId === c.id);
  return { coach, prompts, ref, askChain };
}
const say = (coach, text, studyIntent, extra = {}) => coach.answerStudy({ studyIntent, text, ...extra });
const teachPrompts = (prompts) => prompts.filter((p) => /Teach in 3 short steps|Teach this ONE idea/.test(p));

test("teach the next part of a big notes file: one chunk, cited, one check question, nothing understood", async () => {
  const { coach, prompts, ref } = make();
  const r = await say(coach, "teach me the next part of Databases Demo", "teach");
  assert.match(r.answer, /Step 1/);
  assert.match(r.answer, /One question back: What is the main idea\?/);
  assert.doesNotMatch(r.answer, /KEY|X\./, "the key is never shown");
  const p = teachPrompts(prompts)[0];
  assert.match(p, /about 130 words/);
  assert.match(p, /all-notes\.txt - Intro/, "the first part, cited by its section");
  assert.doesNotMatch(p, /stackword/, "only that part of the notes is sent");
  assert.strictEqual(coach.tracker.progress(ref(DB)).understood, 0);
  assert.ok(r.answer.length < 1700, "one phone screen");
});

test("'next part' moves on; a named section is found by code, no model needed", async () => {
  const { coach, prompts } = make();
  await say(coach, "teach me the next part", "teach", { courseName: DB.name });
  await say(coach, "the main idea is X because it is", "answer"); // answers the check question
  await say(coach, "teach me the next part of Databases Demo", "teach");
  assert.match(teachPrompts(prompts)[1], /Stack and heap/);
  const before = prompts.length;
  await say(coach, "explain pointers to me, Databases Demo", "teach");
  assert.match(teachPrompts(prompts).pop(), /pointerword/);
  assert.ok(!prompts.slice(before).some((p) => /Pick the 1 to 3 sections/.test(p)), "title words matched: no model call");
});

test("a topic that is not in the notes is not invented: the real parts are listed and no teaching call is made", async () => {
  const { coach, prompts } = make();
  const r = await say(coach, "teach me quantum chromodynamics in Databases Demo", "teach");
  assert.match(r.answer, /could not find that in the notes of Databases Demo/);
  assert.match(r.answer, /Stack and heap; Pointers; Paging/);
  assert.strictEqual(teachPrompts(prompts).length, 0);
});

test("English words, Hebrew headings: one model call picks ids, and an invented id is dropped", async () => {
  const { coach, prompts } = make({ courseList: [HE], docs: { [HE.id]: HE_DOC }, choose: ["s999"] });
  const none = await say(coach, "teach me about dynamic allocation", "teach");
  assert.match(none.answer, /could not find that/);
  assert.strictEqual(teachPrompts(prompts).length, 0);
  const real = make({ courseList: [HE], docs: { [HE.id]: HE_DOC } });
  const s = (await real.coach.tracker.progress(real.ref(HE)));
  const id = require("./catchup").unitsOf(require("./outline").buildOutline(HE_DOC)).find((u) => /דינמי/.test(u.title)).id;
  const ok = make({ courseList: [HE], docs: { [HE.id]: HE_DOC }, choose: [id, "s999"] });
  await say(ok.coach, "teach me about dynamic allocation", "teach");
  assert.match(teachPrompts(ok.prompts)[0], /betaword/);
});

test("quiz me on what I covered: questions come only from the parts that were taught", async () => {
  const { coach, prompts } = make();
  await say(coach, "teach me about pointers in Databases Demo", "teach");
  await say(coach, "it is the main idea X", "answer");
  const r = await say(coach, "quiz me on what I covered in Databases Demo", "quiz");
  assert.match(r.answer, /Quiz on Pointers/);
  const q = prompts.filter((p) => /Write exactly/.test(p)).pop();
  assert.match(q, /pointerword/);
  assert.doesNotMatch(q, /pagingword|stackword/);
});

test("no course named: the only course that fits is used (section words), several that fit are asked", async () => {
  const two = make({ courseList: [DB, HE], docs: { [DB.id]: DOC, [HE.id]: HE_DOC } });
  const r = await say(two.coach, "teach me about paging", "teach"); // no course in the words or from the front desk
  assert.match(r.answer, /Step 1/);
  assert.match(teachPrompts(two.prompts)[0], /pagingword/);
  const fresh = make({ courseList: [DB, HE], docs: { [DB.id]: DOC, [HE.id]: HE_DOC } });
  const amb = await say(fresh.coach, "teach me the next part", "teach");
  assert.match(amb.answer, /Which course/);
  const solo = make({ courseList: [DB] });
  const s = await say(solo.coach, "teach me the next part", "teach");
  assert.match(s.answer, /Step 1/);
});

test("catch-up plan: first step with minutes, real dates only, a deadline goes first, ONE exam question once a week", async () => {
  const { coach, ref } = make();
  coach.tracker.addAssignment(ref(CO), { title: "Lexer project", due: "2026-11-09", needs: ["tokens", "regular expressions"], text: "made-up text" });
  const r = await say(coach, "I'm behind in everything, what should I do today?", "update");
  assert.match(r.answer, /about 90 minutes a day/);
  assert.match(r.answer, /Start with: Compilers Demo: assignment "Lexer project" \(60 min\)/, "the deadline in two days first");
  assert.match(r.answer, /teach me through the assignment/);
  assert.match(r.answer, /Databases Demo: "Intro"/);
  assert.match(r.answer, /when are the exams \(Databases Demo, Compilers Demo\)/);
  assert.ok(r.answer.split("\n").length <= 14, "one screen");
  assert.doesNotMatch(r.answer.split("One thing")[0], /2026-1[0-2]-\d\d|Dec/, "no invented date");
  const again = await say(coach, "what should I do today", "plan");
  assert.doesNotMatch(again.answer, /when are the exams/, "asked once");
});

test("the time budget comes from the student's words, a paused course is left out", async () => {
  const { coach, ref } = make();
  coach.tracker.setStanding(ref(CO), { mode: "paused" });
  const r = await say(coach, "what should I do this week? I have 3 hours a day", "plan");
  assert.match(r.answer, /about 180 minutes a day/);
  assert.doesNotMatch(r.answer, /Compilers Demo:/);
});

test("teach through the assignment: the idea is taught from the notes WITHOUT the assignment text, then hints, never a solution", async () => {
  const { coach, prompts, ref } = make();
  coach.tracker.addAssignment(ref(DB), { title: "Allocator exercise", due: "2026-11-20", needs: ["pointers", "stack and heap"], text: "SECRET-ASSIGNMENT-TEXT build an allocator" });
  const r = await say(coach, "teach me through the assignment", "start", { courseName: DB.name });
  assert.match(r.answer, /needs 2 ideas: pointers; stack and heap/);
  assert.match(r.answer, /First: pointers/);
  const t = teachPrompts(prompts)[0];
  assert.match(t, /pointerword/);
  assert.doesNotMatch(t, /SECRET-ASSIGNMENT-TEXT|allocator/i, "the assignment is not in the teaching prompt");
  const a = await say(coach, "the main idea is X", "answer");
  assert.match(a.answer, /hints, not the solution/);
  const h = await say(coach, "I think I start by allocating", "answer");
  assert.match(h.answer, /Nice start/);
  const n = await say(coach, "teach me the next idea of the assignment", "start", { courseName: DB.name });
  assert.match(n.answer, /Idea 2 of 2: stack and heap/);
  assert.match(teachPrompts(prompts)[1], /stackword/);
});

test("Hebrew: the sentences written by code use no gendered 'you'", async () => {
  const { coach } = make();
  const r = await say(coach, "תלמד אותי את החלק הבא ב-Databases Demo", "teach");
  assert.match(r.answer, /שאלה אחת לבדיקה/);
  const plan = await say(coach, "אני מאחור בהכל, מה לעשות היום?", "update");
  assert.match(plan.answer, /תוכנית ריאלית/);
  assert.doesNotMatch(plan.answer, /\b(?:אתה|את|תכתוב|ענה|תראה|בקש|כתוב)\b/);
  const tutor = fs.readFileSync(path.join(__dirname, "tutor.js"), "utf8");
  const he = tutor.slice(tutor.indexOf("  he: {"), tutor.indexOf("const tx ="));
  assert.doesNotMatch(he, /(?<![א-ת])(?:אתה|ענה|תראה|בקש|כתוב|תכתוב)(?![א-ת])/, "no masculine commands in the tutor's Hebrew sentences");
});

const SP = { id: "a".repeat(16), name: "Systems Programming" }; // has the default timetable

test("'I skipped two weeks and came back' keeps the words and asks ONE useful question, once", async () => {
  const { coach } = make({ courseList: [SP, DB] });
  const r = await say(coach, "דילגתי על שבועיים באמצע ב-Systems Programming ואז חזרתי", "update");
  assert.match(r.answer, /שמרתי את מה שכתבת/);
  assert.strictEqual((r.answer.match(/שאלה אחת כדי להתחיל/g) || []).length, 1);
  assert.match(r.answer, /מה ההרצאה האחרונה/);
  const again = await say(coach, "I skipped two weeks of Systems Programming and came back", "update");
  assert.doesNotMatch(again.answer, /One question so that I start/, "not asked again within a week");
});

test("a written exam date becomes a Confirm card (not saved before), computed by code", async () => {
  const { coach, ref } = make({ courseList: [SP, DB] });
  const r = await say(coach, "I'm revising Systems Programming, the exam is on 22 December", "update");
  assert.ok(r.proposal && r.proposal.kind === "exam", JSON.stringify(r.proposal));
  assert.strictEqual(r.proposal.date, "2026-12-22");
  assert.ok(!coach.tracker.progress(ref(SP)).position.examDate, "not saved before the tap");
  coach.confirmProposal(r.proposal.id);
  assert.strictEqual(coach.tracker.progress(ref(SP)).position.examDate, "2026-12-22");
});

test("a single check question after a lesson can be skipped, and a request for the full solution gets a plain no with guidance", async () => {
  const { coach, prompts, ref } = make();
  coach.tracker.addAssignment(ref(DB), { title: "Allocator exercise", due: "2026-11-20", needs: ["pointers"], text: "made-up" });
  const t = await say(coach, "teach me through the assignment", "start", { courseName: DB.name });
  assert.match(t.answer, /One question back/);
  const skip = await say(coach, "skip", "answer");
  assert.match(skip.answer, /Skipped\. Nothing was recorded/);
  assert.strictEqual(coach.tracker.getSession(ref(DB)).mode, "work", "an assignment lesson goes on to guided hints");
  assert.strictEqual(coach.tracker.progress(ref(DB)).understood, 0);
  const s = await say(coach, "give me the full solution code for the assignment", "start", { courseName: DB.name });
  assert.match(s.answer, /^I will not write the full solution of an assignment/);
  assert.doesNotMatch(prompts.filter((p) => /Teach this ONE idea|working on an assignment/.test(p)).join("\n"), /made-up|SECRET/, "no assignment text in teaching prompts");
});

test("teachesFromNotes: true for one big notes file, false without notes and for a timetable course with lecture material", async () => {
  const { coach, ref } = make({ courseList: [DB, CO] });
  assert.strictEqual(coach.teachesFromNotes(DB.id), true);
  assert.strictEqual(coach.teachesFromNotes(CO.id), false, "no notes");
  assert.strictEqual(coach.teachesFromNotes("0".repeat(16)), false, "unknown course");
});

test("a sentence with only an exam date (no 'I') still reaches the exam card", async () => {
  const { coach } = make({ courseList: [SP, DB] });
  const r = await say(coach, "the exam in Systems Programming is on 22 December", "update");
  assert.ok(r.proposal && r.proposal.kind === "exam" && r.proposal.date === "2026-12-22", r.answer);
});

test("notes made of 'Lecture N' headings in a course with a timetable use the lecture road, not free chunks", async () => {
  const LEC = [{ fileId: "l1", fileName: "lectures.txt", page: 1, text: ["Lecture 1: Intro", filler("one", 30), "Lecture 2: Graphs", filler("two", 30)].join("\n") }];
  const { coach } = make({ courseList: [SP], docs: { [SP.id]: LEC } });
  assert.strictEqual(coach.teachesFromNotes(SP.id), false);
});
