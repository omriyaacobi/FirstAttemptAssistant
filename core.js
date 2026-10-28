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

// ---- Conversation memory ----
// The models have no memory of their own (every call starts from nothing), and different
// models answer different messages. So we give them the memory: before each question we
// paste the recent conversation in front of it. Only the newest messages are kept, so the
// prompt cannot grow without limit.
const MAX_HISTORY_CHARS = 12000; // total size of the pasted history
const MAX_MESSAGE_CHARS = 3000; // a single long message is cut to this

function historyBlock(history = []) {
  const lines = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i--) { // walk from newest to oldest, so the newest survive
    const message = history[i];
    const line = `${message.role === "user" ? "User" : "Assistant"}: ${String(message.text).slice(0, MAX_MESSAGE_CHARS)}`;
    if (total + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    total += line.length;
  }
  return lines.length ? "Conversation so far (oldest first), for context only:\n" + lines.join("\n\n") : "";
}

// The text a model actually receives: the history (if any) followed by the new message.
function withContext(task, history) {
  const block = historyBlock(history);
  return block ? `${block}\n\nThe user's new message (answer this one):\n${task}` : task;
}

// A plain-text version of a result, used when a later message needs to see this answer.
function resultText(result) {
  if (result.mode === "single") return result.answer;
  if (result.mode === "split") {
    return result.steps.map((s) => `Step ${s.id}: ${s.task}\n${s.error ? "(failed)" : s.answer}`).join("\n\n");
  }
  return "";
}

async function handleTask(task, { noPlan = false, planOnly = false, forced = null, history = [], log = () => {}, deps = {} } = {}) {
  const d = { ...defaultDeps, ...deps };
  const started = Date.now();
  const seconds = () => Number(((Date.now() - started) / 1000).toFixed(1));
  // Routing and the planner decide from the newest message alone; the models get the context.
  const prompt = withContext(task, history);

  // One job: pick a chain, run it with fallbacks, return the answer.
  async function runSingle(info) {
    log(`[router] rule: ${info.rule} - ${info.reason}`);
    log(`[router] plan: ${chainText(info.chain)}`);
    const { answer, used } = await d.askChain(info.chain, prompt, {
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => log(`[router] ${label(m)} failed: ${m.message}`),
    });
    log(`[router] answered by ${label(used)}`);
    return { mode: "single", rule: info.rule, reason: info.reason, chain: info.chain, used, answer, seconds: seconds() };
  }

  // Several jobs: run the plan, return every step's result.
  async function runSplit(subtasks, plannedBy) {
    const steps = await d.runPlan(subtasks, prompt, {
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
      const { subtasks, plannedBy } = await d.plan(task, { context: historyBlock(history) });
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

module.exports = { handleTask, chainText, label, historyBlock, withContext, resultText, MAX_HISTORY_CHARS };
