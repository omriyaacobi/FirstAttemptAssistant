// tests/brain-reminders.test.js
// The brain's reminder tools (2026-11-28, after the page's reminder list was removed): reminders_list numbers the waiting reminders in
// time order and marks the ones that went off; reminder_cancel takes ONLY a number from that list (code keeps number -> id for 2
// hours), cancels with the same store function the page's old cancel button used, and can be undone for 2 hours. A real reminder
// store in a temp folder, a FAKE model: nothing real runs.

const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createBrain } = require("../brain");
const { createReminders } = require("../reminders");

const COURSES = [{ id: "calc", name: "Calculus 2" }];
const START = Date.parse("2026-11-20T10:00:00Z");
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function setup() {
  const clock = { t: START };
  const now = () => clock.t;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-rem-")), "reminders.json");
  const reminders = createReminders({ file, now });
  let replies = [];
  const prompts = [];
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders,
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies.shift(); if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now,
  });
  const say = async (text, script) => { replies = [...script]; prompts.length = 0; const r = await brain.handle(text, { history: [], courses: COURSES }); return { r, all: prompts.join("\n") }; };
  // Three reminders made out of order, so the list must sort them.
  const add = (text, iso) => reminders.create({ text, at: iso, timezone: ZONE });
  add("call the bank", "2026-11-25T09:00");
  add("buy milk", "2026-11-21T18:00");
  add("submit ex 3", "2026-11-23T12:00");
  return { reminders, say, clock, add };
}

test("reminders_list: the waiting ones numbered in time order, with date, time and text; recently fired ones marked, without a number", async () => {
  const s = setup();
  s.add("stretch", "2026-11-20T10:30:00Z");
  s.clock.t = START + 60 * 60 * 1000; // an hour later: "stretch" is due
  s.reminders.tick();
  const { all } = await s.say("show me my reminders", ['CALL {"tool":"reminders_list"}', "Here they are."]);
  const listed = all.slice(all.lastIndexOf("Waiting reminders"));
  assert.match(listed, /1\. [^\n]*21[^\n]*18:00: buy milk/);
  assert.match(listed, /2\. [^\n]*23[^\n]*12:00: submit ex 3/);
  assert.match(listed, /3\. [^\n]*25[^\n]*09:00: call the bank/);
  assert.match(listed, /Already went off[^\n]*\n[\s\S]*- went off [^\n]*: stretch/);
  assert.doesNotMatch(listed, /\d\. [^\n]*stretch/, "a reminder that went off has no number");
});

test("reminder_cancel: the number from the last list cancels exactly that reminder, and undo puts it back", async () => {
  const s = setup();
  await s.say("show me my reminders", ['CALL {"tool":"reminders_list"}', "Here they are."]);
  const { all } = await s.say("cancel 2", ['CALL {"tool":"reminder_cancel","number":2}', "Cancelled."]);
  assert.match(all, /Reminder 2 CANCELLED[^\n]*submit ex 3/);
  assert.deepStrictEqual(s.reminders.list().map((r) => r.text), ["buy milk", "call the bank"]);
  const undo = await s.say("undo that", ['CALL {"tool":"reminder_cancel","undo":true}', "Back."]);
  assert.match(undo.all, /Reminder PUT BACK[^\n]*submit ex 3/);
  assert.deepStrictEqual(s.reminders.list().map((r) => r.text), ["buy milk", "submit ex 3", "call the bank"]);
});

test("reminder_cancel: the number keeps meaning what Omri saw, even after an earlier reminder went off", async () => {
  const s = setup();
  s.add("stretch", "2026-11-20T10:30:00Z"); // the earliest: number 1
  await s.say("my reminders?", ['CALL {"tool":"reminders_list"}', "Here."]);
  s.clock.t = START + 45 * 60 * 1000;
  assert.strictEqual(s.reminders.tick().length, 1, "stretch went off");
  // Omri saw: 1 stretch, 2 buy milk, 3 submit ex 3, 4 call the bank. "cancel 2" is buy milk, not the new second one.
  const { all } = await s.say("cancel 2", ['CALL {"tool":"reminder_cancel","number":2}', "Done."]);
  assert.match(all, /Reminder 2 CANCELLED[^\n]*buy milk/);
  assert.deepStrictEqual(s.reminders.list().filter((r) => r.status === "pending").map((r) => r.text), ["submit ex 3", "call the bank"]);
});

test("reminder_cancel: refused without a list shown, with a number not on it, with text instead of a number, and after 2 hours", async () => {
  const s = setup();
  let r = await s.say("cancel 1", ['CALL {"tool":"reminder_cancel","number":1}', "Sorry."]);
  assert.match(r.all, /FAILED, nothing was done: [^\n]*call reminders_list first/);
  await s.say("list", ['CALL {"tool":"reminders_list"}', "Here."]);
  r = await s.say("cancel 7", ['CALL {"tool":"reminder_cancel","number":7}', "Sorry."]);
  assert.match(r.all, /FAILED, nothing was done: [^\n]*no number 7/);
  r = await s.say("cancel the bank one", ['CALL {"tool":"reminder_cancel","number":"call the bank"}', "Sorry."]);
  assert.match(r.all, /FAILED, nothing was done: [^\n]*NUMBER/);
  s.clock.t = START + 3 * 3600 * 1000;
  r = await s.say("cancel 1", ['CALL {"tool":"reminder_cancel","number":1}', "Sorry."]);
  assert.match(r.all, /FAILED, nothing was done: [^\n]*last 2 hours/);
  assert.strictEqual(s.reminders.list().length, 3, "nothing was cancelled");
});

test("reminder_cancel: a reminder that already went off (or was cancelled) is not cancelled again; undo with nothing to undo is refused", async () => {
  const s = setup();
  await s.say("list", ['CALL {"tool":"reminders_list"}', "Here."]);
  await s.say("cancel 1", ['CALL {"tool":"reminder_cancel","number":1}', "Done."]);
  const again = await s.say("cancel 1", ['CALL {"tool":"reminder_cancel","number":1}', "Sorry."]);
  assert.match(again.all, /FAILED, nothing was done: [^\n]*no longer waiting/);
  assert.strictEqual(s.reminders.list().length, 2);
  const s2 = setup();
  const u = await s2.say("undo", ['CALL {"tool":"reminder_cancel","undo":true}', "Sorry."]);
  assert.match(u.all, /FAILED, nothing was done: [^\n]*no cancelled reminder/);
});

test("reminders.restore refuses a reminder whose time has passed, and one that is already there", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rem-restore-")), "reminders.json");
  let t = START;
  const store = createReminders({ file, now: () => t });
  const r = store.create({ text: "x", at: "2026-11-21T10:00", timezone: ZONE });
  assert.throws(() => store.restore(r), /already there/);
  store.cancel(r.id);
  t = Date.parse("2026-11-22T10:00:00Z");
  assert.throws(() => store.restore(r), /already passed/);
  assert.strictEqual(store.list().length, 0);
});
