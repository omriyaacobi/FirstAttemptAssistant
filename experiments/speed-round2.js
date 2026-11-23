// experiments/speed-round2.js (2026-11-23, t19 round 2): can the model's THINKING and WRITING part of an answer get faster?
// Everything here is invented (public repo): no data/, no .env, no real messages. The head of every prompt is Bot's REAL briefing
// (brain-brief.md) and the invented course block of speed-lab.js, laid out like brain.js builds it; the new message comes last.
// agy runs like the brain's: slim agent, waiting spare (the timing starts when the prompt is written), one call at a time.
//
// THREE REALISTIC QUESTIONS (correctness is read by hand from the saved answers):
//   math  a course math question in the middle of a Calculus talk (no tool needed)
//   tool  "why does my main.c crash" with a linked folder: the right reply is a project_read CALL line
//   cal   "what do I have tomorrow, and remind me 30 min before": the right reply is a set_reminder CALL (+ the answer from the calendar)
// ARMS (one line added to the tail, next to the message; the briefing itself is unchanged):
//   base   Bot as it is today
//   quick  "start at once" line: plan only as much as the message needs
//   short  a default answer length: at most about 6 sentences unless Omri asks for more (a STYLE change: measured, not switched on)
// Run:  node experiments/speed-round2.js arms <rounds> [model] [arm,arm] [q,q]   -> speed-round2-results.json (appended)
//       node experiments/speed-round2.js cache <pairs> [model]   round 1 then the same prompt + a tool result (like a real tool round)
//       node experiments/speed-round2.js table
// The answers' text goes to the scratchpad folder given in SPEED_ANSWERS (default: the OS temp folder), never into the repo.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWarmAgy } = require("../warmagy");

const OUT = path.join(__dirname, "speed-round2-results.json");
const ANSWERS = process.env.SPEED_ANSWERS || path.join(os.tmpdir(), "speed-round2-answers.jsonl");
const BRIEF = fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8");
const { prompt: labPrompt } = require("./speed-lab");

// The head of speed-lab's "big" prompt (brief + time + calendar + courses + course block + talk), with a linked folder added.
const LAB_HEAD = labPrompt("big-short").split("\n\n## Omri's new message")[0];
const FOLDER = "## Omri's linked folder for Systems Programming\nC:\\Users\\omri\\Documents\\spl\\mission2 (read with project_read / project_files): main.c (2.1 KB, changed 20 min ago), list.c (3.4 KB, changed 20 min ago), list.h, Makefile";
const HEAD = LAB_HEAD.replace("## Omri's courses in Bot\n- Calculus 2 (12 files)\n- Algorithms (5 files)", "## Omri's courses in Bot\n- Calculus 2 (12 files)\n- Algorithms (5 files)\n- Systems Programming (8 files, linked folder)") + "\n\n" + FOLDER;
if (!HEAD.startsWith(BRIEF)) throw new Error("the lab head must start with the real briefing");

const Q = {
  math: "ok so for sum k*x^k / 2^k i got R=2 but what do i do at the end points? i'm stuck",
  tool: "my main.c in spl crashes with a segfault when I add the second node, can you look why?",
  cal: "what do I have tomorrow? and remind me 30 minutes before the lecture",
  // two HARDER ones, where too little thinking would show as a wrong answer:
  trap: "for sum k*x^k/2^k (R=2), at x=-2 it converges by Leibniz right? the signs alternate", // wrong: k*(-1)^k does not go to 0, so it diverges
  // several things in one message (Omri's core wish): a reminder AND a math answer, both must be done
  multi: "remind me tomorrow at 9 to submit sheet 7, and btw what's the radius of sum x^k/3^k",
  pval: "for which p does sum from k=2 of 1/(k (ln k)^p) converge? just the answer and why in a line or two", // p > 1 (integral test)
};
const LINE = {
  base: "",
  quick: "\n(Answer at once. Plan only as much as this message needs: a clear question or a clear tool call needs almost no planning. Then write.)",
  short: "\n(Keep this reply to at most about 6 short sentences unless Omri asks for more detail.)",
};
// quicktop: the same "start at once" rule, but as a rule in the briefing ("How to behave"), where a real change would put it.
const TOP_RULE = "- Omri waits for your first words. Plan only as much as the message needs: a clear question or a clear tool call needs almost no planning. Then write.\n";
LINE.quicktop = "";
const build = (q, arm) => `${arm === "quicktop" ? HEAD.replace("## How to behave\n\n", "## How to behave\n\n" + TOP_RULE) : HEAD}\n\n## Omri's new message\n<message>\n${Q[q]}\n</message>${LINE[arm]}`;

