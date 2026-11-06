// experiments/answer-breakdown.js
// Where do the ~10 s of an everyday answer go? One real agy call per question in stream-json mode (the same mode
// providers.askAgyStream uses), with a clock on every event:
//   initS    = from starting agy until it says "init" (start-up)
//   firstS   = from sending the prompt until the first words arrive (thinking before writing)
//   writeS   = from the first words until the result (writing)
//   usage    = agy's own token counts for the call (input / output / thinking)
// Variants (one after another per question, order rotated):
//   full      = exactly what Bot sends: the profile block + the question
//   noprofile = only the question
// Usage: node experiments/answer-breakdown.js <out.json> [rounds] [model] [variants,comma]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { aboutBlock, personalize } = require("../profile");
const { SANDBOX_DIR } = require("../providers");

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
];
const AGY = process.env.AGY_CMD || path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
const about = aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] } });
const chainFlash = [{ provider: "agy", model: "x", pool: null }];

function call(model, prompt) {
  return new Promise((resolve) => {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    const t0 = Date.now();
    const rel = () => +((Date.now() - t0) / 1000).toFixed(2);
    const child = spawn(AGY, ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model], { cwd: SANDBOX_DIR, windowsHide: true });
    let buf = "", initS = null, sentS = null, firstS = null, usage = null, text = "", chars = 0;
    child.stderr.on("data", () => {});
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch (x) { continue; }
        const u = e.step_update;
        if (e.event === "init") { initS = rel(); sentS = rel(); child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n"); }
        else if (e.event === "step_update" && u && u.step_type === "agent_response") {
          if (u.text_delta && firstS === null) firstS = rel();
          if (u.text_delta) text += u.text_delta;
          if (u.usage) usage = u.usage;
        } else if (e.event === "result") {
          const totalS = rel();
          const r = e.result || {};
          child.kill();
          chars = String(r.response || text).length;
          resolve({ initS, firstWordsAfterSendS: firstS === null ? null : +(firstS - sentS).toFixed(2), writeS: firstS === null ? null : +(totalS - firstS).toFixed(2), totalS, afterInitS: +(totalS - initS).toFixed(2), chars, usage: usage && { in: usage.input_tokens, out: usage.output_tokens, thinking: usage.thinking_tokens }, status: r.status });
        }
      }
    });
    child.on("close", () => resolve({ error: "closed", totalS: rel() }));
  });
}

(async () => {
  const [out, rounds = "1", model = "gemini-3.8-flash-medium", variantsArg = "full,noprofile"] = process.argv.slice(2);
  const variants = variantsArg.split(",");
  const rows = [];
  let n = 0;
  for (let r = 0; r < Number(rounds); r++) {
    for (const q of QUESTIONS) {
      const order = variants.map((_, k) => variants[(k + n) % variants.length]);
      n++;
      for (const v of order) {
        const prompt = v === "full" ? personalize(chainFlash, q, about) : q;
        const row = { variant: v, q: q.slice(0, 28), model, ...(await call(model, prompt)) };
        rows.push(row);
        console.error(v.padEnd(10), String(row.totalS).padStart(5), "s  init", row.initS, "first", row.firstWordsAfterSendS, "write", row.writeS, JSON.stringify(row.usage || {}), row.q);
        fs.writeFileSync(out, JSON.stringify(rows, null, 2));
      }
    }
  }
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const v of variants) {
    const m = rows.filter((x) => x.variant === v && !x.error);
    console.log(JSON.stringify({ variant: v, n: m.length, medianTotal: med(m.map((x) => x.totalS)), medianInit: med(m.map((x) => x.initS)), medianThinkBeforeWords: med(m.map((x) => x.firstWordsAfterSendS)), medianWriting: med(m.map((x) => x.writeS)), medianOutTokens: med(m.map((x) => x.usage && x.usage.out)), medianThinkingTokens: med(m.map((x) => x.usage && x.usage.thinking)), medianInTokens: med(m.map((x) => x.usage && x.usage.in)), medianChars: med(m.map((x) => x.chars)) }));
  }
  process.exit(0);
})();
