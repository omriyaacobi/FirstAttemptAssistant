// router.js
// The MODELS Bot can ask (each with the quota pool it draws from) and a few named chains.
// A chain is a list of models tried in order: the first is the preferred one, the rest are fallbacks if it fails.
// The brain (brain.js) has its own chain; the course notebook (study.js), the tutor, the reader and the summaries take theirs from here.
// (Until 2026-11-12 a "front desk" model picked a destination name from this file; the brain replaced it.)
// Based on experiments/2026-10-28-model-comparison.md:
//   - Gemini has the most quota room, so it handles most things.
//   - The claude CLI is kept for code and the hardest problems (shared Claude plan, scarce).
//   - Claude inside agy has the smallest quota, so it only appears as a last resort.

// Every model we can run. "provider" is the tool that runs it:
//   "claude" = Claude Code CLI (Claude plan), "agy" = Antigravity CLI (Google AI Pro plan),
//   "web" and "research" = agy with its search_web tool, for a quick look-up or for real research.
// "pool" is the quota bucket the model draws from, spelled exactly as `agy -p "/usage"` names it
// (quota.js compares these). A model can draw from SEVERAL pools (an array): Claude Opus has its own weekly limit
// on top of the Claude plan's two limits. The Claude CLI is not in `agy /usage`; its numbers come from quota.js
// (the "rate_limit_event" messages that `claude --output-format stream-json` prints, or a limit error when a call fails).
const CLAUDE_PLAN = "Claude plan", CLAUDE_OPUS_WEEK = "Claude plan (Opus)";
const GEMINI = "Gemini Models", ARGON = "Gemini 4 Argon", CLAUDE_AGY = "Claude and GPT models"; // the pool names
const MODELS = {
  flashMedium: { provider: "agy", model: "gemini-3.8-flash-medium", pool: "Gemini Models" },
  flashLow: { provider: "agy", model: "gemini-3.8-flash-low", pool: "Gemini Models" }, // only for short helper calls (the other-language search words, crosslang.js)
  flashHigh: { provider: "agy", model: "gemini-3.8-flash-high", pool: "Gemini Models" }, // used by the planner
  argonLow: { provider: "agy", model: "gemini-4-argon-low", pool: "Gemini 4 Argon" },
  argonMedium: { provider: "agy", model: "gemini-4-argon-medium", pool: "Gemini 4 Argon" },
  claudeSonnet: { provider: "claude", model: "sonnet", pool: CLAUDE_PLAN },
  claudeOpus: { provider: "claude", model: "opus", pool: [CLAUDE_PLAN, CLAUDE_OPUS_WEEK] },
  claudeHaiku: { provider: "claude", model: "haiku", pool: CLAUDE_PLAN }, // the tiny quota probe (quota.js)
  claudeInAgy: { provider: "agy", model: "claude-sonnet-5-5-medium", pool: "Claude and GPT models" }, // smallest quota: last resort only
  sonnetInAgy: { provider: "agy", model: "claude-sonnet-5-5-low", pool: CLAUDE_AGY }, // the brain's 2nd model: agy's own Claude pool, NOT the Claude Pro plan (experiments/2026-11-11-quota-stretch.md)
  webFlash: { provider: "web", model: "gemini-3.8-flash-medium", pool: GEMINI },
  webFlashHigh: { provider: "web", model: "gemini-3.8-flash-high", pool: GEMINI },
  webClaude: { provider: "web", model: "claude-sonnet-5-5-medium", pool: CLAUDE_AGY },
  researchArgon: { provider: "research", model: "gemini-4-argon-medium", pool: ARGON },
  researchFlash: { provider: "research", model: "gemini-3.8-flash-high", pool: GEMINI },
  researchClaude: { provider: "research", model: "claude-sonnet-5-5-medium", pool: CLAUDE_AGY },
};

// Named chains (study.js asks for one by name with chainForDestination).
const DESTINATIONS = {
  "gemini-flash": [MODELS.flashMedium, MODELS.argonLow, MODELS.claudeSonnet],
  "gemini-argon-low": [MODELS.argonLow, MODELS.flashMedium, MODELS.claudeSonnet],
  "gemini-argon-medium": [MODELS.argonMedium, MODELS.claudeOpus, MODELS.claudeInAgy, MODELS.claudeSonnet], // Claude (the plan) is the last resort
  "claude-sonnet": [MODELS.claudeSonnet, MODELS.argonMedium, MODELS.claudeInAgy],
  "claude-opus": [MODELS.claudeOpus, MODELS.argonMedium, MODELS.claudeSonnet],
  // Only models that can search: a model without the web would just guess.
  "web-search": [MODELS.webFlash, MODELS.webFlashHigh, MODELS.webClaude],
  "web-research": [MODELS.researchArgon, MODELS.researchFlash, MODELS.researchClaude],
};

// The pools a model draws from, as a list (a model may have one pool, several, or none).
const poolsOf = (m) => [].concat((m && m.pool) || []);

// Which pools a model (as named in a log or an error) draws from; [] when it is not one of ours.
function poolsForModel(provider, model) {
  const known = Object.values(MODELS).find((m) => m.provider === provider && m.model === model);
  return poolsOf(known);
}

function chainForDestination(name) {
  return Object.hasOwn(DESTINATIONS, name) ? DESTINATIONS[name] : null;
}

module.exports = { CLAUDE_PLAN, CLAUDE_OPUS_WEEK, poolsOf, poolsForModel, MODELS, DESTINATIONS, chainForDestination };