async function call(pool, model, text) {
  pool.warmUp(model, null);
  const spare = pool._spares.get(model + "|");
  for (let i = 0; i < 150 && spare && !spare.ready; i++) await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  let first = null, usage = null, answer = "", error = null;
  try {
    answer = await pool.askText(text, model, (t) => { if (first === null && t) first = Date.now(); }, { timeoutMs: 120000, onUsage: (u) => { usage = u; } });
  } catch (e) { error = String(e.message).slice(0, 160); }
  const s = (t) => (t ? +((t - t0) / 1000).toFixed(2) : null);
  return { seconds: s(Date.now()), firstText: s(first), chars: String(answer || "").length, calls: (String(answer).match(/^\s*CALL\s*\{.*$/gm) || []).map((l) => (l.match(/"tool"\s*:\s*"(\w+)"/) || [])[1] || "?"), usage, error, answer };
}

function save(rows, row) {
  const { answer, ...nums } = row;
  rows.runs.push(nums);
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  fs.appendFileSync(ANSWERS, JSON.stringify({ kind: row.kind, arm: row.arm, q: row.q, model: row.model, round: row.round, answer }) + "\n");
  const u = row.usage || {};
  console.error(`${row.kind} ${row.model} ${String(row.arm).padEnd(6)} ${String(row.q).padEnd(5)} ${String(row.seconds).padStart(5)} s first ${row.firstText} out ${u.output} think ${u.thinking} cache ${u.cacheRead} calls ${row.calls.join(",") || "-"} ${row.error || ""}`);
}
const load = () => (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { runs: [] });

async function arms(rounds, model, armList, qList) {
  const rows = load();
  const pool = createWarmAgy({ keepReady: false, agent: true });
  try {
    for (let r = 0; r < rounds; r++) for (let qi = 0; qi < qList.length; qi++) {
      const q = qList[qi];
      const order = armList.map((_, i) => armList[(i + r + qi) % armList.length]); // the order of the arms rotates
      for (const arm of order) save(rows, { kind: "arms", model, arm, q, round: r, at: new Date().toISOString(), ...(await call(pool, model, build(q, arm))) });
    }
  } finally { pool.closeAll(); }
}

// A real tool round sends the SAME head and tail again with the tool result after it, a few seconds later (brain.js). Does agy/Gemini
// reuse (cache) the repeated part, and is the second call's first word sooner?
async function cache(pairs, model) {
  const rows = load();
  const pool = createWarmAgy({ keepReady: false, agent: true, early: true });
  const result = "## Tool round 1\nYou called: {\"tool\":\"project_read\",\"file\":\"main.c\"}\n<tool-result id=\"x1\">\n" + Array.from({ length: 40 }, (_, i) => `${i + 1}: ${i === 17 ? "  node->next->value = v; // node->next is NULL for the first node" : "  int x" + i + " = " + i + ";"}`).join("\n") + "\n</tool-result id=\"x1\">\n\nContinue: either more CALL lines (only if really needed), or the final reply to Omri.";
  try {
    for (let p = 0; p < pairs; p++) {
      const a = build("tool", "base");
      save(rows, { kind: "cache-a", model, arm: "base", q: "tool", round: p, at: new Date().toISOString(), ...(await call(pool, model, a)) });
      save(rows, { kind: "cache-b", model, arm: "base", q: "tool", round: p, at: new Date().toISOString(), ...(await call(pool, model, a + "\n\n" + result)) });
    }
  } finally { pool.closeAll(); }
}

// The FLOOR: a tiny prompt and a one-word answer. What is left is agy's and Google's own fixed time, not the prompt or the writing.
async function floor(n, model) {
  const rows = load();
  const pool = createWarmAgy({ keepReady: false, agent: true });
  try {
    for (let i = 0; i < n; i++) save(rows, { kind: "floor", model, arm: "tiny", q: "ok", round: i, at: new Date().toISOString(), ...(await call(pool, model, "Reply with the single word OK.")) });
  } finally { pool.closeAll(); }
}

const median = (a) => { const s = a.filter((x) => typeof x === "number").sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
function table() {
  const { runs } = load();
  console.log("| kind | model | arm | q | n | median s | worst s | median first words s | median out | median thinking | median cacheRead | tool calls |\n|---|---|---|---|---|---|---|---|---|---|---|---|");
  const keys = [...new Set(runs.map((r) => [r.kind, r.model, r.arm, r.q].join("|")))];
  for (const k of keys) {
    const g = runs.filter((r) => [r.kind, r.model, r.arm, r.q].join("|") === k && !r.error);
    if (!g.length) continue;
    const u = (f) => Math.round(median(g.map((r) => (r.usage || {})[f] || 0)));
    const calls = {};
    for (const r of g) { const c = r.calls.join("+") || "none"; calls[c] = (calls[c] || 0) + 1; }
    console.log(`| ${k.split("|").join(" | ")} | ${g.length} | ${median(g.map((r) => r.seconds)).toFixed(1)} | ${Math.max(...g.map((r) => r.seconds)).toFixed(1)} | ${median(g.map((r) => r.firstText)).toFixed(1)} | ${u("output")} | ${u("thinking")} | ${u("cacheRead")} | ${Object.entries(calls).map(([c, n]) => `${c} ${n}`).join(", ")} |`);
  }
}

if (require.main === module) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  const fail = (e) => { console.error(e); process.exit(1); };
  if (cmd === "arms") arms(Number(a) || 1, b || "gemini-4-neon-low", c ? c.split(",") : Object.keys(LINE), d ? d.split(",") : Object.keys(Q)).catch(fail);
  else if (cmd === "cache") cache(Number(a) || 1, b || "gemini-4-neon-low").catch(fail);
  else if (cmd === "floor") floor(Number(a) || 1, b || "gemini-4-neon-low").catch(fail);
  else if (cmd === "table") table();
  else console.log("node experiments/speed-round2.js arms <rounds> [model] [arms] [questions] | cache <pairs> [model] | table");
}
module.exports = { build, Q, LINE };
