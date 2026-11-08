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
//        remember -> a fact is PROPOSED; the page asks you to Save it (profile.js). Saved at once only when your own
//                    short message says "remember that ..." (explicitRemember), and then the page offers Undo
//        listReminders -> code reads the real reminder list (reminders.js)
//        recall   -> code searches your earlier chats (recall.js), or lists what Bot knows about you
//   2. If the front desk fails or returns nonsense, Claude Sonnet takes the task.
//   3. Whatever model runs a task has fallbacks: if it fails, the next one in its chain is tried.

const { mostlyHebrew, HEBREW_RULE, say, langOf } = require("./lang");
const { chainForDestination, chainForType, DEFAULT_CHAIN, MODELS } = require("./router");
const path = require("node:path");
const { ask, askChain, askAgyWithImage, timeoutFor } = require("./providers");
const { createWarmAgy } = require("./warmagy");
const { decide, FRONT_DESK_MODEL } = require("./frontdesk");
const { plan, runPlan } = require("./planner");
const { getLowPools, refreshQuota, noteFailure, prioritize, describeLow } = require("./quota");
const { getReminders, formatWhen } = require("./reminders");
const { aboutBlock, personalize, pickFacts, bestMatches, explicitRemember, createMemory } = require("./profile");
const { readCalendar: readCalendarEvents, friendlyError } = require("./calendar-chat");
const { wantsCalendarAdd, photoCalendarNote, checkPhotoEvents, getCards } = require("./calendar-add");
const { createStore } = require("./store");
const { findInChats, listFound, recallPrompt } = require("./recall");

const label = ({ provider, model }) => `${provider}/${model}`;
const chainText = (chain) => chain.map(label).join("  ->  ");

// ---- Pre-warmed answer process ----
// Starting agy costs about 2.5 s before the answer model even sees the question. For the model most answers come from, one agy
// process waits ready (warmagy.js: ONE process per message, the same flags as a normal call, a dead or old spare is replaced at once),
// so the answer skips the start-up. It is started when a message arrives, while the front desk is still deciding, and again after
// each answer. Waiting processes use no model quota (the model is only called when the question arrives).
const SPECULATE_ANSWER = true; // the one-line switch for the speculative answer (see runTask)
const SPECULATIVE_MODEL = MODELS.flashMedium; // the first model of the "gemini-flash" destination
const WARM_ANSWER_MODELS = new Set([MODELS.flashMedium.model]);
const answerPool = createWarmAgy({ keepReady: true });
const prewarmAnswer = () => { for (const model of WARM_ANSWER_MODELS) answerPool.warmUp(model, null); };
function askOneWarm(provider, model, question, onText) {
  if (provider === "agy" && WARM_ANSWER_MODELS.has(model)) return answerPool.askText(question, model, onText || (() => {}), { timeoutMs: timeoutFor(model) });
  return ask(provider, model, question, onText);
}

// deps lets tests swap in fakes for the real models.
// lowPools says which quota pools are nearly empty: it reads a flag in memory and never waits (see quota.js).
// refreshQuota updates that flag in the background AFTER each answer, for the next message.
const defaultDeps = { about: (opts) => aboutBlock(opts), facts: () => createMemory().list(), addFact: (text) => createMemory().add(text), decide, plan, runPlan, askChain, askImage: askAgyWithImage, chainForType, chainForDestination, lowPools: getLowPools, refreshQuota, noteFailure, prewarmAnswer, askOne: askOneWarm,
  // The answer model started alongside the front desk (null = off). It uses the pre-warmed pool, so it is killed with its signal.
  speculate: SPECULATE_ANSWER ? (question, { signal, onText }) => answerPool.askText(question, SPECULATIVE_MODEL.model, onText, { signal, timeoutMs: timeoutFor(SPECULATIVE_MODEL.model) }) : null, readCalendar: readCalendarEvents,
  // A Confirm card for checked events (calendar-add.js). Bot only DRAFTS here: creating events needs the Confirm tap in server.js.
  addCalendarCard: (proposal, opts) => getCards().add(proposal, opts),
  searchChats: (query) => findInChats(createStore(path.join(__dirname, "data", "conversations")), query),
  // Saves a reminder that frontdesk.js already validated. at is milliseconds, reminders.js wants ISO text.
  listReminders: () => getReminders().list(),
  createReminder: ({ text, at, timezone }) => getReminders().create({ text, at: new Date(at).toISOString(), timezone }) };

