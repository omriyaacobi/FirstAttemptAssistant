// Tests the time limit of a photo question (providers.js askAgyWithImage) and the model order for a calendar photo (core.js).
// A fake agy: child_process.execFile is replaced (before providers.js loads). The fake agy never answers; "taskkill" calls are recorded.
const cp = require("node:child_process");
const killed = [];
cp.execFile = (cmd, args, options, callback) => {
  if (cmd === "taskkill") { killed.push(args); (typeof options === "function" ? options : callback)(null, "", ""); return { on() {}, kill() {}, pid: 1 }; }
  return { on() {}, kill() { killed.push("kill"); }, pid: 4242 }; // agy: stays silent, so only the time limit ends it
};
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyWithImage, imageTimeoutFor } = require("../providers");
const { handleTask } = require("../core");

test("a photo question that never answers is stopped at its limit, the process tree is killed, and the work folder is removed", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pt-"));
  const file = path.join(base, "p.png");
  fs.writeFileSync(file, "x");
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("bot-photo-")).length;
  await assert.rejects(askAgyWithImage("gemini-3.8-flash-low", "q", file, { timeoutMs: 40 }), /gemini-3\.8-flash-low timed out after/);
  assert.ok(killed.length >= 1, "the process was killed");
  assert.ok(String(killed[0]).includes("4242") || killed[0] === "kill");
  assert.deepStrictEqual(fs.readdirSync(base).filter((n) => n.startsWith("bot-photo-")), [], "no work folder left behind");
  fs.rmSync(base, { recursive: true, force: true });
});

test("the limits come from the measured timings: 90 s for Flash, 150 s for Argon", () => {
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-medium"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-low"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-4-argon-low"), 150 * 1000);
});

const timetableJson = JSON.stringify({ events: [{ title: "Calculus", weekday: "Sunday", start: "10:00", end: "11:30" }], repeat: "weekly", until: "2027-01-31", skipped: [] });
const deps = (over) => ({ lowPools: async () => [], refreshQuota: () => {}, prewarmAnswer: () => {}, speculate: null, addCalendarCard: (p) => ({ id: "a".repeat(32), events: p.events, skipped: [], unclear: [] }), ...over });

test("a calendar photo asks ARGON low first (accuracy first; Flash medium thought for 135 s in the real test); when it times out Flash medium takes over", async () => {
  const tried = [];
  const result = await handleTask("תוסיף את זה לקלנדר כל שבוע עד סוף ינואר", {
    image: { path: "p.png", ext: ".png" },
    deps: deps({ askImage: async (model) => { tried.push(model); if (tried.length === 1) throw new Error(model + " timed out after 90 s"); return timetableJson; } }),
  });
  assert.deepStrictEqual(tried, ["gemini-4-argon-low", "gemini-3.8-flash-medium"]);
  assert.ok(!tried.includes("gemini-3.8-flash-low"), "Flash low stays the front desk only");
  assert.strictEqual(result.calendarAdd.events.length, 1);
});

test("an ordinary photo question asks Argon low first (Flash medium only as the fallback)", async () => {
  const tried = [];
  await handleTask("what is in this photo?", { image: { path: "p.png", ext: ".png" }, deps: deps({ askImage: async (model) => { tried.push(model); return "a table"; } }) });
  assert.deepStrictEqual(tried, ["gemini-4-argon-low"]);
});
