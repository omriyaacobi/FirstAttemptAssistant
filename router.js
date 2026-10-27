// router.js
// The "brain" of the orchestrator: looks at a task and decides which model gets it.
// It is plain rules, no AI involved, so it is free, instant and easy to read.
// To change who gets what, edit ROUTES (the destinations) or RULES (the conditions).

// Destinations. "provider" is which tool runs it: "claude" (Claude Code CLI,
// uses the Claude plan) or "agy" (Antigravity CLI, uses the Google AI Pro plan).
const ROUTES = {
  google: { provider: "agy", model: "gemini-3.8-flash-medium" },
  hard: { provider: "agy", model: "gemini-4-argon-medium" },
  code: { provider: "claude", model: "sonnet" },
  quick: { provider: "agy", model: "gemini-3.8-flash-low" },
  fallback: { provider: "claude", model: "sonnet" },
};

// Rules are checked from the top; the first one that matches wins.
// Order matters: Google tasks go to Gemini first (your request), then hard problems,
// then code, then short questions, and everything else gets the fallback.
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

// Returns { provider, model, rule, reason } for a task.
function route(task) {
  for (const rule of RULES) {
    if (rule.test(task)) return { ...ROUTES[rule.name], rule: rule.name, reason: rule.reason };
  }
  return { ...ROUTES.fallback, rule: "fallback", reason: "no rule matched, using the default" };
}

module.exports = { route, ROUTES, RULES };
