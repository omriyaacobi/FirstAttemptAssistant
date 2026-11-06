// experiments/answer-e2e.js
// BEFORE and AFTER through the real core.handleTask (real front desk, real answer model), taking turns for each message.
//   before = what Bot did when this work started: the answer model starts its own agy when the front desk is done (no spare, no
//            speculative answer). The front desk itself is the same fast one in both arms.
//   after  = the defaults now: pre-warmed answer process + the answer model asked together with the front desk.
// The real profile is used (as in Bot). A pause between messages (GAP_MS, default 10 s) lets the spares become ready, as in a chat.
// Records the seconds until the full answer, the seconds until the first words, the decision, and the answer text for the quality check.
// Rows have the same shape as answer-warm-ab.js, so `node experiments/answer-check.js <out.json>` checks them.
// Usage: node experiments/answer-e2e.js <out.json> [rounds]
const fs = require("node:fs");
const { handleTask } = require("../core");
const { ask } = require("../providers");
const { aboutBlock } = require("../profile");

const PROFILE = "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md";
// [message, language] : everyday questions (the answer step matters) and short front desk replies (reminder, greeting, vague).
const MESSAGES = [
  ["שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?", "he"],
  ["How long should I boil an egg for a runny yolk?", "en"],
  ["מה ההבדל בין מכונת כביסה עם פתח קדמי לעליון?", "he"],
  ["What is the difference between TCP and UDP?", "en"],
  ["איך מורידים כתם של קפה מחולצה לבנה?", "he"],
  ["Why does my car shake when I brake at high speed?", "en"],
  ["תן לי תוכנית ארוחות פשוטה ליום אחד עם כ-2000 קלוריות", "he"],
  ["How do I make a basic béchamel sauce? Give the steps.", "en"],
  ["כמה זמן אפשר לשמור עוף מבושל במקרר?", "he"],
  ["Explain in about 150 words how a fridge works.", "en"],
  ["מה זה אינפלציה, בקצרה?", "he"],
  ["What does a mutex do?", "en"],
  ["remind me tomorrow at 9 to call the bank", "en"],
  ["hi bot, how are you?", "en"],
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hebrewRatio = (s) => (s.match(/[\u0590-\u05FF]/g) || []).length / Math.max(1, (s.match(/\p{L}/gu) || []).length);
const realAbout = (opts = {}) => aboutBlock({ profileFile: PROFILE, memory: { list: () => [] }, ...opts });
const noopReminder = ({ text, at, timezone }) => ({ id: "x", text, at: new Date(at).toISOString(), timezone }); // never write the real reminders file

const BASE = { about: realAbout, refreshQuota: () => {}, createReminder: noopReminder, lowPools: async () => [] };
const ARMS = {
  before: { ...BASE, speculate: null, prewarmAnswer: () => {}, askOne: (provider, model, q, onText) => ask(provider, model, q, onText) },
  after: { ...BASE },
};

(async () => {
  const [out, rounds = "2"] = process.argv.slice(2);
  const gap = Number(process.env.GAP_MS || 10000);
  const rows = [];
  let n = 0;
  for (let r = 0; r < Number(rounds); r++) {
    for (const [q, lang] of MESSAGES) {
      const order = n++ % 2 ? ["after", "before"] : ["before", "after"];
      for (const arm of order) {
        const t0 = Date.now();
        let first = null, error = null, result = null;
        try { result = await handleTask(q, { deps: ARMS[arm], onPartial: (t) => { if (t && first === null) first = (Date.now() - t0) / 1000; } }); } catch (e) { error = String(e.message).slice(0, 100); }
        const totalS = +((Date.now() - t0) / 1000).toFixed(2);
        const answer = result ? String(result.answer || "") : "";
        const he = hebrewRatio(answer);
        const row = { variant: arm, q: q.slice(0, 30), lang, totalS, firstWordsS: first === null ? null : +first.toFixed(2), rule: result && result.rule, used: result && result.used && result.used.model, chars: answer.length, languageOk: /[A-Za-z\u0590-\u05FF]/.test(answer) ? (lang === "he" ? he > 0.3 : he < 0.1) : false, answer, error };
        rows.push(row);
        console.error(arm.padEnd(7), String(totalS).padStart(6), "s first", row.firstWordsS, row.rule, "|", row.used, error || "", row.q);
        fs.writeFileSync(out, JSON.stringify(rows, null, 2));
        await wait(gap);
      }
    }
  }
  const sorted = (a) => a.filter((x) => x != null).sort((x, y) => x - y);
  const med = (a) => sorted(a)[Math.floor(sorted(a).length / 2)];
  const p90 = (a) => sorted(a)[Math.floor(sorted(a).length * 0.9)];
  for (const arm of ["before", "after"]) {
    const m = rows.filter((x) => x.variant === arm);
    const flash = m.filter((x) => x.used === "gemini-3.8-flash-medium" && !/answered directly|reminder/.test(String(x.rule)));
    console.log(JSON.stringify({ arm, n: m.length, errors: m.filter((x) => x.error).length, medianTotal: med(m.map((x) => x.totalS)), p90Total: p90(m.map((x) => x.totalS)), maxTotal: Math.max(...m.map((x) => x.totalS)), flashAnswers: flash.length, flashMedian: med(flash.map((x) => x.totalS)), flashP90: p90(flash.map((x) => x.totalS)), flashFirstWordsMedian: med(flash.map((x) => x.firstWordsS)), languageWrong: m.filter((x) => !x.languageOk && !x.error).length }));
  }
  process.exit(0);
})();
