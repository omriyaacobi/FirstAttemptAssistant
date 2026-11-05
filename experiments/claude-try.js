// Quick check of `claude -p` with the token from the MAIN checkout's .env (a worktree has no .env). Prints no secrets.
const fs = require("node:fs");
const { exec } = require("node:child_process");
const { CLAUDE_CMD, SANDBOX_DIR } = require("../providers");
const line = fs.readFileSync("C:/Claude Code Project/FirstAttemptAssistant/.env", "utf8").split(/\r?\n/).find((l) => l.startsWith("CLAUDE_CODE_OAUTH_TOKEN="));
const token = line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, "");
fs.mkdirSync(SANDBOX_DIR, { recursive: true });
const extra = process.argv[3] || "";
const t = Date.now();
const c = exec(`${CLAUDE_CMD} -p --model ${process.argv[2] || "haiku"} --tools "" --no-session-persistence --output-format json ${extra}`, { cwd: SANDBOX_DIR, env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token } }, (e, o, er) => {
  const j = (() => { try { return JSON.parse(o); } catch (x) { return null; } })();
  console.log(((Date.now() - t) / 1000).toFixed(1) + "s", j ? JSON.stringify({ result: String(j.result).slice(0, 200), is_error: j.is_error, usage: j.usage && { in: j.usage.input_tokens, out: j.usage.output_tokens, cacheRead: j.usage.cache_read_input_tokens, cacheWrite: j.usage.cache_creation_input_tokens }, cost: j.total_cost_usd, models: Object.keys(j.modelUsage || {}), ms: j.duration_ms, api_ms: j.duration_api_ms }) : (o || er).slice(0, 300));
});
c.stdin.end("Reply with just OK");
