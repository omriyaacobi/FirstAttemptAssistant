// stream-timing.js
// Experiment 2026-11-05: how much earlier do the first words appear when the answer is streamed?
// For each question and model: BEFORE = the whole-answer call Bot used until now (providers.ask without onText),
// AFTER = providers.askAgyStream (first text arriving, then the whole answer). One call at a time, alternating order.
// Run:  node experiments/stream-timing.js [rounds]
const { ask, askAgyStream } = require("../providers");

const QUESTIONS = [
  "Explain in about 200 words how a fridge works.",
  "תסביר לי בקצרה מה ההבדל בין מכונת כביסה עם פתח קדמי לעליון",
  "How do I make a basic béchamel sauce? Give the steps.",
  "What is the difference between TCP and UDP?",
  "תן לי תוכנית ארוחות פשוטה ליום אחד עם כ-2000 קלוריות",
  "Why does my car shake when I brake at high speed?",
];
const MODELS = ["gemini-3.8-flash-medium", "gemini-3.8-flash-low"];

(async () => {
  const rounds = Number(process.argv[2] || 1);
  const rows = [];
  for (let r = 0; r < rounds; r++) {
    for (const model of MODELS) {
      for (const q of QUESTIONS) {
        const t0 = Date.now();
        await ask("agy", model, q);
        const whole = (Date.now() - t0) / 1000;
        const t1 = Date.now();
        let first = null;
        const text = await askAgyStream(q, model, () => { if (first === null) first = (Date.now() - t1) / 1000; });
        const total = (Date.now() - t1) / 1000;
        rows.push({ model, q: q.slice(0, 30), beforeWholeS: +whole.toFixed(1), afterFirstWordsS: +first.toFixed(1), afterTotalS: +total.toFixed(1), chars: text.length });
        console.log(JSON.stringify(rows[rows.length - 1]));
      }
    }
  }
  for (const model of MODELS) {
    const m = rows.filter((x) => x.model === model);
    const med = (k) => m.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(m.length / 2)];
    console.log(model, "median before(whole)", med("beforeWholeS"), "after(first words)", med("afterFirstWordsS"), "after(total)", med("afterTotalS"));
  }
})();
