// frontdesk.test.js
// Tests the checks around the front desk model, without calling any real model.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { decide, validateDecision, buildPrompt, ACTIONS, SCHEMA, BRIEF_FILE } = require("./frontdesk");
const { DESTINATIONS } = require("./router");

test("validateDecision accepts each kind of good decision", () => {
  assert.deepStrictEqual(validateDecision({ action: "answer", destination: "none", answer: " 56 ", reason: "simple" }),
    { action: "answer", destination: null, answer: "56", reason: "simple" });
  assert.strictEqual(validateDecision({ action: "clarify", destination: "none", answer: "What do you mean?", reason: "vague" }).action, "clarify");
  assert.strictEqual(validateDecision({ action: "delegate", destination: "claude-sonnet", answer: "", reason: "code" }).destination, "claude-sonnet");
  assert.strictEqual(validateDecision({ action: "split", destination: "none", answer: "", reason: "three jobs" }).action, "split");
});

test("improve: accepted with a reply, rejected without one", () => {
  const d = validateDecision({ action: "improve", destination: "none", answer: "Use the button below.", reason: "wants a redesign" });
  assert.deepStrictEqual(d, { action: "improve", destination: null, answer: "Use the button below.", reason: "wants a redesign" });
  assert.strictEqual(validateDecision({ action: "improve", destination: "none", answer: "", reason: "x" }), null);
});

test("SECURITY: a destination that is not on the menu is rejected", () => {
  for (const bad of ["rm -rf /", "gemini-9-ultra", "none", "", "toString", "__proto__", "claude-sonnet; whoami", 42, null]) {
    assert.strictEqual(validateDecision({ action: "delegate", destination: bad, answer: "", reason: "x" }), null, String(bad));
  }
});

test("validateDecision rejects unknown actions and malformed input", () => {
  assert.strictEqual(validateDecision({ action: "run_command", destination: "none", answer: "", reason: "" }), null);
  assert.strictEqual(validateDecision(null), null);
  assert.strictEqual(validateDecision("delegate"), null);
  assert.strictEqual(validateDecision({}), null);
});

test("answer and clarify need real text, and not too much of it", () => {
  assert.strictEqual(validateDecision({ action: "answer", destination: "none", answer: "   ", reason: "x" }), null);
  assert.strictEqual(validateDecision({ action: "clarify", destination: "none", answer: "", reason: "x" }), null);
  assert.strictEqual(validateDecision({ action: "answer", destination: "none", answer: "x".repeat(9000), reason: "x" }), null);
});

test("the reason is trimmed and cut", () => {
  const d = validateDecision({ action: "split", destination: "none", answer: "", reason: "  " + "r".repeat(500) });
  assert.strictEqual(d.reason.length, 200);
});

test("the schema only allows the menu names (plus none)", () => {
  assert.deepStrictEqual([...SCHEMA.properties.destination.enum].sort(), [...Object.keys(DESTINATIONS), "none"].sort());
  assert.deepStrictEqual(SCHEMA.properties.action.enum, ACTIONS);
});

test("the briefing describes every destination and every action", () => {
  const brief = fs.readFileSync(BRIEF_FILE, "utf8");
  for (const name of Object.keys(DESTINATIONS)) assert.ok(brief.includes(name), `router-brief.md does not mention ${name}`);
  for (const action of ACTIONS) assert.ok(brief.includes(action), `router-brief.md does not mention ${action}`);
});

test("the Haiku briefing describes every destination and every action too", () => {
  const brief = fs.readFileSync(require("./frontdesk").HAIKU_BRIEF_FILE, "utf8");
  for (const name of Object.keys(DESTINATIONS)) assert.ok(brief.includes(name), `router-brief-haiku.md does not mention ${name}`);
  for (const action of ACTIONS) assert.ok(brief.includes(action), `router-brief-haiku.md does not mention ${action}`);
});

test("the prompt contains the briefing, the history and the message between markers", () => {
  const prompt = buildPrompt("what is 7 times 8?", { history: "Conversation so far (oldest first), for context only:\nUser: hi", brief: "BRIEF TEXT" });
  assert.match(prompt, /^BRIEF TEXT/);
  assert.match(prompt, /User: hi/);
  assert.match(prompt, /<message>\nwhat is 7 times 8\?\n<\/message>/);
  assert.match(prompt, /Splitting is allowed/);
});

