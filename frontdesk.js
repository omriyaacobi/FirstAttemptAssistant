// frontdesk.js
// The front desk reads each message (and the conversation so far) and decides what to do:
// answer it, ask a question, hand it to one destination, or have the planner split it.
//
// The judgment comes from a Gemini model following the plain-English briefing in
// router-brief.md (edit that file to change how it decides; no code changes needed).
// The code only does two things around the model:
//   1. forces its reply into a fixed shape (a JSON schema), and
//   2. CHECKS the reply (validateDecision). A model's text is never trusted: if it picks a
//      destination that is not on the menu, or returns nonsense, the decision is rejected.

const fs = require("node:fs");
const path = require("node:path");
const { createWarmAgy } = require("./warmagy");
const { askClaudeStructured } = require("./providers");
const { race } = require("./deskrace");
const { MODELS, DESTINATIONS } = require("./router");
const { parseWhen, cleanText, localIso } = require("./reminders");
const { checkFact } = require("./profile");
const { checkRequest } = require("./calendar-chat");

// Flash LOW: with the short briefing it made the same decisions as medium on 49 messages (0 wrong, 0 invalid) in about half
// the time, and in about 3.5 s when its process is pre-warmed (experiments/2026-11-05-frontdesk-speed.md).
const FRONT_DESK_MODEL = MODELS.flashLow;

// The slow tail: if the first call has not answered after HEDGE_AFTER_MS, a second identical call is started (a third after
// another HEDGE_AFTER_MS) and the first valid reply wins (the others are killed). A call that fails or returns an invalid reply
// starts the next one at once. After DEADLINE_MS the front desk gives up and core.js uses its default (Claude Sonnet).
// Measured: some messages (for example "what do I have on Thursday?") make Flash low think for 10-15 s in one call out of four,
// and the thinking time is random per call, so several independent calls shorten the tail.
const HEDGE_AFTER_MS = 4500; // a warm call normally answers in about 3 s, a cold one in about 5 s
const DEADLINE_MS = 30000;
const DESK_CALLS = 3; // so the 2nd call starts at 4.5 s and the 3rd at 9 s
const BRIEF_FILE = path.join(__dirname, "router-brief.md");

// The BACKUP front desk: when the Gemini desk above fails or hits its deadline, Claude Haiku makes the decision (about
// 4 s, same checks), so a Gemini outage no longer loses calendar, reminder and memory actions. Only if Haiku fails too does
// core.js hand the message to Claude Sonnet. Haiku gets its own briefing as its system prompt (router-brief-haiku.md: the
// same rules, with examples; a test checks the two list the same actions and destinations) and a reply shape that only
// requires "action" and "reason", which makes it write about half as many words. experiments/2026-11-05-frontdesk-haiku.md
const BACKUP_MODEL = "haiku";
const BACKUP_BRIEF_FILE = path.join(__dirname, "router-brief-haiku.md");
const BACKUP_TIMEOUT_MS = 25000;
// "improve" means: the user wants Bot to change itself. The front desk only REPLIES; the page then
// offers a button that opens "Improve Bot" with the request filled in, and the user starts it.
// "remind" means: the user wants to be reminded of something at a time. The model only EXTRACTS the
// text and the time; validateDecision checks the time is a real future moment (see reminders.js).
// "remember" means: the user stated a lasting fact or asked Bot to remember something. The model only
// PROPOSES the fact; validateDecision checks it (profile.js) and nothing is saved until the user presses Save.
// "calendar" means: the user asks what is on their calendar. The model only extracts a start day and a
// number of days; validateDecision checks them, then code reads the calendar and writes the reply
// (calendar-chat.js). No model ever sees an event.
const ACTIONS = ["answer", "clarify", "delegate", "split", "improve", "remind", "remember", "forget", "calendar"];
const MAX_ANSWER_CHARS = 8000;

