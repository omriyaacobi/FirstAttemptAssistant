// experiments/claude-flags.js : which `claude -p` flags make the front desk call faster?
//   node experiments/claude-flags.js <rounds> <out.json>
// Variants take turns (so a slow minute hits all of them), one call at a time.
const fs = require("node:fs");
const path = require("node:path");
const { buildPrompt, validateDecision } = require("../frontdesk");
const { claudeFrontDesk } = require("./claude-fd");

const MSGS = ["What is 17 times 23?", "My Node server crashes with EADDRINUSE :::3000 when I restart it. What do I do?", "תזכיר לי מחר ב-9 להגיש את התרגיל", "Find the best price for a Logitech MX Master 3S in Israel, check all the shops."];
const V = {
  base: "",
  effortLow: "--effort low",
  sysPrompt: '--system-prompt "You are a message router. Reply only with the requested JSON."',
  noDynamic: "--exclude-dynamic-system-prompt-sections",
  noSettings: '--setting-sources "" --disable-slash-commands --strict-mcp-config --no-chrome',
  safeMode: "--safe-mode",
  combo: '--system-prompt "You are a message router. Reply only with the requested JSON." --setting-sources "" --disable-slash-commands --strict-mcp-config --no-chrome',
  comboLow: '--effort low --system-prompt "You are a message router. Reply only with the requested JSON." --setting-sources "" --disable-slash-commands --strict-mcp-config --no-chrome',
};
(async () => {
  const [rounds, out] = process.argv.slice(2);
  const rows = [];
  for (let i = 0; i < Number(rounds); i++) for (const m of MSGS) for (const [name, flags] of Object.entries(V)) {
    const prompt = buildPrompt(m, {});
    const r = await claudeFrontDesk(prompt, "haiku", flags);
    const d = r.raw ? validateDecision(r.raw) : null;
    rows.push({ variant: name, msg: m.slice(0, 20), seconds: r.seconds, apiMs: r.apiMs, ms: r.ms, error: r.error, key: d ? d.action + (d.destination ? "/" + d.destination : "") : "INVALID", usage: r.usage });
    console.error(name.padEnd(10), String(r.seconds).padStart(5), r.apiMs, rows[rows.length - 1].key, r.error || "");
    fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  }
  for (const name of Object.keys(V)) {
    const rs = rows.filter((r) => r.variant === name); const s = rs.map((r) => r.seconds).sort((a, b) => a - b);
    console.log(name.padEnd(10), "n", s.length, "median", s[Math.floor(s.length / 2)], "max", s[s.length - 1], "errors", rs.filter((r) => r.error || r.key === "INVALID").length, "keys", [...new Set(rs.map((r) => r.key))].join(" "));
  }
})();
