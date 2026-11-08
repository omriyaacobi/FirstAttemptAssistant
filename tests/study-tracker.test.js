// study-tracker.test.js
// The timetable maths and the tracker. Temporary folders only; the clock is fixed: Saturday 2026-11-07, 12:00 in Jerusalem.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const plan = require("../study-plan");
const { createTracker } = require("../study-tracker");

const at = (iso, hhmm = "12:00") => new Date(`${iso}T${hhmm}:00+02:00`).getTime();
const make = (nowMs = at("2026-11-07")) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-study-"));
  const clock = { now: nowMs };
  const t = createTracker({ dir, now: () => clock.now });
  return { dir, clock, t, sp: { key: "sp", courseId: "a".repeat(16), name: "Systems Programming" }, calc: { key: "calculus", courseId: "b".repeat(16), name: "Calculus 2" } };
};

test("lecture slots passed since 18 Oct come from the timetable", () => {
  const tt = plan.cleanTimetable(plan.DEFAULT_TIMETABLE);
  const now = at("2026-11-07");
  assert.strictEqual(plan.heldSlots(tt, "sp", [], now).length, 6); // Sun 18, 25 Oct, 1 Nov + Thu 22, 29 Oct, 5 Nov
  assert.strictEqual(plan.heldSlots(tt, "calculus", [], now).length, 6); // Mon x3 + the Wednesday 08:00 lecture x3
  assert.strictEqual(plan.heldSlots(tt, "algo", [], now).length, 6);
  assert.strictEqual(plan.heldSlots(tt, "hpsp", [], now).length, 3); // Thursday only; its Sunday class is an exercise
});

test("a lecture counts as held only after it ends", () => {
  const tt = plan.cleanTimetable(plan.DEFAULT_TIMETABLE);
  assert.strictEqual(plan.heldSlots(tt, "sp", [], at("2026-11-05", "15:59")).length, 5); // Thursday's lecture ends at 16:00
  assert.strictEqual(plan.heldSlots(tt, "sp", [], at("2026-11-05", "16:00")).length, 6);
});

test("a skipped date disappears and the numbers move up", () => {
  const tt = plan.cleanTimetable(plan.DEFAULT_TIMETABLE);
  const before = plan.slotsOf(tt, "sp", []);
  const after = plan.slotsOf(tt, "sp", [{ date: "2026-10-22", course: "sp" }]);
  assert.strictEqual(after.length, before.length - 1);
  assert.strictEqual(after[1].date, "2026-10-25");
  assert.deepStrictEqual(after.slice(0, 3).map((s) => s.n), [1, 2, 3]);
  assert.strictEqual(plan.slotsOf(tt, "sp", [{ date: "2026-10-22", course: "algo" }]).length, before.length); // another course's skip does not count
  assert.strictEqual(plan.slotsOf(tt, "sp", [{ date: "2026-10-22", course: "*" }]).length, before.length - 1);
});

test("quiet hours cross midnight, and a class in progress is detected", () => {
  assert.ok(plan.inQuietHours(at("2026-11-07", "23:30")));
  assert.ok(plan.inQuietHours(at("2026-11-07", "07:59")));
  assert.ok(!plan.inQuietHours(at("2026-11-07", "08:00")));
  assert.ok(!plan.inQuietHours(at("2026-11-07", "21:59")));
  assert.ok(plan.inQuietHours(at("2026-11-07", "13:00"), { from: "12:00", to: "14:00" }));
  const tt = plan.cleanTimetable(plan.DEFAULT_TIMETABLE);
  assert.ok(plan.inClass(tt, at("2026-11-08", "13:00"))); // Sunday: Systems Programming
  assert.ok(!plan.inClass(tt, at("2026-11-08", "14:30")));
});

test("a broken timetable file is ignored and the default is used", () => {
  const { dir, t } = make();
  fs.writeFileSync(path.join(dir, "timetable.json"), "not json");
  assert.ok(t.timetable().slots.length > 5);
  assert.ok(plan.cleanTimetable({ courses: [{ key: "../x", match: "a" }], slots: [] }) === null);
});

