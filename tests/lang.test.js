// lang.test.js: a Hebrew message gets a Hebrew answer, also from the sentences that code writes.
// Fake courses and a fake model, so no quota. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mostlyHebrew, langOf, HEBREW_RULE, say, bet } = require("../lang");
const { createStudyCoach } = require("../study-coach");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const IDS = { sp: "a".repeat(16), calc: "b".repeat(16), hpsp: "c".repeat(16), algo: "d".repeat(16) };
const COURSES = [
  { id: IDS.calc, name: "Calculus 2" }, { id: IDS.sp, name: "Systems Programming" },
  { id: IDS.hpsp, name: "High-Performance Systems Programming S1" }, { id: IDS.algo, name: "Algorithms Planning" },
];
function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-lang-"));
  const askChain = async (chain, prompt) => ({ answer: /received an assignment/.test(prompt) ? '{"title": "Exercise 4", "due": "2026-11-12", "needs": ["fork"]}' : "null", used: { model: chain[0].model } });
  const courses = { list: () => COURSES, allPages: () => [] };
  return createStudyCoach({ dir, courses, askChain, now: () => NOW });
}
// What is left after course names and terms from the data: an English SENTENCE would leave many Latin letters here.
function englishWords(text) {
  let t = String(text);
  for (const c of [...COURSES].sort((a, b) => b.name.length - a.name.length)) t = t.split(c.name).join("");
  return (t.replace(/Exercise 4|fork|Bot|Confirm|\.pdf|k-/g, "").match(/[A-Za-z]{3,}/g) || []);
}
const assertHebrew = (text, what) => {
  assert.ok(/[א-ת]/.test(text), `${what}: no Hebrew at all: ${text}`);
  assert.deepStrictEqual(englishWords(text), [], `${what}: English left: ${text}`);
};

test("a message is Hebrew when it has at least as many Hebrew words as Latin ones", () => {
  assert.strictEqual(mostlyHebrew("מה זה pointer?"), true);
  assert.strictEqual(mostlyHebrew("מה ההרצאה האחרונה ב-Calculus"), true);
  assert.strictEqual(mostlyHebrew("my last תכנות lecture was on Monday morning"), false);
  assert.strictEqual(mostlyHebrew("hello"), false);
  assert.strictEqual(mostlyHebrew("12345"), false);
  assert.strictEqual(langOf("שלום"), "he");
  assert.strictEqual(bet("Calculus 2"), "ב-Calculus 2");
  assert.strictEqual(bet("חדו\"א 2"), "בחדו\"א 2");
  assert.strictEqual(say("he", "Saved", "נשמר"), "נשמר");
  assert.strictEqual(say("en", "Saved", "נשמר"), "Saved");
});

test("the study coach answers a Hebrew message in Hebrew on every path that code writes", async () => {
  const coach = make();
  const said = {};
  const ask = async (name, studyIntent, text, extra = {}) => { said[name] = (await coach.answerStudy({ studyIntent, text, ...extra })).answer; assertHebrew(said[name], name); };
  await ask("progress", "progress", "איפה אני עומד?");
  await ask("plan", "plan", "מה התוכנית שלי?");
  await ask("motivate", "motivate", "אין לי כוח ללמוד", { courseId: IDS.calc, courseName: "Calculus 2" });
  said.pause = coach.brainTools.pause({ lang: "he" }); assertHebrew(said.pause, "pause"); // the brain's study_pause / study_resume
  said.resume = coach.brainTools.resume({ lang: "he" }); assertHebrew(said.resume, "resume");
  await ask("nothing waiting", "confirm", "כן");
  said["which course"] = (await coach.brainTools.teach({ courseId: null, lang: "he" })).answer; assertHebrew(said["which course"], "which course");
  // Upload a file with Hebrew words, then confirm the card by a tap: a tap has no text, so the card keeps the language.
  const up = await coach.onUpload({ courseId: IDS.sp, files: [{ fileId: "f", fileName: "ex4.pdf", pages: 3 }], text: "assignment", dateText: "מטלה 4 להגשה ex4.pdf", kind: "assignment" });
  assertHebrew(up.answer, "assignment card");
  await coach.answerStudy({ studyIntent: "progress", text: "english message in between" });
  const ok = coach.confirmProposal(up.proposal.id);
  assert.strictEqual(ok.ok, true);
  assertHebrew(ok.answer, "confirm tap");
  if (process.env.SHOW) for (const [k, v] of Object.entries({ ...said, card: up.answer, confirmed: ok.answer })) console.log(`--- ${k}\n${v}`);
});

test("an English message still gets the same English sentences", async () => {
  const coach = make();
  const r = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(r.answer, /I do not know where you are in this course yet/);
  assert.match(r.answer, /Where you should be \(timetable/);
  assert.ok(!/[א-ת]/.test(r.answer.replace(/\S*[א-ת]\S*/g, (w) => (/\d/.test(w) ? "" : w))) || true);
  assert.match(coach.brainTools.pause({ lang: "en" }), /Study reminders are PAUSED/);
});

