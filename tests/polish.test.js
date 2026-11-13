// polish.test.js: the night-polish changes. Streaming of tutor text (and that it never shows the answer key), Hebrew dates in study
// messages, "am I keeping up?", and the page's Hebrew words. Fake models and temporary folders only. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const plan = require("../study-plan");
const tutor = require("../tutor");
const { createStudyCoach } = require("../study-coach");
const { keepingUp, studyOverview } = require("../study-page");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const IDS = { calc: "b".repeat(16), sp: "a".repeat(16) };
const COURSES = [{ id: IDS.calc, name: "Calculus 2" }, { id: IDS.sp, name: "Systems Programming" }];
const NOTEBOOK = Array.from({ length: 16 }, (_, i) => ({ fileId: "nb", fileName: "calc.pdf", page: i + 1, text: i % 2 === 0 ? `Lecture ${i / 2 + 1}\nintegrals` : "more integrals" }));

test("Hebrew dates: Wednesday 28 Oct becomes Hebrew, and the English date is unchanged (also through .map)", () => {
  assert.strictEqual(plan.niceDate("2026-10-28", "he"), "יום רביעי 28 באוקטובר");
  assert.strictEqual(plan.niceDate("2026-10-31", "he"), "שבת 31 באוקטובר");
  assert.strictEqual(plan.niceDate("2026-10-28"), "Wednesday 28 Oct");
  assert.deepStrictEqual(["2026-10-28"].map(plan.niceDate), ["Wednesday 28 Oct"]); // map passes an index as the second argument
});

test("a study answer to a Hebrew message has Hebrew dates; an English one has English dates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-polish-"));
  const coach = createStudyCoach({ dir, courses: { list: () => COURSES, allPages: () => NOTEBOOK }, askChain: async (c) => ({ answer: "x", used: { model: c[0].model } }), now: () => NOW });
  const he = await coach.answerStudy({ studyIntent: "progress", text: "איפה אני בחדוא?" });
  assert.match(he.answer, /יום (ראשון|שני|שלישי|רביעי|חמישי|שישי) \d+ ב/);
  assert.doesNotMatch(he.answer, /\((Sun|Mon|Tues|Wednes|Thurs|Fri)day \d+ [A-Z][a-z]{2}\)/);
  const en = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(en.answer, /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) \d+ [A-Z][a-z]{2}/);
});

test("the teaching text streams while it is written, and the check question with its KEY is never shown", () => {
  const v = tutor.visibleTeaching;
  assert.strictEqual(v("Step one.\nStep two."), "Step one.\nStep two.");
  assert.strictEqual(v("Step one.\nQUESTION: What is x? || KEY: the secret"), "Step one.");
  assert.strictEqual(v("Step one.\nQUES"), "Step one."); // the start of the marker is held back
  assert.strictEqual(v("Step one.\nQ"), "Step one.");
  assert.strictEqual(v("Step one.\nQuiet moment"), "Step one.\nQuiet moment"); // a line that only starts like it stays
  assert.strictEqual(v("Step\nquestion: lower || KEY: k"), "Step");
  assert.doesNotMatch(v("a\nQUESTION: q || KEY: hidden answer"), /hidden|KEY/);
});

