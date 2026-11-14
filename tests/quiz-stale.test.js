// quiz-stale.test.js
// 2026-11-14: a one-question check after a lesson (made 6 days earlier) was still open, so Omri's reply to a different question
// went to it and was graded as "not an answer". Now such a check closes by itself after 6 hours; a full quiz stays open.
// The brain's context shows the open question's text, so the model can tell a reply to it from a reply to something else.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { openQuestion, CHECK_TTL_MS } = require("../tutor");

const H = 60 * 60 * 1000;
const q = (state = "open") => ({ id: "q1", q: "A made-up check question?", key: "a made-up key", state });

test("a lesson's one-question check is open for 6 hours, then closes by itself", () => {
  const s = { fromTeach: true, startedAt: 1000, questions: [q()] };
  assert.strictEqual(CHECK_TTL_MS, 6 * H);
  assert.strictEqual(openQuestion(s, 1000 + 5 * H), "A made-up check question?");
  assert.strictEqual(openQuestion(s, 1000 + 6 * H + 1), null);
});

test("a full quiz stays open; nothing open gives null", () => {
  assert.strictEqual(openQuestion({ startedAt: 0, questions: [q()] }, 30 * 24 * H), "A made-up check question?");
  assert.strictEqual(openQuestion({ startedAt: 0, questions: [q("done")] }, 0), null);
  assert.strictEqual(openQuestion(null), null);
});

test("the brain's context names the open question and says when not to call quiz_answer", () => {
  const brain = fs.readFileSync(path.join(__dirname, "..", "brain.js"), "utf8");
  assert.match(brain, /openQuestion\(coach\.tracker\.getSession/);
  assert.match(brain, /Call quiz_answer ONLY if Omri's message answers THIS question/);
  const brief = fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8");
  assert.match(brief, /do not call quiz_answer/);
});
