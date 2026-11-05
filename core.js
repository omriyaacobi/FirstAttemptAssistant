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
//        remember -> a fact is PROPOSED; the page asks you to Save it (profile.js, never saved by itself)
//   2. If the front desk fails or returns nonsense, Claude Sonnet takes the task.
//   3. Whatever model runs a task has fallbacks: if it fails, the next one in its chain is tried.

const { chainForDestination, chainForType, DEFAULT_CHAIN, MODELS } = require("./router");
const path = require("node:path");
const { askChain, askAgyWithImage } = require("./providers");
const { decide, FRONT_DESK_MODEL } = require("./frontdesk");
const { plan, runPlan } = require("./planner");
const { getLowPools, refreshQuota, prioritize } = require("./quota");
const { getReminders, formatWhen } = require("./reminders");
const { aboutBlock, personalize, recentFacts, createMemory } = require("./profile");
const { readCalendar: readCalendarEvents, friendlyError } = require("./calendar-chat");

const label = ({ provider, model }) => `${provider}/${model}`;
const chainText = (chain) => chain.map(label).join("  ->  ");

// deps lets tests swap in fakes for the real models.
// lowPools says which quota pools are nearly empty: it reads a flag in memory and never waits (see quota.js).
// refreshQuota updates that flag in the background AFTER each answer, for the next message.
const defaultDeps = { about: (opts) => aboutBlock(opts), facts: () => createMemory().list(), decide, plan, runPlan, askChain, askImage: askAgyWithImage, chainForType, chainForDestination, lowPools: getLowPools, refreshQuota, readCalendar: readCalendarEvents,
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

// Only Gemini (through agy) can look at a photo here, so a message with a photo skips the front desk.
const PHOTO_CHAIN = [MODELS.flashMedium, MODELS.argonLow];
const photoNote = (name) =>
  `The user attached a photo. It is the file "${name}" in your current folder. Open and look at that one file to answer; do not read or change anything else. ` +
  "You cannot add anything to a calendar yet: if the photo shows a schedule or events, list each one clearly (date, start and end time, title) so the user can add them.";

// Runs one task. A message never waits for the quota lookup; the lookup runs after the answer is ready.
async function handleTask(task, options = {}) {
  try {
    return await runTask(task, options);
  } finally {
    try { Promise.resolve((options.deps?.refreshQuota || defaultDeps.refreshQuota)()).catch(() => {}); } catch (error) { /* quota can never break a task */ }
  }
}

async function runTask(task, { noPlan = false, planOnly = false, forced = null, history = [], image = null, log = () => {}, deps = {} } = {}) {
  const d = { ...defaultDeps, ...deps };
  const started = Date.now();
  const secondsSince = (t0) => Number(((Date.now() - t0) / 1000).toFixed(1));
  const seconds = () => secondsSince(started);
  // Where the time went, shown in the log and on the page ("What Bot did"). Filled in as we go.
  // attempts lists every model that was tried, including failed ones (see askChain).
  const timing = { frontDeskSeconds: null, plannerSeconds: null, attempts: [] };
  // The front desk decides from the newest message (plus the history for context).
  const prompt = withContext(task, history);
  // What Bot knows about the user (profile.js), read fresh for every task. Goes to the front desk and to
  // the models, but personalize() keeps it away from the web routes. A problem here never breaks a task.
  let about = "";
  let deskAbout = ""; // the same, but with the saved facts numbered, so the front desk can point at one
  try { about = d.about() || ""; deskAbout = d.about({ numbered: true }) || ""; } catch (error) { /* no profile, same as before */ }

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
    const { answer, used, attempts } = await d.askChain(info.chain, personalize(info.chain, prompt, about), {
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

  // The user said something worth remembering. The front desk only PROPOSED it (and profile.js checked it):
  // the page shows Save / Don't save, and only a click on Save stores it (POST /api/memory).
  // Add, change or forget: the card shows exactly what will change. The model only gave a NUMBER for the
  // fact it means; the code looks up the real fact, so a wrong number can at worst point at another saved fact,
  // which the user sees on the card before tapping Save.
  function proposeFact(decision) {
    let old = null;
    if (decision.replaces) {
      try {
        const hit = recentFacts(d.facts()).find((f) => String(f.n) === decision.replaces);
        if (hit) old = { id: hit.id, text: hit.text };
      } catch (error) { /* no saved facts to look at */ }
    }
    const reply = (answer, extra = {}) => {
      log(timingLine());
      return { mode: "single", rule: "remember?", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds(), timing, ...extra };
    };
    if (decision.action === "forget") {
      if (!old) {
        log("[memory] forget: no matching saved fact");
        return reply("I could not find a saved fact like that. (Things written in your profile file data/profile.md can only be changed by editing that file.)");
      }
      log("[memory] proposed forgetting a fact (not changed)");
      return reply(`Forget this? "${old.text}"`, { forget: old });
    }
    if (!decision.fact) {
      log(`[memory] refused: ${decision.answer}`);
      return reply(decision.answer);
    }
    log(`[memory] proposed a ${old ? "change" : "new fact"} (not saved)`);
    if (old) return reply(`Change this saved fact?\nBefore: "${old.text}"\nAfter: "${decision.fact}"`, { remember: { fact: decision.fact, replaces: old } });
    return reply(`Should Bot remember this? "${decision.fact}"`, { remember: { fact: decision.fact } });
  }

  // The user asked what is on the calendar. READ-ONLY: code fetches the events and writes the reply,
  // so no model ever sees a title (see calendar-chat.js). The log never contains titles either.
  async function readCalendar(decision) {
    let answer;
    try {
      const got = await d.readCalendar(decision.calendar);
      log(`[calendar] read ${got.events.length} event(s), ${got.days} day(s) from ${got.from}`);
      answer = got.text;
    } catch (error) {
      log(`[calendar] could not read: ${friendlyError(error)}`);
      answer = friendlyError(error);
    }
    log(timingLine());
    return { mode: "single", rule: "calendar (read-only)", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds(), timing };
  }

  // Several jobs: run the plan, return every step's result.
  async function runSplit(subtasks, plannedBy) {
    const low = await getLow();
    const steps = await d.runPlan(subtasks, prompt, {
      run: (chain, stepPrompt) => d.askChain(chain, personalize(chain, stepPrompt, about)), // web steps get no profile
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

  // A photo: ask Gemini directly, with the photo in a private empty folder (see providers.js).
  if (image) {
    const chain = quotaChain(PHOTO_CHAIN, await getLow());
    log("[router] photo: a photo is attached, so only Gemini (through agy) can look at it");
    log(`[router] plan: ${chainText(chain)}`);
    const question = `${personalize(chain, prompt, about)}\n\n${photoNote("photo" + path.extname(image.path))}`;
    const { answer, used } = await d.askChain(chain, question, {
      askOne: (provider, model, q) => d.askImage(model, q, image.path),
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => log(`[router] ${label(m)} failed: ${m.message}`),
    });
    log(`[router] answered by ${label(used)}`);
    return { mode: "single", rule: "photo", reason: "a photo is attached", chain, used, answer, seconds: seconds() };
  }

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
    const low = await getLow(); // never waits: just the in-memory flag from the last lookup
    const deskStart = Date.now();
    try {
      decision = await d.decide(task, { history: historyBlock(history), allowSplit: !noPlan, low, about: deskAbout, log });
    } finally {
      timing.frontDeskSeconds = secondsSince(deskStart);
    }
  } catch (error) {
    log(`[frontdesk] failed after ${timing.frontDeskSeconds} s: ${error.message}. Claude Sonnet takes it.`);
    return planOnly ? { mode: "plan", subtasks: null, note: error.message } : fallback("the front desk failed, so Claude Sonnet took it");
  }
  const target = decision.action === "delegate" ? ` -> ${decision.destination}` : "";
  log(`[frontdesk] decision: ${decision.action}${target} (${decision.reason}) in ${timing.frontDeskSeconds} s${decision.hedged ? " (a second call was started because the first was slow)" : ""}`);

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
  if (decision.action === "remember" || decision.action === "forget") return proposeFact(decision);
  if (decision.action === "calendar") return readCalendar(decision);

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
