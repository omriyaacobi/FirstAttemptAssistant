// reminders.test.js
// Tests reminders.js with temporary folders and a fake clock (never the real data folder).
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createReminders, parseWhen, formatWhen, cleanText, validTimezone, MAX_PENDING } = require("./reminders");

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0); // 2026-11-01 12:00 UTC
const TZ = "Asia/Jerusalem";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-reminders-"));
  const clock = { t: NOW };
  const notified = [];
  const r = createReminders({ file: path.join(dir, "sub", "reminders.json"), notify: (x) => notified.push(x), now: () => clock.t });
  return { dir, clock, notified, r, file: path.join(dir, "sub", "reminders.json") };
}

test("parseWhen: wall-clock time in a zone becomes the right UTC moment (winter and summer)", () => {
  assert.strictEqual(parseWhen("2026-11-02T09:00:00", TZ, NOW), Date.UTC(2026, 10, 2, 7, 0, 0)); // +02:00
  assert.strictEqual(parseWhen("2027-07-01T09:00", TZ, NOW), Date.UTC(2027, 6, 1, 6, 0, 0)); // +03:00
  assert.strictEqual(parseWhen("2026-11-02T09:00", "UTC", NOW), Date.UTC(2026, 10, 2, 9, 0, 0));
  assert.strictEqual(parseWhen("2026-11-02T09:00", "America/New_York", NOW), Date.UTC(2026, 10, 2, 14, 0, 0));
});

test("parseWhen: an explicit offset or Z is used as written", () => {
  assert.strictEqual(parseWhen("2026-11-02T09:00:00+02:00", TZ, NOW), Date.UTC(2026, 10, 2, 7, 0, 0));
  assert.strictEqual(parseWhen("2026-11-02T09:00:00Z", TZ, NOW), Date.UTC(2026, 10, 2, 9, 0, 0));
});

test("parseWhen: rejects the past, the far future, impossible dates and junk", () => {
  const bad = ["2026-11-01T11:59", "2020-01-01T10:00", "2033-01-01T10:00", "2026-02-30T10:00", "2026-13-01T10:00", "2026-11-02T25:00",
    "tomorrow at 9", "", "2026-11-02", "2026-11-02T09:00; rm -rf", null, undefined, 42, {}];
  for (const iso of bad) assert.throws(() => parseWhen(iso, TZ, NOW), Error, String(iso));
});

test("parseWhen: the time zone is required and must be a real one", () => {
  for (const tz of [undefined, null, "", "Mars/Olympus", "../etc", "x".repeat(100), 5]) {
    assert.throws(() => parseWhen("2026-11-02T09:00", tz, NOW), /time zone/, String(tz));
  }
  assert.ok(validTimezone("Asia/Jerusalem"));
  assert.ok(!validTimezone("nope"));
});

test("cleanText trims, flattens control characters and limits the length", () => {
  assert.strictEqual(cleanText("  call \n the\tbank  "), "call the bank");
  assert.throws(() => cleanText("   "));
  assert.throws(() => cleanText(5));
  assert.throws(() => cleanText("x".repeat(501)));
});

test("formatWhen shows the time in the reminder's zone", () => {
  assert.match(formatWhen(Date.UTC(2026, 10, 2, 7, 0, 0), TZ), /09:00/);
});

test("create, list and cancel; the file is created lazily and survives a new instance", () => {
  const { r, file, dir } = setup();
  assert.deepStrictEqual(r.list(), []);
  assert.ok(!fs.existsSync(file), "reading does not create the file");
  const a = r.create({ text: "call the bank", at: "2026-11-02T09:00", timezone: TZ });
  const b = r.create({ text: "buy milk", at: "2026-11-01T18:00", timezone: TZ });
  assert.match(a.id, /^[a-f0-9]{16}$/);
  assert.deepStrictEqual(r.list().map((x) => x.text), ["buy milk", "call the bank"], "sorted by time");
  const again = createReminders({ file, now: () => NOW });
  assert.strictEqual(again.list().length, 2);
  assert.ok(r.cancel(a.id));
  assert.ok(!r.cancel(a.id), "already gone");
  assert.deepStrictEqual(r.list().map((x) => x.id), [b.id]);
  assert.ok(!fs.existsSync(file + ".tmp"), "no temp file left behind");
  fs.rmSync(dir, { recursive: true });
});

test("cancel and acknowledge refuse ids that are not 16 hex characters", () => {
  const { r } = setup();
  for (const id of ["../../x", "", "abc", null, 5, "ZZZZZZZZZZZZZZZZ"]) {
    assert.strictEqual(r.cancel(id), false);
    assert.strictEqual(r.acknowledge(id), false);
  }
});

