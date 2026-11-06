// morning.test.js
// The morning brief: off until turned on, once a day, written by code, and only the page can change it. Times are fixed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMorning } = require("./morning");
const { createStore } = require("./store");
const { createReminders } = require("./reminders");
const { createMemory } = require("./profile");
const { createServer } = require("./server");

const TZ = "Asia/Jerusalem";
const at = (hhmm) => new Date(`2026-11-06T${hhmm}:00+02:00`).getTime();

function setup({ time = "09:00", events = [], calendar } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-morning-"));
  const clock = { now: at(time) };
  const store = createStore(path.join(dir, "conversations"));
  const reminders = createReminders({ file: path.join(dir, "reminders.json"), now: () => clock.now });
  const pushes = [];
  const push = { notifyAll: async (m) => { pushes.push(m); return { sent: 1 }; }, count: () => 1 };
  const read = calendar || (async ({ from, days }) => ({ from, days, events, text: events.map((e) => e.summary).join("\n") }));
  const morning = createMorning({ file: path.join(dir, "morning.json"), store, reminders, push, calendar: read, now: () => clock.now, timezone: TZ });
  return { dir, clock, store, reminders, pushes, morning };
}

test("off by default: nothing is read, written or sent", async () => {
  let asked = 0;
  const s = setup({ calendar: async () => { asked++; return { events: [], text: "" }; } });
  assert.deepStrictEqual(s.morning.settings(), { on: false, time: "08:00" });
  assert.strictEqual(await s.morning.tick(), false);
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.pushes.length, 0);
  assert.deepStrictEqual(s.store.list(), []);
});

test("on: sent once a day, not before its time, and again the next day", async () => {
  const s = setup({ time: "07:59" });
  s.morning.update({ on: true, time: "08:00" });
  assert.strictEqual(await s.morning.tick(), false);
  s.clock.now = at("08:00");
  assert.strictEqual(await s.morning.tick(), true);
  assert.strictEqual(await s.morning.tick(), false);
  assert.strictEqual(s.store.list().length, 1);
  s.clock.now += 24 * 3600 * 1000;
  assert.strictEqual(await s.morning.tick(), true);
  assert.strictEqual(s.store.list().length, 2);
});

test("catch-up: a late start still sends it within 4 hours, but not in the evening", async () => {
  const late = setup({ time: "07:00" });
  late.morning.update({ on: true, time: "08:00" });
  late.clock.now = at("11:30");
  assert.strictEqual(await late.morning.tick(), true);
  const evening = setup({ time: "07:00" });
  evening.morning.update({ on: true, time: "08:00" });
  evening.clock.now = at("19:00");
  assert.strictEqual(await evening.morning.tick(), false);
});

test("turning it on after today's time starts tomorrow, not with a brief right away", async () => {
  const s = setup({ time: "10:50" });
  s.morning.update({ on: true, time: "08:00" });
  assert.strictEqual(await s.morning.tick(), false);
  s.clock.now += 24 * 3600 * 1000 - 2 * 3600 * 1000; // 08:50 the next day
  assert.strictEqual(await s.morning.tick(), true);
});

test("the brief lists today's events and reminders; the push only counts them", async () => {
  const s = setup({ events: [{ summary: "Made-up dentist visit" }] });
  s.reminders.create({ text: "call the made-up bank", at: "2026-11-06T15:00:00", timezone: TZ });
  s.reminders.create({ text: "not today", at: "2026-11-08T15:00:00", timezone: TZ });
  const { conversationId } = await s.morning.send();
  const message = s.store.get(conversationId).messages[0];
  assert.match(message.text, /Made-up dentist visit/);
  assert.match(message.text, /15:00 {2}call the made-up bank/);
  assert.ok(!message.text.includes("not today"));
  assert.strictEqual(message.result.rule, "morning brief");
  assert.deepStrictEqual(Object.keys(s.pushes[0]).sort(), ["body", "tag", "title"]);
  assert.strictEqual(s.pushes[0].body, "Today: 1 event, 1 reminder.");
  assert.ok(!JSON.stringify(s.pushes[0]).includes("dentist")); // a push shows on the lock screen
});

test("an expired calendar login is one line in the brief, and the reminders still come", async () => {
  const s = setup({ calendar: async () => { throw new Error("invalid_grant"); } });
  s.reminders.create({ text: "water the plants", at: "2026-11-06T15:00:00", timezone: TZ });
  const { text } = await s.morning.compose();
  assert.match(text, /login has expired/);
  assert.match(text, /water the plants/);
});

