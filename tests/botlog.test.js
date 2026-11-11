// tests/botlog.test.js
// The log file (botlog.js): lines reach the file, a crash is written with its stack and an exit code, a failed background step does not stop Bot.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { startLog, write, CRASH_EXIT, LATE_CRASH_EXIT } = require("../botlog");

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-log-")), "data", "bot.log");
function fakes(uptime = 5) {
  const proc = new EventEmitter();
  proc.uptime = () => uptime;
  const printed = [];
  const out = { log: (...a) => printed.push(["log", ...a]), error: (...a) => printed.push(["error", ...a]) };
  const exits = [];
  return { proc, out, printed, exits, exit: (code) => exits.push(code) };
}

test("console lines go to the file with the time, and still to the console", () => {
  const file = tmpFile();
  const f = fakes();
  const log = startLog(file, { ...f, now: () => new Date("2026-11-11T10:00:00Z") });
  f.out.log("hello", { a: 1 });
  f.out.error("bad thing");
  log.stop();
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /2026-11-11T10:00:00.000Z ---- Bot started ----/);
  assert.match(text, /hello \{"a":1\}/);
  assert.match(text, /ERROR bad thing/);
  assert.strictEqual(f.printed.length, 2);
});

test("an uncaught exception is written with its stack and Bot exits: 1 right after start, 76 after a good run", () => {
  for (const [uptime, code] of [[5, CRASH_EXIT], [600, LATE_CRASH_EXIT]]) {
    const file = tmpFile();
    const f = fakes(uptime);
    const log = startLog(file, f);
    f.proc.emit("uncaughtException", new Error("boom in brain"));
    log.stop();
    assert.deepStrictEqual(f.exits, [code]);
    assert.match(fs.readFileSync(file, "utf8"), /CRASH \(uncaught exception\).*boom in brain[\s\S]*botlog\.test\.js/);
  }
});

test("a failed background step is logged and Bot keeps running", () => {
  const file = tmpFile();
  const f = fakes();
  const log = startLog(file, f);
  f.proc.emit("unhandledRejection", new Error("calendar timed out"));
  log.stop();
  assert.deepStrictEqual(f.exits, []);
  assert.match(fs.readFileSync(file, "utf8"), /background step failed \(Bot keeps running\).*calendar timed out/);
});

test("the file is kept small, and a broken path never throws", () => {
  const file = tmpFile();
  for (let i = 0; i < 60; i++) write(file, "x".repeat(100) + " line " + i, { maxBytes: 2000 });
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.length < 4500, String(text.length));
  assert.match(text, /older lines were dropped/);
  assert.match(text, /line 59/);
  assert.doesNotThrow(() => write(path.join(file, "not-a-folder", "x.log"), "hi"));
});
