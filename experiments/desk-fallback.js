// experiments/desk-fallback.js
// How does the front desk behave when it is RARELY used (for example as the fallback behind another desk)?
//   A) cold: every call gets a brand-new pool, so no waiting spare (this is the "first message after a start" case)
//   B) rarely used: a pool whose spares live 60 s; call, wait 80 s (the spare is killed by its timer), call, wait 30 s, call
// Usage: node experiments/desk-fallback.js [coldCalls]
const { decide } = require("../frontdesk");
const { createWarmAgy } = require("../warmagy");

const MESSAGES = ["What is 17 times 23?", "Write a Python function that reverses a string, with tests.", "what's the weather in Beer Sheva today?", "remind me tomorrow at 9 to call the bank", "תוכיח שלכל גרף עם n צמתים ו-n קשתות לפחות יש מעגל.", "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?", "What do I have this week?", "hi bot"];
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const secs = (t) => Number(((Date.now() - t) / 1000).toFixed(1));

(async () => {
  const cold = [];
  for (const m of MESSAGES.slice(0, Number(process.argv[2] || 8))) {
    const pool = createWarmAgy(); // new pool: nothing waiting
    const t = Date.now();
    const d = await decide(m, { askStructured: pool.askStructured });
    cold.push(secs(t));
    console.log("cold", secs(t), "s", d.action + (d.destination ? "/" + d.destination : ""), d.hedged ? "(hedged)" : "");
    pool.closeAll();
  }
  const s = [...cold].sort((a, b) => a - b);
  console.log("COLD summary", JSON.stringify({ n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] }));

  const pool = createWarmAgy({ maxSpareAgeMs: 60 * 1000 });
  const run = async (label) => { const t = Date.now(); const d = await decide(MESSAGES[0], { askStructured: pool.askStructured }); console.log(label, secs(t), "s", "spares waiting:", pool._spares.size); };
  await run("first call (cold)");
  await wait(80);
  console.log("after 80 s idle, spares waiting:", pool._spares.size, "(0 = the unused spare was killed by its timer)");
  await run("call after 80 s idle (cold again)");
  await wait(30);
  await run("call after 30 s idle (spare alive)");
  pool.closeAll();
  process.exit(0);
})();
