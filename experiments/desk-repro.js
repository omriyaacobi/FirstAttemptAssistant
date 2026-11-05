// experiments/desk-repro.js
// Repeats ONE message through the real frontdesk.decide and logs every underlying call (start, end, error, seconds).
// Usage: node experiments/desk-repro.js "message" <times> [gapSeconds] [profile=1|0]
// Used to find out why a call once ran into the 20 s deadline.
const { decide, warm, FRONT_DESK_MODEL } = require("../frontdesk");
const { aboutBlock } = require("../profile");

const [message = "what do I have on Thursday?", times = "20", gap = "8", useProfile = "1"] = process.argv.slice(2);
const about = useProfile === "1" ? aboutBlock({ profileFile: "C:/Claude Code Project/FirstAttemptAssistant/data/profile.md", memory: { list: () => [] }, numbered: true }) : "";
const t00 = Date.now();
const stamp = () => ((Date.now() - t00) / 1000).toFixed(1).padStart(6) + "s";
let callNo = 0;

// Wraps the real warm pool so every call is visible.
const askStructured = (prompt, model, schema, options) => {
  const id = ++callNo;
  const t0 = Date.now();
  const spareWaiting = warm._spares.size;
  console.log(`${stamp()}   call #${id} starts (spares waiting: ${spareWaiting})`);
  return warm.askStructured(prompt, model, schema, options).then(
    (r) => { console.log(`${stamp()}   call #${id} ok after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${r.action}${r.destination && r.destination !== "none" ? "/" + r.destination : ""}`); return r; },
    (e) => { console.log(`${stamp()}   call #${id} FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${String(e.message).slice(0, 120)}`); throw e; },
  );
};

(async () => {
  const seconds = [];
  let failures = 0;
  for (let i = 1; i <= Number(times); i++) {
    const t = Date.now();
    try {
      const d = await decide(message, { askStructured, about });
      const s = (Date.now() - t) / 1000;
      seconds.push(s);
      console.log(`${stamp()} #${i}: ${s.toFixed(1)} s ${d.action}${d.destination ? "/" + d.destination : ""}${d.calendar ? " " + JSON.stringify(d.calendar) : ""}${d.hedged ? " (hedged)" : ""}`);
    } catch (e) {
      failures++;
      console.log(`${stamp()} #${i}: DESK FAILED after ${((Date.now() - t) / 1000).toFixed(1)} s: ${String(e.message).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, Number(gap) * 1000));
  }
  const s = [...seconds].sort((a, b) => a - b);
  console.log("SUMMARY", JSON.stringify({ message, model: FRONT_DESK_MODEL.model, n: Number(times), failures, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] }));
  process.exit(0);
})();
