// botlog.js
// Bot's LOG FILE. Until now everything Bot printed went only to its console window, so when Bot stopped nobody could tell why.
// startLog() makes every console.log / console.error line ALSO go to a file (data/bot.log, with the time in front), and writes the
// full error there when Bot crashes. The file is in data/, which is git-ignored, and is kept small (the old half is dropped).
//
// Crashes:
//   - an "uncaught exception" (a bug that nothing handled) leaves Bot in an unknown state, so it is logged and Bot exits. The exit code
//     tells start-web.cmd what happened: 76 = crashed after running a while (start again), 1 = crashed right after starting (start
//     again only a few times, so a broken change cannot loop forever).
//   - an "unhandled rejection" (a background step failed and nothing was waiting for it) is logged and Bot KEEPS RUNNING: one failed
//     background step should not take the whole Bot down. (Without this, Node stops the program.)

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 2 * 1024 * 1024; // when the file passes this, only its newest half is kept
const CRASH_EXIT = 1;
const LATE_CRASH_EXIT = 76; // start-web.cmd: crashed after a good run, restart without counting it as a start-up failure
const GOOD_RUN_SECONDS = 120;

const text = (args) => args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack || a.message : (() => { try { return JSON.stringify(a); } catch (error) { return String(a); } })())).join(" ");

// Appends one line. Never throws: a full disk or a locked file must not break Bot.
function write(file, line, { now = () => new Date(), maxBytes = MAX_BYTES } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > maxBytes) {
        const all = fs.readFileSync(file, "utf8");
        const half = all.slice(Math.floor(all.length / 2));
        fs.writeFileSync(file, "[older lines were dropped to keep this file small]\n" + half.slice(half.indexOf("\n") + 1));
      }
    } catch (error) { /* no file yet */ }
    fs.appendFileSync(file, `${now().toISOString()} ${String(line).replace(/\r?\n/g, "\n    ")}\n`);
  } catch (error) { /* logging is a help, never a reason to fail */ }
}

// Turns the log on for this process. Returns { file, stop } (stop puts the console back; used by tests).
function startLog(file, { proc = process, out = console, now, maxBytes, exit = (code) => proc.exit(code) } = {}) {
  const opts = { ...(now ? { now } : {}), ...(maxBytes ? { maxBytes } : {}) };
  const original = { log: out.log, error: out.error };
  out.log = (...args) => { write(file, text(args), opts); original.log.apply(out, args); };
  out.error = (...args) => { write(file, "ERROR " + text(args), opts); original.error.apply(out, args); };
  const onCrash = (error) => {
    write(file, "CRASH (uncaught exception), Bot stops now: " + (error && error.stack ? error.stack : String(error)), opts);
    try { original.error.call(out, "Bot crashed:", error); } catch (e) { /* the window may be gone */ }
    exit(proc.uptime() > GOOD_RUN_SECONDS ? LATE_CRASH_EXIT : CRASH_EXIT);
  };
  const onRejection = (reason) => {
    write(file, "ERROR a background step failed (Bot keeps running): " + (reason && reason.stack ? reason.stack : String(reason)), opts);
    try { original.error.call(out, "A background step failed (Bot keeps running):", reason); } catch (e) { /* the window may be gone */ }
  };
  const onExit = (code) => write(file, `Bot stopped (exit code ${code}).`, opts);
  proc.on("uncaughtException", onCrash);
  proc.on("unhandledRejection", onRejection);
  proc.on("exit", onExit);
  write(file, "---- Bot started ----", opts);
  return { file, stop: () => { out.log = original.log; out.error = original.error; proc.removeListener("uncaughtException", onCrash); proc.removeListener("unhandledRejection", onRejection); proc.removeListener("exit", onExit); } };
}

module.exports = { startLog, write, MAX_BYTES, CRASH_EXIT, LATE_CRASH_EXIT, GOOD_RUN_SECONDS };
