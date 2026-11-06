// frontdesk.test.js
// Tests the checks around the front desk model, without calling any real model.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { decide, validateDecision, buildPrompt, ACTIONS, SCHEMA, COMPACT_SCHEMA, BRIEF_FILE, BACKUP_BRIEF_FILE } = require("./frontdesk");
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

test("DRIFT: router-brief.md and router-brief-haiku.md name the same destinations and the same actions", () => {
  const names = (file) => {
    const text = fs.readFileSync(file, "utf8");
    return {
      destinations: [...new Set(text.match(/\b(?:gemini|claude|web)-[a-z-]*[a-z]\b/g) || [])].sort(),
      actions: [...new Set([...text.matchAll(/\*\*(\w+)\*\*/g)].map((m) => m[1]).filter((w) => ACTIONS.includes(w)))].sort(),
    };
  };
  const gemini = names(BRIEF_FILE);
  const haiku = names(BACKUP_BRIEF_FILE);
  assert.deepStrictEqual(haiku.destinations, gemini.destinations);
  assert.deepStrictEqual(haiku.actions, gemini.actions);
  assert.deepStrictEqual(haiku.destinations, Object.keys(DESTINATIONS).sort()); // and both match the real menu
  assert.deepStrictEqual(haiku.actions, [...ACTIONS].sort());
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
  const fake = async (prompt, model, schema, options) => {
    seen = { prompt, model, schema, options };
    return { action: "delegate", destination: "gemini-flash", answer: "", reason: "easy" };
  };
  const decision = await decide("summarize this", { askStructured: fake, brief: "B" });
  assert.strictEqual(decision.destination, "gemini-flash");
  assert.strictEqual(seen.model, "gemini-3.8-flash-low");
  assert.strictEqual(seen.schema, null); // the shape is described in the prompt and checked in code, not forced by agy
  assert.match(seen.prompt, /Reply with ONLY one JSON object/);
  for (const key of SCHEMA.required) assert.ok(seen.prompt.includes(key), key + " is named in the reply format");
  assert.ok(seen.options.signal && seen.options.timeoutMs > 0); // so a losing call can be killed
  assert.strictEqual(decision.hedged, false);
});

test("decide: a slow first call is hedged and the quick second call wins", async () => {
  let calls = 0;
  const fake = async (prompt, model, schema, { signal }) => {
    const mine = ++calls;
    if (mine === 1) return new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted"))); }); // never answers
    return { action: "answer", destination: "none", answer: "hi", reason: "r" };
  };
  const decision = await decide("hello", { askStructured: fake, brief: "B", hedgeAfterMs: 30, deadlineMs: 2000 });
  assert.strictEqual(decision.action, "answer");
  assert.strictEqual(decision.hedged, true);
  assert.strictEqual(calls, 2);
});

test("decide: an unusable first reply starts the second call at once, and a good one is used", async () => {
  let calls = 0;
  const fake = async () => (++calls === 1 ? { action: "delegate", destination: "evil" } : { action: "delegate", destination: "gemini-flash", reason: "ok" });
  const decision = await decide("x", { askStructured: fake, brief: "B", hedgeAfterMs: 60000, deadlineMs: 120000 });
  assert.strictEqual(decision.destination, "gemini-flash");
});

