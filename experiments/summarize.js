// node experiments/summarize.js a.json [b.json ...]  : median/slowest/errors/right per file, and the WRONG rows
const fs = require("node:fs");
for (const f of process.argv.slice(2)) {
  const rows = JSON.parse(fs.readFileSync(f, "utf8"));
  const s = rows.filter((r) => !r.error).map((r) => r.seconds).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  console.log(`${f}: n=${rows.length} median=${q(0.5)} p90=${q(0.9)} max=${s[s.length - 1]} errors=${rows.filter((r) => r.error).length} invalid=${rows.filter((r) => r.invalid).length} right=${rows.filter((r) => r.right).length}/${rows.length}`);
  for (const r of rows.filter((r) => !r.right)) console.log(`   WRONG ${r.label}: ${r.key} ${JSON.stringify(r.detail || "")} ${r.error || ""} | ${r.reason}`);
}