test("teach streams through the coach (onText), the page-visible text never holds the key; a quiz shows nothing half-written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-polish-"));
  const seen = [];
  const askChain = async (chain, prompt, opts = {}) => {
    let answer = "?";
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else if (/Teach the topic/.test(prompt)) {
      answer = "Lesson part one.\nLesson part two.\nQUESTION: What is it? || KEY: SECRETKEY";
      if (opts.onText) for (let i = 10; i <= answer.length; i += 10) opts.onText(answer.slice(0, i));
    }
    return { answer, used: { model: chain[0].model } };
  };
  const coach = createStudyCoach({ dir, courses: { list: () => COURSES, allPages: (id) => (id === IDS.calc ? NOTEBOOK : []) }, askChain, now: () => NOW });
  const r = await coach.brainTools.teach({ courseId: IDS.calc, part: "", onText: (t) => seen.push(t) });
  assert.ok(seen.length >= 3, "text arrived in pieces");
  assert.ok(seen.every((t) => !/SECRETKEY|KEY:|QUESTION/.test(t)), "never the key or the marker");
  assert.ok(seen.some((t) => /Lesson part one/.test(t)));
  assert.match(r.answer, /Lesson part one/);
  const quizSeen = [];
  await coach.answerStudy({ studyIntent: "quiz", text: "quiz me on Calculus 2", courseId: IDS.calc, courseName: "Calculus 2", onText: (t) => quizSeen.push(t) });
  assert.deepStrictEqual(quizSeen, [], "JSON steps never stream");
});

test("am I keeping up: unknown, topic only, on track, behind by N, ahead", () => {
  // Calculus: Sundays and Wednesdays are fake slots here; only date and number matter
  const slots = [["2026-10-18", 1], ["2026-10-21", 2], ["2026-10-25", 3], ["2026-10-28", 4], ["2026-11-01", 5], ["2026-11-04", 6], ["2026-11-08", 7]].map(([date, n]) => ({ date, n, key: "calc", start: "10:00", end: "12:00" }));
  const base = { slots, today: "2026-11-07", now: NOW };
  assert.deepStrictEqual(keepingUp({ ...base, positionKnown: false }), { state: "unknown", n: 0 });
  assert.deepStrictEqual(keepingUp({ ...base, positionKnown: true, seenThrough: null }), { state: "topic", n: 0 });
  assert.deepStrictEqual(keepingUp({ ...base, positionKnown: true, seenThrough: "2026-11-04" }), { state: "on_track", n: 0 });
  const behind = keepingUp({ ...base, positionKnown: true, seenThrough: "2026-10-25" });
  assert.strictEqual(behind.state, "behind");
  assert.ok(behind.n >= 2, "lectures held after that place count");
  assert.deepStrictEqual(keepingUp({ ...base, positionKnown: true, seenThrough: "2026-11-08" }), { state: "ahead", n: 1 });
});

test("GET /api/study data carries keepingUp for a tracked course", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-polish-"));
  const coach = createStudyCoach({ dir, courses: { list: () => COURSES, allPages: () => [] }, askChain: async () => ({ answer: "x", used: { model: "m" } }), now: () => NOW });
  const out = studyOverview({ coach, courseList: COURSES, now: NOW });
  const tracked = out.courses.filter((c) => c.tracked);
  assert.ok(tracked.length > 0);
  for (const c of tracked) assert.strictEqual(c.keepingUp.state, "unknown"); // nothing told yet: Bot does not guess
});

// ---- the page's own helpers ----
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const pure = (html.match(/\/\/ <thread-pure>([\s\S]*?)\/\/ <\/thread-pure>/) || [])[1] || "";
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(pure + "\nthis.out = { tLangOf, tKeeping, tStudyLines, TS };", sandbox);
const P = sandbox.out;

test("page language: Hebrew when you write Hebrew, else the browser's language, else English", () => {
  assert.strictEqual(P.tLangOf(["hello", "מה נשמע", "שלום"], "en-US"), "he");
  assert.strictEqual(P.tLangOf(["hello", "מה נשמע", "how are you", "fine"], "he-IL"), "en"); // one Hebrew in four: still English
  assert.strictEqual(P.tLangOf([], "he-IL"), "he");
  assert.strictEqual(P.tLangOf([], "en-GB"), "en");
});

