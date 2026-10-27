// orchestrator.js
// The main program. It takes a task, asks router.js who should handle it,
// asks providers.js to run it (falling back to the next model if one fails),
// and prints the answer.
//
// Usage:
//   node orchestrator.js "your task"
//   node orchestrator.js --dry-run "your task"          (show the plan, don't run anything)
//   node orchestrator.js --force claude:opus "task"     (skip the router, pick yourself)
//   node orchestrator.js --force agy:x,claude:sonnet "task"   (your own fallback list)

const { route } = require("./router");
const { askChain } = require("./providers");

const label = ({ provider, model }) => `${provider}/${model}`;

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
    console.error('Usage: node orchestrator.js [--dry-run] [--force provider:model[,provider:model]] "your task"');
    process.exit(1);
  }

  let plan;
  if (forced) {
    const chain = forced.split(",").map((item) => {
      const [provider, model] = item.split(":");
      return { provider, model };
    });
    plan = { chain, rule: "forced", reason: "you picked it" };
  } else {
    plan = route(task);
  }

  // Always say what was chosen and why, so you can see where your quota goes.
  console.error(`[router] rule: ${plan.rule} - ${plan.reason}`);
  console.error(`[router] plan: ${plan.chain.map(label).join("  ->  ")}`);
  if (dryRun) return;

  const started = Date.now();
  const { answer, used } = await askChain(plan.chain, task, {
    onTry: (m) => console.error(`[router] trying ${label(m)}`),
    onFail: (m) => console.error(`[router] ${label(m)} failed: ${m.message}`),
  });
  console.log(answer);
  console.error(`[router] answered by ${label(used)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
