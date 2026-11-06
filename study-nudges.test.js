// study-nudges.test.js: one nudge a day, tied to a date, quiet after two ignored, pause, quiet hours, counts only on the lock screen.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTracker } = require("./study-tracker");
const { createNudges } = require("./study-nudges");
const { createMorning } = require("./morning");
const { createStore } = require("./store");
const { createReminders } = require("./reminders");

const at = (iso, hhmm = "08:30") => new Date(`${iso}T${hhmm}:00+02:00`).getTime();
const COURSES = [{ id: "a".repeat(16), name: "Systems Programming" }, { id: "b".repeat(16), name: "Calculus 2" }];

function setup(nowMs = at("2026-11-08")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-nudge-"));
  const clock = { now: nowMs };
  const tracker = createTracker({ dir, now: () => clock.now });
  const nudges = createNudges({ tracker, courseList: () => COURSES, now: () => clock.now });
  const sp = tracker.refsFor(COURSES)[0];
  return { dir, clock, tracker, nudges, sp };
}

test("nothing to say means no block (and no nudge is recorded)", () => {
  const s = setup(at("2026-10-18", "09:00")); // before the first lecture: nothing held, nothing due
  assert.strictEqual(s.nudges.morningBlock(), null);
  assert.strictEqual(s.tracker.state().nudges.length, 0);
});

test("an assignment due soon wins, names its due date, and only one nudge is made a day", () => {
  const s = setup();
  s.tracker.addAssignment(s.sp, { title: "Exercise 3", due: "2026-11-10", needs: [] });
  const b = s.nudges.morningBlock();
  assert.match(b.text, /Exercise 3.*due Tuesday 10 Nov, in 2 days/);
  assert.strictEqual(b.count, 1);
  assert.strictEqual(s.nudges.morningBlock(), null); // second call the same day: nothing
});

test("a lecture nudge needs material or a topic, is 3+ days old, and names its date", () => {
  const s = setup();
  assert.strictEqual(s.nudges.candidates().some((c) => c.kind === "lecture"), false); // nothing known about any lecture
  s.tracker.attachMaterial(s.sp, "2026-10-25", [{ fileId: "f", from: 1, to: 2 }]);
  const c = s.nudges.candidates().find((x) => x.kind === "lecture");
  assert.strictEqual(c.date, "2026-10-25");
  assert.match(c.text, /Sunday 25 Oct/);
});

test("a held lecture with nothing known is asked about ONCE, in a good moment only", () => {
  const s = setup();
  const first = s.nudges.morningBlock();
  assert.strictEqual(first.kind, "material");
  s.clock.now = at("2026-11-09");
  const second = s.nudges.morningBlock();
  assert.ok(!second || !(second.text.includes(first.text.split("was there a lecture on ")[1].slice(0, 12)))); // not the same slot again
  const s2 = setup(at("2026-11-08", "13:00")); // Sunday 13:00: Systems Programming is in class
  assert.strictEqual(s2.nudges.candidates().some((c) => c.kind === "material"), false);
});

test("quiet hours and pause stop everything; a pause ends by itself on its date; resume clears the ignored count", () => {
  const s = setup(at("2026-11-08", "23:00"));
  s.tracker.addAssignment(s.sp, { title: "Ex", due: "2026-11-09", needs: [] });
  assert.strictEqual(s.nudges.morningBlock(), null); // 23:00 is quiet
  s.clock.now = at("2026-11-08", "08:30");
  s.nudges.pause("2026-11-10");
  assert.strictEqual(s.nudges.morningBlock(), null);
  s.clock.now = at("2026-11-11");
  assert.strictEqual(s.nudges.isPaused(), false);
  assert.throws(() => s.nudges.pause("2026-01-01"), /past/);
  assert.throws(() => s.nudges.setQuiet({ from: "25:00", to: "08:00" }), /look like/);
  assert.deepStrictEqual(s.nudges.setQuiet({ from: "23:00", to: "07:00" }).quiet, { from: "23:00", to: "07:00" });
});

