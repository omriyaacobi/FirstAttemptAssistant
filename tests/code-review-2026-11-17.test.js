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
