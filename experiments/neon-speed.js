// Neon low vs Hydrogen medium: REACTION TIME through Bot's real brain (createBrain: the real prompt, tool protocol, rounds).
// 2026-11-20. Everything is invented (public repo): fake courses, fake calendar, fake reminders store, no data/, no .env.
// One call at a time, NEVER parallel. The order of the arms alternates (forward, then backward) to cancel warm-up / queue effects.
// agy runs under the slim agent (no shell, no --dangerously-skip-permissions), exactly like Bot's brain.
//
// ARMS (what differs is only HOW agy is started):
//   neon-cold      = what Bot does TODAY for Neon low (brain.js WARM_MODELS does not list it: a new agy process per call)
//   hydrogen-warm  = what Bot does TODAY for Hydrogen medium (a waiting spare process, saves the 2-3 s start)
//   hydrogen-cold  = Hydrogen started the same way as Neon today (pure model-vs-model comparison)
//   neon-warm      = Neon with a waiting spare (what Bot would do if Neon were in WARM_MODELS)
//
// Run:   node experiments/neon-speed.js run <rounds> [arm,arm,...]      results -> experiments/neon-speed-results.json (appended)
//        node experiments/neon-speed.js table                           median / worst per arm and kind
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createBrain } = require("../brain");
const { ask, AGY_CMD } = require("../providers");
const { createWarmAgy } = require("../warmagy");

const OUT = path.join(__dirname, "neon-speed-results.json");
const MODEL = { neon: "gemini-4-neon-low", hydrogen: "gemini-4-hydrogen-medium" };
const ARMS = { "neon-cold": { model: MODEL.neon, warm: false }, "hydrogen-warm": { model: MODEL.hydrogen, warm: true }, "hydrogen-cold": { model: MODEL.hydrogen, warm: false }, "neon-warm": { model: MODEL.neon, warm: true } };
const FLOOR = 35; // stop when the Gemini Models 5-hour window is below this (Omri's floor is 30)

// ---------- the invented world ----------
const COURSES = [{ id: "db", name: "Intro to Databases" }, { id: "alg", name: "Algorithms" }];
const ASSIGNMENT = "Assignment 2 (Intro to Databases). Design a schema for a small library. Your schema must reach Third normal form (3NF) and you must submit it with a short ER diagram. Due: Thursday, 3 December 2026, 23:59. Submit through the course site.";
const PAGES = { db: [{ fileId: "f1", fileName: "Assignment_2.pdf", page: 1, text: ASSIGNMENT }, { fileId: "f2", fileName: "lecture4.pdf", page: 1, text: "Normalization. A foreign key is a column that refers to the primary key of another table. 1NF, 2NF, 3NF, BCNF." }], alg: [{ fileId: "f3", fileName: "lecture2.pdf", page: 1, text: "Merge sort runs in O(n log n) time." }] };
const CALENDAR = "Tuesday 1 December\n  10:00-12:00  Algorithms lecture\nWednesday 2 December\n  14:00-16:00  Databases tutorial\nThursday 3 December\n  10:00-12:00  Databases lecture";
const FILLER = Array.from({ length: 220 }, (_, i) => `Digest line ${i + 1}: the study group talked about snacks, the bus schedule and who has the projector. Nothing important was decided on day ${(i % 28) + 1}.`);
FILLER[137] = "Digest line 138: it was agreed that the group quiz will be held in week 9, in room 204.";
const LONG = FILLER.join("\n");