test("skipWeek removes this week's lectures of one course only, and survives a restart", () => {
  const { dir, t, clock } = make(at("2026-11-04", "09:00")); // Wednesday
  const dates = t.skipWeek("sp");
  assert.deepStrictEqual(dates, ["2026-11-01", "2026-11-05"]); // Sunday 1 and Thursday 5 (the week starts on Sunday)
  assert.strictEqual(t.slots("sp").some((s) => dates.includes(s.date)), false);
  assert.strictEqual(t.slots("algo").some((s) => s.date === "2026-11-01"), true);
  const again = createTracker({ dir, now: () => clock.now });
  assert.strictEqual(again.state().skips.length, 2);
  assert.throws(() => t.addSkip({ date: "2026-02-30" }), /real date/);
  assert.throws(() => t.addSkip({ date: "2026-11-02", course: "nope" }), /unknown/);
});

test("progress: should-have numbers, material, understood and behind come from code", () => {
  const { t, sp } = make();
  let p = t.progress(sp);
  assert.deepStrictEqual([p.held, p.withMaterial, p.understood, p.positionKnown], [6, 0, 0, false]);
  assert.strictEqual(p.behind.length, 5); // the lecture of Thursday 5 Nov is only 2 days old: fresh, not behind
  t.attachMaterial(sp, "2026-10-18", [{ fileId: "f1", from: 1, to: 9 }]);
  p = t.progress(sp);
  assert.strictEqual(p.withMaterial, 1);
  assert.throws(() => t.attachMaterial(sp, "2026-10-19", [{ fileId: "f1", from: 1, to: 2 }]), /lecture days/); // a Monday is not an SP day
});

test("position is only a real held lecture: by date or number, never invented; a note alone is allowed", () => {
  const { t, sp } = make();
  assert.strictEqual(t.setPosition(sp, { date: "2026-10-29" }).seenThrough, "2026-10-29");
  assert.strictEqual(t.setPosition(sp, { date: "2026-10-30" }).seenThrough, "2026-10-29"); // Friday: the last lecture before it
  assert.strictEqual(t.setPosition(sp, { n: 2 }).seenThrough, "2026-10-22");
  assert.throws(() => t.setPosition(sp, { n: 99 }), /no held lecture/);
  assert.throws(() => t.setPosition(sp, { date: "2026-10-10" }), /no held lecture/);
  assert.throws(() => t.setPosition(sp, {}), /say a date/);
  assert.strictEqual(t.setPosition(sp, { note: "pointers" }).known, true);
});

test("material with no date: the suggestion is the most recent held slot without material", () => {
  const { t, sp } = make();
  assert.strictEqual(t.suggestSlot(sp).date, "2026-11-05");
  t.attachMaterial(sp, "2026-11-05", [{ fileId: "f", from: 1, to: 2 }]);
  assert.strictEqual(t.suggestSlot(sp).date, "2026-11-01");
});

test("a notebook of lectures is lined up with the slots, marked assumed, and never overwrites", () => {
  const { t, calc } = make();
  t.attachMaterial(calc, "2026-10-26", [{ fileId: "mine", from: 50, to: 55 }]);
  const placed = t.alignNotebook(calc, [1, 2, 3, 4].map((n) => ({ lecture: n, fileId: "nb", from: n * 10, to: n * 10 + 9 })));
  assert.strictEqual(placed, 3); // lecture 3 is the 26 Oct slot, which already had material
  const c = t.course(calc);
  assert.strictEqual(c.lectures["2026-10-19"].assumed, true);
  assert.strictEqual(c.lectures["2026-10-21"].material[0].from, 20);
  assert.strictEqual(c.lectures["2026-10-26"].material[0].fileId, "mine");
});

