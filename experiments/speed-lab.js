// experiments/speed-lab.js (2026-11-23, t19): what costs SECONDS in one brain call?
// Everything here is invented (public repo): no data/, no .env, no real messages. Bot's real briefing (brain-brief.md, in the repo)
// is the head of every prompt, like in Bot. agy runs under the slim agent (no shell, no --dangerously-skip-permissions), on a
// WAITING spare process (what Bot does when the previous message was less than 8 minutes ago), and the time starts when the
// prompt is written to it. One call at a time, never parallel; the order of the arms rotates every round.
//
// ARMS: context size x answer length
//   small-short  brief + a short talk (~10k tokens in), a one-line answer
//   big-short    + an invented assignment and notes like Bot's course block (~21k tokens in), a one-line answer
//   small-long   ~10k in, an answer of a few paragraphs (like Bot's real tutoring replies, ~500 tokens out)
//   big-long     ~21k in, a few paragraphs
// Run:  node experiments/speed-lab.js run <rounds> [model] [arm,arm]   -> experiments/speed-lab-results.json (appended)
//       node experiments/speed-lab.js table
const fs = require("node:fs");
const path = require("node:path");
const { createWarmAgy } = require("../warmagy");

const OUT = path.join(__dirname, "speed-lab-results.json");
const BRIEF = fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8");

// ---------- invented context ----------
const TALK = Array.from({ length: 10 }, (_, i) => (i % 2 ? `Bot: For exercise ${i}, start from the definition of the limit and bound the remainder term; the series converges by comparison with 1/n^2.` : `Omri: ok, and what about exercise ${i + 1} in the sheet? I am not sure about the bound.`)).join("\n");
const SECTION = (n) => `Section ${n}. Power series. A power series sum a_k (x - c)^k converges on an interval around c. The radius R is found with the ratio test: R = lim |a_k / a_(k+1)| when the limit exists, or with the root test, 1/R = limsup |a_k|^(1/k). Inside the interval the series can be differentiated and integrated term by term, and the radius does not change. At the end points the series must be checked separately: example ${n} shows a series that converges at x = c - R but diverges at x = c + R. Exercise ${n}.1: find the radius and the interval of convergence of sum k^${n % 4 + 1} x^k / ${n + 2}^k. Exercise ${n}.2: write the Taylor series of ln(1 + x) around 0 and use it to estimate ln(1.1) with an error below 10^-4.`;
const ASSIGNMENT = Array.from({ length: 40 }, (_, i) => SECTION(i + 1)).join("\n\n").slice(0, 24000);
const NOTES = Array.from({ length: 18 }, (_, i) => `[lecture 7, page ${i + 1}] ` + SECTION(i + 60)).join("\n").slice(0, 10000);
const head = (big) => [
  BRIEF,
  "## Right now\nIt is 2026-12-01T18:20 (Tuesday), time zone Asia/Jerusalem.",
  "## Calendar and reminders\nOmri's Google Calendar, 7 days from today:\n<calendar>\nWednesday 2 December\n  10:00-12:00  Calculus 2 - lecture\nThursday 3 December\n  14:00-16:00  Algorithms - tutorial\n</calendar>\nReminders waiting: none.",
  "## Omri's courses in Bot\n- Calculus 2 (12 files)\n- Algorithms (5 files)",
  big ? `## The course this talk is in: Calculus 2\nThe assignment of Calculus 2 ("Sheet 7"), in full:\n<assignment>\n${ASSIGNMENT}\n</assignment>\nThe best-matching pages of the notes:\n<notes>\n${NOTES}\n</notes>` : "",
  `## Conversation so far\n${TALK}`,
].filter(Boolean).join("\n\n");
const ASK = {
  short: "What is the radius of convergence of sum x^k / 3^k? Answer in one line.",
  long: "Explain to me how to find the interval of convergence of a power series, step by step, with one worked example, and tell me what to check at the end points. A few short paragraphs.",
};
const prompt = (arm) => { const [size, len] = arm.split("-"); return `${head(size === "big")}\n\n## Omri's new message\n<message>\n${ASK[len]}\n</message>`; };
const ARMS = ["small-short", "big-short", "small-long", "big-long"];

async function one(pool, model, arm) {
  pool.warmUp(model, null); // the spare Bot keeps for the next message; wait until agy said "init", outside the timing
  const spare = pool._spares.get(model + "|");
  for (let i = 0; i < 150 && spare && !spare.ready; i++) await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  let first = null, usage = null, text = "", error = null;
  try {
    text = await pool.askText(prompt(arm), model, (t) => { if (first === null && t) first = Date.now(); }, { timeoutMs: 120000, onUsage: (u) => { usage = u; } });
  } catch (e) { error = String(e.message).slice(0, 160); }
  const s = (t) => (t ? +((t - t0) / 1000).toFixed(2) : null);
  return { model, arm, seconds: s(Date.now()), firstText: s(first), chars: String(text || "").length, usage, error, promptChars: prompt(arm).length };
}

async function run(rounds, model, arms) {
  const rows = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { runs: [] };
  const pool = createWarmAgy({ keepReady: false, agent: true });
  try {
    for (let r = 0; r < rounds; r++) {
      const order = arms.map((_, i) => arms[(i + r) % arms.length]);
      for (const arm of order) {
        const row = { ...(await one(pool, model, arm)), round: r, at: new Date().toISOString() };
        rows.runs.push(row);
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
        const u = row.usage || {};
        console.error(`${model} ${arm.padEnd(12)} ${String(row.seconds).padStart(5)} s first ${row.firstText} in ${u.input} out ${u.output} think ${u.thinking} cache ${u.cacheRead} ${row.error || ""}`);
      }
    }
  } finally { pool.closeAll(); }
}

const median = (a) => { const s = a.filter((x) => typeof x === "number").sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
function table() {
  const { runs } = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log("| model | arm | n | median s | worst s | median first text s | median in | median out | median thinking | median cache |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const model of [...new Set(runs.map((r) => r.model))]) for (const arm of [...new Set(runs.map((r) => r.arm))]) {
    const g = runs.filter((r) => r.model === model && r.arm === arm && !r.error);
    if (!g.length) continue;
    const u = (k) => Math.round(median(g.map((r) => (r.usage || {})[k] || 0)));
    console.log(`| ${model} | ${arm} | ${g.length} | ${median(g.map((r) => r.seconds)).toFixed(1)} | ${Math.max(...g.map((r) => r.seconds)).toFixed(1)} | ${median(g.map((r) => r.firstText)).toFixed(1)} | ${u("input")} | ${u("output")} | ${u("thinking")} | ${u("cacheRead")} |`);
  }
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "run") run(Number(a) || 1, b || "gemini-4-neon-low", c ? c.split(",") : ARMS).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === "table") table();
  else console.log("node experiments/speed-lab.js run <rounds> [model] [arms] | table");
}
module.exports = { prompt, ARMS };