// The shape we force the model's reply into. "none" is for the actions that need no destination.
const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    destination: { type: "string", enum: [...Object.keys(DESTINATIONS), "none"] },
    answer: { type: "string" },
    reason: { type: "string" },
    // Only for the action "remind"; empty strings otherwise.
    reminderText: { type: "string" },
    remindAt: { type: "string" },
    timezone: { type: "string" },
    // Only for the action "remember"; empty otherwise.
    fact: { type: "string" },
    // For "remember" (when it CHANGES a saved fact) and "forget": the number of that saved fact, else "".
    replaces: { type: "string" },
    // Only for the action "calendar": the first day (YYYY-MM-DD) and how many days (1-14); empty otherwise.
    calendarFrom: { type: "string" },
    calendarDays: { type: "string" },
  },
  required: ["action", "destination", "answer", "reason", "reminderText", "remindAt", "timezone", "fact", "replaces", "calendarFrom", "calendarDays"],
};

// The shape for the backup desk (forced through claude's --json-schema): only "action" and "reason" are required, and
// validateDecision treats a missing field as empty.
const COMPACT_SCHEMA = { ...SCHEMA, required: ["action", "reason"] };

// The reply shape is described in the prompt and CHECKED by validateDecision, instead of agy's --json-schema mode: in about
// 300 test calls the schema mode gave every invalid reply and the one 90 s hang, the plain mode none.
const REPLY_FORMAT = "\n\nReply with ONLY one JSON object, nothing before or after it, no markdown. It must have exactly these keys, all with string values (use \"\" for the ones the action does not need): " + SCHEMA.required.join(", ") + ".";

// One pre-warmed agy waits for the next message (warmagy.js).
const warm = createWarmAgy({ keepReady: true });
// Called when Bot starts, so the first message is warm too.
const warmUpDesk = () => warm.warmUp(FRONT_DESK_MODEL.model, null);

// Reads the briefing each time, so edits to the file take effect on the next message.
const readBrief = () => fs.readFileSync(BRIEF_FILE, "utf8");

// One line telling the model which quota pools are low and which destinations that affects
// (the ones whose FIRST choice is in a low pool). Empty when nothing is low. This is advice only:
// core.js reorders the chain by code whatever the front desk picks.
function quotaLine(low = []) {
  if (!low.length) return "";
  const names = new Set(low.map((p) => p.pool));
  const affected = Object.entries(DESTINATIONS).filter(([, chain]) => names.has(chain[0].pool)).map(([name]) => name);
  const pools = low.map((p) => `${p.pool} (${p.remaining}% left)`).join(", ");
  return `Low quota right now: ${pools}.` + (affected.length ? ` Avoid these destinations unless nothing else fits: ${affected.join(", ")}.` : "");
}

// The model needs today's date and the time zone to turn "tomorrow at 9" into a real time.
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
function nowLine(now = Date.now(), timezone = localZone()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(new Date(now));
  return `The current time is ${localIso(now, timezone)} (${day}), time zone ${timezone}. Use this time zone for reminders unless the user names another.`;
}

function buildPrompt(task, { history = "", allowSplit = true, brief = readBrief(), low = [], now = Date.now(), timezone = localZone(), about = "" } = {}) {
  return [
    brief,
    "## Right now",
    nowLine(now, timezone),
    allowSplit ? "Splitting is allowed." : 'The user turned splitting off: do NOT choose the action "split".',
    quotaLine(low),
    about, // the profile and saved facts (profile.js), already inside their markers; "" when there are none
    history ? `## Conversation so far\n${history.replace(/^Conversation so far[^\n]*\n/, "")}` : "## Conversation so far\n(none, this is the first message)",
    `## The user's new message\n<message>\n${task}\n</message>`,
  ].filter(Boolean).join("\n\n");
}