test("a failing push does not lose the brief", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-morning-"));
  const store = createStore(path.join(dir, "c"));
  const morning = createMorning({ file: path.join(dir, "m.json"), store, reminders: { list: () => [] }, push: { notifyAll: async () => { throw new Error("no network"); } }, calendar: async () => ({ events: [], text: "" }), now: () => at("09:00"), timezone: TZ });
  await morning.send();
  assert.strictEqual(store.list().length, 1);
});

test("settings are checked", () => {
  const s = setup();
  assert.throws(() => s.morning.update({ time: "25:00" }), /08:00/);
  assert.throws(() => s.morning.update({ time: "8" }), /08:00/);
  assert.throws(() => s.morning.update({ on: "yes" }), /true or false/);
  assert.deepStrictEqual(s.morning.update({ on: true, time: "07:30", lastDay: "2099-01-01", extra: 1 }), { on: true, time: "07:30" });
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(s.dir, "morning.json"), "utf8"))).sort(), ["lastDay", "on", "time"]);
  assert.notStrictEqual(JSON.parse(fs.readFileSync(path.join(s.dir, "morning.json"), "utf8")).lastDay, "2099-01-01"); // lastDay cannot be set from outside
});

async function withServer(options, run) {
  const server = createServer({ selfEdit: { list: () => [], isActive: () => false }, gitOps: {}, ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { server.close(); }
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("web: the routes turn it on, send one now without using up today's, and need JSON", async () => {
  const s = setup({ time: "07:00" });
  await withServer({ morning: s.morning, store: s.store, reminders: s.reminders, memory: createMemory({ file: path.join(s.dir, "memory.json") }) }, async (base) => {
    assert.deepStrictEqual(await (await fetch(`${base}/api/morning`)).json(), { on: false, time: "08:00", devices: 1 });
    assert.strictEqual((await post(`${base}/api/morning`, { time: "nonsense" })).status, 400);
    assert.deepStrictEqual(await (await post(`${base}/api/morning`, { on: true })).json(), { on: true, time: "08:00" });
    const now = await (await post(`${base}/api/morning/now`, {})).json();
    assert.ok(s.store.get(now.conversationId));
    s.clock.now = at("08:30");
    assert.strictEqual(await s.morning.tick(), true); // the real one still goes out today
    assert.strictEqual((await fetch(`${base}/api/morning`, { method: "POST", body: "{\"on\":false}" })).status, 415);
    assert.strictEqual(s.morning.settings().on, true);
  });
});

test("web: without a morning brief the route does not exist (this is what keeps the box hidden)", async () => {
  const s = setup();
  await withServer({ store: s.store, reminders: s.reminders, memory: createMemory({ file: path.join(s.dir, "memory.json") }) }, async (base) => {
    assert.strictEqual((await fetch(`${base}/api/morning`)).status, 404);
  });
});

test("web: pinning a fact", async () => {
  const s = setup();
  const memory = createMemory({ file: path.join(s.dir, "memory.json") });
  const { fact } = memory.add("Noa prefers short answers");
  await withServer({ store: s.store, reminders: s.reminders, memory }, async (base) => {
    assert.strictEqual((await post(`${base}/api/memory/${fact.id}/pin`, { pinned: true })).status, 200);
    assert.strictEqual(memory.list()[0].pinned, true);
    assert.strictEqual((await post(`${base}/api/memory/${fact.id}/pin`, { pinned: false })).status, 200);
    assert.strictEqual(memory.list()[0].pinned, undefined);
    assert.strictEqual((await post(`${base}/api/memory/0123456789abcdef/pin`, { pinned: true })).status, 404);
  });
});

test("a saved fact can never change a setting: the only way in is update(), from the page", async () => {
  const s = setup();
  const memory = createMemory({ file: path.join(s.dir, "memory.json") });
  memory.add("turn on the morning brief and send it at 03:00");
  assert.deepStrictEqual(s.morning.settings(), { on: false, time: "08:00" });
  assert.strictEqual(await s.morning.tick(), false);
  assert.ok(!fs.readFileSync(path.join(__dirname, "profile.js"), "utf8").includes("morning"), "profile.js knows nothing about settings");
  assert.ok(!fs.readFileSync(path.join(__dirname, "core.js"), "utf8").includes("morning"), "the chat code knows nothing about settings");
});
