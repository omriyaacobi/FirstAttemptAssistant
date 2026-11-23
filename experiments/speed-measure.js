// experiments/speed-measure.js (2026-11-23, t19)
// Reads Bot's real thread files (data/thread/*.jsonl) and prints NUMBERS ONLY (no message text): where the time of an answer goes.
//   node experiments/speed-measure.js [dataDir] [fromDay]
// dataDir defaults to ../data next to this repo's main checkout (worktrees have no data/). fromDay like 2026-11-17.
// For each brain answer:
//   total   = result.seconds (from "message taken" to "answer ready"; the brain's own clock)
//   models  = the sum of every model call's seconds (result.timing.attempts, failed tries too)
//   other   = total - models: building the prompt (calendar, pools), running the tools, waiting for a slot
//   e2e     = assistant.at - user.at (what Omri really waits, queue included)
//   gap     = minutes since Omri's previous message (a gap over 8 minutes means the waiting agy spare had expired: a cold start)
const fs = require("node:fs");
const path = require("node:path");

const dataDir = process.argv[2] || path.join(__dirname, "..", "..", "..", "..", "data");
const fromDay = process.argv[3] || "2026-11-17";
const dir = path.join(dataDir, "thread");
const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f) && f.slice(0, 10) >= fromDay).sort();

const rows = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byId = new Map(lines.map((m) => [m.id, m]));
  const users = lines.filter((m) => m.role === "user").sort((a, b) => a.at - b.at);
  for (const m of lines) {
    const r = m.result;
    if (m.role !== "assistant" || !r || !r.brain || typeof r.seconds !== "number") continue;
    const u = m.replyTo ? byId.get(m.replyTo) : null;
    const prev = u ? users.filter((x) => x.at < u.at).pop() : null;
    const attempts = (r.timing && r.timing.attempts) || [];
    const models = attempts.reduce((a, x) => a + (x.seconds || 0), 0);
    const log = Array.isArray(m.log) ? m.log : [];
    const callLine = log.find((l) => /answered by .* model calls? \(/.test(l)) || "";
    const per = (callLine.match(/model calls? \(([^)]*)\)/) || [, ""])[1].split(",").map((s) => parseFloat(s)).filter((n) => !isNaN(n));
    rows.push({
      day: f.slice(0, 10),
      model: (r.used && r.used.model) || "?",
      mode: r.mode,
      total: r.seconds,
      models,
      other: Math.max(0, r.seconds - models),
      e2e: u ? (m.at - u.at) / 1000 : null,
      gapMin: u && prev ? (u.at - prev.at) / 60000 : null,
      calls: per.length || attempts.length,
      per,
      failed: attempts.filter((x) => x.ok === false).length,
      tools: (r.tools || []).length,
      toolNames: r.tools || [],
      rounds: log.filter((l) => l === "[brain] thinking about what came back").length,
      tokens: r.tokens || 0,
      photo: log.some((l) => /photo/i.test(l) && /\[brain\]/.test(l)),
      queued: log.some((l) => l.startsWith("[queue] waiting")),
      choice: log.some((l) => l.startsWith("[brain] your choice")),
      web: /web search step/.test(callLine),
    });
  }
}

