// position-record.test.js: step 2 of the "where am I" plan, position v2 in the tracker. Made-up data only. Clock: Saturday 2026-11-07, 12:00.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTracker } = require("../study-tracker");
const { normalizePosition, normalizePending } = require("../position-record");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const ref = { key: "sp", courseId: "a".repeat(16), name: "Systems Programming" };
const fresh = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-posrec-")); return { dir, tracker: createTracker({ dir, now: () => NOW }) }; };
const write = (dir, data) => fs.writeFileSync(path.join(dir, "sp.json"), JSON.stringify(data));

test("an old-shaped record loads and reports exactly as before (no v2 field appears)", () => {
  const { dir, tracker } = fresh();
  write(dir, { key: "sp", courseId: ref.courseId, name: "Systems Programming", position: { known: true, seenThrough: "2026-11-02", note: "lecture 5", at: 1700000000000 }, askedPosition: 0, askedSlots: {}, lectures: {}, assignments: [], topics: {}, session: null });
  const p = tracker.progress(ref);
  assert.deepStrictEqual(p.position, { known: true, seenThrough: "2026-11-02", note: "lecture 5", at: 1700000000000 });
  assert.strictEqual(p.positionKnown, true);
  assert.strictEqual(tracker.pendingQuestion(ref), null);
  const unknown = fresh();
  assert.deepStrictEqual(unknown.tracker.progress(ref).position, { known: false, seenThrough: null, note: "", at: 0 });
});

test("an old record that was asked but not answered becomes a pending question; an answered one does not", () => {
  const a = fresh();
  write(a.dir, { key: "sp", position: { known: false, seenThrough: null, note: "", at: 0 }, askedPosition: NOW - 1000 });
  assert.deepStrictEqual(a.tracker.pendingQuestion(ref), { kind: "position", at: NOW - 1000 });
  const b = fresh();
  write(b.dir, { key: "sp", position: { known: true, seenThrough: null, note: "topic", at: 5 }, askedPosition: NOW - 1000 });
  assert.strictEqual(b.tracker.pendingQuestion(ref), null);
  assert.strictEqual(normalizePending({ pendingQuestion: { kind: "bogus", at: 1 } }, { known: false }), null);
});

test("markAsked records a pending question; any answer clears it", () => {
  const { tracker } = fresh();
  tracker.markAsked(ref, { position: true });
  assert.deepStrictEqual(tracker.pendingQuestion(ref), { kind: "position", at: NOW });
  tracker.setPosition(ref, { said: "I'm at page 40" });
  assert.strictEqual(tracker.pendingQuestion(ref), null);
  assert.strictEqual(tracker.progress(ref).positionKnown, true);
});

test("a v2 record saves and reloads field for field", () => {
  const { dir, tracker } = fresh();
  const saved = tracker.setStanding(ref, { said: "Mostly reading the notes alone, 3 weeks behind", mode: "selfStudy", where: { type: "pages", from: 1, to: 38 }, pace: "behind", behindBy: { unit: "weeks", amount: 3 }, gaps: [{ kind: "lecture", n: 4 }], depth: "shaky", goal: "concepts", focus: "memory management" });
  assert.strictEqual(saved.v, 2);
  const again = createTracker({ dir, now: () => NOW }).progress(ref);
  assert.deepStrictEqual(again.position, saved);
  assert.strictEqual(again.position.depth, "shaky");
  assert.strictEqual(again.understood, 0); // the student's own opinion is never "understood"
  assert.strictEqual(again.positionKnown, true);
});

test("invalid v2 fields are dropped, never repaired; unconfirmed exam dates are not kept", () => {
  const n = normalizePosition({ known: true, mode: "genius", pace: "fast", depth: "understood", goal: "win", where: { type: "pages", from: 9, to: 2 }, behindBy: { unit: "weeks", amount: 99 }, gaps: [{ kind: "lecture", n: -1 }, "x", { kind: "section", name: "Memory" }], examDate: "2026-12-01", said: "ok\u0000\u0001 fine".padEnd(500, "x") });
  assert.strictEqual(n.mode, undefined);
  assert.strictEqual(n.pace, undefined);
  assert.strictEqual(n.depth, undefined);
  assert.strictEqual(n.goal, undefined);
  assert.strictEqual(n.where, undefined);
  assert.strictEqual(n.behindBy, undefined);
  assert.deepStrictEqual(n.gaps, [{ kind: "section", name: "Memory" }]);
  assert.strictEqual(n.examDate, undefined); // not confirmed
  assert.ok(n.said.length <= 300 && !/[\u0000-\u001f]/.test(n.said));
  assert.strictEqual(normalizePosition({ examDate: "2026-12-01", confirmed: true }).examDate, "2026-12-01");
  assert.strictEqual(normalizePosition({ where: { type: "fraction", value: 1.5 } }).where, undefined);
  assert.deepStrictEqual(normalizePosition({ where: { type: "fraction", value: 0.5 } }).where, { type: "fraction", value: 0.5 });
  assert.strictEqual(normalizePosition("junk").known, false);
});

test("setStanding: a lecture must be a held one, a second reading replaces the first, an empty one is refused", () => {
  const { tracker } = fresh();
  assert.throws(() => tracker.setStanding(ref, { where: { type: "lecture", n: 7 } }), /no held lecture/);
  assert.throws(() => tracker.setStanding(ref, { mode: "genius" }), /nothing to keep/);
  assert.strictEqual(tracker.progress(ref).positionKnown, false); // nothing was written by the failures
  const p = tracker.setStanding(ref, { where: { type: "lecture", n: 3 }, mode: "attending" });
  assert.strictEqual(p.seenThrough, "2026-10-25");
  const q = tracker.setStanding(ref, { said: "only revising now", mode: "revising", where: { type: "none" } });
  assert.strictEqual(q.seenThrough, null);
  assert.strictEqual(q.mode, "revising");
  assert.strictEqual(q.where.type, "none");
  assert.strictEqual(tracker.progress(ref).understood, 0);
});

test("the old setPosition keeps the v2 fields of the record but drops an older sentence", () => {
  const { tracker } = fresh();
  tracker.setStanding(ref, { said: "old words", mode: "attending" });
  const p = tracker.setPosition(ref, { n: 4 });
  assert.strictEqual(p.mode, "attending");
  assert.strictEqual(p.said, undefined);
  assert.strictEqual(p.note, "");
});
