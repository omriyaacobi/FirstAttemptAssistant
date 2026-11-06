// experiments/answer-warm-ab.js
// Real answers, cold vs pre-warmed, taking turns for each question so conditions match. The model, the prompt (with the real
// profile block, as core.js builds it) and the flags are the same in all variants; only WHEN agy was started differs.
//   cold     = providers.ask("agy", model, prompt, onText): what main does today (agy starts when the question arrives)
//   warm     = a spare agy has been waiting for 6+ s (the normal case in a chat)
//   overlap  = the spare was started 3 s before the question (the first message after a pause: it starts while the front desk decides)
// Records seconds from "question handed over" to "answer finished", seconds to the FIRST words, the answer text and simple checks.
// Usage: node experiments/answer-warm-ab.js <out.json> [rounds] [model] [variants,comma]
const fs = require("node:fs");
const { ask } = require("../providers");
const { createWarmAgy } = require("../warmagy");
const { aboutBlock, personalize } = require("../profile");

const QUESTIONS = [
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
];
const about = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] } });
const chain = [{ provider: "agy", model: "x", pool: null }];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hebrewRatio = (s) => (s.match(/[\u0590-\u05FF]/g) || []).length / Math.max(1, (s.match(/[\p{L}]/gu) || []).length);

(async () => {
  const [out, rounds = "1", model = "gemini-3.8-flash-medium", variantsArg = "cold,warm,overlap"] = process.argv.slice(2);
  const variants = variantsArg.split(",");
  const pool = createWarmAgy({ keepReady: false });
  const rows = [];
  let n = 0;
  for (let r = 0; r < Number(rounds); r++) {
    for (const [q, lang] of QUESTIONS) {
      const order = variants.map((_, k) => variants[(k + n) % variants.length]);
      n++;
      for (const v of order) {
        const prompt = personalize(chain, q, about);
        pool.closeAll();
        if (v === "warm") { pool.warmUp(model, null); await wait(7000); }
        if (v === "overlap") { pool.warmUp(model, null); await wait(3000); }
        const t0 = Date.now();
        let first = null;
        const onText = () => { if (first === null) first = (Date.now() - t0) / 1000; };
        let answer = "", error = null;
        try { answer = v === "cold" ? await ask("agy", model, prompt, onText) : await pool.askText(prompt, model, onText); } catch (e) { error = String(e.message).slice(0, 100); }
        const totalS = +((Date.now() - t0) / 1000).toFixed(2);
        const he = hebrewRatio(answer);
        const row = { variant: v, q: q.slice(0, 30), lang, totalS, firstWordsS: first === null ? null : +first.toFixed(2), chars: answer.length, hebrewRatio: +he.toFixed(2), languageOk: lang === "he" ? he > 0.3 : he < 0.1, answer, error };
        rows.push(row);
        console.error(v.padEnd(8), String(totalS).padStart(6), "s first", row.firstWordsS, "chars", row.chars, row.languageOk ? "" : "LANG?", error || "", row.q);
        fs.writeFileSync(out, JSON.stringify(rows, null, 2));
      }
    }
  }
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const p90 = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
  for (const v of variants) {
    const m = rows.filter((x) => x.variant === v);
    console.log(JSON.stringify({ variant: v, n: m.length, errors: m.filter((x) => x.error).length, medianTotal: med(m.map((x) => x.totalS)), p90Total: p90(m.map((x) => x.totalS)), maxTotal: Math.max(...m.map((x) => x.totalS)), medianFirstWords: med(m.map((x) => x.firstWordsS)), medianChars: med(m.map((x) => x.chars)), languageWrong: m.filter((x) => !x.languageOk).length, tooShort: m.filter((x) => x.chars < 100).length }));
  }
  pool.closeAll();
  process.exit(0);
})();
