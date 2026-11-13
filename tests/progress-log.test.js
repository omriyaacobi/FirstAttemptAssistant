// progress-log.test.js
// The progress log: code writes one line per real study event, "understood" only from a passed graded quiz, old days are removed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProgressLog } = require("../progress-log");
const { createTracker } = require("../study-tracker");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-progress-"));
const NOON = Date.UTC(2026, 10, 10, 10, 0, 0); // 2026-11-10 12:00 in Jerusalem
const REF = { key: "calculus", courseId: "c1", name: "Calculus 2" };

function setup() {
  const dir = tmp();
  const clock = { now: NOON };
  const progress = createProgressLog({ dir: path.join(dir, "progress"), now: () => clock.now });
  const tracker = createTracker({ dir, now: () => clock.now, progressLog: progress });
  return { dir, clock, progress, tracker };
}

test("a graded quiz is logged with its score; only a passed one says Understood", () => {
  const s = setup();
  s.tracker.recordCheck(REF, { type: "lecture", date: "2026-11-09" }, [{ topic: "a", verdict: "right" }, { topic: "b", verdict: "right" }, { topic: "c", verdict: "partly" }]);
  s.tracker.recordCheck(REF, { type: "lecture", date: "2026-11-05" }, [{ topic: "a", verdict: "right" }, { topic: "b", verdict: "wrong" }]);
  s.tracker.recordCheck(REF, { type: "lecture", date: "2026-11-02" }, [{ topic: "a", verdict: "wrong" }, { topic: "b", verdict: "wrong" }, { topic: "c", verdict: "right" }]);
  const lines = s.progress.day("2026-11-10");
  assert.strictEqual(lines.length, 3);
  assert.match(lines[0].text, /3 questions, 83%, passed: now Understood/);
  assert.strictEqual(lines[0].understood, true);
  assert.strictEqual(lines[0].course, "Calculus 2");
  assert.match(lines[1].text, /too few questions to count/);
  assert.strictEqual(lines[1].understood, false);
  assert.match(lines[2].text, /33%, not passed yet/);
  assert.strictEqual(lines[2].understood, false);
});

test("lessons, notes in Omri's words, assignments and exam dates are logged; an unchanged status is not", () => {
  const s = setup();
  s.tracker.markTaught(REF, "2026-11-09");
  s.tracker.addNote(REF, "finished the exercise on series");
  const a = s.tracker.addAssignment(REF, { title: "Exercise 4", due: "2026-11-15" });
  s.tracker.setAssignment(REF, a.id, { status: "done" });
  s.tracker.setAssignment(REF, a.id, { status: "done" }); // no change, no line
  s.tracker.setExamDate(REF, "2027-02-01");
  const kinds = s.progress.day("2026-11-10").map((l) => l.kind);
  assert.deepStrictEqual(kinds, ["lesson", "note", "assignment", "assignment", "exam"]);
  const texts = s.progress.day("2026-11-10").map((l) => l.text).join("\n");
  assert.match(texts, /Omri said: "finished the exercise on series"/);
  assert.match(texts, /"Exercise 4" marked done/);
  assert.strictEqual(s.tracker.course(REF).brainNotes.length, 1);
});

test("a day is read back safely: broken lines are skipped, a model can never mark a lesson understood", () => {
  const s = setup();
  s.progress.add({ kind: "lesson", course: "X", text: "a lesson", understood: true });
  fs.appendFileSync(path.join(s.dir, "progress", "2026-11-10.jsonl"), "{broken\n" + JSON.stringify({ kind: "evil", text: "x" }) + "\n");
  const lines = s.progress.day("2026-11-10");
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].understood, false); // only a quiz line can carry understood
  assert.deepStrictEqual(s.progress.day("../etc"), []);
  assert.throws(() => s.progress.add({ kind: "made-up", text: "x" }), /unknown/);
});

test("days older than the keep window are removed", () => {
  const s = setup();
  s.progress.add({ kind: "note", text: "old one" });
  s.clock.now = NOON + 40 * 24 * 3600 * 1000;
  s.progress.add({ kind: "note", text: "new one" });
  assert.deepStrictEqual(s.progress.day("2026-11-10"), []);
  assert.strictEqual(fs.readdirSync(path.join(s.dir, "progress")).length, 1);
});
