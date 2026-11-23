// experiments/speed-rounds.js (2026-11-23, t19): a message with a TOOL ROUND = two model calls in a row (call A asks for a tool,
// code runs it, call B writes the reply). Bot starts the spare agy process for call B only when call A has ENDED (warmagy.js
// runOnSpare's finally), and agy takes about 3.4 s to start, so call B waits for it. Does starting that spare when call A STARTS
// make call B faster, and does the extra process slow call A down?
// Invented prompts only (speed-lab.js); slim agent; one message at a time; arms alternate.
//   node experiments/speed-rounds.js run <rounds>     -> experiments/speed-rounds-results.json
//   node experiments/speed-rounds.js table
const fs = require("node:fs");
const path = require("node:path");
const { createWarmAgy } = require("../warmagy");
const { prompt } = require("./speed-lab");

const OUT = path.join(__dirname, "speed-rounds-results.json");
const MODEL = process.env.MODEL || "gemini-4-neon-low";
const TOOL_MS = 300; // code running the tool (course_read and project_read take well under a second)
const A = prompt("big-short") + "\n\n(For this test: do not use any tool; answer in one line.)";
const B = A + "\n\n## Tool round 1\nYou called: {\"tool\":\"course_read\",\"course\":\"Calculus 2\",\"file\":\"sheet7.pdf\",\"page\":3}\n<tool-result id=\"t1\">\n" + prompt("small-short").slice(-3000) + "\n</tool-result id=\"t1\">\n\nContinue: either more CALL lines (only if really needed), or the final reply to Omri.";

async function message(arm) {
  const pool = createWarmAgy({ keepReady: false, agent: true });
  try {
    pool.warmUp(MODEL, null); // call A is warm, like a message less than 8 minutes after the last one
    const s0 = pool._spares.get(MODEL + "|");
    for (let i = 0; i < 150 && !s0.ready; i++) await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    const a = pool.askText(A, MODEL, () => {}, { timeoutMs: 120000 });
    if (arm === "early") pool.warmUp(MODEL, null); // the spare for the next round starts NOW (the change being tested)
    await a;
    const tA = Date.now();
    await new Promise((r) => setTimeout(r, TOOL_MS));
    const spare = pool._spares.get(MODEL + "|");
    const readyAtB = !!(spare && spare.ready);
    const tB0 = Date.now();
    await pool.askText(B, MODEL, () => {}, { timeoutMs: 120000 });
    const tB = Date.now();
    return { arm, a: (tA - t0) / 1000, b: (tB - tB0) / 1000, total: (tB - t0) / 1000, readyAtB };
  } finally { pool.closeAll(); }
}

async function run(rounds) {
  const rows = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { runs: [] };
  for (let r = 0; r < rounds; r++) for (const arm of r % 2 ? ["early", "after"] : ["after", "early"]) {
    try {
      const row = { ...(await message(arm)), model: MODEL, at: new Date().toISOString() };
      rows.runs.push(row);
      console.error(`${arm.padEnd(6)} A ${row.a.toFixed(1)} s  B ${row.b.toFixed(1)} s  total ${row.total.toFixed(1)} s  spare ready at B: ${row.readyAtB}`);
    } catch (e) { console.error(arm, "ERROR", String(e.message).slice(0, 160)); }
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  }
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function table() {
  const { runs } = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log("| model | arm | n | median call A s | median call B s | median both s | worst both s |\n|---|---|---|---|---|---|---|");
  for (const model of [...new Set(runs.map((r) => r.model))]) for (const arm of ["after", "early"]) {
    const g = runs.filter((r) => r.arm === arm && r.model === model);
    if (g.length) console.log(`| ${model} | ${arm} | ${g.length} | ${median(g.map((r) => r.a)).toFixed(1)} | ${median(g.map((r) => r.b)).toFixed(1)} | ${median(g.map((r) => r.total)).toFixed(1)} | ${Math.max(...g.map((r) => r.total)).toFixed(1)} |`);
  }
}
if (require.main === module) {
  const [cmd, n] = process.argv.slice(2);
  if (cmd === "run") run(Number(n) || 1).catch((e) => { console.error(e); process.exit(1); });
  else table();
}