// ---- Conversation memory ----
// The models have no memory of their own (every call starts from nothing), and different
// models answer different messages. So we give them the memory: before each question we
// paste the recent conversation in front of it. Only the newest messages are kept, so the
// prompt cannot grow without limit.
const MAX_HISTORY_CHARS = 12000; // total size of the pasted history
const MAX_MESSAGE_CHARS = 3000; // a single long message is cut to this

// A calendar card note (see jobs.js) is never cut: the NEWEST card keeps its full note, because a correction must copy every event, and cutting
// the JSON would silently lose the last classes. Older cards only keep a short status line. If even the full note cannot fit, the model is told
// to ask the user instead of guessing.
const CARD_TOO_LONG = "[A calendar card was shown here, but its event list is too long to repeat. For a correction, ask the user which events to change; do not guess.]";

function historyBlock(history = []) {
  const lines = [];
  let total = 0;
  let newestCard = true;
  for (let i = history.length - 1; i >= 0; i--) { // walk from newest to oldest, so the newest survive
    const message = history[i];
    // `label` is written by CODE (jobs.js, thread only): an answer that came from a course says so, e.g. "Assistant [course answer: Calculus 2]".
    const who = message.role === "user" ? "User" : message.label ? `Assistant [${String(message.label).replace(/[\[\]\n]/g, " ").slice(0, 80)}]` : "Assistant";
    let line = `${who}: ${String(message.text).slice(0, MAX_MESSAGE_CHARS)}`;
    if (message.note) {
      const full = "\n" + message.note;
      line += newestCard ? (total + line.length + full.length <= MAX_HISTORY_CHARS ? full : "\n" + CARD_TOO_LONG) : "\n" + (message.noteShort || "");
      newestCard = false;
    }
    if (total + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    total += line.length;
  }
  return lines.length ? "Conversation so far (oldest first), for context only:\n" + lines.join("\n\n") : "";
}

// What the saved facts are searched with: the new message, plus the user's message before it, so that a follow-up like
// "and what about her?" still finds the fact it is about.
function memoryQuery(task, history = []) {
  const last = [...history].reverse().find((m) => m.role === "user");
  return last ? `${task} ${String(last.text).slice(0, 300)}` : task;
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
// A timetable photo with "add to my calendar" is a JSON task with possibly several changes. Measured (experiments/2026-11-06-photo-calendar-timing.md):
// Flash MEDIUM thought for 135 s and answered nothing (414 s in the real chat); Argon low needed 24 s. Accuracy comes first (Flash made real reading
// errors before, and Flash low is kept for the front desk only), so Argon low goes first and Flash medium is the fallback, under the photo time limit.
const PHOTO_CALENDAR_CHAIN = [MODELS.argonLow, MODELS.flashMedium];
const photoNote = (name) =>
  `The user attached a photo. It is the file "${name}" in your current folder. Open and look at that one file to answer; do not read or change anything else. ` +
  "If the photo shows a schedule or events, list each one clearly (date, start and end time, title). You cannot add anything to a calendar yourself; if the user asks for that, Bot handles it with a card.";

// Runs one task. A message never waits for the quota lookup; the lookup runs after the answer is ready.
async function handleTask(task, options = {}) {
  const speculation = {}; // runTask puts a drop() in here when it started an answer alongside the front desk
  try {
    return await runTask(task, { ...options, speculation });
  } finally {
    try { if (speculation.drop) speculation.drop(); } catch (error) { /* stopping a call nobody needs can never break a task */ }
    try { Promise.resolve((options.deps?.refreshQuota || defaultDeps.refreshQuota)()).catch(() => {}); } catch (error) { /* quota can never break a task */ }
  }
}

// courses (thread only): the real course list [{ id, name }] and studyState (one line per course, written by code). With a list, the front
// desk may choose the action "course"; without it (BOT_THREAD off) that action does not exist and nothing below changes.
async function runTask(task, { route = null, noPlan = false, planOnly = false, forced = null, history = [], image = null, log = () => {}, onPartial = null, deps = {}, speculation = {}, courses = null, studyState = "", deeper = false, gate = null } = {}) {
  const d = { ...defaultDeps, ...deps };
  const lang = langOf(task); // the language of Bot's own fixed sentences in this answer
  // gate (thread only, given by jobs.js): called ONCE, right before slow work starts (a model answer, a plan, a course answer, a photo).
  // It resolves when a slow slot is free (and an earlier question about the same course is done). Fast actions never call it.
  let slotTaken = false;
  const slow = async (info = {}) => { if (!gate || slotTaken) return; slotTaken = true; await gate(info); };
  try { d.prewarmAnswer(); } catch (error) { /* a missing spare only means the answer starts agy itself */ }
  const started = Date.now();
  const secondsSince = (t0) => Number(((Date.now() - t0) / 1000).toFixed(1));
  const seconds = () => secondsSince(started);
  // Where the time went, shown in the log and on the page ("What Bot did"). Filled in as we go.
  // attempts lists every model that was tried, including failed ones (see askChain).
  const timing = { frontDeskSeconds: null, plannerSeconds: null, attempts: [] };
  // The front desk decides from the newest message (plus the history for context).
  const prompt = withContext(task, history) + (mostlyHebrew(task) ? `\n\n${HEBREW_RULE}` : "");
  // What Bot knows about the user (profile.js), read fresh for every task. Goes to the front desk and to
  // the models, but personalize() keeps it away from the web routes. A problem here never breaks a task.
  let about = "";
  let deskAbout = ""; // the same, but with the saved facts numbered, so the front desk can point at one
  let allFacts = [];
  let picked = []; // only the facts that matter for this message; one list for the whole task, so a number always means the same fact
  try {
    allFacts = d.facts();
    picked = pickFacts(allFacts, memoryQuery(task, history));
  } catch (error) { /* no saved facts to look at */ }
  try { about = d.about({ picked }) || ""; deskAbout = d.about({ picked, numbered: true }) || ""; } catch (error) { /* no profile, same as before */ }

  // Which quota pools are low right now. Asked at most once per task. If the lookup fails for any
  // reason we treat it as "nothing is low", so quota can never break a task.
  let lowPromise;
  const getLow = () => (lowPromise ??= Promise.resolve().then(() => d.lowPools()).then((l) => (Array.isArray(l) ? l : []), () => []));

  // Moves models from a low pool to the end of the chain and says so in the log.
  // `low` must already be loaded (await getLow() first).
  // What quota did to this task's routes, for the log and for the page (result.quota).
  const quotaNotes = [];
  const quotaChain = (chain, low) => {
    const { chain: reordered, moved, allLow } = prioritize(chain, low);
    const note = (text) => { quotaNotes.push(text); log(`[quota] ${text}`); };
    if (moved.length) note(`low: ${describeLow(low)}. Moved to the end: ${moved.map(label).join(", ")}, so ${label(reordered[0])} goes first`);
    else if (allLow) note(`every model in this chain is low (${describeLow(low)}). Using the best available, the one with the most room: ${label(reordered[0])}`);
    return reordered;
  };
  const quotaField = (low = []) => (quotaNotes.length ? { quota: { low, notes: [...new Set(quotaNotes)] } } : {});
  // A model failed. If the error says a limit was hit, quota.js marks its pool low until the reset time in the message,
  // even when the usage lookup cannot see that pool. Never throws.
  const noteLimit = (m) => { try { d.noteFailure({ provider: m.provider, model: m.model }, m.message); } catch (error) { /* quota can never break a task */ } };

  // One line with the real cost of this message, e.g.
  // "[timing] quota 0 s, front desk 8.4 s, gemini-4-argon-low 41.2 s (failed), sonnet 6 s, total 56.1 s"
  const timingLine = () => {
    const parts = [];
    if (timing.frontDeskSeconds !== null) parts.push(`front desk ${timing.frontDeskSeconds} s`);
    if (timing.plannerSeconds !== null) parts.push(`planner ${timing.plannerSeconds} s`);
    for (const a of timing.attempts) parts.push(`${a.step ? `step ${a.step}: ` : ""}${a.model} ${a.seconds} s${a.ok ? "" : " (failed)"}${a.speculative ? " (started together with the front desk, so the times overlap)" : ""}`);
    parts.push(`total ${seconds()} s`);
    return "[timing] " + parts.join(", ");
  };

  // One job: run a chain with fallbacks and return the answer.
  async function runSingle(info) {
    await slow();
    const low = await getLow();
    if (info.rule !== "forced") info = { ...info, chain: quotaChain(info.chain, low) };
    log(`[router] ${info.rule}: ${info.reason}`);
    log(`[router] plan: ${chainText(info.chain)}`);
    const { answer, used, attempts } = await d.askChain(info.chain, personalize(info.chain, prompt, about), {
      askOne: d.askOne,
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => { log(`[router] ${label(m)} failed after ${m.seconds} s: ${m.message}`); noteLimit(m); },
      onText: onPartial, // lets the page show the answer while it is written (agy only)
    });
    timing.attempts = attempts || [];
    const last = timing.attempts[timing.attempts.length - 1];
    log(`[router] answered by ${label(used)}${last ? ` in ${last.seconds} s` : ""}`);
    log(timingLine());
    return { mode: "single", rule: info.rule, reason: info.reason, chain: info.chain, used, answer, seconds: seconds(), timing, ...quotaField(low) };
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
      const answer = say(lang, `Reminder set for ${formatWhen(saved.at, saved.timezone)} (${saved.timezone}): ${saved.text}`, `התזכורת נקבעה ל${formatWhen(saved.at, saved.timezone, "he")} (${saved.timezone}): ${saved.text}`);
      log(`[reminder] saved ${saved.id}`);
      log(timingLine());
      return { mode: "single", rule: "set a reminder", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, reminder: saved, seconds: seconds(), timing };
    } catch (error) {
      log(`[reminder] could not save: ${error.message}`);
      const answer = say(lang, `I could not set that reminder: ${error.message}`, `לא הצלחתי לקבוע את התזכורת: ${error.message}`);
      return { mode: "single", rule: "set a reminder", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds() };
    }
  }

  // "What reminders do I have?": the answer is written by code from the real list (never from chat history, which goes stale).
  function listReminders(decision) {
    let items;
    try { items = d.listReminders(); } catch (error) {
      log(`[reminder] could not read the list: ${error.message}`);
      return { mode: "single", rule: "list reminders", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer: say(lang, `I could not read your reminders: ${error.message}`, `לא הצלחתי לקרוא את התזכורות: ${error.message}`), seconds: seconds(), timing };
    }
    const pending = items.filter((r) => r.status === "pending");
    const line = (r) => "- " + formatWhen(r.at, r.timezone, lang) + ": " + r.text;
    const body = pending.map(line).join("\n");
    const answer = pending.length
      ? say(lang, `You have ${pending.length} pending ${pending.length === 1 ? "reminder" : "reminders"}:\n${body}`, `יש לך ${pending.length} תזכורות ממתינות:\n${body}`)
      : say(lang, "You have no reminders waiting.", "אין לך תזכורות ממתינות.");
    log(timingLine());
    return { mode: "single", rule: "list reminders", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds(), timing };
  }

  // The user said something worth remembering. The front desk only PROPOSED it (and profile.js checked it):
  // the page shows Save / Don't save, and only a click on Save stores it (POST /api/memory).
  // Add, change or forget: the card shows exactly what will change. The model only gave a NUMBER for the
  // fact it means; the code looks up the real fact, so a wrong number can at worst point at another saved fact,
  // which the user sees on the card before tapping Save.
  function proposeFact(decision) {
    let old = null;
    if (decision.replaces) {
      const hit = picked.find((f) => String(f.n) === decision.replaces);
      if (hit) old = { id: hit.id, text: hit.text };
    } else if (decision.action === "forget") {
      // The front desk named no number: offer the closest saved fact. The card shows it, so a wrong guess changes nothing.
      const [best] = bestMatches(allFacts, task);
      if (best) old = { id: best.id, text: best.text };
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
    // The user said "remember that ..." themselves, in a short message of their own: no need to ask again. The page offers Undo.
    if (explicitRemember(task, decision.fact)) {
      try {
        const { fact, already } = d.addFact(decision.fact);
        log(`[memory] ${already ? "already known" : "saved at the user's own request"}`);
        return reply(already ? `Bot already knows this: "${fact.text}"` : `Saved: "${fact.text}"`, already ? {} : { remembered: { id: fact.id, text: fact.text } });
      } catch (error) {
        log(`[memory] could not save: ${error.message}`);
        return reply(error.message);
      }
    }
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

  // Earlier calendar cards of this chat (jobs.js gives their ids with the history): a new card replaces the ones still waiting.
  const supersedes = history.map((h) => h.cardId).filter(Boolean);

  // The user asked to ADD an event. The front desk model only proposed fields and frontdesk.js checked them. Code makes the
  // Confirm card; nothing is created until the user taps Confirm (server.js). The log never contains titles.
  function addEvent(decision) {
    let extra = {}, answer = decision.answer;
    if (decision.calendarAdd) {
      try {
        extra = { calendarAdd: d.addCalendarCard(decision.calendarAdd, { supersedes }) };
        answer = say(lang, "Add this to your calendar? Nothing is added until you tap Confirm.", "להוסיף ליומן? שום דבר לא נוסף לפני לחיצה על Confirm.");
        log(`[calendar] drafted ${decision.calendarAdd.events.length} event(s), waiting for Confirm`);
      } catch (error) {
        answer = say(lang, `Bot could not prepare the card: ${error.message}`, `Bot לא הצליח להכין את הכרטיס: ${error.message}`);
      }
    }
    log(timingLine());
    return { mode: "single", rule: "calendar (add, needs Confirm)", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds(), timing, ...extra };
  }

  // "What do you know about me?" is answered by code from the saved facts. A question about an earlier chat: code searches
  // the chats, and a cheap model answers from what was found, with no web and no tools; if it fails, the excerpts themselves
  // are the reply. Either way the reply lists the chats, so the page can open them.
  async function recall(decision) {
    const reply = (answer, extra = {}) => {
      log(timingLine());
      return { mode: "single", rule: "recall", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer, seconds: seconds(), timing, ...extra };
    };
    if (!decision.query) {
      if (!allFacts.length) return reply("You have no saved facts yet. Tell me to remember something, like \"remember that I prefer short answers\". Your profile file data/profile.md is separate.");
      const lines = [...allFacts].sort((a, b) => b.at - a.at).map((f) => "- " + f.text);
      return reply(`I have ${lines.length} saved ${lines.length === 1 ? "fact" : "facts"} about you (you can change or forget them in the sidebar, or just tell me):\n${lines.join("\n")}`);
    }
    let found = [];
    try {
      found = d.searchChats(decision.query);
    } catch (error) {
      log(`[recall] could not search: ${error.message}`);
    }
    log(`[recall] found ${found.length} place(s)`);
    if (!found.length) return reply(Array.isArray(courses) // thread on: course answers ARE searched (one conversation); only calendar replies and the daily brief are skipped
      ? "I could not find that in your conversation, including your course questions. (Calendar replies and the daily brief are not searched.)"
      : "I could not find that in your earlier chats. (Chats inside a course and calendar replies are not searched.)");
    const chats = [...new Map(found.map((f) => [f.conversationId, { id: f.conversationId, title: f.title }])).values()];
    const chain = quotaChain(d.chainForDestination("gemini-flash"), await getLow());
    try {
      const { answer, used } = await d.askChain(chain, recallPrompt(task, found), {
        askOne: d.askOne,
        onTry: (m) => log(`[router] trying ${label(m)}`),
        onFail: (m) => { log(`[router] ${label(m)} failed after ${m.seconds} s: ${m.message}`); noteLimit(m); },
        onText: onPartial,
      });
      log(`[router] answered by ${label(used)}`);
      return reply(answer, { chain, used, chats });
    } catch (error) {
      log(`[recall] no model answered: ${error.message}`);
      return reply(listFound(found), { chats });
    }
  }

  // The front desk chose "course" (thread only): the message is about studying. Code has already checked the course against the real list.
  // The answer comes from the course's notebook exactly as a course chat's did (study.js, through d.courseAnswer). With no course named
  // ("what should I study today?") code asks which course; the reply is written by code, never by a model.
  // The coach's intents (study-coach.js). The desk's older names map onto them: a quiz or exercises is a quiz, "open" shows progress.
  // "ask" and "summary" stay a plain question to the notebook.
  const COACH_INTENT = { quiz: "quiz", exercises: "quiz", teach: "teach", start: "start", answer: "answer", progress: "progress", open: "progress", plan: "plan", update: "update", assignment: "assignment", motivate: "motivate", pause: "pause", resume: "resume", confirm: "confirm", cancel: "cancel" };
  const TEACH_ME = /^\s*(?:please\s+)?teach\s+me\b|^\s*(?:תלמד|תלמדי|תלמדו)\s+אותי/i;
  const MODEL_INTENTS = new Set(["quiz", "teach", "start", "answer", "assignment"]); // these call Argon; the others are code only (fast lane)
  async function courseAnswer(decision) {
    let coachIntent = COACH_INTENT[decision.studyIntent];
    // "teach me X" is a request to be taught, whatever label the desk gave it, but only for a course taught from its notes (the coach says so); a lecture course keeps its notebook answer.
    if (decision.studyIntent === "ask" && d.studyCanTeach && decision.course && TEACH_ME.test(task) && d.studyCanTeach(decision.course.id)) coachIntent = "teach";
    if (d.studyAnswer && coachIntent) {
      if (MODEL_INTENTS.has(coachIntent)) await slow({ course: decision.course ? decision.course.id : undefined });
      log(`[study] ${coachIntent}${decision.course ? " in " + decision.course.name : ""}`);
      const r = await d.studyAnswer({ studyIntent: coachIntent, text: task, courseId: decision.course ? decision.course.id : null, courseName: decision.course ? decision.course.name : null, ...(onPartial ? { onText: onPartial } : {}) }); // the teaching text shows while it is written
      log(timingLine());
      return { ...r, ...(decision.course ? { courseId: decision.course.id, courseName: decision.course.name } : {}), studyIntent: decision.studyIntent, reason: decision.reason };
    }
    if (!d.courseAnswer) return runSingle({ chain: d.chainForDestination("gemini-flash"), rule: "course (notebooks are off)", reason: "the study notebooks are not available" });
    if (!decision.course) {
      const names = (courses || []).map((c) => c.name).join(", ");
      log("[course] no course named, asking which one");
      log(timingLine());
      return { mode: "single", rule: "asked you a question", reason: decision.reason, chain: [FRONT_DESK_MODEL], used: FRONT_DESK_MODEL, answer: say(lang, `Which course is this about? Your courses: ${names}.`, `על איזה קורס מדובר? הקורסים שלך: ${names}.`), seconds: seconds(), timing, topic: "study" };
    }
    await slow({ course: decision.course.id }); // thread: waits for a slot, and for an earlier question about the same course
    log(`[course] ${decision.course.name} (${decision.studyIntent})`);
    const result = await d.courseAnswer(decision.course.id, task, { history, deeper: deeper === true, onPartial: onPartial || undefined, log });
    log(timingLine());
    return { ...result, courseName: decision.course.name, studyIntent: decision.studyIntent, reason: decision.reason };
  }

  // A reminder step of a split: the front desk reads just that step (no splitting) and the same code as a normal reminder saves it.
  // If it cannot be turned into a checked reminder, the step fails with an honest message. A model never writes "reminder set" itself.
  async function runReminder(subtask) {
    const low = await getLow();
    let stepDecision;
    try {
      stepDecision = await d.decide(subtask.task, { history: "", allowSplit: false, low, about: deskAbout, log });
    } catch (error) {
      throw new Error(`Bot did not set a reminder: ${error.message}`);
    }
    if (!stepDecision || stepDecision.action !== "remind") throw new Error("Bot did not set a reminder: I could not find a clear time in that part. Ask again with the day and time.");
    const saved = d.createReminder(stepDecision.reminder); // a failure here becomes the step's error
    log(`[reminder] saved ${saved.id} (from a split step)`);
    return { answer: say(lang, `Reminder set for ${formatWhen(saved.at, saved.timezone)} (${saved.timezone}): ${saved.text}`, `התזכורת נקבעה ל${formatWhen(saved.at, saved.timezone, "he")} (${saved.timezone}): ${saved.text}`), used: FRONT_DESK_MODEL };
  }

  // Several jobs: run the plan, return every step's result.
  async function runSplit(subtasks, plannedBy) {
    await slow();
    const low = await getLow();
    const steps = await d.runPlan(subtasks, prompt, {
      runReminder,
      run: (chain, stepPrompt) => d.askChain(chain, personalize(chain, stepPrompt, about), { askOne: d.askOne, onFail: noteLimit }), // web steps get no profile
      chainFor: (type) => quotaChain(d.chainForType(type), low),
      onStart: ({ subtask, chain }) => log(`[planner] step ${subtask.id} (${subtask.type}) starting: ${chain.length ? label(chain[0]) : "the reminder code"}`),
      onDone: ({ subtask, result }) =>
        log(`[planner] step ${subtask.id} ${result.error ? "FAILED: " + result.error : "done by " + label(result.used)}`),
    });
    log("[planner] all steps finished");
    timing.attempts = steps.flatMap((s) => (s.attempts || []).map((a) => ({ ...a, step: s.id }))); // steps run in parallel, so these do not add up to the total
    log(timingLine());
    return { mode: "split", plannedBy, steps, seconds: seconds(), timing, ...quotaField(low) };
  }

  const fallback = (reason) => runSingle({ chain: DEFAULT_CHAIN, rule: "fallback", reason });

  // A photo: ask Gemini directly, with the photo in a private empty folder (see providers.js).
  if (image) {
    await slow(); // thread: a photo task is slow work too
    const low = await getLow();
    const addToCalendar = wantsCalendarAdd(task);
    const chain = quotaChain(addToCalendar ? PHOTO_CALENDAR_CHAIN : PHOTO_CHAIN, low);
    log("[router] photo: a photo is attached, so only Gemini (through agy) can look at it");
    log(`[router] plan: ${chainText(chain)}`);
    // When the user's own words ask to add the photo to the calendar, the model must answer with strict JSON only; code checks it
    // below and builds a Confirm card. Any other photo message works as before.
    const fileName = "photo" + path.extname(image.path);
    const question = `${personalize(chain, prompt, about)}\n\n${addToCalendar ? photoCalendarNote(fileName) : photoNote(fileName)}`;
    const { answer, used } = await d.askChain(chain, question, {
      askOne: (provider, model, q) => d.askImage(model, q, image.path),
      onTry: (m) => log(`[router] trying ${label(m)}`),
      onFail: (m) => { log(`[router] ${label(m)} failed: ${m.message}`); noteLimit(m); },
    });
    log(`[router] answered by ${label(used)}`);
    if (addToCalendar) {
      let proposal = null, text, extra = {};
      try {
        proposal = checkPhotoEvents(answer);
        text = "Add these to your calendar? Nothing is added until you tap Confirm.";
        log(`[calendar] drafted ${proposal.events.length} event(s) from the photo, waiting for Confirm`);
      } catch (error) {
        text = `Bot could not turn the photo into calendar events: ${error.message}. Nothing was added. You can describe the events in words, or send the photo again.`;
        log(`[calendar] the photo answer was refused: ${error.message}`);
      }
      if (proposal) {
        try { extra = { calendarAdd: d.addCalendarCard(proposal, { supersedes }) }; } catch (error) { text = `Bot could not prepare the card: ${error.message}`; }
      }
      return { mode: "single", rule: "photo (calendar add, needs Confirm)", reason: "a photo is attached and you asked to add it to the calendar", chain, used, answer: text, seconds: seconds(), ...extra, ...quotaField(low) };
    }
    return { mode: "single", rule: "photo", reason: "a photo is attached", chain, used, answer, seconds: seconds(), ...quotaField(low) };
  }

  // Forced: skip the front desk completely.
  if (forced) {
    const chain = forced.split(",").map((item) => {
      const [provider, model] = item.split(":");
      return { provider, model };
    });
    return runSingle({ chain, rule: "forced", reason: "you picked it" });
  }

  // A speculative answer. Most questions end up at "gemini-flash" (Flash medium), and its answer takes about 8 s once the front
  // desk has decided. So that model is asked at the SAME moment as the front desk, with the very same prompt the real call would
  // get. If the front desk then picks gemini-flash, that answer is used (about 4 s sooner); anything else, and the call is killed.
  // Measured in experiments/2026-11-06-answer-speed.md. Skipped when the Gemini pool is nearly empty. Switch it off with
  // SPECULATE_ANSWER = false at the top of this file.
  let spec = null;
  if (d.speculate && !planOnly) {
    const low = await getLow();
    if (!low.some((p) => p.pool === SPECULATIVE_MODEL.pool)) {
      const controller = new AbortController();
      speculation.drop = () => controller.abort();
      const current = { startedAt: Date.now(), text: "", forward: null };
      try {
        current.promise = Promise.resolve(d.speculate(personalize([SPECULATIVE_MODEL], prompt, about), {
          signal: controller.signal,
          onText: (text) => { current.text = text; if (current.forward) current.forward(text); },
        }));
        current.promise.catch(() => {}); // a failure is handled when (and only if) the answer is wanted
        spec = current;
      } catch (error) { /* could not start: the normal path runs */ }
    }
  }

  // The front desk chose gemini-flash: use the answer that is already being written, if it is for the same model the chain starts with.
  // Returns the result, or null when the normal path has to run (the plan changed, or the speculative call failed).
  async function adoptSpeculative(info) {
    const low = await getLow();
    const chain = quotaChain(info.chain, low);
    const first = chain[0];
    if (!first || first.provider !== SPECULATIVE_MODEL.provider || first.model !== SPECULATIVE_MODEL.model) return null;
    log(`[router] ${info.rule}: ${info.reason}`);
    log(`[router] plan: ${chainText(chain)}`);
    log(`[router] trying ${label(first)}`);
    spec.forward = onPartial;
    if (onPartial && spec.text) onPartial(spec.text);
    let answer;
    try {
      answer = await spec.promise;
      if (!answer) throw new Error("empty answer");
    } catch (error) {
      if (onPartial) onPartial("");
      log(`[router] ${label(first)} failed after ${secondsSince(spec.startedAt)} s: ${String(error.message).trim().slice(0, 200)}`);
      noteLimit({ provider: first.provider, model: first.model, message: String(error.message) });
      return null;
    }
    const took = secondsSince(spec.startedAt);
    timing.attempts = [{ provider: first.provider, model: first.model, seconds: took, ok: true, speculative: true }];
    log(`[router] answered by ${label(first)} in ${took} s`);
    log(timingLine());
    return { mode: "single", rule: info.rule, reason: info.reason, chain, used: first, answer, seconds: seconds(), timing, ...quotaField(low) };
  }

  // 1. Ask the front desk.
  log(`[frontdesk] asking ${label(FRONT_DESK_MODEL)}`);
  let decision;
  try {
    const low = await getLow(); // never waits: just the in-memory flag from the last lookup
    const deskStart = Date.now();
    try {
      decision = await d.decide(task, { history: historyBlock(history), allowSplit: !noPlan, low, about: deskAbout, log, ...(courses && courses.length ? { courses, studyState } : {}) });
    } finally {
      timing.frontDeskSeconds = secondsSince(deskStart);
    }
  } catch (error) {
    log(`[frontdesk] failed after ${timing.frontDeskSeconds} s: ${error.message}. Claude Sonnet takes it.`);
    return planOnly ? { mode: "plan", subtasks: null, note: error.message } : fallback("the front desk failed, so Claude Sonnet took it");
  }
  const target = decision.action === "delegate" ? ` -> ${decision.destination}` : "";
  log(`[frontdesk] decision: ${decision.action}${target} (${decision.reason}) in ${timing.frontDeskSeconds} s${decision.hedged ? " (a second call was started because the first was slow)" : ""}`);

  // "Wrong? Ask again normally" (the page sends route "general", checked in server.js): course files, the calendar, earlier chats and the study plan
  // are skipped and the question is answered as an ordinary one. Only these four actions change; a reminder or a saved fact is still what it is.
  if (route === "general" && ["course", "calendar", "addEvent", "recall"].includes(decision.action)) {
    log(`[route] you asked for an ordinary answer, so "${decision.action}" is skipped`);
    decision = { action: "delegate", destination: "gemini-flash", reason: "you asked for an ordinary answer, not course files, your calendar or your study plan" };
  }

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
  if (decision.action === "addEvent") return addEvent(decision);
  if (decision.action === "recall") return recall(decision);
  if (decision.action === "listReminders") return listReminders(decision);
  if (decision.action === "course") return courseAnswer(decision);

  if (decision.action === "delegate") {
    await slow(); // thread: a slow task waits for a free slot (see jobs.js), before the speculative answer is adopted
    const info = { chain: d.chainForDestination(decision.destination), rule: decision.destination, reason: decision.reason };
    if (spec && decision.destination === "gemini-flash") {
      const adopted = await adoptSpeculative(info);
      if (adopted) return adopted;
    }
    return runSingle(info);
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
  if (subtasks.length > 1 || subtasks[0].type === "reminder") return runSplit(subtasks, plannedBy);
  log("[planner] only one job found, handling it as one");
  return runSingle({ chain: d.chainForType(subtasks[0].type), rule: subtasks[0].type, reason: "the planner found a single job" });
}

module.exports = { handleTask, chainText, label, historyBlock, withContext, resultText, MAX_HISTORY_CHARS };
