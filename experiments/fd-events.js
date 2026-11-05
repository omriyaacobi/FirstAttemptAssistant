// Dumps agy's event stream for one real front desk call, with arrival times. Usage: node experiments/fd-events.js "message" [model]
const { spawn } = require("node:child_process");
const { buildPrompt, SCHEMA } = require("../frontdesk");
const { SANDBOX_DIR } = require("../providers");
const msg = process.argv[2] || "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?";
const model = process.argv[3] || "gemini-3.8-flash-medium";
const t0 = Date.now();
const c = spawn(process.env.AGY_CMD || require("node:path").join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe"), ["-p", buildPrompt(msg), "--model", model, "--output-format", "stream-json", "--json-schema", JSON.stringify(SCHEMA)], { cwd: SANDBOX_DIR });
let buf = "";
c.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const e = JSON.parse(l); if (e.event === "init") e.init = "(init omitted)"; console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(e).slice(0, 900)); } });
c.on("close", () => console.log("closed", ((Date.now() - t0) / 1000).toFixed(1)));
c.stdin.end();
