// experiments/agy-warm.js
// Can a SINGLE-USE pre-warmed agy process cut the front desk time? The idea: start agy BEFORE the message arrives
// (it prints "init" after ~3 s), wait, then write the real prompt on its stdin and read the answer. Each process serves
// exactly one message, so nothing leaks between messages.
//   node experiments/agy-warm.js <model> <idleSeconds> [json|text] [message]
// Prints: seconds until init, seconds from sending the prompt to the result, and the reply.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { buildPrompt, SCHEMA, validateDecision } = require("../frontdesk");
const { SANDBOX_DIR } = require("../providers");

const [model = "gemini-3.8-flash-low", idle = "0", mode = "json", message = "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?"] = process.argv.slice(2);
const brief = fs.readFileSync(path.join(__dirname, "router-brief-short.md"), "utf8");
const TAIL = "\n\nReply with ONLY one JSON object, nothing before or after it, no markdown, with exactly these keys, all string values (\"\" when unused): action, destination, answer, reason, reminderText, remindAt, timezone, fact, replaces, calendarFrom, calendarDays.";
const prompt = buildPrompt(message, { brief }) + (mode === "text" ? TAIL : "");

const agy = process.env.AGY_CMD || path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
const args = ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model];
if (mode === "json") args.push("--json-schema", JSON.stringify(SCHEMA));
fs.mkdirSync(SANDBOX_DIR, { recursive: true });
const t0 = Date.now();
const secs = (t) => ((Date.now() - t) / 1000).toFixed(1);
const child = spawn(agy, args, { cwd: SANDBOX_DIR });
let buf = "";
let tSent = null;
child.stderr.on("data", (d) => process.stderr.write("[stderr] " + String(d).slice(0, 200)));
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    if (e.event === "init") {
      console.log("init after", secs(t0), "s; waiting", idle, "s");
      setTimeout(() => { tSent = Date.now(); child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n"); }, Number(idle) * 1000);
    } else if (e.event === "result") {
      const r = e.result || {};
      let decision = null;
      try { decision = validateDecision(r.structured_output ?? JSON.parse(String(r.response).match(/\{[\s\S]*\}/)[0])); } catch (x) { /* invalid */ }
      console.log("result", tSent ? secs(tSent) : "?", "s after sending;", "status", r.status, "decision", decision ? decision.action + (decision.destination ? "/" + decision.destination : "") : "INVALID");
      child.stdin.end();
      setTimeout(() => child.kill(), 500);
    }
  }
});
child.on("close", () => console.log("closed after", secs(t0), "s total"));
