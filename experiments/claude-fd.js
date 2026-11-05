// One front desk call through `claude -p` (Haiku etc.) with the JSON schema. Used by the experiments. Prints no secrets.
const fs = require("node:fs");
const { exec } = require("node:child_process");
const { CLAUDE_CMD, SANDBOX_DIR } = require("../providers");
const { SCHEMA } = require("../frontdesk");

function token() {
  const line = fs.readFileSync("C:/Claude Code Project/FirstAttemptAssistant/.env", "utf8").split(/\r?\n/).find((l) => l.startsWith("CLAUDE_CODE_OAUTH_TOKEN="));
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, "");
}
const TOKEN = token();

// Returns { seconds, error, raw (the structured object or null), usage, cost, apiMs }
function claudeFrontDesk(prompt, model = "haiku", extraFlags = "") {
  return new Promise((resolve) => {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const t0 = Date.now();
    const schema = JSON.stringify(SCHEMA).replace(/"/g, '\\"');
    const cmd = `${CLAUDE_CMD} -p --model ${model} --tools "" --no-session-persistence --output-format json --json-schema "${schema}" ${extraFlags}`;
    const c = exec(cmd, { cwd: SANDBOX_DIR, maxBuffer: 1e8, timeout: 120000, env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }, (e, o, er) => {
      const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
      let j = null; try { j = JSON.parse(o); } catch (x) { /* not json */ }
      resolve({
        seconds, error: j ? (j.is_error ? String(j.result).slice(0, 150) : null) : String(e ? e.message : "no json").slice(0, 150),
        raw: j && !j.is_error ? (j.structured_output ?? (() => { try { return JSON.parse(j.result); } catch (x) { return null; } })()) : null,
        usage: j && j.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens, cacheRead: j.usage.cache_read_input_tokens, cacheWrite: j.usage.cache_creation_input_tokens } : null,
        cost: j && j.total_cost_usd, apiMs: j && j.duration_api_ms, ms: j && j.duration_ms, model: j && Object.keys(j.modelUsage || {})[0],
      });
    });
    c.stdin.end(prompt);
  });
}
module.exports = { claudeFrontDesk };
if (require.main === module) {
  const { buildPrompt, validateDecision } = require("../frontdesk");
  const brief = fs.readFileSync(__dirname + "/router-brief-short.md", "utf8");
  claudeFrontDesk(buildPrompt(process.argv[2] || "מה השעה בניו יורק עכשיו?", { brief }), process.argv[3] || "haiku").then((r) => console.log(JSON.stringify({ ...r, decision: validateDecision(r.raw) })));
}