test("the mic language follows the draft text, and the language picker stays hidden", () => {
  const micPure = (html.match(/\/\/ <mic-pure>([\s\S]*?)\/\/ <\/mic-pure>/) || [])[1] || "";
  const box = {};
  vm.createContext(box);
  vm.runInContext(micPure + "\nthis.micLangFor = micLangFor;", box);
  assert.strictEqual(box.micLangFor("שלום מה נשמע", "en-US"), "he-IL");
  assert.strictEqual(box.micLangFor("hello there", "he-IL"), "en-US");
  assert.strictEqual(box.micLangFor("", "he-IL"), "he-IL"); // empty box: keep the last language
  assert.ok(/id="micLang"[^>]*\bhidden\b/.test(html));
  assert.ok(!html.includes('$("micLang").hidden = false'));
});

test("the keeping-up pill says it in words, in English and in Hebrew", () => {
  assert.strictEqual(P.tKeeping({ state: "behind", n: 2 }, "en").text, "Behind by 2 lectures");
  assert.strictEqual(P.tKeeping({ state: "behind", n: 1 }, "en").text, "Behind by 1 lecture");
  assert.strictEqual(P.tKeeping({ state: "ahead", n: 1 }, "en").text, "Ahead by 1 lecture");
  assert.strictEqual(P.tKeeping({ state: "on_track", n: 0 }, "en").text, "On track");
  assert.strictEqual(P.tKeeping({ state: "unknown", n: 0 }, "en").text, "Not told Bot yet");
  assert.strictEqual(P.tKeeping(null, "en").state, "unknown");
  assert.strictEqual(P.tKeeping({ state: "nonsense" }, "en").state, "unknown");
  assert.strictEqual(P.tKeeping({ state: "behind", n: 3 }, "he").text, "בפיגור של 3 הרצאות");
  assert.strictEqual(P.tKeeping({ state: "on_track" }, "he").text, "בקצב");
  assert.match(P.tKeeping({ state: "unknown" }, "he").text, /Bot/);
});

test("Study lines in Hebrew use Hebrew words and dates, English stays as before", () => {
  const c = { shouldBe: { held: 6, lastLecture: { n: 6, date: "2026-11-04" }, nextLecture: null }, you: { positionKnown: true, position: { seenThrough: "2026-10-28", note: "" }, understood: 1 }, behind: [], assignments: [{ title: "HW3", due: "2026-11-20" }], topicsDue: 2, keepingUp: { state: "behind", n: 3 } };
  const he = P.tStudyLines(c, "he");
  assert.match(he.should, /6 הרצאות התקיימו/);
  assert.match(he.at, /^עד /);
  assert.match(he.due[0], /להגשה/);
  assert.strictEqual(he.due[1], "2 נושאים לחזרה");
  assert.strictEqual(he.keeping.state, "behind");
  const en = P.tStudyLines(c, "en");
  assert.match(en.should, /^6 lectures held so far/);
  assert.strictEqual(en.due[1], "2 topics to review");
});

test("the first-open notice is short, in both languages, and invites you to say where you are", () => {
  for (const lang of ["en", "he"]) {
    const n = P.TS[lang].notice;
    assert.ok(n.length <= 4);
    assert.ok(n.join(" ").length < 520, `${lang} notice is short`);
    assert.match(n[n.length - 1], lang === "he" ? /איפה אתה/ : /where you are/);
  }
  assert.match(P.TS.en.tellText("Calculus 2"), /^My last Calculus 2 lecture was $/);
  assert.match(P.TS.he.tellText("חדוא 2"), /חדוא 2/);
});

test("the Study page has the tell-Bot button and the keeping-up pill, with textContent only", () => {
  assert.match(html, /const tell = el\("button", "", S\.tell\)/);
  assert.match(html, /el\("div", "tkeep tkeep-"/);
  assert.match(html, /box\.setSelectionRange/);
  assert.match(html, /\.tkeep-behind \{/);
  assert.match(html, /\[dir="rtl"\] \.tdue/);
  assert.doesNotMatch(html.slice(html.indexOf('<script id="threadScript">')), /\.innerHTML\s*=/);
});
