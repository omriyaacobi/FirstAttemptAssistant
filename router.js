// router.js
// The "brain" of the orchestrator: looks at a task and decides which model gets it.
// It is plain rules, no AI involved, so it is free, instant and easy to read.
// Based on experiments/2026-10-28-model-comparison.md:
//   - Gemini is the default (its quota barely moves, quality was comparable).
//   - The claude CLI is kept for coding tasks.
//   - Claude inside agy has the smallest quota, so it only appears as a last resort.

// Every model we can use. "provider" is the tool that runs it:
//   "claude" = Claude Code CLI (Claude plan), "agy" = Antigravity CLI (Google AI Pro plan).
const MODELS = {
  flashLow: { provider: "agy", model: "gemini-3.8-flash-low" },
  flashMedium: { provider: "agy", model: "gemini-3.8-flash-medium" },
  argonLow: { provider: "agy", model: "gemini-4-argon-low" },
  argonMedium: { provider: "agy", model: "gemini-4-argon-medium" },
  claudeSonnet: { provider: "claude", model: "sonnet" },
  claudeOpus: { provider: "claude", model: "opus" },
  claudeInAgy: { provider: "agy", model: "claude-sonnet-5-5-medium" }, // smallest quota: last resort only
};

// For each kind of task, a list of models to try in order.
// The first one is the preferred choice; the rest are fallbacks if it fails.
const CHAINS = {
  google: [MODELS.flashMedium, MODELS.argonLow, MODELS.claudeSonnet],
  hard: [MODELS.argonMedium, MODELS.claudeOpus, MODELS.claudeInAgy],
  code: [MODELS.claudeSonnet, MODELS.argonMedium, MODELS.claudeInAgy],
  quick: [MODELS.flashLow, MODELS.argonLow, MODELS.claudeSonnet],
  default: [MODELS.argonLow, MODELS.flashMedium, MODELS.claudeSonnet],
};

// Rules are checked from the top; the first one that matches wins.
// Order matters: Google tasks first (your request), then hard problems,
// then code, then short questions, and everything else gets the default chain.
const RULES = [
  {
    name: "google",
    reason: "mentions a Google product",
    test: (task) => /\b(calendar|gmail|google (docs?|sheets?|slides|drive|meet|maps)|appointments?)\b/i.test(task),
  },
  {
    name: "hard",
    reason: "needs deep reasoning (or is very long)",
    test: (task) =>
      task.length > 1200 ||
      /\b(architect(ure)?|design|trade-?offs?|analy[sz]e|compare|prove|optimi[sz]e|complex)\b/i.test(task),
  },
  {
    name: "code",
    reason: "looks like a coding task",
    test: (task) =>
      /```|\b(code|function|script|bug|error|exception|regex|refactor|compile|stack ?trace|javascript|python|sql|git)\b/i.test(task),
  },
  {
    name: "quick",
    reason: "short and simple, so use the cheapest model",
    test: (task) => task.length <= 120,
  },
];

// Returns { chain, rule, reason } for a task. chain[0] is the first choice.
function route(task) {
  for (const rule of RULES) {
    if (rule.test(task)) return { chain: CHAINS[rule.name], rule: rule.name, reason: rule.reason };
  }
  return { chain: CHAINS.default, rule: "default", reason: "no rule matched, using the default" };
}

// The planner labels each sub-task with a type; this turns a type into its model chain.
// "general" (writing, summaries, explanations) uses the default chain.
function chainForType(type) {
  return CHAINS[type] || CHAINS.default;
}

module.exports = { route, chainForType, MODELS, CHAINS, RULES };
