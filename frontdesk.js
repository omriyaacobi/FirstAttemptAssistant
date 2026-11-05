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
const { askAgyStructured } = require("./providers");
const { MODELS, DESTINATIONS } = require("./router");
const { parseWhen, cleanText, localIso } = require("./reminders");
const { checkFact } = require("./profile");

const FRONT_DESK_MODEL = MODELS.flashMedium; // medium was ~5 s faster than high with identical decisions on 19 prompts (experiments/2026-11-04-speed-part2.md)
const BRIEF_FILE = path.join(__dirname, "router-brief.md");
// "improve" means: the user wants Bot to change itself. The front desk only REPLIES; the page then
// offers a button that opens "Improve Bot" with the request filled in, and the user starts it.
// "remind" means: the user wants to be reminded of something at a time. The model only EXTRACTS the
// text and the time; validateDecision checks the time is a real future moment (see reminders.js).
// "remember" means: the user stated a lasting fact or asked Bot to remember something. The model only
// PROPOSES the fact; validateDecision checks it (profile.js) and nothing is saved until the user presses Save.
const ACTIONS = ["answer", "clarify", "delegate", "split", "improve", "remind", "remember"];
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
  },
  required: ["action", "destination", "answer", "reason", "reminderText", "remindAt", "timezone", "fact"],
};

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

  if (raw.action === "remember") {
    // Code decides whether the proposed fact may be offered. A refused one (a secret, too long) becomes a plain reply.
    try {
      return { action: "remember", destination: null, answer: "", reason, fact: checkFact(raw.fact) };
    } catch (error) {
      return { action: "remember", destination: null, answer: error.message, reason, fact: "" };
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
async function decide(task, { history = "", allowSplit = true, askStructured = askAgyStructured, brief, low = [], about = "" } = {}) {
  const prompt = buildPrompt(task, { history, allowSplit, brief, low, about });
  const raw = await askStructured(prompt, FRONT_DESK_MODEL.model, SCHEMA);
  const decision = validateDecision(raw);
  if (!decision) throw new Error("the front desk returned an unusable decision");
  return decision;
}

module.exports = { decide, validateDecision, buildPrompt, quotaLine, FRONT_DESK_MODEL, ACTIONS, SCHEMA, BRIEF_FILE };
