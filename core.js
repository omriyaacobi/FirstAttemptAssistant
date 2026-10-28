// core.js
// The engine behind every front end (the command line and the web page).
// handleTask() takes a task, decides how to run it, runs it, and RETURNS the result
// as a plain object. It never prints anything itself: progress messages go to the
// "log" function you pass in, so each front end can show them its own way.

const { route, chainForType } = require("./router");
const { askChain } = require("./providers");
const { looksMultiPart, plan, runPlan } = require("./planner");

const label = ({ provider, model }) => `${provider}/${model}`;
const chainText = (chain) => chain.map(label).join("  ->  ");

// deps lets tests swap in fakes for the real models.
const defaultDeps = { route, chainForType, askChain, looksMultiPart, plan, runPlan };

async function handleTask(task, { noPlan = false, planOnly = false, forced = null, log = () => {}, deps = {} } = {}) {
  const d = { ...defaultDeps, ...deps };
  const started = Date.now();
  const seconds = () => Number(((Date.now() - started) / 1000).toFixed(1));

  // One job: pick a chain, run it with fallbacks, return the answer.
  async function runSingle(info) {
    log(`[router] rule: ${info.rule} - ${info.reason}`);
    log(`[router] plan: ${chainText(info.chain)}`);
    const { answer, used } = await d.askChain(info.chain, task, {
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => log(`[router] ${label(m)} failed: ${m.message}`),
    });
    log(`[router] answered by ${label(used)}`);
    return { mode: "single", rule: info.rule, reason: info.reason, chain: info.chain, used, answer, seconds: seconds() };
  }

  // Several jobs: run the plan, return every step's result.
  async function runSplit(subtasks, plannedBy) {
    const steps = await d.runPlan(subtasks, task, {
      onStart: ({ subtask, chain }) => log(`[planner] step ${subtask.id} (${subtask.type}) starting: ${label(chain[0])}`),
      onDone: ({ subtask, result }) =>
        log(`[planner] step ${subtask.id} ${result.error ? "FAILED: " + result.error : "done by " + label(result.used)}`),
    });
    log("[planner] all steps finished");
    return { mode: "split", plannedBy, steps, seconds: seconds() };
  }

  // Forced: skip the planner and the router completely.
  if (forced) {
    const chain = forced.split(",").map((item) => {
      const [provider, model] = item.split(":");
      return { provider, model };
    });
    return runSingle({ chain, rule: "forced", reason: "you picked it" });
  }

  if (!noPlan && d.looksMultiPart(task)) {
    log("[planner] this looks like it may contain several jobs, asking the planner to split it");
    try {
      const { subtasks, plannedBy } = await d.plan(task);
      log(`[planner] ${subtasks.length} step(s), planned by ${plannedBy}`);
      for (const s of subtasks) {
        const needs = s.needs.length ? `  (needs step ${s.needs.join(", ")})` : "";
        log(`[planner]   ${s.id}. [${s.type}] ${s.task.slice(0, 90)}${needs}  ->  ${chainText(d.chainForType(s.type))}`);
      }
      if (planOnly) return { mode: "plan", subtasks, plannedBy };
      if (subtasks.length > 1) return runSplit(subtasks, plannedBy);
      log("[planner] only one job found, handling it as one");
    } catch (error) {
      log(`[planner] ${error.message}. Handling it as one job.`);
      if (planOnly) return { mode: "plan", subtasks: null, note: error.message };
    }
  } else if (planOnly) {
    log("[planner] the task does not look multi-part, nothing to plan");
    return { mode: "plan", subtasks: null, note: "the task does not look multi-part" };
  }

  return runSingle(d.route(task));
}

module.exports = { handleTask, chainText, label };
