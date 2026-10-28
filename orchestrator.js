// orchestrator.js
// The command-line front end. All the real work happens in core.js; this file only
// reads what you typed, calls handleTask(), and prints the result.
//
// Usage:
//   node orchestrator.js "your task"
//   node orchestrator.js --dry-run "your task"        (show what would happen, call no model)
//   node orchestrator.js --plan-only "your task"      (let the front desk decide, show the plan, stop)
//   node orchestrator.js --no-plan "your task"        (never split, treat it as one job)
//   node orchestrator.js --force claude:opus "task"   (skip the front desk, pick yourself; list with commas for fallbacks)
//
// The web page (node server.js) uses the same core.js, so both behave the same way.

const { DEFAULT_CHAIN } = require("./router");
const { FRONT_DESK_MODEL } = require("./frontdesk");
const { handleTask, chainText, label } = require("./core");

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false, planOnly = false, noPlan = false, forced = null;
  const words = [];

  // A tiny hand-written argument parser: pull out the flags, keep the rest as the task.
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--plan-only") planOnly = true;
    else if (args[i] === "--no-plan") noPlan = true;
    else if (args[i] === "--force") forced = args[++i];
    else words.push(args[i]);
  }

  const task = words.join(" ").trim();
  if (!task) {
    console.error('Usage: node orchestrator.js [--dry-run] [--plan-only] [--no-plan] [--force provider:model[,provider:model]] "your task"');
    process.exit(1);
  }

  if (dryRun) {
    if (forced) return console.error(`[router] plan: ${forced.split(",").join("  ->  ")}`);
    console.error(`[frontdesk] would ask ${label(FRONT_DESK_MODEL)} to decide (no model is called in a dry run)`);
    return console.error(`[router] if it fails, Claude Sonnet takes it: ${chainText(DEFAULT_CHAIN)}`);
  }

  // Progress goes to stderr, the final answer to stdout, so the answer stays clean.
  const result = await handleTask(task, { noPlan, planOnly, forced, log: (line) => console.error(line) });

  if (result.mode === "single") {
    console.log(result.answer);
    console.error(`[router] done in ${result.seconds}s`);
  } else if (result.mode === "split") {
    for (const step of result.steps) {
      console.log(`\n## Step ${step.id}: ${step.task}`);
      console.log(step.error ? `(failed: ${step.error})` : `[${label(step.used)}]\n\n${step.answer}`);
    }
    console.error(`[planner] all steps finished in ${result.seconds}s`);
  }
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
