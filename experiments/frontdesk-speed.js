// experiments/frontdesk-speed.js
// Measures where the front desk's time goes. Not part of Bot itself.
//   node experiments/frontdesk-speed.js size
//   node experiments/frontdesk-speed.js run <variant> <times> ["message"] [out.json]
// Variants: trivial (say OK), full (today's prompt + JSON schema), fullplain (today's prompt, plain text
// reply "action|destination"), triviaschema (tiny prompt + the real schema), stream (full, with agy's event stream).
// Runs one call after another (never in parallel) so the runs do not slow each other down.

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { buildPrompt, SCHEMA, validateDecision } = require("../frontdesk");
const { aboutBlock } = require("../profile");
const { SANDBOX_DIR } = require("../providers");

const AGY = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const MODEL = process.env.FD_MODEL || "gemini-3.8-flash-medium";
// The real profile lives in the main checkout's data folder (git-ignored); the worktree has none.
const PROFILE = process.env.FD_PROFILE || "C:\\Claude Code Project\\FirstAttemptAssistant\\data\\profile.md";
const MESSAGE = "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?";

const about = aboutBlock({ profileFile: PROFILE, memory: { list: () => [] }, numbered: true });
const realPrompt = (message, opts = {}) => buildPrompt(message, { about, ...opts });

function sizes(message) {
  const brief = fs.readFileSync(path.join(__dirname, "..", "router-brief.md"), "utf8");
  const full = realPrompt(message);
  console.log(JSON.stringify({
    briefChars: brief.length, profileBlockChars: about.length, fullPromptChars: full.length,
    schemaChars: JSON.stringify(SCHEMA).length, approxTokensPrompt: Math.round(full.length / 4),
  }, null, 2));
}

function agy(args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const child = execFile(AGY, args, { cwd: SANDBOX_DIR, maxBuffer: 1e8, timeout: 200000 }, (error, stdout, stderr) => {
      resolve({ seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), error: error ? String(error.message).slice(0, 120) : null, stdout, stderr });
    });
    child.stdin && child.stdin.end();
  });
}

const PLAIN_TAIL = "\n\nReply with ONLY one line: action|destination (for example delegate|gemini-flash, or answer|none). No other text.";

async function once(variant, message) {
  if (variant === "trivial") {
    const r = await agy(["-p", "Reply with just OK", "--model", MODEL]);
    return { seconds: r.seconds, error: r.error, out: r.stdout.trim().slice(0, 40) };
  }
  if (variant === "tinyschema") {
    const r = await agy(["-p", "Reply with action answer, destination none, and empty strings for all other fields.", "--model", MODEL, "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)]);
    return { seconds: r.seconds, error: r.error, out: r.stdout.trim().slice(0, 60) };
  }
  if (variant === "fullplain") {
    const r = await agy(["-p", realPrompt(message) + PLAIN_TAIL, "--model", MODEL]);
    return { seconds: r.seconds, error: r.error, out: r.stdout.trim().slice(0, 80) };
  }
  if (variant === "stream") {
    const r = await agy(["-p", realPrompt(message), "--model", MODEL, "--output-format", "stream-json", "--json-schema", JSON.stringify(SCHEMA)]);
    const events = r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { raw: l.slice(0, 80) }; } });
    const kinds = events.map((e) => e.type || e.event || e.state || Object.keys(e)[0]);
    return { seconds: r.seconds, error: r.error, eventCount: events.length, kinds: kinds.join(","), sample: JSON.stringify(events).slice(0, 1500) };
  }
  // full / shortfull: structured JSON reply; plain / shortplain: one-line text reply. "short" uses experiments/router-brief-short.md
  const short = variant.startsWith("short");
  const plain = variant.endsWith("plain");
  const opts = short ? { brief: fs.readFileSync(path.join(__dirname, "router-brief-short.md"), "utf8") } : {};
  const prompt = realPrompt(message, opts);
  if (plain) {
    const r = await agy(["-p", prompt + PLAIN_TAIL, "--model", MODEL]);
    return { seconds: r.seconds, error: r.error, out: r.stdout.trim().slice(0, 80), decision: r.stdout.trim().slice(0, 60), promptChars: prompt.length };
  }
  const r = await agy(["-p", prompt, "--model", MODEL, "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)]);
  let decision = null;
  try { const env = JSON.parse(r.stdout); decision = validateDecision(env.structured_output ?? JSON.parse(env.response)); } catch (e) { /* invalid */ }
  return { seconds: r.seconds, error: r.error, decision: decision ? decision.action + (decision.destination ? "/" + decision.destination : "") : "INVALID", promptChars: prompt.length, raw: decision ? undefined : (r.stdout || r.stderr).slice(0, 600) };
}

(async () => {
  const [cmd, variant, times, message, out] = process.argv.slice(2);
  if (cmd === "mix") { // node frontdesk-speed.js mix <rounds> <v1,v2,..> [message] [out.json]   (variants take turns, so slow periods hit all of them)
    const names = times.split(","); const rows = [];
    for (let i = 0; i < Number(variant); i++) for (const v of names) {
      const row = { variant: v, ...(await once(v, message || MESSAGE)) }; rows.push(row);
      console.error(i + 1, v, row.seconds + "s", row.decision || row.out || row.error || "");
      if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
    }
    for (const v of names) { const s = rows.filter((r) => r.variant === v).map((r) => r.seconds).sort((a, b) => a - b); console.log(JSON.stringify({ variant: v, n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], invalid: rows.filter((r) => r.variant === v && r.decision === "INVALID").length })); }
    return;
  }
  if (cmd === "size") return sizes(MESSAGE);
  const rows = [];
  for (let i = 0; i < Number(times || 1); i++) {
    const row = await once(variant, message || MESSAGE);
    rows.push(row);
    console.error(`${variant} #${i + 1}: ${row.seconds}s ${row.decision || row.out || row.error || ""}${row.eventCount ? " events=" + row.eventCount : ""}`);
    if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  }
  const s = rows.map((r) => r.seconds).sort((a, b) => a - b);
  console.log(JSON.stringify({ variant, n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], all: rows.map((r) => r.seconds) }));
})();