test("the prompt says so when splitting is turned off, and when there is no history", () => {
  const prompt = buildPrompt("x", { allowSplit: false, brief: "B" });
  assert.match(prompt, /do NOT choose the action "split"/);
  assert.match(prompt, /\(none, this is the first message\)/);
});

test("decide returns a validated decision from the model's reply", async () => {
  let seen = null;
  const fake = async (prompt, model, schema) => {
    seen = { prompt, model, schema };
    return { action: "delegate", destination: "gemini-flash", answer: "", reason: "easy" };
  };
  const decision = await decide("summarize this", { askStructured: fake, brief: "B" });
  assert.strictEqual(decision.destination, "gemini-flash");
  assert.strictEqual(seen.model, "gemini-3.8-flash-medium");
  assert.strictEqual(seen.schema, SCHEMA);
});

test("decide throws when the reply is unusable, so the caller can fall back", async () => {
  await assert.rejects(decide("x", { askStructured: async () => ({ action: "delegate", destination: "evil" }), brief: "B" }), /unusable/);
  await assert.rejects(decide("x", { askStructured: async () => { throw new Error("agy down"); }, brief: "B" }), /agy down/);
});

test("quota: the prompt names low pools and the destinations they affect; silent when nothing is low", () => {
  const { buildPrompt, quotaLine } = require("./frontdesk");
  const low = [{ pool: "Gemini 4 Argon", remaining: 4 }];
  const line = quotaLine(low);
  assert.match(line, /Gemini 4 Argon \(4% left\)/);
  assert.match(line, /gemini-argon-medium/);
  assert.doesNotMatch(line, /claude-opus/);
  assert.ok(buildPrompt("hi", { brief: "BRIEF", low }).includes(line));
  assert.strictEqual(quotaLine([]), "");
  assert.ok(!buildPrompt("hi", { brief: "BRIEF" }).includes("Low quota"));
});

// ---- remind ----
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const remind = (over = {}) => ({ action: "remind", destination: "none", answer: "", reason: "wants a reminder",
  reminderText: "call the bank", remindAt: "2026-11-02T09:00:00", timezone: "Asia/Jerusalem", ...over });

test("remind: a real future time becomes a checked reminder (milliseconds)", () => {
  const d = validateDecision(remind(), { now: NOW });
  assert.deepStrictEqual(d, { action: "remind", destination: null, answer: "", reason: "wants a reminder",
    reminder: { text: "call the bank", at: Date.UTC(2026, 10, 2, 7, 0, 0), timezone: "Asia/Jerusalem" } });
});

test("SECURITY: remind is rejected for a past time, a fake date, no time zone, an unknown zone or no text", () => {
  const bad = [{ remindAt: "2026-10-31T09:00:00" }, { remindAt: "2026-02-30T09:00:00" }, { remindAt: "tomorrow 9am" }, { remindAt: "" },
    { timezone: "" }, { timezone: "Not/AZone" }, { reminderText: "   " }, { reminderText: undefined }, { remindAt: undefined }];
  for (const over of bad) assert.strictEqual(validateDecision(remind(over), { now: NOW }), null, JSON.stringify(over));
});

test("the prompt tells the model the current time and zone, for working out 'tomorrow at 9'", () => {
  const prompt = buildPrompt("remind me tomorrow", { brief: "B", now: NOW });
  assert.match(prompt, /The current time is 2026-11-01T14:00:00\+02:00 \(Sunday\), time zone /);
});

test("the schema asks for the reminder fields", () => {
  for (const f of ["reminderText", "remindAt", "timezone"]) assert.ok(SCHEMA.required.includes(f) && SCHEMA.properties[f]);
});

// ---- the Haiku desk and its Flash fallback ----
const { resetCoolDowns, DESK_COOLDOWN_MS, FRONT_DESK } = require("./frontdesk");
const GOOD = { action: "delegate", destination: "claude-sonnet", answer: "", reason: "code" };

test("the default front desk is still Flash (Haiku is opt-in by changing one word)", () => {
  assert.strictEqual(FRONT_DESK, "flash");
});

test("haiku desk: Claude answers when it works, and Flash is never called", async () => {
  resetCoolDowns();
  const calls = [];
  const claude = async (p, model) => { calls.push("claude:" + model); return GOOD; };
  const flash = async () => { calls.push("flash"); return GOOD; };
  const d = await decide("fix my code", { desk: "haiku", askStructured: claude, askFallback: flash, brief: "B" });
  assert.strictEqual(d.via, "haiku");
  assert.deepStrictEqual(calls, ["claude:haiku"]);
});

