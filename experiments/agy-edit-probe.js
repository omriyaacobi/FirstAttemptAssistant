// experiments/agy-edit-probe.js
// Runs ONE agy edit in a given folder and prints every event type, every tool call, the answer and the usage.
// Usage: node experiments/agy-edit-probe.js <folder> <model> <prompt-file> [extra agy flags...]
// It never uses --dangerously-skip-permissions. Used for experiments/2026-11-06-improve-argon.md.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const [folder, model, promptFile, ...extra] = process.argv.slice(2);
if (extra.includes("--dangerously-skip-permissions")) throw new Error("never");
const AGY = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const prompt = fs.readFileSync(promptFile, "utf8");
const args = ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model, ...extra];
const started = Date.now();
const child = spawn(AGY, args, { cwd: folder, windowsHide: true });
let buf = "";
const kinds = {};
child.stderr.on("data", (d) => process.stderr.write("[stderr] " + d));
child.stdout.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    if (e.event === "init") { child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n"); continue; }
    const u = e.step_update;
    const k = e.event + (u ? ":" + u.step_type + (u.status ? ":" + u.status : "") : "");
    kinds[k] = (kinds[k] || 0) + 1;
    if (u && u.step_type !== "agent_response") console.log("STEP", JSON.stringify(u).slice(0, 400));
    if (e.event === "result") {
      console.log("RESULT", JSON.stringify(e.result).slice(0, 1500));
      console.log("KINDS", JSON.stringify(kinds));
      console.log("SECONDS", ((Date.now() - started) / 1000).toFixed(1));
      child.kill(); setTimeout(() => process.exit(0), 300);
    }
  }
});
setTimeout(() => { console.log("TIMEOUT"); child.kill(); process.exit(1); }, 5 * 60 * 1000);
