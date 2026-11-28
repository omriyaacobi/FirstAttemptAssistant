// tests/brain-brief-time.test.js
// brief_time (2026-11-28, t43; the page's morning brief settings were removed that day): the brain changes the morning brief's time
// or turns it on/off through morning.update (the road POST /api/morning uses). Code checks a real HH:MM and on/off, and "undo" puts
// the old setting back for 2 hours. A real morning store in a temp folder, a FAKE model: nothing real runs, nothing is sent.

const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createBrain } = require("../brain");
const { createMorning } = require("../morning");

const COURSES = [{ id: "calc", name: "Calculus 2" }];
const START = Date.parse("2026-11-20T04:00:00Z"); // early morning, before the default 08:30 in Israel and in UTC

function setup({ withMorning = true } = {}) {
  const clock = { t: START };
  const now = () => clock.t;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-brief-")), "morning.json");
  const morning = createMorning({ file, store: null, reminders: { list: () => [] }, push: { count: () => 0, notifyAll: async () => {} }, now });
  let replies = [];
  const prompts = [];
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [], create: () => ({}) },
    morning: withMorning ? morning : null,
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies.shift(); if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now,
  });
  const say = async (text, script) => { replies = [...script]; prompts.length = 0; await brain.handle(text, { history: [], courses: COURSES }); return prompts.join("\n"); };
  return { morning, say, clock, file };
}

test("brief_time: turns the brief on at a new time, and the context shows the setting", async () => {
  const s = setup();
  const all = await s.say("turn on my morning brief at 7:15", ['CALL {"tool":"brief_time","on":true,"time":"7:15"}', "Done."]);
  assert.match(all, /Morning brief: off, at 08:30\./, "the context shows the setting before the change");
  assert.match(all, /Morning brief ON, at 07:15 \(before: off, at 08:30\)/);
  assert.deepStrictEqual(s.morning.settings(), { on: true, time: "07:15" });
});

test("brief_time: only the time, only off (\"off\" as a word too), and undo puts the old setting back", async () => {
  const s = setup();
  s.morning.update({ on: true, time: "08:00" });
  await s.say("move the brief to 6:45", ['CALL {"tool":"brief_time","time":"06:45"}', "Moved."]);
  assert.deepStrictEqual(s.morning.settings(), { on: true, time: "06:45" });
  await s.say("stop the morning brief", ['CALL {"tool":"brief_time","on":"off"}', "Off."]);
  assert.deepStrictEqual(s.morning.settings(), { on: false, time: "06:45" });
  const all = await s.say("undo", ['CALL {"tool":"brief_time","undo":true}', "Back."]);
  assert.match(all, /Morning brief PUT BACK: on, at 06:45/);
  assert.deepStrictEqual(s.morning.settings(), { on: true, time: "06:45" });
});

test("brief_time: refuses a time that is not real, a bad on/off, no change at all, and undo with nothing to undo", async () => {
  const s = setup();
  for (const [args, said] of [[{ time: "25:00" }, /real HH:MM/], [{ time: "7:5" }, /real HH:MM/], [{ time: "seven" }, /real HH:MM/], [{ on: "maybe" }, /true or false/], [{}, /give "time"/], [{ undo: true }, /nothing|no morning brief change/]]) {
    const all = await s.say("brief", [`CALL ${JSON.stringify({ tool: "brief_time", ...args })}`, "Sorry."]);
    assert.match(all, new RegExp(`FAILED, nothing was done: [^\\n]*${said.source}`), JSON.stringify(args));
  }
  assert.deepStrictEqual(s.morning.settings(), { on: false, time: "08:30" }, "nothing changed");
});

test("brief_time: undo is gone after 2 hours", async () => {
  const s = setup();
  await s.say("brief at 9", ['CALL {"tool":"brief_time","time":"09:00"}', "Done."]);
  s.clock.t = START + 3 * 3600 * 1000;
  const all = await s.say("undo", ['CALL {"tool":"brief_time","undo":true}', "Sorry."]);
  assert.match(all, /FAILED, nothing was done: [^\n]*no morning brief change to undo/);
  assert.deepStrictEqual(s.morning.settings(), { on: false, time: "09:00" });
});

test("brief_time: a Bot without the morning brief says so and changes nothing", async () => {
  const s = setup({ withMorning: false });
  const all = await s.say("brief at 9", ['CALL {"tool":"brief_time","time":"09:00"}', "Hmm."]);
  assert.match(all, /not set up in this Bot/);
  assert.strictEqual(fs.existsSync(s.file), false);
});
