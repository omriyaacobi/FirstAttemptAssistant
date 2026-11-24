// tools/quota-guard.js
// FOR TEST SESSIONS THAT MAKE REAL MODEL CALLS (to-do t29, part 4): read the weekly level FIRST, and stop at a set share of it, so a
// live test never eats Omri's week. (`agy -p /usage` itself costs no model quota.)
//
//   node tools/quota-guard.js begin [--pool "Gemini Models"] [--share 10] [--min 40]   write down the weekly level now; print the budget
//   node tools/quota-guard.js check                                                    exit 0 = you may go on, exit 2 = STOP now
//
//   --share 10   the budget is 10% of what is left this week at begin (89% left -> 8.9 points; at least 1 point)
//   --min 40     do not start at all when the week has less than 40% left (begin exits 3)
//   --five 20    also stop when the 5-hour window has less than 20% left (default 20)
//   --file <p>   where the note is kept (default: bot-quota-guard.json in the temp folder)
//
// Use it before the first real call and after every few calls, for example:
//   node tools/quota-guard.js begin --share 10 && node my-experiment.js --one-call && node tools/quota-guard.js check
// From a script: const { createGuard } = require("./tools/quota-guard"); const g = createGuard({ share: 10 }); await g.begin(); ... if (!(await g.allow()).ok) stop.
// A new weekly period (the reset time moved) starts a new budget by itself, with a note.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GEMINI = "Gemini Models";
const FILE = path.join(os.tmpdir(), "bot-quota-guard.json");

// Pure. rows: parseUsage's output. Returns { week, five } for the pool: { remaining, resets } or null.
function levelsOf(rows, pool = GEMINI) {
  const pick = (re) => (rows || []).find((r) => r && r.pool === pool && re.test(String(r.window)) && Number.isFinite(r.remaining));
  const w = pick(/week/i), f = pick(/five hour/i);
  return { week: w ? { remaining: w.remaining, resets: w.resets } : null, five: f ? { remaining: f.remaining, resets: f.resets } : null };
}

// Pure. The budget in points of the week: share% of what was left at the start, at least 1 point.
const budgetOf = (startRemaining, share) => Math.max(1, Math.round(startRemaining * share) / 100);

// Pure. note = what begin wrote down ({ pool, share, start, resets, five }); levels = levelsOf(now).
// Returns { ok, why, spent, budget }: ok false means STOP.
function judge(note, levels, { fiveMin = 20 } = {}) {
  const budget = budgetOf(note.start, note.share);
  if (!levels.week) return { ok: false, why: "the weekly row is missing from /usage: stop and look", spent: null, budget };
  if (levels.week.resets !== note.resets) return { ok: true, why: "a new weekly period started: run begin again for a new budget", spent: 0, budget, renewed: true };
  const spent = note.start - levels.week.remaining;
  if (spent >= budget) return { ok: false, why: `spent ${spent} of the ${budget} points budget (${note.share}% of the ${note.start}% that was left): STOP`, spent, budget };
  if (levels.five && levels.five.remaining < fiveMin) return { ok: false, why: `the 5-hour window has only ${levels.five.remaining}% left: STOP and wait`, spent, budget };
  return { ok: true, why: `spent ${spent} of ${budget} points`, spent, budget };
}

function createGuard({ pool = GEMINI, share = 10, min = 40, fiveMin = 20, file = FILE, readRows = defaultRows } = {}) {
  return {
    // Writes the level down. { ok: false } when the week is already too low to test (or unreadable).
    async begin() {
      const l = levelsOf(await readRows(), pool);
      if (!l.week) return { ok: false, why: "no weekly row for this pool in /usage" };
      if (l.week.remaining < min) return { ok: false, why: `only ${l.week.remaining}% of the week is left (minimum ${min}%): no live tests` };
      const note = { pool, share, start: l.week.remaining, resets: l.week.resets, at: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(note));
      return { ok: true, why: `week ${l.week.remaining}% left; budget ${budgetOf(note.start, share)} points`, budget: budgetOf(note.start, share), note };
    },
    async allow() {
      let note;
      try { note = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { ok: false, why: "no begin was run: run begin first" }; }
      return judge(note, levelsOf(await readRows(), note.pool), { fiveMin });
    },
  };
}

// `agy -p /usage` prints tab-separated lines. (quota.js's own fetchUsage is detached on purpose, so a short script would exit before the answer.)
function defaultRows() {
  const { execFile } = require("node:child_process");
  const agy = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
  return new Promise((resolve, reject) => execFile(agy, ["-p", "/usage"], { windowsHide: true, timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(require("../quota").parseUsage(stdout)))));
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback; };
  const guard = createGuard({ pool: opt("pool", GEMINI), share: Number(opt("share", 10)), min: Number(opt("min", 40)), fiveMin: Number(opt("five", 20)), file: opt("file", FILE) });
  if (cmd === "begin") { const r = await guard.begin(); console.log(r.ok ? `OK: ${r.why}` : `NO: ${r.why}`); return r.ok ? 0 : 3; }
  if (cmd === "check") { const r = await guard.allow(); console.log(r.ok ? `OK: ${r.why}` : `STOP: ${r.why}`); return r.ok ? 0 : 2; }
  console.log("usage: node tools/quota-guard.js begin|check  [--pool NAME] [--share 10] [--min 40] [--five 20] [--file PATH]");
  return 1;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });

module.exports = { levelsOf, budgetOf, judge, createGuard, FILE };
