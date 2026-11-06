// experiments/argon-run.js
// Runs ONE Improve Bot request through the real selfedit.js flow, but on a THROWAWAY clone of the project, never the real one.
// Usage: node experiments/argon-run.js <name> "<request>" [follow-up message] [--model argon|sonnet]
// Env: ARGON_MODEL=gemini-4-argon-medium to try another effort. Prints a JSON summary line at the end.
// Everything lands in <scratch>/argon-runs/<name>/ (clone, private copies). Nothing is merged or pushed anywhere.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSelfEdit, makeArgonEditor, ARGON_MODEL } = require("../selfedit");

const args = process.argv.slice(2);
const mi = args.indexOf("--model");
const model = mi >= 0 ? args.splice(mi, 2)[1] : "argon";
const [name, request, followUpText] = args;
const base = path.join(process.env.ARGON_RUNS || path.join(os.tmpdir(), "argon-runs"), name);
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const clone = path.join(base, "project");
execFileSync("git", ["clone", "-q", path.resolve(__dirname, ".."), clone]);
execFileSync("git", ["config", "user.name", "Test"], { cwd: clone });
execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: clone });

const effort = process.env.ARGON_MODEL || ARGON_MODEL;
const real = makeArgonEditor();
const manager = createSelfEdit({
  repoDir: clone,
  dataDir: path.join(clone, "data"),
  workRoot: path.join(base, "work"),
  argonEditor: (a) => real({ ...a, model: effort }),
  lowPools: async () => [],
});

(async () => {
  const t0 = Date.now();
  const out = [];
  const summarize = (label, r, seconds) => ({
    label, status: r.status, note: r.note, seconds, editorSeconds: r.editorSeconds,
    files: (r.files || []).map((f) => f.status + " " + f.path), attempts: (r.attempts || []).length,
    tests: r.tests && { ok: r.tests.ok, total: r.tests.total, baseline: r.tests.baselineTotal }, blocked: r.blocked, summary: (r.summary || "").slice(0, 400),
  });
  const { record, finished } = await manager.start(request, { model });
  const seen = new Set();
  const poll = setInterval(() => { const r = manager.get(record.id); for (const p of (r && r.progress) || []) if (!seen.has(p.at + p.text)) { seen.add(p.at + p.text); console.log(`[${((p.at - t0) / 1000).toFixed(0)}s] ${p.text}`); } }, 1000);
  const done = await finished;
  clearInterval(poll);
  out.push(summarize("start", done, Number(((Date.now() - t0) / 1000).toFixed(1))));
  if (followUpText && done.status === "ready") {
    const t1 = Date.now();
    const { finished: f2 } = await manager.followUp(record.id, followUpText);
    const d2 = await f2;
    out.push(summarize("follow-up", d2, Number(((Date.now() - t1) / 1000).toFixed(1))));
  }
  console.log("RESULT " + JSON.stringify(out, null, 1));
  const last = manager.get(record.id);
  if (last && last.diff) fs.writeFileSync(path.join(base, "diff.patch"), last.diff);
  console.log("DIFF saved to " + path.join(base, "diff.patch"));
  setTimeout(() => process.exit(0), 3000);
})().catch((e) => { console.log("CRASH " + e.stack); process.exit(1); });
