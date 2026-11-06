// experiments/memory-desk-check.js
// Does the REAL front desk pick the new "recall" action when it should, and only then? Calls the real model, one message at a
// time, with a made-up profile and made-up facts. Not part of Bot itself.
//   node experiments/memory-desk-check.js [rounds]            the Gemini desk
//   node experiments/memory-desk-check.js [rounds] haiku      the backup desk (Claude Haiku)
const { decide } = require("../frontdesk");
const { aboutBlock } = require("../profile");

// [message, the actions that are right]
const CASES = [
  ["what did we decide about the laptop last week?", ["recall"]],
  ["what do you know about me?", ["recall"]],
  ["what did I ask you yesterday about the fridge?", ["recall"]],
  ["מה סיכמנו על המחשב הנייד בשבוע שעבר?", ["recall"]],
  ["מה אתה יודע עליי?", ["recall"]],
  ["do you remember what we said about my exam plan?", ["recall"]],
  ["what's the difference between a stack and a queue?", ["answer", "delegate"]],
  ["what is the capital of Australia?", ["answer"]],
  ["hi bot, how are you?", ["answer"]],
  ["what do I have on Thursday?", ["calendar"]],
  ["remind me tomorrow at 9 to call the bank", ["remind"]],
  ["remember that my bike is red", ["remember"]],
  ["תזכור שאני צמחונית", ["remember"]],
  ["I'm vegetarian now", ["remember"]],
  ["forget that my dog is called Pixel", ["forget"]],
  ["summarize the French revolution in 3 lines", ["delegate"]],
  ["Write a Python function that reverses a linked list", ["delegate"]],
  ["what's the latest iPhone price in Israel?", ["delegate"]],
  ["add a dark mode button to Bot", ["improve"]],
];

const facts = [
  { id: "a".repeat(16), text: "Noa's dog is called Pixel", at: 2 },
  { id: "b".repeat(16), text: "Noa's bike is blue", at: 1 },
];
const about = aboutBlock({ profileFile: "none", memory: { list: () => facts }, numbered: true });
const [rounds = "1", which = "gemini"] = process.argv.slice(2);
const options = which === "haiku" ? { askStructured: async () => { throw new Error("use the backup"); } } : {};

(async () => {
  let right = 0, total = 0;
  for (let round = 0; round < Number(rounds); round++) {
    for (const [message, want] of CASES) {
      total++;
      const t = Date.now();
      try {
        const d = await decide(message, { about, ...options, hedgeAfterMs: 4500, calls: which === "haiku" ? 1 : 3 });
        const ok = want.includes(d.action);
        if (ok) right++;
        console.log(`${ok ? "ok   " : "WRONG"} ${((Date.now() - t) / 1000).toFixed(1)} s ${d.action}${d.query ? ` [${d.query}]` : ""}${d.fact ? ` [${d.fact}]` : ""}${d.replaces ? ` #${d.replaces}` : ""} via ${d.via} | ${message}`);
      } catch (error) {
        console.log(`FAIL  ${message} | ${String(error.message).slice(0, 120)}`);
      }
    }
  }
  console.log(`${right} of ${total} right (${which})`);
  process.exit(0);
})();
