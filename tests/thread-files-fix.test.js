// thread-files-fix.test.js
// QA fixes for files sent in the thread (2026-11-07): the course named in words, one question per file, "due next Sunday".
// Fake models, temporary folders, made-up text only. Clock: Saturday 2026-11-07, 12:00 (Israel).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");
const { createThreadStore } = require("../thread-store");
const { createThreadFiles, pickCourse } = require("../thread-files");
const { dueFromWords } = require("../due-date");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-thfix-"));
const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const IDS = { prog: "a".repeat(16), alg: "b".repeat(16), sys: "c".repeat(16), hp: "d".repeat(16) };
const COURSES = [{ id: IDS.prog, name: "Intro Programming Demo" }, { id: IDS.alg, name: "Linear Algebra Demo" }];
const SYS = [...COURSES, { id: IDS.sys, name: "Systems Programming" }, { id: IDS.hp, name: "High-Performance Systems Programming S1" }];

function makeCoach(list = COURSES, prompts = []) {
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    return { answer: '{"title": "Homework 1", "due": null, "needs": ["loops", "arrays"]}', used: { model: "fake" } };
  };
  return createStudyCoach({ dir: tmp(), courses: { list: () => list, allPages: () => [] }, askChain, now: () => NOW });
}
function fakeRoutes(list = COURSES, fileText = "Some made-up slides") {
  const added = [];
  const infos = new Map();
  return {
    added,
    list: () => list,
    addUpload: (courseId, bytes, name) => {
      const id = String(added.length + 1).padStart(16, "0");
      added.push({ courseId, name, id });
      infos.set(`${courseId}/${id}`, { fileId: id, fileName: name, pages: 3, status: "ready", text: fileText });
      return { id, name };
    },
    fileInfo: (courseId, fileId) => infos.get(`${courseId}/${fileId}`) || null,
  };
}
const pdf = (n) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(String(n).repeat(50))]);

test("a) the course named with its own words in the message is chosen (code checks the real list)", () => {
  const coach = makeCoach();
  const pick = (text) => pickCourse({ fileName: "slides.pdf", text, coach, courseList: COURSES, now: NOW });
  assert.strictEqual(pick("slides for the programming course").ref.name, "Intro Programming Demo");
  assert.strictEqual(pick("this is the homework for linear algebra").ref.name, "Linear Algebra Demo");
  assert.strictEqual(pick("this is the homework for Algebra").ref.name, "Linear Algebra Demo");
  assert.strictEqual(pick("here are some slides"), null, "no clue: ask");
  assert.strictEqual(pick("slides for the biology course"), null, "a course that is not in the list is never invented");
  assert.strictEqual(pick("the intro to programming and linear algebra slides"), null, "two courses named: ask");
  assert.strictEqual(pick("what a nice demo"), null, "a word every course shares is not a clue");
});

test("a) ambiguity: two courses share the word, so Bot asks; the more specific match wins", () => {
  const coach = makeCoach(SYS);
  const pick = (text) => pickCourse({ fileName: "x.pdf", text, coach, courseList: SYS, now: NOW });
  assert.strictEqual(pick("for the programming course"), null, "3 courses have 'programming'");
  assert.strictEqual(pick("for high performance systems programming").ref.name, "High-Performance Systems Programming S1");
});

test("b) three files in a row: every 'which date' question names its file", async () => {
  const TT = [{ id: IDS.prog, name: "Calculus 2" }, COURSES[1]]; // a course WITH a timetable (a course without one gets no date question, see the next test)
  const coach = makeCoach(TT);
  const routes = fakeRoutes(TT, "Week 2 slides");
  const thread = createThreadStore(tmp());
  const files = createThreadFiles({ thread, courseRoutes: routes, coach, now: () => NOW });
  const calc = coach.tracker.refsFor(TT)[0];
  for (const s of coach.tracker.slots(calc.key).filter((x) => x.date <= "2026-11-07")) coach.tracker.attachMaterial(calc, s.date, [{ fileId: "old", from: 1, to: 1 }]); // every held lecture already has material: Bot cannot suggest a slot
  const names = ["notes-a.pdf", "notes-b.pdf", "notes-c.pdf"];
  const rs = names.map((n, i) => files.receive({ bytes: pdf(i), name: n, text: "for Calculus 2" }));
  for (const r of rs) await files.onFileReady({ courseId: r.courseId, fileId: r.fileId });
  const asks = [...thread.all()].filter((m) => m.role === "assistant" && /Which date was it/.test(m.text));
  assert.strictEqual(asks.length, 3);
  names.forEach((n, i) => assert.ok(asks[i].text.includes(n), `question ${i} names ${n}: ${asks[i].text}`));
});