test("two ignored in a row make Bot quiet; studying brings it back", () => {
  const s = setup(at("2026-11-08"));
  s.tracker.attachMaterial(s.sp, "2026-10-18", [{ fileId: "f", from: 1, to: 2 }]);
  assert.ok(s.nudges.morningBlock()); // day 1
  s.clock.now = at("2026-11-09");
  assert.ok(s.nudges.morningBlock()); // day 2: day 1 is 24 h old and ignored: 1 ignored
  s.clock.now = at("2026-11-10");
  assert.strictEqual(s.nudges.ignoredInRow(), 2);
  assert.strictEqual(s.nudges.morningBlock(), null); // day 3: two ignored in a row, so quiet
  s.clock.now = at("2026-11-12");
  assert.strictEqual(s.nudges.morningBlock(), null); // and it stays quiet
  s.tracker.markActivity(); // the student studies
  s.clock.now = at("2026-11-13");
  assert.ok(s.nudges.morningBlock());
});

test("resume clears the ignored count", () => {
  const s = setup(at("2026-11-08"));
  s.tracker.attachMaterial(s.sp, "2026-10-18", [{ fileId: "f", from: 1, to: 2 }]);
  s.nudges.morningBlock();
  s.clock.now = at("2026-11-09");
  s.nudges.morningBlock();
  s.clock.now = at("2026-11-10");
  assert.strictEqual(s.nudges.ignoredInRow(), 2);
  s.nudges.pause();
  s.nudges.resume();
  assert.strictEqual(s.nudges.ignoredInRow(), 0);
  assert.ok(s.nudges.morningBlock());
});

test("a nudge followed by studying is not counted as ignored", () => {
  const s = setup(at("2026-11-08"));
  s.tracker.attachMaterial(s.sp, "2026-10-18", [{ fileId: "f", from: 1, to: 2 }]);
  s.nudges.morningBlock();
  s.clock.now = at("2026-11-08", "19:00");
  s.tracker.markActivity();
  s.clock.now = at("2026-11-09", "09:00");
  assert.strictEqual(s.nudges.ignoredInRow(), 0);
});

test("the morning brief carries the study line, and the push says counts only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-nudge-m-"));
  const clock = { now: at("2026-11-08", "08:30") };
  const tracker = createTracker({ dir: path.join(dir, "study"), now: () => clock.now });
  const nudges = createNudges({ tracker, courseList: () => COURSES, now: () => clock.now });
  tracker.addAssignment(tracker.refsFor(COURSES)[0], { title: "Secret Exercise", due: "2026-11-09", needs: [] });
  const pushes = [];
  const push = { notifyAll: async (m) => { pushes.push(m); return { sent: 1 }; }, count: () => 1 };
  const morning = createMorning({ file: path.join(dir, "morning.json"), store: createStore(path.join(dir, "c")), reminders: createReminders({ file: path.join(dir, "r.json"), now: () => clock.now }), push, calendar: async () => ({ events: [], text: "" }), now: () => clock.now, timezone: "Asia/Jerusalem", study: nudges });
  const r = await morning.send();
  assert.ok(r.conversationId);
  assert.ok(pushes[0].body.endsWith("1 study item."), pushes[0].body);
  assert.doesNotMatch(pushes[0].body, /Secret|Systems/);
  const chat = createStore(path.join(dir, "c")).get(r.conversationId);
  assert.match(JSON.stringify(chat), /Secret Exercise/);
});

test("without the study hook the morning brief is exactly as before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-nudge-m2-"));
  const clock = { now: at("2026-11-08", "08:30") };
  const pushes = [];
  const push = { notifyAll: async (m) => { pushes.push(m); return { sent: 1 }; }, count: () => 1 };
  const morning = createMorning({ file: path.join(dir, "morning.json"), store: createStore(path.join(dir, "c")), reminders: createReminders({ file: path.join(dir, "r.json"), now: () => clock.now }), push, calendar: async () => ({ events: [], text: "" }), now: () => clock.now, timezone: "Asia/Jerusalem" });
  await morning.send();
  assert.strictEqual(pushes[0].body, "Today: 0 events, 0 reminders.");
});