test("decide: gives up at the deadline so the caller can use its default", async () => {
  const stuck = (p, m, s, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const started = Date.now();
  await assert.rejects(decide("x", { askStructured: stuck, askBackup: async () => { throw new Error("claude down"); }, brief: "B", hedgeAfterMs: 20, deadlineMs: 150 }), /did not answer within/);
  assert.ok(Date.now() - started < 1500);
});

test("decide throws when the reply is unusable, so the caller can fall back", async () => {
  const backupDown = async () => { throw new Error("claude down"); };
  await assert.rejects(decide("x", { askStructured: async () => ({ action: "delegate", destination: "evil" }), askBackup: backupDown, brief: "B" }), /unusable/);
  await assert.rejects(decide("x", { askStructured: async () => { throw new Error("agy down"); }, askBackup: backupDown, brief: "B" }), /agy down.*claude down/);
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

// ---- the backup desk: Claude Haiku when the Gemini desk fails ----
const geminiDown = async () => { throw new Error("agy is down"); };
const NOW_FIXED = Date.UTC(2026, 10, 5, 12, 0, 0); // Thursday 2026-11-05, 14:00 in Jerusalem

test("backup: a Gemini failure gives the decision to Claude Haiku, with the briefing as a system file and the compact shape", async () => {
  let seen = null;
  const haiku = async (prompt, model, schema, options) => { seen = { prompt, model, schema, options }; return { action: "calendar", calendarFrom: "2026-11-06", calendarDays: "1", reason: "asks about tomorrow" }; };
  const logs = [];
  const d = await decide("what do I have tomorrow?", { askStructured: geminiDown, askBackup: haiku, now: NOW_FIXED, timezone: "Asia/Jerusalem", log: (l) => logs.push(l) });
  assert.strictEqual(d.via, "haiku");
  assert.deepStrictEqual(d.calendar, { from: "2026-11-06", days: 1 });
  assert.strictEqual(seen.model, "haiku");
  assert.strictEqual(seen.schema, COMPACT_SCHEMA);
  assert.strictEqual(seen.options.systemFile, BACKUP_BRIEF_FILE);
  assert.ok(seen.options.timeoutMs > 0);
  assert.match(seen.prompt, /The current time is 2026-11-05T14:00:00\+02:00/);
  assert.match(seen.prompt, /<message>\nwhat do I have tomorrow\?\n<\/message>/);
  assert.doesNotMatch(seen.prompt, /Front desk briefing/); // the briefing travels in the system file
  assert.doesNotMatch(seen.prompt, /Reply with ONLY one JSON object/); // the shape is forced by the schema instead
  assert.match(logs[0], /Gemini desk failed \(.*agy is down.*\); Claude Haiku decides/);
});

test("backup: a reminder from Haiku is checked by the same code (real future time, real zone)", async () => {
  const good = async () => ({ action: "remind", reminderText: "call the bank", remindAt: "2026-11-06T09:00:00", timezone: "Asia/Jerusalem", reason: "r" });
  const d = await decide("remind me tomorrow at 9 to call the bank", { askStructured: geminiDown, askBackup: good, now: NOW_FIXED });
  assert.strictEqual(d.via, "haiku");
  assert.deepStrictEqual(d.reminder, { text: "call the bank", at: Date.UTC(2026, 10, 6, 7, 0, 0), timezone: "Asia/Jerusalem" });
  const past = async () => ({ action: "remind", reminderText: "x", remindAt: "2026-11-04T09:00:00", timezone: "Asia/Jerusalem", reason: "r" });
  await assert.rejects(decide("remind me", { askStructured: geminiDown, askBackup: past, now: NOW_FIXED }), /unusable decision/);
});

test("backup: a Gemini deadline also hands over to Haiku", async () => {
  const stuck = (p, m, s, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const d = await decide("hi", { askStructured: stuck, askBackup: async () => ({ action: "answer", answer: "hello", reason: "greeting" }), hedgeAfterMs: 20, deadlineMs: 150 });
  assert.strictEqual(d.via, "haiku");
  assert.strictEqual(d.answer, "hello");
});

test("backup: not used when Gemini answers", async () => {
  let backupCalls = 0;
  const d = await decide("hi", { askStructured: async () => ({ action: "answer", answer: "hello", reason: "r" }), askBackup: async () => { backupCalls++; return {}; }, brief: "B" });
  assert.strictEqual(d.via, "gemini");
  assert.strictEqual(backupCalls, 0);
});

test("backup: an unusable Haiku reply, or Haiku failing too, makes decide throw so core.js can use Claude Sonnet", async () => {
  await assert.rejects(decide("x", { askStructured: geminiDown, askBackup: async () => ({ action: "delegate", destination: "evil" }) }), /agy is down; backup \(Claude Haiku\): the backup front desk returned an unusable decision/);
  await assert.rejects(decide("x", { askStructured: geminiDown, askBackup: async () => { throw new Error("OAuth session expired"); } }), /agy is down; backup \(Claude Haiku\): OAuth session expired/);
});

test("the compact schema only requires action and reason, and a reply without the empty fields still validates", () => {
  assert.deepStrictEqual(COMPACT_SCHEMA.required, ["action", "reason"]);
  assert.strictEqual(validateDecision({ action: "delegate", destination: "web-search", reason: "weather" }).destination, "web-search");
  assert.strictEqual(validateDecision({ action: "forget", replaces: "3", reason: "r" }).replaces, "3");
});

test("quota: when the Claude plan is low, the prompt warns about the Claude destinations (including Opus' own pool)", () => {
  const { quotaLine } = require("./frontdesk");
  const line = quotaLine([{ pool: "Claude plan", remaining: 3 }]);
  assert.match(line, /Claude plan \(3% left\)/);
  assert.match(line, /claude-sonnet/);
  assert.match(line, /claude-opus/);
  assert.doesNotMatch(line, /gemini-flash/);
  const opusOnly = quotaLine([{ pool: "Claude plan (Opus)", remaining: 3 }]);
  assert.match(opusOnly, /claude-opus/);
  assert.doesNotMatch(opusOnly, /claude-sonnet/);
});

test("quota: with Gemini failing and the Claude plan low, the Haiku backup desk is NOT used (it would spend the plan)", async () => {
  const logs = [];
  let haikuCalled = false;
  const geminiDown = async () => { throw new Error("agy is down"); };
  await assert.rejects(
    decide("x", { askStructured: geminiDown, askBackup: async () => { haikuCalled = true; return {}; }, brief: "B", low: [{ pool: "Claude plan", remaining: 3 }], log: (l) => logs.push(l) }),
    /skipped because the Claude plan is low/
  );
  assert.strictEqual(haikuCalled, false);
  assert.match(logs[0], /Haiku backup desk is not used/);
});

test("quota: a low Gemini pool alone does not stop the Haiku backup desk", async () => {
  const geminiDown = async () => { throw new Error("agy is down"); };
  const haiku = async () => ({ action: "answer", answer: "hello", reason: "r" });
  const d = await decide("x", { askStructured: geminiDown, askBackup: haiku, brief: "B", low: [{ pool: "Gemini Models", remaining: 3 }] });
  assert.strictEqual(d.via, "haiku");
});