// Returns a clean decision, or null if the model's reply is unusable.
// `now` is only used to check that a reminder's time is in the future (tests pass a fixed one).
function validateDecision(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  if (!ACTIONS.includes(raw.action)) return null;

  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 200) : "";
  const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";

  if (raw.action === "remind") {
    // The model only extracted a text and a time. The code decides whether they are usable.
    try {
      const text = cleanText(raw.reminderText);
      const at = parseWhen(raw.remindAt, raw.timezone, now);
      return { action: "remind", destination: null, answer: "", reason, reminder: { text, at, timezone: raw.timezone } };
    } catch (error) {
      return null;
    }
  }

  // The number of a saved fact (see profile.js pickFacts). Only digits get through; core.js maps it to the real fact.
  const replaces = /^\d{1,3}$/.test(String(raw.replaces || "").trim()) ? String(raw.replaces).trim() : "";
  if (raw.action === "forget") return { action: "forget", destination: null, answer: "", reason, replaces };
  if (raw.action === "remember") {
    // Code decides whether the proposed fact may be offered. A refused one (a secret, too long) becomes a plain reply.
    try {
      return { action: "remember", destination: null, answer: "", reason, fact: checkFact(raw.fact), replaces };
    } catch (error) {
      return { action: "remember", destination: null, answer: error.message, reason, fact: "" };
    }
  }
  if (raw.action === "calendar") {
    try {
      return { action: "calendar", destination: null, answer: "", reason, calendar: checkRequest({ from: raw.calendarFrom, days: raw.calendarDays }) };
    } catch (error) {
      return null;
    }
  }

  if (raw.action === "answer" || raw.action === "clarify" || raw.action === "improve") {
    if (!answer || answer.length > MAX_ANSWER_CHARS) return null;
    return { action: raw.action, destination: null, answer, reason };
  }
  if (raw.action === "delegate") {
    if (typeof raw.destination !== "string" || !Object.hasOwn(DESTINATIONS, raw.destination)) return null;
    return { action: "delegate", destination: raw.destination, answer: "", reason };
  }
  return { action: "split", destination: null, answer: "", reason };
}

// Asks the front desk model. Throws if it fails or its reply is unusable, so the caller
// can fall back to Claude Sonnet.
// A reply that fails validateDecision counts as a failed call: the next call is started at once.
// The result says "hedged: true" when the second call had to be started.
// If the Gemini desk fails (error, invalid replies, deadline), the BACKUP desk (Claude Haiku) decides; the result then says
// "via: 'haiku'". decide throws only when the backup fails too. askBackup is a parameter so tests can plug in a fake.
async function decide(task, { history = "", allowSplit = true, askStructured = warm.askStructured, askBackup = askClaudeStructured, brief, low = [], about = "", now, timezone, hedgeAfterMs = HEDGE_AFTER_MS, deadlineMs = DEADLINE_MS, calls = DESK_CALLS, log = () => {} } = {}) {
  const prompt = buildPrompt(task, { history, allowSplit, brief, low, about, now, timezone }) + REPLY_FORMAT;
  const starts = Array.from({ length: calls }, () => (signal) => askStructured(prompt, FRONT_DESK_MODEL.model, null, { signal, timeoutMs: deadlineMs }));
  try {
    const { result, started } = await race(starts, { accept: (raw) => validateDecision(raw, { now }), hedgeAfterMs, deadlineMs });
    return { ...result, hedged: started > 1, via: "gemini" };
  } catch (geminiError) {
    log(`[frontdesk] the Gemini desk failed (${String(geminiError.message).slice(0, 120)}); Claude Haiku decides instead`);
    const message = buildPrompt(task, { history, allowSplit, brief: "", low, about, now, timezone }); // the briefing is the system file
    try {
      const raw = await askBackup(message, BACKUP_MODEL, COMPACT_SCHEMA, { systemFile: BACKUP_BRIEF_FILE, timeoutMs: BACKUP_TIMEOUT_MS });
      const decision = validateDecision(raw, { now });
      if (!decision) throw new Error("the backup front desk returned an unusable decision");
      return { ...decision, hedged: false, via: "haiku" };
    } catch (backupError) {
      throw new Error(`${geminiError.message}; backup (Claude Haiku): ${backupError.message}`);
    }
  }
}

module.exports = { decide, warm, warmUpDesk, REPLY_FORMAT, validateDecision, buildPrompt, quotaLine, FRONT_DESK_MODEL, ACTIONS, SCHEMA, COMPACT_SCHEMA, BRIEF_FILE, BACKUP_BRIEF_FILE };
