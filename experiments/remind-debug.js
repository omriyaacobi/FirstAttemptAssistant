// Why did "Remind me in 2 hours to call mom" give an unusable reply? Prints the raw replies and why validation fails.
const { buildPrompt, validateDecision, REPLY_FORMAT, warm, FRONT_DESK_MODEL } = require("../frontdesk");
const { parseWhen } = require("../reminders");
const NOW = Date.UTC(2026, 10, 5, 8, 0, 0);
(async () => {
  const prompt = buildPrompt(process.argv[2] || "Remind me in 2 hours to call mom", { now: NOW, timezone: "Asia/Jerusalem" }) + REPLY_FORMAT;
  for (let i = 0; i < Number(process.argv[3] || 4); i++) {
    try {
      const raw = await warm.askStructured(prompt, FRONT_DESK_MODEL.model, null);
      let why = "ok";
      try { parseWhen(raw.remindAt, raw.timezone, NOW); } catch (e) { why = e.message; }
      console.log(JSON.stringify({ action: raw.action, remindAt: raw.remindAt, timezone: raw.timezone, text: raw.reminderText, valid: !!validateDecision(raw, { now: NOW }), why }));
    } catch (e) { console.log("ERR", e.message.slice(0, 200)); }
  }
  process.exit(0);
})();
