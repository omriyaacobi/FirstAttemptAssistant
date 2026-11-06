// experiments/answer-speculative.js
// Does starting the ANSWER model while the front desk is still deciding save time, and what does it cost?
//   sequential  = front desk decides, THEN the answer model is asked (what Bot does)
//   speculative = the answer model (Flash medium, the model behind "gemini-flash") starts at the same moment as the front desk.
//                 If the desk then picks gemini-flash, that answer is used; if it picks anything else, the speculative call is killed.
// Both arms use the pre-warmed processes (a spare waits for the desk and for the answer model), the real profile block, and the same prompt.
// Records: seconds until the user has the final answer, the desk's own time (does the parallel call slow it down?), and how often
// the speculative call was wasted (the desk chose something else, or answered itself).
// Usage: node experiments/answer-speculative.js <out.json> [rounds]
const fs = require("node:fs");
const { decide, warm } = require("../frontdesk");
const { createWarmAgy } = require("../warmagy");
const { aboutBlock, personalize } = require("../profile");
const { MODELS } = require("../router");

const QUESTIONS = [
  "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?",
  "How long should I boil an egg for a runny yolk?",
  "מה ההבדל בין מכונת כביסה עם פתח קדמי לעליון?",
  "What is the difference between TCP and UDP?",
  "איך מורידים כתם של קפה מחולצה לבנה?",
  "Why does my car shake when I brake at high speed?",
  "תן לי תוכנית ארוחות פשוטה ליום אחד עם כ-2000 קלוריות",
  "How do I make a basic béchamel sauce? Give the steps.",
  "כמה זמן אפשר לשמור עוף מבושל במקרר?",
  "Explain in about 150 words how a fridge works.",
  "מה זה אינפלציה, בקצרה?",
  "What does a mutex do?",
  "Write a Python function that reverses a string, with tests.",
  "what's the weather in Beer Sheva today?",
  "remind me tomorrow at 9 to call the bank",
  "Prove that the square root of 2 is irrational.",
];
const MODEL = MODELS.flashMedium.model;
const about = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] } });
const deskAbout = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] }, numbered: true });
const chain = [{ provider: "agy", model: MODEL, pool: null }];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const answers = createWarmAgy({ keepReady: false });
const isFlash = (d) => d.action === "delegate" && d.destination === "gemini-flash";

async function ready() { // both kinds of spare are waiting, like in a chat where the previous message ended a while ago
  answers.closeAll();
  answers.warmUp(MODEL, null);
  warm.warmUp(require("../frontdesk").FRONT_DESK_MODEL.model, null);
  await wait(7000);
}

async function sequential(q) {
  const t0 = Date.now();
  const d = await decide(q, { about: deskAbout });
  const deskS = (Date.now() - t0) / 1000;
  let totalS = deskS;
  if (isFlash(d)) { await answers.askText(personalize(chain, q, about), MODEL, () => {}); totalS = (Date.now() - t0) / 1000; }
  return { totalS, deskS, decision: d.action + (d.destination ? "/" + d.destination : ""), flash: isFlash(d), wasted: false };
}

async function speculative(q) {
  const t0 = Date.now();
  const controller = new AbortController();
  const spec = answers.askText(personalize(chain, q, about), MODEL, () => {}, { signal: controller.signal });
  spec.catch(() => {});
  const d = await decide(q, { about: deskAbout });
  const deskS = (Date.now() - t0) / 1000;
  let totalS = deskS, wasted = false;
  if (isFlash(d)) { await spec; totalS = (Date.now() - t0) / 1000; } else { controller.abort(); wasted = true; }
  return { totalS, deskS, decision: d.action + (d.destination ? "/" + d.destination : ""), flash: isFlash(d), wasted };
}

(async () => {
  const [out, rounds = "2"] = process.argv.slice(2);
  const rows = [];
  let n = 0;
  for (let r = 0; r < Number(rounds); r++) {
    for (const q of QUESTIONS) {
      const arms = n++ % 2 ? [["speculative", speculative], ["sequential", sequential]] : [["sequential", sequential], ["speculative", speculative]];
      for (const [name, fn] of arms) {
        await ready();
        const row = { arm: name, q: q.slice(0, 28), ...(await fn(q)) };
        rows.push(row);
        console.error(name.padEnd(12), row.totalS.toFixed(1).padStart(5), "s desk", row.deskS.toFixed(1), row.decision, row.wasted ? "WASTED" : "", row.q);
        fs.writeFileSync(out, JSON.stringify(rows, null, 2));
      }
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const arm of ["sequential", "speculative"]) {
    const all = rows.filter((x) => x.arm === arm), fl = all.filter((x) => x.flash);
    console.log(JSON.stringify({ arm, n: all.length, medianDeskS: med(all.map((x) => x.deskS)), flashAnswers: fl.length, medianTotalForFlashAnswers: fl.length ? med(fl.map((x) => x.totalS)) : null, wastedCalls: all.filter((x) => x.wasted).length }));
  }
  answers.closeAll();
  process.exit(0);
})();
