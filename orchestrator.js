// orchestrator.js
// The main program. It takes a task, asks router.js who should handle it,
// asks providers.js to run it, and prints the answer.
//
// Usage:
//   node orchestrator.js "your task"
//   node orchestrator.js --dry-run "your task"        (show the choice, don't run anything)
//   node orchestrator.js --force claude:opus "task"   (skip the router, pick yourself)

const { route } = require("./router");
const { ask } = require("./providers");

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let forced = null;
  const words = [];

  // A tiny hand-written argument parser: pull out the flags, keep the rest as the task.
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--force") forced = args[++i];
    else words.push(args[i]);
  }

  const task = words.join(" ").trim();
  if (!task) {
    console.error('Usage: node orchestrator.js [--dry-run] [--force provider:model] "your task"');
    process.exit(1);
  }

  let choice;
  if (forced) {
    const [provider, model] = forced.split(":");
    choice = { provider, model, rule: "forced", reason: "you picked it" };
  } else {
    choice = route(task);
  }

  // Always say what was chosen and why, so you can see where your quota goes.
  console.error(`[router] ${choice.provider} / ${choice.model}  (rule: ${choice.rule} - ${choice.reason})`);
  if (dryRun) return;

  const started = Date.now();
  const answer = await ask(choice.provider, choice.model, task);
  console.log(answer);
  console.error(`[router] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
