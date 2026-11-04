// core.js
// The engine behind every front end (the command line and the web page).
// handleTask() takes a task, decides how to run it, runs it, and RETURNS the result
// as a plain object. It never prints anything itself: progress messages go to the
// "log" function you pass in, so each front end can show them its own way.
//
// How a message is handled:
//   1. The front desk (a Gemini model following router-brief.md) reads it and decides:
//        answer   -> it replies itself            clarify -> it asks you a question
//        delegate -> one model from the menu      split   -> the planner splits it into steps
//        remind   -> the time is checked and saved (reminders.js)
//   2. If the front desk fails or returns nonsense, Claude Sonnet takes the task.
//   3. Whatever model runs a task has fallbacks: if it fails, the next one in its chain is tried.

const { chainForDestination, chainForType, DEFAULT_CHAIN } = require("./router");
const { askChain } = require("./providers");
const { decide, FRONT_DESK_MODEL } = require("./frontdesk");
const { plan, runPlan } = require("./planner");
const { getLowPools, prioritize } = require("./quota");
const { getReminders, formatWhen } = require("./reminders");

const label = ({ provider, model }) => `${provider}/${model}`;
const chainText = (chain) => chain.map(label).join("  ->  ");

// deps lets tests swap in fakes for the real models.
// lowPools says which quota pools are nearly empty (cached; never throws, see quota.js).
const defaultDeps = { decide, plan, runPlan, askChain, chainForType, chainForDestination, lowPools: getLowPools,
  // Saves a reminder that frontdesk.js already validated. at is milliseconds, reminders.js wants ISO text.
  createReminder: ({ text, at, timezone }) => getReminders().create({ text, at: new Date(at).toISOString(), timezone }) };

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
  const secondsSince = (t0) => Number(((Date.now() - t0) / 1000).toFixed(1));
  const seconds = () => secondsSince(started);
  // Where the time went, shown in the log and on the page ("What Bot did"). Filled in as we go.
  // attempts lists every model that was tried, including failed ones (see askChain).
  const timing = { quotaSeconds: 0, frontDeskSeconds: null, plannerSeconds: null, attempts: [] };
  // The front desk decides from the newest message (plus the history for context).
  const prompt = withContext(task, history);

  // Which quota pools are low right now. Asked at most once per task. If the lookup fails for any
  // reason we treat it as "nothing is low", so quota can never break a task.
  let lowPromise;
  const getLow = () => (lowPromise ??= Promise.resolve().then(() => d.lowPools()).then((l) => (Array.isArray(l) ? l : []), () => []));

  // Moves models from a low pool to the end of the chain and says so in the log.
  // `low` must already be loaded (await getLow() first).
  const quotaChain = (chain, low) => {
    const { chain: reordered, moved } = prioritize(chain, low);
    if (moved.length) {
      const why = low.map((p) => `${p.pool} ${p.remaining}% left`).join(", ");
      log(`[quota] low: ${why}. Moved to the end: ${moved.map(label).join(", ")}`);
    }
    return reordered;
  };

  // One line with the real cost of this message, e.g.
  // "[timing] quota 0 s, front desk 8.4 s, gemini-4-argon-low 41.2 s (failed), sonnet 6 s, total 56.1 s"
  const timingLine = () => {
    const parts = [];
    if (timing.quotaSeconds >= 0.1) parts.push(`quota ${timing.quotaSeconds} s`);
    if (timing.frontDeskSeconds !== null) parts.push(`front desk ${timing.frontDeskSeconds} s`);
    if (timing.plannerSeconds !== null) parts.push(`planner ${timing.plannerSeconds} s`);
    for (const a of timing.attempts) parts.push(`${a.step ? `step ${a.step}: ` : ""}${a.model} ${a.seconds} s${a.ok ? "" : " (failed)"}`);
    parts.push(`total ${seconds()} s`);
    return "[timing] " + parts.join(", ");
  };

  // One job: run a chain with fallbacks and return the answer.
  async function runSingle(info) {
    if (info.rule !== "forced") info = { ...info, chain: quotaChain(info.chain, await getLow()) };
    log(`[router] ${info.rule}: ${info.reason}`);
    log(`[router] plan: ${chainText(info.chain)}`);
    const { answer, used, attempts } = await d.askChain(info.chain, prompt, {
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => log(`[router] ${label(m)} failed after ${m.seconds} s: ${m.message}`),
    });
    timing.attempts = attempts || [];
    const last = timing.attempts[timing.attempts.length - 1];
    log(`[router] answered by ${label(used)}${last ? ` in ${last.seconds} s` : ""}`);
    log(timingLine());
    return { mode: "single", rule: info.rule, reason: info.reason, chain: info.chain, used, answer, seconds: seconds(), timing };
  }

  // The front desk replied itself (an answer, a question for you, or a pointer to "Improve Bot").
  const RULE_NAMES = { clarify: "asked you a question", improve: "a change to Bot", answer: "answered directly" };
  const frontDeskReply = (decision) => {
    const rule = RULE_NAMES[decision.action];
    log(`[frontdesk] ${rule}`);
    log(timingLine());
    const result = { mode: "single", rule, reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer: decision.answer, seconds: seconds(), timing };
    // The page shows a button that opens "Improve Bot" with this request filled in. It never starts anything.
    if (decision.action === "improve") result.improve = { request: task };
    return result;
  };

  // The user asked to be reminded: save it and confirm. The front desk already checked the time;
  // reminders.js checks it again when saving.
  function setReminder(decision) {
    try {
      const saved = d.createReminder(decision.reminder);
      const answer = `Reminder set for ${formatWhen(saved.at, saved.timezone)} (${saved.timezone}): ${saved.text}`;
      log(`[reminder] saved ${saved.id}`);
      log(timingLine());
      return { mode: "single", rule: "set a reminder", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, reminder: saved, seconds: seconds(), timing };
    } catch (error) {
      log(`[reminder] could not save: ${error.message}`);
      const answer = `I could not set that reminder: ${error.message}`;
      return { mode: "single", rule: "set a reminder", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds() };
    }
  }

  // Several jobs: run the plan, return every step's result.
  async function runSplit(subtasks, plannedBy) {
    const low = await getLow();
    const steps = await d.runPlan(subtasks, prompt, {
      chainFor: (type) => quotaChain(d.chainForType(type), low),
      onStart: ({ subtask, chain }) => log(`[planner] step ${subtask.id} (${subtask.type}) starting: ${label(chain[0])}`),
      onDone: ({ subtask, result }) =>
        log(`[planner] step ${subtask.id} ${result.error ? "FAILED: " + result.error : "done by " + label(result.used)}`),
    });
    log("[planner] all steps finished");
    timing.attempts = steps.flatMap((s) => (s.attempts || []).map((a) => ({ ...a, step: s.id }))); // steps run in parallel, so these do not add up to the total
    log(timingLine());
    return { mode: "split", plannedBy, steps, seconds: seconds(), timing };
  }

  const fallback = (reason) => runSingle({ chain: DEFAULT_CHAIN, rule: "fallback", reason });

  // Forced: skip the front desk completely.
  if (forced) {
    const chain = forced.split(",").map((item) => {
      const [provider, model] = item.split(":");
      return { provider, model };
    });
    return runSingle({ chain, rule: "forced", reason: "you picked it" });
  }

  // 1. Ask the front desk.
  log(`[frontdesk] asking ${label(FRONT_DESK_MODEL)}`);
  let decision;
  try {
    const quotaStart = Date.now();
    const low = await getLow(); // usually instant now: quota.js answers with the last known value
    timing.quotaSeconds = secondsSince(quotaStart);
    const deskStart = Date.now();
    try {
      decision = await d.decide(task, { history: historyBlock(history), allowSplit: !noPlan, low });
    } finally {
      timing.frontDeskSeconds = secondsSince(deskStart);
    }
  } catch (error) {
    log(`[frontdesk] failed after ${timing.frontDeskSeconds} s: ${error.message}. Claude Sonnet takes it.`);
    return planOnly ? { mode: "plan", subtasks: null, note: error.message } : fallback("the front desk failed, so Claude Sonnet took it");
  }
  const target = decision.action === "delegate" ? ` -> ${decision.destination}` : "";
  log(`[frontdesk] decision: ${decision.action}${target} (${decision.reason}) in ${timing.frontDeskSeconds} s`);

  // The user turned splitting off, so a "split" decision is handled as one job instead.
  if (decision.action === "split" && noPlan) {
    return runSingle({ chain: d.chainForDestination("gemini-argon-medium"), rule: "no split", reason: "splitting is turned off" });
  }

  if (planOnly && decision.action !== "split") {
    return { mode: "plan", subtasks: null, note: `the front desk chose "${decision.action}", so there is nothing to split` };
  }

  // 2. Act on the decision.
  if (["answer", "clarify", "improve"].includes(decision.action)) return frontDeskReply(decision);
  if (decision.action === "remind") return setReminder(decision);

  if (decision.action === "delegate") {
    return runSingle({ chain: d.chainForDestination(decision.destination), rule: decision.destination, reason: decision.reason });
  }

  // split: ask the planner for the steps
  let planned;
  const plannerStart = Date.now();
  try {
    planned = await d.plan(task, { context: historyBlock(history) });
    timing.plannerSeconds = secondsSince(plannerStart);
  } catch (error) {
    timing.plannerSeconds = secondsSince(plannerStart);
    log(`[planner] failed after ${timing.plannerSeconds} s: ${error.message}`);
    return planOnly ? { mode: "plan", subtasks: null, note: error.message } : fallback("the planner failed, so Claude Sonnet took it");
  }
  const { subtasks, plannedBy } = planned;
  log(`[planner] ${subtasks.length} step(s), planned by ${plannedBy} in ${timing.plannerSeconds} s`);
  const lowNow = await getLow();
  for (const s of subtasks) {
    const needs = s.needs.length ? `  (needs step ${s.needs.join(", ")})` : "";
    log(`[planner]   ${s.id}. [${s.type}] ${s.task.slice(0, 90)}${needs}  ->  ${chainText(prioritize(d.chainForType(s.type), lowNow).chain)}`);
  }
  if (planOnly) return { mode: "plan", subtasks, plannedBy };
  if (subtasks.length > 1) return runSplit(subtasks, plannedBy);
  log("[planner] only one job found, handling it as one");
  return runSingle({ chain: d.chainForType(subtasks[0].type), rule: subtasks[0].type, reason: "the planner found a single job" });
}

module.exports = { handleTask, chainText, label, historyBlock, withContext, resultText, MAX_HISTORY_CHARS };