test("b2) a file for a course with NO timetable gets no date question: it says it is filed and how to start", async () => {
  const coach = makeCoach();
  const routes = fakeRoutes(COURSES, "Week 2 slides");
  const thread = createThreadStore(tmp());
  const files = createThreadFiles({ thread, courseRoutes: routes, coach, now: () => NOW });
  const r = files.receive({ bytes: pdf(0), name: "notes-a.pdf", text: "for the programming course" });
  await files.onFileReady({ courseId: r.courseId, fileId: r.fileId });
  const replies = [...thread.all()].filter((m) => m.role === "assistant").map((m) => m.text).join(" ");
  assert.doesNotMatch(replies, /Which date was it/);
  assert.match(replies, /no timetable/);
  assert.match(replies, /teach me/);
});

test("c) 'due next Sunday' becomes a real date computed by code (Sat 2026-11-07 -> Sun 2026-11-08)", () => {
  assert.strictEqual(dueFromWords("Homework 1. Due next Sunday.", NOW), "2026-11-08");
  assert.strictEqual(dueFromWords("due on Thursday", NOW), "2026-11-12");
  assert.strictEqual(dueFromWords("it is due Saturday", NOW), "2026-11-14", "today is Saturday: the next one, never today");
  assert.strictEqual(dueFromWords("due tomorrow", NOW), "2026-11-08");
  assert.strictEqual(dueFromWords("due in 2 weeks", NOW), "2026-11-21");
  assert.strictEqual(dueFromWords("להגשה ביום רביעי", NOW), "2026-11-11");
  assert.strictEqual(dueFromWords("Sunday is a nice day", NOW), null);
  assert.strictEqual(dueFromWords("no date here", NOW), null);
});

test("c) the file's 'due next Sunday' reaches the coach as a computed date (the model is told, never left to guess)", async () => {
  const prompts = [];
  const coach = makeCoach(COURSES, prompts);
  const routes = fakeRoutes(COURSES, "Homework 1\nExercises on loops. Due next Sunday.");
  const thread = createThreadStore(tmp());
  const files = createThreadFiles({ thread, courseRoutes: routes, coach, now: () => NOW });
  const r = files.receive({ bytes: pdf(7), name: "hw1.pdf", text: "homework for the programming course" });
  assert.strictEqual(r.status, "filed");
  await files.onFileReady({ courseId: r.courseId, fileId: r.fileId });
  assert.match(prompts[0], /2026-11-08/);
});

test("d) L5: no Google client reads as plain words, not as jargon", () => {
  const { friendlyError } = require("../calendar-chat");
  const text = friendlyError(new Error("No Google client found: put the file in the data folder"));
  assert.match(text, /not connected/i);
  assert.doesNotMatch(text, /client file/i);
  assert.match(text, /calendar-setup\.md/);
});

test("d) L9: a text file named like a PDF is refused (the name must match what is inside)", () => {
  const coach = makeCoach();
  const thread = createThreadStore(tmp());
  const files = createThreadFiles({ thread, courseRoutes: fakeRoutes(), coach, now: () => NOW });
  assert.throws(() => files.receive({ bytes: Buffer.from("just some made-up words"), name: "check.pdf", text: "" }), (e) => e.status === 415 && /pdf/i.test(e.message));
  assert.throws(() => files.receive({ bytes: Buffer.from("just some made-up words"), name: "slides.pptx", text: "" }), (e) => e.status === 415);
  assert.strictEqual([...thread.all()].length, 0, "nothing is written to the thread");
  assert.strictEqual(files.receive({ bytes: Buffer.from("made-up notes about loops"), name: "loops notes.txt", text: "for the programming course" }).status, "filed");
});

// QA round 2: the real model ignored the worked-out date in the prompt and answered "due: null". Code now fills it in.
test("e) a due date worked out by code is kept even when the model says null", async () => {
  const coach = makeCoach();
  const routes = fakeRoutes(COURSES, "Homework 1\nExercises on loops. Due next Sunday.");
  const thread = createThreadStore(tmp());
  const files = createThreadFiles({ thread, courseRoutes: routes, coach, now: () => NOW });
  const r = files.receive({ bytes: pdf(7), name: "hw1.pdf", text: "homework for the programming course" });
  await files.onFileReady({ courseId: r.courseId, fileId: r.fileId });
  const card = [...thread.all()].map((m) => m.result && m.result.proposal).filter(Boolean)[0];
  assert.ok(card, "a proposal card was made");
  assert.strictEqual(card.due, "2026-11-08");
});
