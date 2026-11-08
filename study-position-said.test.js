// study-position-said.test.js: step 1 of the "where am I" plan. The student's own words are kept, Bot acknowledges them, and the same report +
// question is never sent twice. Made-up sentences and a fake model only. Clock: Saturday 2026-11-07, 12:00 (Systems Programming: 6 held).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("./study-coach");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const COURSES = [{ id: "b".repeat(16), name: "Calculus 2" }, { id: "a".repeat(16), name: "Systems Programming" }];
function make(courseList = COURSES) {
  const clock = { now: NOW };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-said-")), courses: { list: () => courseList, allPages: () => [] }, askChain: async (chain) => ({ answer: "?", used: { model: chain[0].model } }), now: () => clock.now });
  return { coach, clock, refs: coach.tracker.refsFor(courseList) };
}
const SP = "Systems Programming";

test("a free description of the state (intent update) is kept word for word and acknowledged, no report, no question", async () => {
  const { coach, refs } = make();
  const text = `${SP}: I'm at page 40, only reading the notes`;
  const r = await coach.answerStudy({ studyIntent: "update", text });
  assert.match(r.answer, /Systems Programming: I kept your words: "Systems Programming: I'm at page 40, only reading the notes"/);
  assert.doesNotMatch(r.answer, /lectures held|where are you in|Where you should be/);
  const p = coach.tracker.progress(refs[1]);
  assert.strictEqual(p.positionKnown, true);
  assert.strictEqual(p.position.said, text);
  assert.strictEqual(p.understood, 0); // words never set "understood"
});

test("Bot asked 'where are you', the front desk labels the answer progress: code still takes the update path and stores the words", async () => {
  const { coach, refs } = make([COURSES[1]]);
  const ask = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(ask.answer, /where are you in Systems Programming/);
  assert.match(ask.answer, /in your own words/);
  const r = await coach.answerStudy({ studyIntent: "progress", text: "I'm 3 weeks behind, mostly reading the notes alone." });
  assert.match(r.answer, /I kept your words: "I'm 3 weeks behind, mostly reading the notes alone."/);
  assert.doesNotMatch(r.answer, /lectures held|where are you in/);
  assert.strictEqual(coach.tracker.progress(refs[0]).position.said, "I'm 3 weeks behind, mostly reading the notes alone.");
  // The next "progress" does not repeat the old question: the position is known now.
  const again = await coach.answerStudy({ studyIntent: "progress", text: "how am I doing?" });
  assert.doesNotMatch(again.answer, /So that I do not guess/);
  assert.match(again.answer, /You told me: "I'm 3 weeks behind/);
});

test("a statement that includes a question mark still answers Bot's question; a clearly different question does not", async () => {
  const { coach, refs } = make([COURSES[1]]);
  await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  const other = await coach.answerStudy({ studyIntent: "progress", text: "which homework is due soon?" });
  assert.doesNotMatch(other.answer, /I kept your words/);
  assert.strictEqual(coach.tracker.progress(refs[0]).positionKnown, false);
  const mixed = await coach.answerStudy({ studyIntent: "progress", text: "I'm at page 12 of the notes. Is that okay?" });
  assert.match(mixed.answer, /I kept your words: "I'm at page 12 of the notes. Is that okay\?"/);
});

test("'where am I' always gets the report back; the same question is not asked twice within 7 days otherwise", async () => {
  const { coach, clock } = make();
  const a = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(a.answer, /So that I do not guess/);
  const b = await coach.answerStudy({ studyIntent: "progress", text: "Calculus 2" }); // opening the course, not asking where
  assert.doesNotMatch(b.answer, /So that I do not guess/);
  const c = await coach.answerStudy({ studyIntent: "progress", text: "where am I?" });
  assert.match(c.answer, /So that I do not guess/);
  clock.now += 8 * 24 * 3600 * 1000;
  const d = await coach.answerStudy({ studyIntent: "progress", text: "Calculus 2" });
  assert.match(d.answer, /So that I do not guess/);
});

test("'lecture 7' when the timetable holds 6: the words are kept and Bot says what it could not place", async () => {
  const { coach, refs } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "Systems Programming: I'm at lecture 7 right now" });
  assert.match(r.answer, /I kept your words: "Systems Programming: I'm at lecture 7 right now"/);
  assert.match(r.answer, /timetable shows 6 held so far, so I could not place lecture 7/);
  assert.doesNotMatch(r.answer, /stored nothing/);
  const p = coach.tracker.progress(refs[1]);
  assert.strictEqual(p.positionKnown, true);
  assert.strictEqual(p.position.seenThrough, null); // nothing placed that code could not check
});

test("a Hebrew message gets a Hebrew acknowledgement with no English-only sentence", async () => {
  const { coach } = make();
  const r = await coach.answerStudy({ studyIntent: "update", text: "Systems Programming: אני בעמוד 40, רק קורא את הסיכומים" });
  assert.match(r.answer, /שמרתי את מה שכתבת/);
  const rest = r.answer.replace(/Systems Programming/g, "").replace(/"[^"]*"/g, "");
  assert.doesNotMatch(rest, /[A-Za-z]{3,}/);
  const lost = await coach.answerStudy({ studyIntent: "update", text: "אני בלי שום התקדמות, עוד לא התחלתי" });
  assert.match(lost.answer, /איזה קורס/); // two courses, none named: asks which, in Hebrew
  assert.doesNotMatch(lost.answer.replace(/Calculus 2|Systems Programming/g, "").replace(/"[^"]*"/g, ""), /[A-Za-z]{3,}/);
});

test("the stored words are trimmed to 300 characters and lose control characters", async () => {
  const { coach, refs } = make();
  const long = `Systems Programming: I'm at page 40\u0000\u0007\n${"and reading more ".repeat(40)}`;
  await coach.answerStudy({ studyIntent: "update", text: long });
  const said = coach.tracker.progress(refs[1]).position.said;
  assert.ok(said.length <= 300);
  assert.doesNotMatch(said, /[\u0000-\u001f]/);
});

test("claims and due dates are not kept as a position; a course Bot does not know is not guessed", async () => {
  const { coach, refs } = make();
  await coach.answerStudy({ studyIntent: "update", text: "I understand everything already" });
  await coach.answerStudy({ studyIntent: "update", text: "my homework is due next Sunday" });
  assert.strictEqual(coach.tracker.progress(refs[1]).positionKnown, false);
  const nowhere = await coach.answerStudy({ studyIntent: "update", text: "I'm at page 40, only reading the notes" }); // two courses, none named
  assert.match(nowhere.answer, /Which one\?/);
  assert.strictEqual(coach.tracker.progress(refs[0]).positionKnown, false);
  assert.strictEqual(coach.tracker.progress(refs[1]).positionKnown, false);
});

test("both briefings send a description of one's own state to update, and keep progress for questions", () => {
  for (const f of ["router-brief.md", "router-brief-haiku.md"]) {
    const t = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.match(t, /DESCRIBES their own state/, f);
    assert.match(t, /"I've done nothing yet"/, f);
    assert.match(t, /progress \(a QUESTION about their status/, f);
    assert.match(t, /<!--thread-->/, f);
  }
});