test("asking about empty slots: only held slots, never twice, never at a bad time", () => {
  const { t, sp, clock } = make(at("2026-11-07", "12:00"));
  assert.strictEqual(t.slotsToAskAbout(sp).length, 6);
  t.markAsked(sp, { dates: ["2026-10-18"] });
  assert.strictEqual(t.slotsToAskAbout(sp).length, 5);
  assert.ok(t.goodTimeToAsk());
  clock.now = at("2026-11-07", "23:00");
  assert.ok(!t.goodTimeToAsk());
  clock.now = at("2026-11-08", "13:00"); // Sunday, during the Systems Programming lecture
  assert.ok(!t.goodTimeToAsk());
});

test("understood needs 3 graded questions and 70%: asking about a topic or 2 right answers is not enough", () => {
  const { t, sp } = make();
  const target = { type: "lecture", date: "2026-10-18" };
  let r = t.recordCheck(sp, target, [{ topic: "pointers", verdict: "right" }, { topic: "arrays", verdict: "right" }]);
  assert.strictEqual(r.understood, false);
  assert.strictEqual(t.progress(sp).understood, 0);
  r = t.recordCheck(sp, target, [{ topic: "a", verdict: "right" }, { topic: "b", verdict: "partly" }, { topic: "c", verdict: "wrong" }]);
  assert.strictEqual(r.understood, false); // 1.5 / 3 = 50%
  r = t.recordCheck(sp, target, [{ topic: "a", verdict: "right" }, { topic: "b", verdict: "right" }, { topic: "c", verdict: "partly" }]);
  assert.strictEqual(r.understood, true); // 2.5 / 3 = 83%
  assert.strictEqual(t.progress(sp).understood, 1);
  r = t.recordCheck(sp, target, [{ topic: "x", verdict: "bogus" }, { topic: "y", verdict: "wrong" }, { topic: "z", verdict: "wrong" }]);
  assert.strictEqual(r.total, 2); // a verdict that is not one of the three is dropped
  assert.strictEqual(t.progress(sp).understood, 1); // understood is never taken back by a bad day, and never set by anything else
});

test("boxes: right moves up and schedules 2 days, wrong goes back to box 1 with a note", () => {
  const { t, sp } = make();
  const target = { type: "lecture", date: "2026-10-18" };
  t.recordCheck(sp, target, [{ topic: "Pointers", verdict: "right" }]);
  let topic = Object.values(t.course(sp).topics)[0];
  assert.deepStrictEqual([topic.box, topic.nextDue], [2, "2026-11-09"]);
  t.recordCheck(sp, target, [{ topic: "Pointers", verdict: "wrong", note: "mixed up * and &" }]);
  topic = Object.values(t.course(sp).topics)[0];
  assert.deepStrictEqual([topic.box, topic.nextDue, topic.notes.length], [1, "2026-11-08", 1]);
  assert.strictEqual(t.progress(sp).topicsDue, 0);
});

test("assignments: saved with a checked due date, sorted by due date, status changes are validated", () => {
  const { t, sp } = make();
  const a = t.addAssignment(sp, { title: "Exercise 2", due: "2026-11-12", needs: ["fork", "pipes"], text: "do things" });
  t.addAssignment(sp, { title: "Exercise 1", due: "2026-11-10", needs: [] });
  assert.deepStrictEqual(t.progress(sp).assignments.map((x) => x.title), ["Exercise 1", "Exercise 2"]);
  t.setAssignment(sp, a.id, { status: "done" });
  assert.strictEqual(t.progress(sp).assignments.length, 1);
  assert.throws(() => t.setAssignment(sp, a.id, { status: "great" }), /bad status/);
  assert.throws(() => t.setAssignment(sp, "zzz", { status: "done" }), /no such/);
});

test("course keys are checked, so a key can never become a path", () => {
  const { t } = make();
  assert.throws(() => t.course({ key: "../../x" }), /bad course key/);
  const refs = t.refsFor([{ id: "c".repeat(16), name: "High-Performance Systems Programming S1" }, { id: "d".repeat(16), name: "Systems Programming" }, { id: "e".repeat(16), name: "Poetry" }]);
  assert.deepStrictEqual(refs.map((r) => r.key), ["hpsp", "sp", "c-eeeeeeeeeeee"]);
});