test("create validates everything and caps the number of pending reminders", () => {
  const { r } = setup();
  assert.throws(() => r.create({ text: "", at: "2026-11-02T09:00", timezone: TZ }));
  assert.throws(() => r.create({ text: "x", at: "2026-10-01T09:00", timezone: TZ }), /past/);
  assert.throws(() => r.create({ text: "x", at: "2026-11-02T09:00", timezone: "Nope/Zone" }));
  assert.throws(() => r.create({}));
  for (let i = 0; i < MAX_PENDING; i++) r.create({ text: "n" + i, at: "2026-11-02T09:00", timezone: TZ });
  assert.throws(() => r.create({ text: "one more", at: "2026-11-02T09:00", timezone: TZ }), /too many/);
});

test("tick fires only what is due, once, through notify", () => {
  const { r, clock, notified } = setup();
  r.create({ text: "soon", at: "2026-11-01T14:00", timezone: "UTC" });
  r.create({ text: "later", at: "2026-11-03T14:00", timezone: "UTC" });
  assert.deepStrictEqual(r.tick(), []);
  clock.t = Date.UTC(2026, 10, 1, 14, 0, 30);
  assert.deepStrictEqual(r.tick().map((x) => x.text), ["soon"]);
  assert.deepStrictEqual(r.tick(), [], "never fires twice");
  assert.deepStrictEqual(notified.map((x) => x.text), ["soon"]);
  assert.strictEqual(notified[0].late, false);
});

test("catch-up: reminders missed while Bot was off fire at the next check, marked late", () => {
  const { r, clock, notified, file } = setup();
  r.create({ text: "missed", at: "2026-11-01T14:00", timezone: "UTC" });
  clock.t = Date.UTC(2026, 10, 2, 8, 0, 0); // next morning
  const fresh = createReminders({ file, notify: (x) => notified.push(x), now: () => clock.t }); // "Bot restarted"
  fresh.start(1e9);
  fresh.stop();
  assert.deepStrictEqual(notified.map((x) => [x.text, x.late]), [["missed", true]]);
});

test("a fired reminder stays listed until the page acknowledges it", () => {
  const { r, clock } = setup();
  const a = r.create({ text: "x", at: "2026-11-01T13:00", timezone: "UTC" });
  clock.t = Date.UTC(2026, 10, 1, 13, 1, 0);
  r.tick();
  assert.deepStrictEqual(r.undelivered().map((x) => x.id), [a.id]);
  assert.strictEqual(r.list().length, 1);
  assert.ok(r.acknowledge(a.id));
  assert.deepStrictEqual(r.undelivered(), []);
  assert.deepStrictEqual(r.list(), []);
  assert.ok(!r.acknowledge(a.id), "acknowledging twice is a no-op");
});

test("delivered reminders are forgotten after a week", () => {
  const { r, clock, file } = setup();
  const a = r.create({ text: "x", at: "2026-11-01T13:00", timezone: "UTC" });
  clock.t = Date.UTC(2026, 10, 1, 13, 1, 0);
  r.tick();
  r.acknowledge(a.id);
  clock.t += 8 * 24 * 3600 * 1000;
  r.tick();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), []);
});

test("a notify function that throws or rejects never stops the scheduler or double-fires", async () => {
  const { dir, clock } = setup();
  const file = path.join(dir, "r.json");
  let calls = 0;
  const r = createReminders({ file, now: () => clock.t, notify: () => { calls++; throw new Error("boom"); } });
  r.create({ text: "a", at: "2026-11-01T13:00", timezone: "UTC" });
  clock.t = Date.UTC(2026, 10, 1, 13, 5, 0);
  assert.doesNotThrow(() => r.tick());
  const r2 = createReminders({ file, now: () => clock.t, notify: async () => { throw new Error("async boom"); } });
  r2.create({ text: "b", at: "2026-11-02T13:00", timezone: "UTC" });
  clock.t = Date.UTC(2026, 10, 2, 13, 5, 0);
  assert.doesNotThrow(() => r2.tick());
  await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the test run
  assert.strictEqual(calls, 1);
});

test("a corrupt file reads as empty instead of crashing", () => {
  const { r, file } = setup();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{not json");
  assert.deepStrictEqual(r.list(), []);
  r.create({ text: "x", at: "2026-11-02T09:00", timezone: TZ });
  assert.strictEqual(r.list().length, 1);
});

// QA round 2 (L2): a Hebrew reply gets a Hebrew date, not "Sun 8 Nov".
test("formatWhen can write the time in Hebrew", () => {
  const he = formatWhen(Date.UTC(2026, 10, 8, 18, 0, 0), TZ, "he");
  assert.match(he, /20:00/);
  assert.match(he, /[\u0590-\u05ff]/);
  assert.doesNotMatch(he, /Sun|Nov/);
  assert.match(formatWhen(Date.UTC(2026, 10, 8, 18, 0, 0), TZ), /Sun 8 Nov, 20:00/); // English unchanged
});
