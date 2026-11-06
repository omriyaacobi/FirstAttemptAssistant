// experiments/answer-oneshot-vs-stream.js
// Did the streaming change (answers read through agy's stream-json mode, added on 2026-11-05) make the answer step slower?
//   oneshot = providers.ask("agy", model, prompt): `agy -p <prompt>` and wait for all the text (how answers worked before streaming)
//   stream  = providers.ask("agy", model, prompt, onText): stream-json mode (how answers work now, when the page asks for partial text)
// Same model, same prompt (with the real profile block), taking turns for each question.
// Usage: node experiments/answer-oneshot-vs-stream.js <out.json> [rounds] [model]
const fs = require("node:fs");
const { ask } = require("../providers");
const { aboutBlock, personalize } = require("../profile");

const QUESTIONS = [
  "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?",
  "How long should I boil an egg for a runny yolk?",
  "מה ההבדל בין מכונת כביסה עם פתח קדמי לעליון?",
  "What is the difference between TCP and UDP?",
  "איך מורידים כתם של קפה מחולצה לבנה?",
  "Why does my car shake when I brake at high speed?",
  "How do I make a basic béchamel sauce? Give the steps.",
  "כמה זמן אפשר לשמור עוף מבושל במקרר?",
];
const about = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] } });
const chain = [{ provider: "agy", model: "x", pool: null }];

(async () => {
  const [out, rounds = "2", model = "gemini-3.8-flash-medium"] = process.argv.slice(2);
  const rows = [];
  let n = 0;
  for (let r = 0; r < Number(rounds); r++) {
    for (const q of QUESTIONS) {
      const order = n++ % 2 ? ["stream", "oneshot"] : ["oneshot", "stream"];
      for (const mode of order) {
        const prompt = personalize(chain, q, about);
        const t0 = Date.now();
        let answer = "", error = null;
        try { answer = await (mode === "stream" ? ask("agy", model, prompt, () => {}) : ask("agy", model, prompt)); } catch (e) { error = String(e.message).slice(0, 100); }
        const totalS = +((Date.now() - t0) / 1000).toFixed(2);
        rows.push({ mode, q: q.slice(0, 28), totalS, chars: answer.length, error });
        console.error(mode.padEnd(8), String(totalS).padStart(6), "s", answer.length, "chars", error || "", q.slice(0, 28));
        fs.writeFileSync(out, JSON.stringify(rows, null, 2));
      }
    }
  }
  const sorted = (a) => [...a].sort((x, y) => x - y);
  for (const mode of ["oneshot", "stream"]) {
    const t = sorted(rows.filter((x) => x.mode === mode && !x.error).map((x) => x.totalS));
    console.log(JSON.stringify({ mode, n: t.length, median: t[Math.floor(t.length / 2)], p90: t[Math.floor(t.length * 0.9)], max: t[t.length - 1], mean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2) }));
  }
  process.exit(0);
})();
