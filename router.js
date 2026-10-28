// router.js
// The menu of places a task can go. The front desk (frontdesk.js) picks ONE name from
// DESTINATIONS; the code then runs that destination's chain. A chain is a list of models
// tried in order: the first is the preferred one, the rest are fallbacks if it fails.
//
// The front desk can only pick names that exist here. Anything else it writes is rejected,
// so a mistake (or a trick hidden in a user's message) can at worst pick a poor model.
// Based on experiments/2026-10-28-model-comparison.md:
//   - Gemini has the most quota room, so it handles most things.
//   - The claude CLI is kept for code and the hardest problems (shared Claude plan, scarce).
//   - Claude inside agy has the smallest quota, so it only appears as a last resort.

// Every model we can run. "provider" is the tool that runs it:
//   "claude" = Claude Code CLI (Claude plan), "agy" = Antigravity CLI (Google AI Pro plan).
// "pool" is the quota bucket the model draws from, spelled exactly as `agy -p "/usage"` names it
// (quota.js compares these). null = no numbers available (the Claude CLI plan), so it is never
// treated as low.
const MODELS = {
  flashMedium: { provider: "agy", model: "gemini-3.8-flash-medium", pool: "Gemini Models" },
  flashHigh: { provider: "agy", model: "gemini-3.8-flash-high", pool: "Gemini Models" }, // used by the front desk and the planner
  argonLow: { provider: "agy", model: "gemini-4-argon-low", pool: "Gemini 4 Argon" },
  argonMedium: { provider: "agy", model: "gemini-4-argon-medium", pool: "Gemini 4 Argon" },
  claudeSonnet: { provider: "claude", model: "sonnet", pool: null },
  claudeOpus: { provider: "claude", model: "opus", pool: null },
  claudeInAgy: { provider: "agy", model: "claude-sonnet-5-5-medium", pool: "Claude and GPT models" }, // smallest quota: last resort only
};

// The names the front desk may choose. Keep this list and router-brief.md in sync
// (a test checks that every name here is described in the briefing).
const DESTINATIONS = {
  "gemini-flash": [MODELS.flashMedium, MODELS.argonLow, MODELS.claudeSonnet],
  "gemini-argon-low": [MODELS.argonLow, MODELS.flashMedium, MODELS.claudeSonnet],
  "gemini-argon-medium": [MODELS.argonMedium, MODELS.claudeOpus, MODELS.claudeInAgy],
  "claude-sonnet": [MODELS.claudeSonnet, MODELS.argonMedium, MODELS.claudeInAgy],
  "claude-opus": [MODELS.claudeOpus, MODELS.argonMedium, MODELS.claudeSonnet],
};

// Used whenever something goes wrong with the front desk: Claude Sonnet takes the task.
const DEFAULT_CHAIN = DESTINATIONS["claude-sonnet"];

// The planner labels each sub-task with a type; this maps a type to a destination.
const TYPE_TO_DESTINATION = {
  quick: "gemini-flash",
  code: "claude-sonnet",
  hard: "gemini-argon-medium",
  google: "gemini-flash",
  general: "gemini-argon-low",
};

function chainForDestination(name) {
  return Object.hasOwn(DESTINATIONS, name) ? DESTINATIONS[name] : null;
}

function chainForType(type) {
  return chainForDestination(TYPE_TO_DESTINATION[type]) || DEFAULT_CHAIN;
}

module.exports = { MODELS, DESTINATIONS, DEFAULT_CHAIN, chainForDestination, chainForType };
