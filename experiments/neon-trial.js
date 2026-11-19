// Neon trial (2026-11-19): Argon low/medium, Neon low/medium, Hydrogen medium, and Orchestrator (Neon) if it can be called.
// Same blind-question kinds as hydrogen-round3.js (hard math, C++, tool calls in the brain's CALL format, Hebrew, the unclear
// timetable photo, one tutor grading). Everything is invented (no data/ read, the repo is public).
// Before and after each model's batch it reads agy /usage, to see WHICH POOL moves.
// Run: node experiments/neon-trial.js <model-id> [...]    e.g. gemini-4-neon-low
//      node experiments/neon-trial.js blind               (writes neon-trial-blind.md + key, no model calls)
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { brainRun, HARD, TUTOR } = require("./hydrogen-round3");
const { TESTS: OLD } = require("./hydrogen-contest");
const { usage } = require("./hydrogen-contest");
const { parseReply, withoutCalls, leaksPrompt } = require("../brain");
const { gradeAnswer } = require("../tutor");
const { ask } = require("../providers");

const DIR = __dirname;
const FILE = path.join(DIR, "neon-trial-results.json");
const pick = (id) => HARD.find((t) => t.id === id);
const old = (id) => OLD.find((t) => t.id === id);
const BRAIN_TESTS = [pick("m-hard-integral"), pick("cpp-slicing"), pick("m-la-param"), old("tool-reminder-he"), old("he-geometric"), old("photo-moved")];
const TQ = { q: "Use the ratio test to decide whether the series sum_{n=1}^inf n^2 / 2^n converges.", key: "ratio -> 1/2 < 1, converges" };
const MATERIAL = { block: '<course-material id="m1">\n[S1] lecture6.pdf, page 3\nRatio test: if lim |a_{n+1}/a_n| = L exists, the series converges when L < 1 and diverges when L > 1; L = 1 says nothing.\n</course-material id="m1">' };
const TUTOR_TEST = TUTOR.find((t) => t.id === "grade-partly");

const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { usage: {}, runs: [] });
const save = (r) => fs.writeFileSync(FILE, JSON.stringify(r, null, 2));
const tok = (u) => (u ? u.input + u.output + u.thinking : 0);

async function runModel(model) {
  const results = load();
  results.usage["before " + model] = usage();
  console.error("before", model + ":", results.usage["before " + model].join(" | "));
  for (const t of BRAIN_TESTS) {
    const t0 = Date.now();
    let row;
    try {
      const { text, rounds } = await brainRun(model, t);
      let ok = null;
      if (t.ok) { try { ok = !!t.ok(text) && !leaksPrompt(text); } catch (e) { ok = false; } }
      row = { text, rounds, ok, calls: parseReply(text).calls, seconds: +rounds.reduce((a, r) => a + r.seconds, 0).toFixed(1), tokens: rounds.reduce((a, r) => a + tok(r.usage), 0), thinking: rounds.reduce((a, r) => a + (r.usage ? r.usage.thinking : 0), 0) };
    } catch (error) { row = { error: String(error.message).slice(0, 300), ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1) }; }
    results.runs.push({ model, test: t.id, ...row });
    save(results);
    console.error(`${model} / ${t.id}: ${row.seconds}s, ${row.rounds ? row.rounds.length : 1} call(s), ${row.tokens || 0} tokens (${row.thinking || 0} thinking), ${row.ok === null ? "hand" : row.ok ? "OK" : "FAIL"}${row.error ? " ERROR " + row.error.slice(0, 100) : ""}`);
  }
  { // tutor: the real gradeAnswer prompt
    const t0 = Date.now(); let spent = null, row;
    try {
      const askChain = async (chain, prompt) => ({ answer: await ask("agy", model, prompt, () => {}, { onUsage: (u) => { spent = u; }, timeoutMs: 240000 }), used: { provider: "agy", model } });
      const r = await gradeAnswer({ askChain, q: TQ, answer: TUTOR_TEST.answer, material: MATERIAL, lang: "en" });
      row = { text: JSON.stringify(r), ok: r.verdict === TUTOR_TEST.expect, seconds: +((Date.now() - t0) / 1000).toFixed(1), tokens: tok(spent), thinking: spent ? spent.thinking : 0 };
    } catch (error) { row = { error: String(error.message).slice(0, 300), ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1) }; }
    results.runs.push({ model, test: "tutor-grade-partly", ...row });
    save(results);
    console.error(`${model} / tutor-grade-partly: ${row.seconds}s, ${row.tokens || 0} tokens, ${row.ok ? "OK" : "FAIL"}${row.error ? " ERROR " + row.error.slice(0, 100) : ""}`);
  }
  results.usage["after " + model] = usage();
  console.error("after", model + ":", results.usage["after " + model].join(" | "));
  save(results);
}

// Blind file for the hand-graded answers (proof/system, Hebrew, photo): letters shuffled per test; key in a separate file.
function writeBlind() {
  const runs = load().runs;
  const key = {};
  let md = "# Neon trial answers, BLIND\n";
  for (const t of BRAIN_TESTS) {
    const rows = runs.filter((r) => r.test === t.id).map((r) => ({ r, k: crypto.randomBytes(4).readUInt32LE() })).sort((a, b) => a.k - b.k).map((x) => x.r);
    md += `\n\n## ${t.id}\nQuestion: ${String(t.message).split("\n")[0]}\n${t.key ? "Reference: " + t.key + "\n" : ""}`;
    rows.forEach((r, i) => { const label = `${t.id}:${String.fromCharCode(65 + i)}`; key[label] = r.model; md += `\n### ${label}\n${r.error ? "(ERROR) " + r.error : (r.text ? withoutCalls(r.text).slice(0, 1500) + "\nCALLS: " + JSON.stringify(r.calls).slice(0, 700) : "")}\n`; });
  }
  fs.writeFileSync(path.join(DIR, "neon-trial-blind.md"), md);
  fs.writeFileSync(path.join(DIR, "neon-trial-key.json"), JSON.stringify(key, null, 2));
  console.error("blind written", Object.keys(key).length);
}

module.exports = { BRAIN_TESTS };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "blind") writeBlind();
  else if (!args.length) console.error("usage: node experiments/neon-trial.js <model-id>... | blind");
  else (async () => { for (const m of args) await runModel(m); })();
}
