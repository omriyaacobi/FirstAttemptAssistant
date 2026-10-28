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

const FRONT_DESK_MODEL = MODELS.flashHigh;
const BRIEF_FILE = path.join(__dirname, "router-brief.md");
// "improve" means: the user wants Bot to change itself. The front desk only REPLIES; the page then
// offers a button that opens "Improve Bot" with the request filled in, and the user starts it.
const ACTIONS = ["answer", "clarify", "delegate", "split", "improve"];
const MAX_ANSWER_CHARS = 8000;

// The shape we force the model's reply into. "none" is for the actions that need no destination.
const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    destination: { type: "string", enum: [...Object.keys(DESTINATIONS), "none"] },
    answer: { type: "string" },
    reason: { type: "string" },
  },
  required: ["action", "destination", "answer", "reason"],
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

function buildPrompt(task, { history = "", allowSplit = true, brief = readBrief(), low = [] } = {}) {
  return [
    brief,
    "## Right now",
    allowSplit ? "Splitting is allowed." : 'The user turned splitting off: do NOT choose the action "split".',
    quotaLine(low),
    history ? `## Conversation so far\n${history.replace(/^Conversation so far[^\n]*\n/, "")}` : "## Conversation so far\n(none, this is the first message)",
    `## The user's new message\n<message>\n${task}\n</message>`,
  ].filter(Boolean).join("\n\n");
}

// Returns a clean decision, or null if the model's reply is unusable.
function validateDecision(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!ACTIONS.includes(raw.action)) return null;

  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 200) : "";
  const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";

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
async function decide(task, { history = "", allowSplit = true, askStructured = askAgyStructured, brief, low = [] } = {}) {
  const prompt = buildPrompt(task, { history, allowSplit, brief, low });
  const raw = await askStructured(prompt, FRONT_DESK_MODEL.model, SCHEMA);
  const decision = validateDecision(raw);
  if (!decision) throw new Error("the front desk returned an unusable decision");
  return decision;
}

module.exports = { decide, validateDecision, buildPrompt, quotaLine, FRONT_DESK_MODEL, ACTIONS, SCHEMA, BRIEF_FILE };
