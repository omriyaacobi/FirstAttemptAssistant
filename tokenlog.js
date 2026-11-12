// tokenlog.js
// How many TOKENS the brain's answers cost, per day and per model. A token is the unit models count text in (about 4 English
// characters, or about 1 Hebrew letter), and the quota pools charge by tokens, not by messages. agy and Claude report the exact
// numbers with every answer (providers.js readUsage); before 2026-11-12 Bot threw them away.
//
// The file (data/token-log.json) holds numbers only, never message text:
//   { "days": { "2026-11-12": { "messages": 12, "models": { "gemini-4-argon-low": { "calls": 17, "input": 0, "output": 0, "thinking": 0, "cacheRead": 0 } } } } }
// See it with:  node tokenlog.js        (the last 7 days, and tokens per message)

const fs = require("node:fs");
const path = require("node:path");

const KEEP_DAYS = 35;
const FIELDS = ["input", "output", "thinking", "cacheRead"];
const totalOf = (m) => FIELDS.reduce((a, k) => a + (Number(m[k]) || 0), 0);
// The local calendar day of a moment, as YYYY-MM-DD.
const dayOf = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function createTokenLog({ file, now = Date.now, keepDays = KEEP_DAYS } = {}) {
  const read = () => {
    try { const data = JSON.parse(fs.readFileSync(file, "utf8")); return data && typeof data.days === "object" && data.days ? data : { days: {} }; } catch (error) { return { days: {} }; }
  };

  // calls: what ONE message cost, one entry per model call: [{ model, input, output, thinking, cacheRead }]. Never throws.
  function add(calls) {
    try {
      const good = (Array.isArray(calls) ? calls : []).filter((c) => c && typeof c.model === "string" && /^[\w.-]{1,60}$/.test(c.model));
      if (!good.length) return;
      const data = read();
      const day = (data.days[dayOf(now())] ||= { messages: 0, models: {} });
      day.messages++;
      for (const c of good) {
        const m = (day.models[c.model] ||= { calls: 0, input: 0, output: 0, thinking: 0, cacheRead: 0 });
        m.calls++;
        for (const k of FIELDS) m[k] += Number.isFinite(Number(c[k])) && Number(c[k]) > 0 ? Math.round(Number(c[k])) : 0;
      }
      for (const old of Object.keys(data.days).sort().slice(0, -keepDays)) delete data.days[old];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (error) { /* counting tokens must never break an answer */ }
  }

  // The last n days as lines of text (newest last).
  function report(n = 7) {
    const { days } = read();
    const lines = [];
    for (const key of Object.keys(days).sort().slice(-n)) {
      const d = days[key];
      const models = Object.entries(d.models || {});
      const calls = models.reduce((a, [, m]) => a + m.calls, 0);
      const tokens = models.reduce((a, [, m]) => a + totalOf(m), 0);
      lines.push(`${key}: ${d.messages} message(s), ${calls} model call(s), ${tokens.toLocaleString("en-US")} tokens (${d.messages ? Math.round(tokens / d.messages).toLocaleString("en-US") : 0} per message)`);
      for (const [name, m] of models) lines.push(`   ${name}: ${m.calls} call(s), ${totalOf(m).toLocaleString("en-US")} tokens (${m.calls ? Math.round(totalOf(m) / m.calls).toLocaleString("en-US") : 0} per call; input ${m.input.toLocaleString("en-US")}, cache read ${m.cacheRead.toLocaleString("en-US")}, output ${m.output.toLocaleString("en-US")}, thinking ${m.thinking.toLocaleString("en-US")})`);
    }
    return lines.length ? lines : ["No answers were counted yet."];
  }

  return { add, report, read };
}

module.exports = { createTokenLog, totalOf, dayOf, KEEP_DAYS };

if (require.main === module) {
  console.log(createTokenLog({ file: path.join(__dirname, "data", "token-log.json") }).report(Number(process.argv[2]) || 7).join("\n"));
}
