// experiments/one-thread-concurrency.js
// If a slow course answer (about 20 s) is running, can a fast reply (front desk, 3 s) still come at the same time, and does it get slower?
// Runs 6 real front desk calls (made-up short messages) alone, then while 1 slow Argon call runs, then while 2 slow calls run.
// Only agy is used. Not part of Bot itself.
//   node experiments/one-thread-concurrency.js <outfile>
const fs = require("node:fs");
const fd = require("../frontdesk");
const { createWarmAgy } = require("../warmagy");

const outFile = process.argv[2] || "concurrency.json";
const MESSAGES = ["hi bot, how are you?", "what do I have on Sunday?", "remind me tomorrow at 9 to call grandma", "what's 17 times 23?", "תזכיר לי מחר ב-8 להתקשר לסבתא", "am I free tomorrow afternoon?"];
const SLOW_PROMPT = "Write a study guide for a second-year computer science student on pointers in C: ten short worked examples, each with a question, a hint and a full solution. Be thorough.";
const slowPool = createWarmAgy({ keepReady: false });
const slowCall = () => { const t = Date.now(); return slowPool.askText(SLOW_PROMPT, "gemini-4-argon-low", () => {}, { timeoutMs: 180000 }).then(() => (Date.now() - t) / 1000, () => null); };

async function desk(message) {
  const t = Date.now();
  try { const d = await fd.decide(message, {}); return { s: (Date.now() - t) / 1000, action: d.action, hedged: !!d.hedged }; } catch (e) { return { s: (Date.now() - t) / 1000, failed: String(e.message).slice(0, 60) }; }
}

(async () => {
  fd.warmUpDesk();
  await new Promise((r) => setTimeout(r, 6000));
  const result = {};
  for (const slow of [0, 1, 2]) {
    const slowRuns = Array.from({ length: slow }, () => slowCall());
    if (slow) await new Promise((r) => setTimeout(r, 3000)); // let the slow calls get going
    const rows = [];
    for (const m of MESSAGES) { rows.push(await desk(m)); await new Promise((r) => setTimeout(r, 800)); }
    const slowTimes = await Promise.all(slowRuns);
    const s = rows.map((r) => r.s).sort((a, b) => a - b);
    result[`${slow} slow call(s) running`] = { deskSeconds: rows.map((r) => Number(r.s.toFixed(1))), median: s[Math.floor(s.length / 2)], max: s[s.length - 1], failed: rows.filter((r) => r.failed).length, hedged: rows.filter((r) => r.hedged).length, slowSeconds: slowTimes };
    console.log(slow, JSON.stringify(result[`${slow} slow call(s) running`]));
    fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  }
  process.exit(0);
})();
