// experiments/desk-soak.js
// A long run through the REAL frontdesk.decide: several hundred calls over a mix of messages (including the slow thinkers),
// with the real profile, and a pause between messages like a person. Reports the tail honestly: how many calls needed a
// hedge, how many took over 10 / 15 / 20 s, and how many ended in "the front desk did not answer" (those would go to Claude Sonnet).
// Usage: node experiments/desk-soak.js <rounds> [gapSeconds] [out.log]
const fs = require("node:fs");
const { decide, FRONT_DESK_MODEL } = require("../frontdesk");
const { aboutBlock } = require("../profile");

const MESSAGES = [
  "what do I have on Thursday?",
  "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?",
  "what oil filter does a 2015 Ford Focus take?",
  "What do I have this week?",
  "remind me tomorrow at 9 to submit the algorithms homework",
  "Write a Python function that merges two sorted linked lists, with tests.",
  "Prove that the square root of 2 is irrational.",
  "מה ההבדל בין מחסנית לתור?",
  "hi bot, how are you?",
  "Find me the cheapest place in Israel to buy a Raspberry Pi 5 8GB and compare the prices.",
  "I need three things: a summary of the French revolution, a regex for validating Israeli phone numbers, and a proof that there are infinitely many primes.",
  "why does [1,2,3].map(parseInt) return [1,NaN,NaN]?",
];
const [rounds = "25", gap = "4", outFile] = process.argv.slice(2);
const about = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] }, numbered: true });
const log = (line) => { console.log(line); if (outFile) fs.appendFileSync(outFile, line + "\n"); };

(async () => {
  const seconds = [];
  let failures = 0, hedged = 0;
  const bySlowest = [];
  for (let round = 1; round <= Number(rounds); round++) {
    for (const message of MESSAGES) {
      const t = Date.now();
      try {
        const d = await decide(message, { about });
        const s = (Date.now() - t) / 1000;
        seconds.push(s);
        if (d.hedged) hedged++;
        bySlowest.push([s, message.slice(0, 30)]);
        log(`r${round} ${s.toFixed(1)} s ${d.action}${d.destination ? "/" + d.destination : ""}${d.hedged ? " (hedged)" : ""} | ${message.slice(0, 30)}`);
      } catch (error) {
        failures++;
        log(`r${round} FAILED after ${((Date.now() - t) / 1000).toFixed(1)} s | ${message.slice(0, 30)} | ${String(error.message).slice(0, 100)}`);
      }
      await new Promise((r) => setTimeout(r, Number(gap) * 1000));
    }
  }
  const s = [...seconds].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const over = (x) => s.filter((v) => v > x).length;
  log("SUMMARY " + JSON.stringify({ model: FRONT_DESK_MODEL.model, calls: seconds.length + failures, failures, hedged, median: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1], over10s: over(10), over15s: over(15), over20s: over(20) }));
  log("SLOWEST " + bySlowest.sort((a, b) => b[0] - a[0]).slice(0, 5).map(([v, m]) => v.toFixed(1) + " s " + m).join(" | "));
  process.exit(0);
})();