// kind -> the messages; ok(text, seen) is the code check of the answer
const T = [
  { id: "short-en", kind: "short", msg: "What is the derivative of x^3 * ln(x)? Answer in one line.", ok: (t) => /x\^?2|x²/.test(t) && /ln/i.test(t) },
  { id: "short-en2", kind: "short", msg: "Explain in two sentences what a foreign key is.", ok: (t) => /foreign key/i.test(t) && /(refer|point|link)/i.test(t) },
  { id: "hebrew", kind: "hebrew", msg: "מה ההבדל בין מחסנית לתור במבני נתונים?", ok: (t) => (t.match(/[֐-׿]/g) || []).length > 30 && /LIFO|FIFO|אחרון|ראשון/.test(t) },
  { id: "course-q", kind: "course", msg: "In Intro to Databases, which normal form does the assignment ask me to reach?", ok: (t) => /3NF|third normal/i.test(t) },
  { id: "reminder", kind: "one-tool", msg: "Remind me tomorrow at 9:00 to submit the lab report.", ok: (t, seen) => seen.reminders.length === 1 && /lab report/i.test(seen.reminders[0].text || "") && /T09:00/.test(String(seen.reminders[0].at)) },
  { id: "calendar", kind: "one-tool", msg: "What do I have on my calendar this week?", ok: (t) => /Databases/.test(t) && /(Thursday|Tuesday|Wednesday)/.test(t) },
  { id: "chain", kind: "chain-3", msg: "In Intro to Databases: look at the course files, read the assignment, check my calendar, and then remind me at 20:00 on the evening before it is due.", ok: (t, seen) => seen.reminders.length === 1 && /2026-12-02T20:00/.test(String(seen.reminders[0].at)) },
  { id: "long", kind: "long-ctx", msg: `Here is a digest the study group wrote:\n${LONG}\n\nIn which week is the group quiz?`, ok: (t) => /week 9|9/.test(t) && /204|9/.test(t) },
];

// ---------- one message through the real brain ----------
function usageNow() { // "Gemini Models" 5-hour % left, or null
  try {
    const line = execFileSync(AGY_CMD, ["-p", "/usage"], { encoding: "utf8", cwd: require("node:os").tmpdir(), timeout: 90000 }).split(/\r?\n/).find((l) => /^Gemini Models\tFive Hour/.test(l));
    return line ? Number(line.split("\t")[2].replace("%", "")) : null;
  } catch (error) { return null; }
}

async function runMessage(armName, t) {
  const arm = ARMS[armName];
  const seen = { reminders: [] };
  const calls = []; // per model call: seconds, time to first text, tokens
  const pool = arm.warm ? createWarmAgy({ keepReady: false, agent: true }) : null;
  if (pool) { // Bot warms the spare after the previous message, while Omri is not typing: wait until it is ready, outside the timing
    pool.warmUp(arm.model, null);
    const spare = pool._spares.get(arm.model + "|");
    for (let i = 0; i < 100 && !spare.ready; i++) await new Promise((r) => setTimeout(r, 100));
  }
  const askOne = (provider, model, prompt, onText, extra = {}) => {
    const c = { start: Date.now(), first: null, usage: null };
    calls.push(c);
    const onT = (text) => { if (c.first === null && text) c.first = Date.now(); if (onText) onText(text); };
    const onUsage = (u) => { c.usage = u; if (extra.onUsage) extra.onUsage(u); };
    const p = arm.warm ? pool.askText(prompt, model, onT, { timeoutMs: 120000, onUsage }) : ask("agy", model, prompt, onT, { agent: true, onUsage, timeoutMs: 120000 });
    return p.finally(() => { c.end = Date.now(); });
  };
  const brain = createBrain({
    courses: { allPages: (id) => PAGES[id] || [] },
    courseRoutes: { list: () => COURSES, courseFiles: (id) => ({ files: (PAGES[id] || []).map((p) => ({ id: p.fileId, name: p.fileName, status: "ready", pages: 1 })) }), linkFiles: () => [] },
    coach: null,
    reminders: { list: () => [], create: (r) => { const saved = { id: "r1", ...r }; seen.reminders.push(saved); return saved; } },
    memory: { list: () => [], add: () => ({ fact: { id: "m1", text: "" }, already: false }) },
    cards: { add: (proposal) => ({ id: "card1", events: proposal.events }) },
    readCalendar: async () => ({ text: CALENDAR }),
    askOne, chain: [{ provider: "agy", model: arm.model }],
    poolLevels: async () => [], poolRows: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    folderRules: { system: [] },
  });
  const t0 = Date.now();
  let answer = "", error = null, res = null;
  try { res = await brain.handle(t.msg, { history: [], courses: COURSES, log: () => {} }); answer = String((res && res.answer) || ""); } catch (e) { error = String(e.message).slice(0, 200); }
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  if (pool) pool.closeAll();
  let ok = false; try { ok = !error && !!t.ok(answer, seen); } catch (e) { ok = false; }
  const tokens = calls.reduce((a, c) => a + (c.usage ? (c.usage.input || 0) + (c.usage.output || 0) + (c.usage.thinking || 0) + (c.usage.cacheRead || 0) : 0), 0);
  return {
    arm: armName, test: t.id, kind: t.kind, seconds, firstText: calls[0] && calls[0].first ? +((calls[0].first - t0) / 1000).toFixed(1) : null,
    calls: calls.length, perCall: calls.map((c) => +(((c.end || Date.now()) - c.start) / 1000).toFixed(1)), tokens, ok, error, tools: (res && res.tools) || [], answerStart: answer.slice(0, 80),
  };
}

