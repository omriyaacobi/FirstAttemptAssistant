// experiments/claude-lab.js : a flexible `claude -p` call for front desk experiments (no secrets printed).
// call({ user, schema, systemFile, systemMode: "append"|"replace", model, flags }) -> { seconds, raw, error, usage, apiMs, turns, text }
const fs = require("node:fs");
const { exec } = require("node:child_process");
const { CLAUDE_CMD, SANDBOX_DIR } = require("../providers");
const line = fs.readFileSync("C:/Claude Code Project/FirstAttemptAssistant/.env", "utf8").split(/\r?\n/).find((l) => l.startsWith("CLAUDE_CODE_OAUTH_TOKEN="));
const TOKEN = line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, "");

function call({ user, schema, systemFile, systemMode = "append", model = "haiku", flags = "", timeout = 120000 }) {
  return new Promise((resolve) => {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const t0 = Date.now();
    let cmd = `${CLAUDE_CMD} -p --model ${model} --tools "" --no-session-persistence --output-format json`;
    if (schema) cmd += ` --json-schema "${JSON.stringify(schema).replace(/"/g, '\\"')}"`;
    if (systemFile) cmd += ` --${systemMode === "replace" ? "system-prompt-file" : "append-system-prompt-file"} "${systemFile}"`;
    cmd += " " + flags;
    const c = exec(cmd, { cwd: SANDBOX_DIR, maxBuffer: 1e8, timeout, env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }, (e, o, er) => {
      const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
      let j = null; try { j = JSON.parse(o); } catch (x) { /* not json */ }
      resolve({
        seconds, error: j ? (j.is_error ? String(j.result).slice(0, 150) : null) : String(e ? e.message : "no json").slice(0, 150) + " " + String(er).slice(0, 100),
        raw: j && !j.is_error ? (j.structured_output ?? (() => { try { return JSON.parse(String(j.result).trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (x) { return null; } })()) : null,
        text: j && j.result, usage: j && j.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens, cacheRead: j.usage.cache_read_input_tokens, cacheWrite: j.usage.cache_creation_input_tokens } : null,
        apiMs: j && j.duration_api_ms, turns: j && j.num_turns, cost: j && j.total_cost_usd,
      });
    });
    c.stdin.end(user);
  });
}
process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN; // so Bot's own claudeEnv() works in a worktree that has no .env (the token is never printed)
module.exports = { call };
