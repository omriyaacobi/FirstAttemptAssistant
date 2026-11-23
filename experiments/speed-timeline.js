// experiments/speed-timeline.js (2026-11-23, t19 round 2): WHAT HAPPENS INSIDE one agy call, second by second.
// Starts agy exactly like Bot's brain does (slim agent, stream-json, no shell, no --dangerously-skip-permissions), waits for "init"
// (outside the timing, like a warm spare), writes one invented prompt and records every event agy prints: its kind, the step type,
// which fields it carries (never the text) and the time since the prompt was written.
// Run: node experiments/speed-timeline.js [model] [prompt-kind]     prompt-kind: short | long (from speed-lab.js)
const { spawn } = require("node:child_process");
const { AGY_CMD, BRAIN_DIR, ensureAgent } = require("../providers");
const { prompt } = require("./speed-lab");

function timeline(model, kind) {
  return new Promise((resolve) => {
    const args = ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model, "--agent", ensureAgent(BRAIN_DIR)];
    const child = spawn(AGY_CMD, args, { cwd: BRAIN_DIR, windowsHide: true });
    const born = Date.now();
    let t0 = null, buf = "";
    const rows = [];
    child.stdout.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        const at = t0 === null ? -1 : (Date.now() - t0) / 1000;
        const u = e.step_update || {};
        rows.push({ at: +at.toFixed(2), event: e.event, step: u.step_type, idx: u.step_index, keys: Object.keys(u).filter((k) => !/^step_(type|index)$/.test(k)).join(","), deltaLen: (u.text_delta || u.thinking_delta || "").length || undefined });
        if (e.event === "init" && t0 === null) {
          rows[rows.length - 1].startup = +((Date.now() - born) / 1000).toFixed(2);
          setTimeout(() => { t0 = Date.now(); child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt(kind) } }) + "\n"); }, 300);
        }
        if (e.event === "result") { rows.push({ usage: (e.result || {}).usage }); child.kill(); resolve(rows); }
      }
    });
    setTimeout(() => { child.kill(); resolve(rows); }, 120000);
  });
}

if (require.main === module) {
  const [model = "gemini-4-neon-low", kind = "big-long"] = process.argv.slice(2);
  timeline(model, kind).then((rows) => {
    // collapse runs of the same (event, step, keys) into one line: first time, last time, count, characters
    const out = [];
    for (const r of rows) {
      const k = `${r.event}|${r.step}|${r.keys}`;
      const last = out[out.length - 1];
      if (last && last.k === k && r.at !== undefined) { last.to = r.at; last.n++; last.chars += r.deltaLen || 0; } else out.push({ k, from: r.at, to: r.at, n: 1, chars: r.deltaLen || 0, startup: r.startup, usage: r.usage });
    }
    for (const o of out) console.log(o.usage ? "usage " + JSON.stringify(o.usage) : `${String(o.from).padStart(6)} -> ${String(o.to).padStart(6)} s  x${o.n}  ${o.k}${o.chars ? "  chars " + o.chars : ""}${o.startup ? "  startup " + o.startup + " s" : ""}`);
  });
}
module.exports = { timeline };