// ---------- the schedule: one at a time, the order of the arms alternates ----------
async function run(rounds, armNames) {
  const rows = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { started: new Date().toISOString(), usage: [], runs: [] };
  for (let round = 1; round <= rounds; round++) {
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti];
      const forward = (round + ti) % 2 === 0;
      const order = forward ? armNames : armNames.slice().reverse();
      for (const arm of order) {
        const left = usageNow();
        if (left !== null && left < FLOOR) { console.error(`STOP: Gemini Models 5-hour window at ${left}% (floor ${FLOOR}%)`); fs.writeFileSync(OUT, JSON.stringify(rows, null, 2)); return; }
        const r = await runMessage(arm, t);
        r.round = round; r.poolBefore = left; rows.runs.push(r);
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
        console.error(`r${round} ${t.id.padEnd(9)} ${arm.padEnd(13)} ${String(r.seconds).padStart(5)} s  first ${r.firstText}  calls ${r.calls}  ${r.tokens} tok  ${r.ok ? "ok" : "WRONG"}${r.error ? " ERR " + r.error : ""}  pool ${left}%`);
      }
    }
    rows.usage.push({ afterRound: round, at: new Date().toISOString(), geminiFiveHour: usageNow() });
  }
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
function table() {
  const { runs } = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const kinds = [...new Set(runs.map((r) => r.kind))];
  const arms = [...new Set(runs.map((r) => r.arm))];
  console.log("| kind | arm | n | median s | worst s | median first-text s | median tokens | right |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const kind of [...kinds, "ALL"]) for (const arm of arms) {
    const rs = runs.filter((r) => r.arm === arm && !r.error && (kind === "ALL" || r.kind === kind));
    if (!rs.length) continue;
    const all = runs.filter((r) => r.arm === arm && (kind === "ALL" || r.kind === kind));
    console.log(`| ${kind} | ${arm} | ${rs.length} | ${median(rs.map((r) => r.seconds)).toFixed(1)} | ${Math.max(...rs.map((r) => r.seconds)).toFixed(1)} | ${median(rs.filter((r) => r.firstText !== null).map((r) => r.firstText)).toFixed(1)} | ${Math.round(median(rs.map((r) => r.tokens)))} | ${all.filter((r) => r.ok).length}/${all.length} |`);
  }
}

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "run") run(Number(a) || 1, b ? b.split(",") : Object.keys(ARMS)).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === "table") table();
  else console.error("usage: node experiments/neon-speed.js run <rounds> [arm,...] | table");
}
module.exports = { T, ARMS };
