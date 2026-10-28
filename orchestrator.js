// orchestrator.js
// The main program. It takes a task and decides how to handle it:
//   - a single job: router.js picks a model chain, providers.js runs it (with fallbacks)
//   - several jobs: planner.js splits it, each part goes to its own best model chain
//
// Usage:
//   node orchestrator.js "your task"
//   node orchestrator.js --dry-run "your task"        (show the choice, don't call any model)
//   node orchestrator.js --plan-only "your task"      (run the planner, show the plan, stop)
//   node orchestrator.js --no-plan "your task"        (never split, treat it as one job)
//   node orchestrator.js --force claude:opus "task"   (skip routing, pick yourself; list with commas for fallbacks)

const { route, chainForType } = require("./router");
const { askChain } = require("./providers");
const { looksMultiPart, plan, runPlan } = require("./planner");

const label = ({ provider, model }) => `${provider}/${model}`;
const chainText = (chain) => chain.map(label).join("  ->  ");

// One job: route, run with fallbacks, print the answer.
async function runSingle(task, planInfo) {
  console.error(`[router] rule: ${planInfo.rule} - ${planInfo.reason}`);
  console.error(`[router] plan: ${chainText(planInfo.chain)}`);
  const started = Date.now();
  const { answer, used } = await askChain(planInfo.chain, task, {
    onTry: (m) => console.error(`[router] trying ${label(m)}`),
    onFail: (m) => console.error(`[router] ${label(m)} failed: ${m.message}`),
  });
  console.log(answer);
  console.error(`[router] answered by ${label(used)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// Several jobs: run the plan, print each part under a heading.
async function runSplit(task, subtasks) {
  const started = Date.now();
  const results = await runPlan(subtasks, task, {
    onStart: ({ subtask, chain }) =>
      console.error(`[planner] step ${subtask.id} (${subtask.type}) starting: ${label(chain[0])}`),
    onDone: ({ subtask, result }) =>
      console.error(`[planner] step ${subtask.id} ${result.error ? "FAILED: " + result.error : "done by " + label(result.used)}`),
  });
  for (const r of results) {
    console.log(`\n## Step ${r.id}: ${r.task}`);
    console.log(r.error ? `(failed: ${r.error})` : `[${label(r.used)}]\n\n${r.answer}`);
  }
  console.error(`[planner] all steps finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

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

  // Forced: skip the planner and the router completely.
  if (forced) {
    const chain = forced.split(",").map((item) => {
      const [provider, model] = item.split(":");
      return { provider, model };
    });
    const info = { chain, rule: "forced", reason: "you picked it" };
    if (dryRun) return console.error(`[router] plan: ${chainText(chain)}`);
    return runSingle(task, info);
  }

  const wantsPlanner = !noPlan && looksMultiPart(task);

  if (dryRun) {
    console.error(`[planner] would ${wantsPlanner ? "" : "NOT "}ask the planner to split this`);
    const single = route(task);
    console.error(`[router] if kept as one job -> rule: ${single.rule}, plan: ${chainText(single.chain)}`);
    return;
  }

  if (wantsPlanner) {
    console.error("[planner] this looks like it may contain several jobs, asking the planner to split it");
    try {
      const { subtasks, plannedBy } = await plan(task);
      console.error(`[planner] ${subtasks.length} step(s), planned by ${plannedBy}`);
      for (const s of subtasks) {
        const needs = s.needs.length ? `  (needs step ${s.needs.join(", ")})` : "";
        console.error(`[planner]   ${s.id}. [${s.type}] ${s.task.slice(0, 90)}${needs}  ->  ${chainText(chainForType(s.type))}`);
      }
      if (planOnly) return;
      if (subtasks.length > 1) return runSplit(task, subtasks);
      console.error("[planner] only one job found, handling it as one");
    } catch (error) {
      console.error(`[planner] ${error.message}. Handling it as one job.`);
      if (planOnly) return;
    }
  } else if (planOnly) {
    return console.error("[planner] the task does not look multi-part, nothing to plan");
  }

  return runSingle(task, route(task));
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