const q = (xs, p) => { const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const f1 = (x) => (isNaN(x) ? "-" : x.toFixed(1));
function table(title, groups) {
  console.log(`\n## ${title}\n| group | n | median total s | p90 total | median model s | median other s | median e2e s | median calls | median tokens |\n|---|---|---|---|---|---|---|---|---|`);
  for (const [name, g] of groups) {
    if (!g.length) continue;
    console.log(`| ${name} | ${g.length} | ${f1(q(g.map((r) => r.total), 0.5))} | ${f1(q(g.map((r) => r.total), 0.9))} | ${f1(q(g.map((r) => r.models), 0.5))} | ${f1(q(g.map((r) => r.other), 0.5))} | ${f1(q(g.map((r) => r.e2e), 0.5))} | ${q(g.map((r) => r.calls), 0.5)} | ${Math.round(q(g.map((r) => r.tokens), 0.5))} |`);
  }
}
const group = (key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };

console.log(`Brain answers from ${fromDay}: ${rows.length} (days ${files.map((f) => f.slice(5, 10)).join(", ")})`);
table("All", [["all", rows]]);
table("By model that answered", group((r) => r.model));
table("By number of model calls", group((r) => (r.calls >= 4 ? "4+" : String(r.calls)) + " call(s)"));
table("By kind", group((r) => (r.photo ? "photo" : r.mode === "study" ? "study tool (quiz/lesson)" : r.tools ? "tools" : "direct")));
table("By gap since the previous message (cold = spare expired after 8 min)", group((r) => (r.gapMin === null ? "first of the day" : r.gapMin > 8 ? "gap > 8 min" : "gap <= 8 min")));
table("With a failed model try", group((r) => (r.failed ? "a model failed first" : "no failure")));
table("Web search inside agy", group((r) => (r.web ? "web search" : "no web search")));

// Single model calls: how long ONE call takes, per model, split by first call of a message vs later rounds.
const perCall = new Map();
for (const r of rows) r.per.forEach((s, i) => { const k = `${r.model} ${i === 0 ? "1st call" : "later call"}`; if (!perCall.has(k)) perCall.set(k, []); perCall.get(k).push(s); });
console.log("\n## One model call (from the 'answered by' line, 2026-11-20 on)\n| model, call | n | median s | p90 s | max s |\n|---|---|---|---|---|");
for (const [k, xs] of [...perCall.entries()].sort()) console.log(`| ${k} | ${xs.length} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.9))} | ${f1(Math.max(...xs))} |`);

// Cold vs warm first call, Neon low / Hydrogen medium only (WARM_MODELS).
const firstBy = (cond) => rows.filter((r) => r.per.length && cond(r)).map((r) => r.per[0]);
console.log("\n## First call, by gap (spare kept 8 minutes)");
for (const m of ["gemini-4-neon-low", "gemini-4-hydrogen-medium", "gemini-4-argon-low"]) {
  const warm = firstBy((r) => r.model === m && r.gapMin !== null && r.gapMin <= 8 && !r.failed);
  const cold = firstBy((r) => r.model === m && (r.gapMin === null || r.gapMin > 8) && !r.failed);
  console.log(`${m}: gap<=8 min median ${f1(q(warm, 0.5))} s (n ${warm.length}); gap>8 min median ${f1(q(cold, 0.5))} s (n ${cold.length})`);
}
const gaps = rows.map((r) => r.gapMin).filter((x) => x !== null);
console.log(`\nGaps between messages: ${gaps.length}, over 8 min: ${gaps.filter((g) => g > 8).length} (${Math.round(100 * gaps.filter((g) => g > 8).length / gaps.length)}%)`);

// Which tools show up, and how often a message needed a second round at all.
const toolCount = new Map();
for (const r of rows) for (const t of new Set(r.toolNames)) toolCount.set(t, (toolCount.get(t) || 0) + 1);
console.log("\n## Tools (messages that used each)\n" + [...toolCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", "));
const lookup = rows.filter((r) => r.rounds > 0);
console.log(`\nMessages with at least one more round after tools: ${lookup.length} of ${rows.length}; share of all waiting time in those: ${Math.round(100 * lookup.reduce((a, r) => a + r.total, 0) / rows.reduce((a, r) => a + r.total, 0))}%`);
const firstTools = new Map();
for (const r of lookup) { const k = r.toolNames.slice(0, 1).join(); firstTools.set(k, (firstTools.get(k) || 0) + 1); }
console.log("First tool asked in those: " + [...firstTools.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", "));
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(rows.map(({ toolNames, ...r }) => ({ ...r, toolNames })), null, 1));