test("haiku desk: a failing Claude (login, limit, timeout) hands the message to Flash at once", async () => {
  resetCoolDowns();
  const logs = [];
  const claude = async () => { throw new Error("OAuth session expired"); };
  const flash = async (p, model) => { assert.strictEqual(model, "gemini-3.8-flash-medium"); return GOOD; };
  const d = await decide("fix my code", { desk: "haiku", askStructured: claude, askFallback: flash, brief: "B", log: (l) => logs.push(l) });
  assert.strictEqual(d.via, "flash");
  assert.strictEqual(d.destination, "claude-sonnet");
  assert.match(logs[0], /claude\/haiku failed \(OAuth session expired\)/);
});

test("haiku desk: after a failure the next messages skip Claude for a while, then try it again", async () => {
  resetCoolDowns();
  let claudeCalls = 0;
  const claude = async () => { claudeCalls++; throw new Error("rate limit"); };
  const flash = async () => GOOD;
  const t0 = 1_000_000;
  await decide("a", { desk: "haiku", askStructured: claude, askFallback: flash, brief: "B", now: t0 });
  await decide("b", { desk: "haiku", askStructured: claude, askFallback: flash, brief: "B", now: t0 + 1000 });
  assert.strictEqual(claudeCalls, 1, "the second message did not pay for a failed Claude call");
  await decide("c", { desk: "haiku", askStructured: claude, askFallback: flash, brief: "B", now: t0 + DESK_COOLDOWN_MS + 1 });
  assert.strictEqual(claudeCalls, 2, "after the cool-down Claude is tried again");
});

test("haiku desk: a reply that fails the checks falls back for that message only (no cool-down)", async () => {
  resetCoolDowns();
  let claudeCalls = 0;
  const claude = async () => { claudeCalls++; return { action: "delegate", destination: "evil" }; };
  const d1 = await decide("a", { desk: "haiku", askStructured: claude, askFallback: async () => GOOD, brief: "B" });
  assert.strictEqual(d1.via, "flash");
  await decide("b", { desk: "haiku", askStructured: claude, askFallback: async () => GOOD, brief: "B" });
  assert.strictEqual(claudeCalls, 2);
});

test("haiku desk: when Flash fails too, decide throws so core.js can use Claude Sonnet", async () => {
  resetCoolDowns();
  await assert.rejects(decide("x", { desk: "haiku", askStructured: async () => { throw new Error("down"); }, askFallback: async () => { throw new Error("agy down"); }, brief: "B" }), /agy down/);
});

test("an unknown desk name is refused", async () => {
  await assert.rejects(decide("x", { desk: "gpt", brief: "B" }), /unknown front desk/);
});

test("haiku desk: Claude gets the briefing as a system file, a message without it, and the compact schema", async () => {
  resetCoolDowns();
  const { HAIKU_BRIEF_FILE, COMPACT_SCHEMA } = require("./frontdesk");
  let seen = null;
  const claude = async (prompt, model, schema, opts) => { seen = { prompt, model, schema, opts }; return { action: "answer", answer: "391", reason: "math" }; }; // no empty fields: the compact shape
  const d = await decide("17 times 23", { desk: "haiku", askStructured: claude, askFallback: async () => GOOD });
  assert.strictEqual(d.via, "haiku");
  assert.strictEqual(d.answer, "391");
  assert.strictEqual(seen.opts.systemFile, HAIKU_BRIEF_FILE);
  assert.strictEqual(seen.schema, COMPACT_SCHEMA);
  assert.match(seen.prompt, /<message>\n17 times 23\n<\/message>/);
  assert.doesNotMatch(seen.prompt, /Front desk briefing/); // the briefing travels in the system file instead
});

test("the compact schema only requires action and reason, and a reply without the empty fields still validates", () => {
  const { COMPACT_SCHEMA } = require("./frontdesk");
  assert.deepStrictEqual(COMPACT_SCHEMA.required, ["action", "reason"]);
  assert.strictEqual(validateDecision({ action: "delegate", destination: "web-search", reason: "weather" }).destination, "web-search");
  assert.strictEqual(validateDecision({ action: "calendar", calendarFrom: "2026-11-06", calendarDays: "1", reason: "r" }).calendar.days, 1);
  assert.strictEqual(validateDecision({ action: "forget", replaces: "3", reason: "r" }).replaces, "3");
});
