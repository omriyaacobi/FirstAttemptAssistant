// experiments/quota-max-steps.js
// What does agy do INSIDE one call? Prints every step of one call (model turn, tool call ...) and the tokens it cost.
// THIS SPENDS QUOTA (one small call).
//
//   node experiments/quota-max-steps.js <agy model> "<prompt>" [--no-agent]
//
// Why: one agy call can hold several model turns (the model calls a tool such as search_web, reads the result, answers), and
// every turn sends the whole prompt again. The token numbers of a call only make sense when the steps are known.

const { spawn } = require("node:child_process");
const { sandbox, ensureAgent, AGY_CMD, readUsage } = (() => { const p = require("../providers"); const fs = require("node:fs"); return { ...p, sandbox: () => { fs.mkdirSync(p.SANDBOX_DIR, { recursive: true }); return p.SANDBOX_DIR; } }; })();

const [model, prompt] = process.argv.slice(2);
const noAgent = process.argv.includes("--no-agent");
if (!/^[\w.-]+$/.test(model || "") || !prompt) { console.error('usage: node quota-max-steps.js <model> "<prompt>" [--no-agent]'); process.exit(1); }

const cwd = sandbox();
const args = ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model];
if (!noAgent) args.push("--agent", ensureAgent(cwd));
const child = spawn(AGY_CMD, args, { cwd, windowsHide: true });
let buffer = "";
const steps = new Map(); // step_index -> { type, chars }
child.stderr.on("data", () => {});
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    let e; try { e = JSON.parse(line); } catch (error) { continue; }
    if (e.event === "init") child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
    const u = e.step_update;
    if (e.event === "step_update" && u) {
      const s = steps.get(u.step_index) || { type: u.step_type, chars: 0, extra: "" };
      s.chars += (u.text_delta || "").length;
      for (const k of Object.keys(u)) if (!["step_index", "step_type", "state", "text_delta"].includes(k) && !s.extra.includes(k)) s.extra += ` ${k}=${JSON.stringify(u[k]).slice(0, 80)}`;
      steps.set(u.step_index, s);
    }
    if (e.event === "result") {
      for (const [n, s] of [...steps].sort((a, b) => a[0] - b[0])) console.log(`step ${n}: ${s.type}${s.chars ? ` (${s.chars} chars of text)` : ""}${s.extra}`);
      console.log("status:", e.result && e.result.status, "| tokens:", JSON.stringify(readUsage(e.result && e.result.usage)), "| answer:", String((e.result && e.result.response) || "").replace(/\s+/g, " ").slice(0, 160));
      try { child.kill(); } catch (error) { /* gone */ }
      process.exit(0);
    }
  }
});
setTimeout(() => { console.log("timeout"); try { child.kill(); } catch (error) { /* gone */ } process.exit(1); }, 120000);
