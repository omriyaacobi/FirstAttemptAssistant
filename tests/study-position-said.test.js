// study-position-said.test.js: step 1 of the "where am I" plan. The student's own words are kept, Bot acknowledges them, and the same report +
// question is never sent twice. Made-up sentences and a fake model only. Clock: Saturday 2026-11-07, 12:00 (Systems Programming: 6 held).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const COURSES = [{ id: "b".repeat(16), name: "Calculus 2" }, { id: "a".repeat(16), name: "Systems Programming" }];
function make(courseList = COURSES) {
  const clock = { now: NOW };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-said-")), courses: { list: () => courseList, allPages: () => [] }, askChain: async (chain) => ({ answer: "?", used: { model: chain[0].model } }), now: () => clock.now });
  return { coach, clock, refs: coach.tracker.refsFor(courseList) };
}
const SP = "Systems Programming";

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

test("the stored words are trimmed to 300 characters and lose control characters", async () => {
  const { coach, refs } = make();
  const long = `Systems Programming: I'm at page 40\u0000\u0007\n${"and reading more ".repeat(40)}`;
  coach.brainTools.position({ courseId: refs[1].courseId, fields: { mode: "selfStudy" }, said: long }); // the brain hands in Omri's whole message as said
  const said = coach.tracker.progress(refs[1]).position.said;
  assert.ok(said.length <= 300);
  assert.doesNotMatch(said, /[\u0000-\u001f]/);
});

