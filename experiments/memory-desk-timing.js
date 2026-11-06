// experiments/memory-desk-timing.js
// Does the memory work slow the front desk down? Runs the REAL frontdesk.decide over a fixed mix of messages, one after
// another with a pause like a person, with a MADE-UP profile and MADE-UP saved facts (never the real data/ folder).
// Run it on the old code and the new code and compare.
//   node experiments/memory-desk-timing.js <label> [rounds] [gapSeconds] [facts]   writes <label>.json next to OUT (env) or the temp folder
// Not part of Bot itself.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decide, warmUpDesk } = require("../frontdesk");
const profile = require("../profile");

const MESSAGES = [
  "what do I have on Thursday?",
  "remind me tomorrow at 9 to submit the algorithms homework",
  "Write a Python function that merges two sorted linked lists, with tests.",
  "מה ההבדל בין מחסנית לתור?",
  "hi bot, how are you?",
  "what oil filter does a 2015 Ford Focus take?",
  "I'm allergic to peanuts, remember that",
  "Prove that the square root of 2 is irrational.",
  "מה כדאי לבשל הערב?",
  "forget that my dog is called Pixel",
];

const [label = "run", rounds = "6", gap = "3", factCount = "100"] = process.argv.slice(2);

// 100 made-up facts of about 60 characters: a full memory, the worst case for the prompt size.
const TOPICS = ["likes hiking in the Galil", "drinks tea with no sugar", "has a dog called Pixel", "studies algorithms on Sundays", "prefers short answers", "is vegetarian", "lives near the train station", "plays the piano on Fridays", "uses a Linux laptop", "takes the bus to campus"];
const facts = Array.from({ length: Number(factCount) }, (_, i) => ({ id: String(i).padStart(16, "0"), text: `Noa ${TOPICS[i % TOPICS.length]} (made-up example number ${i + 1})`, at: 1000 + i }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-timing-"));
const profileFile = path.join(dir, "profile.md");
fs.writeFileSync(profileFile, "Noa is a made-up student.\n".repeat(68)); // about the size of a real profile

// Old code: aboutBlock takes the list as it is. New code: it also takes the message, so only what fits goes in.
const aboutFor = (message) => profile.aboutBlock({ profileFile, memory: { list: () => facts }, numbered: true, query: message });

(async () => {
  const out = [];
  warmUpDesk();
  await new Promise((r) => setTimeout(r, 6000));
  for (let round = 1; round <= Number(rounds); round++) {
    for (const message of MESSAGES) {
      const about = aboutFor(message);
      const t = Date.now();
      let row;
      try {
        const d = await decide(message, { about });
        row = { message: message.slice(0, 24), seconds: (Date.now() - t) / 1000, action: d.action, hedged: !!d.hedged, via: d.via, aboutChars: about.length };
      } catch (error) {
        row = { message: message.slice(0, 24), seconds: (Date.now() - t) / 1000, failed: String(error.message).slice(0, 100), aboutChars: about.length };
      }
      out.push(row);
      console.log(`r${round} ${row.seconds.toFixed(1)} s ${row.action || "FAILED"}${row.hedged ? " (hedged)" : ""} | about ${row.aboutChars} | ${row.message}`);
      await new Promise((r) => setTimeout(r, Number(gap) * 1000));
    }
  }
  const s = out.filter((r) => !r.failed).map((r) => r.seconds).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const summary = { label, calls: out.length, failed: out.filter((r) => r.failed).length, hedged: out.filter((r) => r.hedged).length, haiku: out.filter((r) => r.via === "haiku").length, median: q(0.5), p90: q(0.9), max: s[s.length - 1], mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)), aboutChars: out[0].aboutChars };
  console.log(JSON.stringify(summary));
  const outDir = process.env.OUT || os.tmpdir();
  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ summary, out }, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0); // the warm agy waiting for the next message would otherwise keep this script alive
})();
