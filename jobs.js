// jobs.js
// Runs Bot's tasks in the BACKGROUND, so they no longer depend on the web page staying open.
//
// Before: the page sent a message and kept one request open, reading progress from it. If the
// page was reloaded, the phone went to sleep or the app was switched away, that request died
// and the page lost track of the task (the task itself kept running and was saved, but the
// page never found out).
//
// Now: starting a task returns a JOB right away. The job runs on this computer whatever the page
// does. The page asks for the job's progress now and then (polling) and can pick it up again
// after a reload. When the job finishes, the answer is saved into the conversation by the
// SERVER, even if nobody is watching, and `onFinish` is called (the server uses it to push a
// notification).
//
// Jobs live in memory only: if Bot restarts, running jobs are gone (Restart is refused while
// any job runs). The conversation file is the permanent record.

const crypto = require("node:crypto");
const fs = require("node:fs");
const { resultText } = require("./core");
const { buildHistory } = require("./thread-context");

// Job ids are random and checked everywhere. 32 hex characters = 128 random bits, so they
// cannot be guessed.
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;
const KEEP_FINISHED_MS = 30 * 60 * 1000; // finished jobs stay visible this long
const MAX_FINISHED = 50;
const MAX_PARTIAL_CHARS = 20000; // the growing answer sent to the page while a job runs
const MAX_LOG_LINES = 200; // kept per job in memory
const SAVED_LOG_LINES = 40; // saved into the conversation
const THREAD_ID = "thread"; // every job of the one conversation carries this as its conversationId, so ?watching=thread works
const MAX_THREAD_JOBS = 20; // messages being worked on at the same time in the thread
const WATCH_FRESH_MS = 8000; // a page that asked this recently counts as "looking at it"

// Turns the raw log lines ("[frontdesk] asking ...", "[planner] step 2 ...") into one plain sentence
// for the page. Pure function, so it is easy to test. Unknown lines are ignored on purpose, so a
// new log line can never break the display.
function describeProgress(lines) {
  let text = "Starting...";
  let total = 0;
  const started = new Set();
  const finished = new Set();
  const models = new Map(); // step id -> model it is asking
  const short = (m) => String(m || "").replace(/^[^/]*\//, "");
  for (const line of lines) {
    let m;
    if ((m = line.match(/^\[frontdesk\] asking (.+)$/))) text = "The front desk is reading your message and deciding what to do";
    else if (/^\[frontdesk\] failed/.test(line)) text = "The front desk failed, so Claude Sonnet takes over";
    else if ((m = line.match(/^\[frontdesk\] decision: (\w+)/))) {
      text = { answer: "The front desk is answering", clarify: "The front desk has a question for you", delegate: "Choosing the right model", split: "Splitting your message into steps", remind: "Setting your reminder", improve: "Preparing a pointer to Improve Bot", remember: "Noting that down", forget: "Looking for that fact", calendar: "Reading your calendar", addEvent: "Preparing your calendar card", listReminders: "Reading your reminders", recall: "Looking through your earlier chats" }[m[1]] || "The front desk decided";
    } else if ((m = line.match(/^\[router\] trying (.+)$/))) text = `Asking ${short(m[1])}`;
    else if ((m = line.match(/^\[router\] (\S+) failed/))) text = `${short(m[1])} did not answer, trying the next model`;
    else if ((m = line.match(/^\[router\] answered by /))) text = "Got the answer";
    else if ((m = line.match(/^\[planner\] (\d+) step\(s\)/))) { total = Number(m[1]); text = `Plan ready: ${total} steps`; }
    else if (/^\[planner\] (?!step \d)/.test(line) && /failed|error|could not/i.test(line)) text = "The planner failed, so Claude Sonnet takes over";
    else if ((m = line.match(/^\[planner\] step (\d+) \([^)]*\) starting: (.+)$/))) { started.add(m[1]); models.set(m[1], short(m[2])); }
    else if ((m = line.match(/^\[planner\] step (\d+) (?:FAILED|done)/))) finished.add(m[1]);
    else if (/^\[planner\] all steps finished/.test(line)) text = "All steps finished";
    else if (/^\[reminder\]/.test(line)) text = "Setting your reminder";
    else if ((m = line.match(/^\[study\] (\w+)(?: in (.+))?$/))) text = ({ teach: "Preparing the lesson", quiz: "Preparing your quiz", start: "Preparing the assignment check", answer: "Checking your answer", progress: "Counting your progress from the timetable", plan: "Counting your progress from the timetable", update: "Noting where you are", assignment: "Reading the assignment", motivate: "Looking at your progress", confirm: "Saving", cancel: "Dropping it", pause: "Pausing study reminders", resume: "Turning study reminders on" }[m[1]] || "Working on your studies") + (m[2] ? ` (${m[2].slice(0, 60)})` : "");
    else if ((m = line.match(/^\[course\] (.+): (\d+) of \d+ pages sent \(.*?\)(?: lectures: ([\d,]+))?$/))) text = `Reading ${m[1].slice(0, 60)}${m[3] ? (m[3].includes(",") ? ", lectures " : ", lecture ") + m[3].replace(/,/g, ", ") : ""} (${m[2]} page${m[2] === "1" ? "" : "s"})`;
    else if (/^\[tutor\] asking /.test(line)) text = "The tutor model is writing (this can take 20 seconds)";
    else if (/^\[queue\] waiting for a free slot/.test(line)) text = "Waiting for a free slot: Bot is busy with other tasks";
    else if (/^\[queue\] waiting for an earlier question/.test(line)) text = "Waiting for your earlier question about the same course to finish";
    else if (/^\[queue\] waiting for the file to be read/.test(line)) text = "Waiting for the file to be read (Bot answers when it is done)";
    else if (/^\[queue\] started/.test(line)) text = "Starting";
    if (m && /^\[planner\] step/.test(line)) {
      const n = total || started.size;
      const done = finished.size;
      const running = [...started].filter((id) => !finished.has(id));
      if (done >= n) text = "All steps finished";
      else if (running.length > 1) text = `Working on ${running.length} steps at once (${done} of ${n} done)`;
      else if (running.length === 1) text = `Working on step ${running[0]} of ${n} (asking ${models.get(running[0])})`;
      else text = `${done} of ${n} steps done`;
    }
  }
  return text;
}

// handleCourse(task, { courseId, history, deeper, onPartial, log }) answers a message in a course chat
// (a conversation with a courseId); it is only given when the study notebooks are on.
// thread (optional, BOT_THREAD=on): the thread store (thread-store.js); with it, startThread() works. courses() gives the real course list
// [{ id, name }], studyState() one line per course written by code (the study tracker), courseName(id) the name for a label. All three
// are safe to leave out. With no thread, nothing below changes: start() is exactly what it was.
function createJobs({ handle, handleCourse = null, cardNote = null, store, thread = null, summaries = null, courses = () => [], studyState = () => "", courseName = null, maxRunning = 2, onFinish = () => {}, now = Date.now }) {
  const jobs = new Map(); // id -> job
  let runningCount = 0;

  // A message of the chat as memory for the models. A calendar card is not in the message's text (the page draws it from result.calendarAdd),
  // so code adds a note with the card's checked events and what happened to it (cardNote, from calendar-add.js) for the models only.
  // It is never shown on the page. The card's id goes along, so a corrected card can replace a waiting one.
  function historyEntry(m) {
    const add = m.result && m.result.calendarAdd;
    if (!cardNote || !add || !Array.isArray(add.events)) return { role: m.role, text: m.text };
    // The note travels in its own fields, NOT inside text: historyBlock (core.js) cuts every text to a few thousand characters, and a note cut
    // in the middle of its JSON would silently lose the last classes. `note` is the full one, `noteShort` is for older cards.
    const entry = { role: m.role, text: m.text, cardId: typeof add.id === "string" ? add.id : undefined };
    try { entry.note = cardNote(add); entry.noteShort = cardNote(add, { short: true }); } catch (error) { /* the card note is only a help */ }
    return entry;
  }

  function prune() {
    const finished = [...jobs.values()].filter((j) => j.status !== "running").sort((a, b) => b.finishedAt - a.finishedAt);
    finished.forEach((job, i) => {
      if (i >= MAX_FINISHED || now() - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(job.id);
    });
  }

  const activeFor = (conversationId) => [...jobs.values()].find((j) => j.status === "running" && j.conversationId === conversationId);

  // What the page may see. The log is only included while the job runs (afterwards it is saved in the conversation).
  function view(job, { withLog = false } = {}) {
    const out = {
      id: job.id,
      conversationId: job.conversationId,
      status: job.status,
      task: job.task.slice(0, 200),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      now: now(),
      step: job.status === "running" ? describeProgress(job.log) : job.status === "done" ? "Done" : "Failed",
    };
    if (job.messageId) { out.messageId = job.messageId; out.waiting = job.waiting === true; if (job.acked) out.acked = true; } // acked: a line was saved under the question, so the page fetches it now // the thread: which question this job answers
    if (job.status === "running" && job.partial) out.partial = job.partial; // the answer so far (streaming); gone once the job ends
    if (job.status === "error") out.error = job.error;
    if (withLog) out.log = job.log;
    return out;
  }

  // Starts a job. `task` must already be checked by the caller. Throws errors with a `status` for the server to send.
  // `image` ({ path, ext }) is a photo the server already checked and saved; the job deletes it when it ends.
  // `courseId` (checked by the caller) starts a NEW chat inside a course; an existing chat remembers its own course.
  function start({ task, noPlan = false, conversationId = null, image = null, courseId = null, deeper = false }) {
    let conversation = null;
    if (conversationId !== null && conversationId !== undefined) {
      conversation = store.get(conversationId);
      if (!conversation) throw Object.assign(new Error("conversation not found"), { status: 404 });
      if (activeFor(conversation.id)) {
        throw Object.assign(new Error("Bot is still working on your last message in this chat. Wait for it to finish, or write in another chat."), { status: 409 });
      }
    }
    if (runningCount >= maxRunning) throw Object.assign(new Error("busy, wait for the current tasks to finish"), { status: 429 });
    const inCourse = conversation ? conversation.courseId : courseId;
    if (inCourse && !handleCourse) throw Object.assign(new Error("the study notebooks are off"), { status: 404 });

    // The earlier messages become the memory for this task (a failed answer is not memory).
    const history = conversation ? conversation.messages.filter((m) => !m.error).map(historyEntry) : [];
    // Save the question right away: if you reload or come back later, the chat already shows it.
    if (!conversation) conversation = store.create(task, { courseId });
    const startedAt = now();
    store.append(conversation.id, [{ role: "user", text: image ? "(photo attached) " + task : task, at: startedAt }]);

    const job = {
      id: crypto.randomBytes(16).toString("hex"),
      conversationId: conversation.id,
      task,
      status: "running",
      startedAt,
      finishedAt: null,
      log: [],
      partial: "",
      lastWatched: 0,
    };
    jobs.set(job.id, job);
    runningCount++;

    // Run it. Nothing waits for this promise: the job finishes on its own.
    (async () => {
      let message;
      try {
        const common = {
          history,
          onPartial: (text) => { job.partial = String(text).slice(-MAX_PARTIAL_CHARS); },
          log: (text) => { if (job.log.length < MAX_LOG_LINES) job.log.push(String(text)); },
        };
        const result = inCourse
          ? await handleCourse(task, { ...common, courseId: inCourse, deeper: deeper === true, image })
          : await handle(task, { ...common, noPlan: noPlan === true, image });
        message = { role: "assistant", text: result.mode === "course" ? result.answer : resultText(result), result, log: job.log.slice(-SAVED_LOG_LINES), at: now() };
        job.status = "done";
      } catch (error) {
        const text = String(error && error.message).slice(0, 500);
        message = { role: "assistant", text: "Something went wrong: " + text, error: true, log: job.log.slice(-SAVED_LOG_LINES), at: now() };
        job.status = "error";
        job.error = text;
      }
      try {
        store.append(job.conversationId, [message]);
      } catch (error) {
        // The chat was deleted while the task ran: the answer has nowhere to go.
        job.status = "error";
        job.error = "the conversation was deleted before the answer arrived";
      }
      if (image) fs.rmSync(image.path, { force: true }); // the photo is private: it is not kept after the answer
      job.finishedAt = now();
      runningCount--;
      prune();
      try {
        const title = (store.get(job.conversationId) || {}).title || "chat";
        // watched = a page asked about this chat a moment ago, so someone is looking at it.
        onFinish({ job: view(job), title, watched: now() - job.lastWatched < WATCH_FRESH_MS });
      } catch (error) { /* a notification problem must never break a job */ }
    })();

    return view(job);
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // THE THREAD (BOT_THREAD=on): one conversation, and every message is its own job.
  //
  // What changes compared with start() above:
  //   - there is no chat: the question and its answer are appended to the thread (thread-store.js). The answer carries replyTo, the id
  //     of its question, so a fast answer can arrive before a slow one and still sit under the right question.
  //   - a second message is never refused because a first one is still running (only 20 at once, so a runaway page cannot pile up work).
  //   - TWO LANES. The front desk reads every message at once (it takes about 4 seconds, with no limit). When it then picks SLOW work
  //     (a model answer, a plan, a course answer, a photo), core.js calls gate() and the job waits for one of `maxRunning` slow slots.
  //     Fast actions (reply, clarify, calendar, reminder, memory, recall, add-event card) never take a slot.
  //   - SAME-COURSE ORDER: a question that goes to a course waits for an EARLIER question to the same course that is still running,
  //     so "and the next one?" sees the earlier answer. Questions to different courses never wait for each other.
  //   - the context is built by code from the thread (thread-context.js), small and capped.
  // Jobs live in memory only, like before; the thread is the permanent record.
  // ---------------------------------------------------------------------------------------------------------------------------
  let sequence = 0;
  let slotsUsed = 0;

  const threadJobs = () => [...jobs.values()].filter((j) => j.conversationId === THREAD_ID);

  // Hands out slow slots, oldest waiting job first. A job that has to wait for an earlier question of its course does not block
  // the ones behind it (they may take the free slot).
  function pump() {
    for (const job of threadJobs().filter((j) => j.waiting).sort((a, b) => a.seq - b.seq)) {
      if (slotsUsed >= maxRunning) return;
      const earlier = threadJobs().some((o) => o !== job && o.status === "running" && o.course && o.course === job.course && o.seq < job.seq && (o.holding || o.waiting));
      if (job.course && earlier) continue;
      job.waiting = false;
      job.holding = true;
      slotsUsed++;
      job.log.push("[queue] started");
      job.wake();
    }
  }

  function release(job) {
    if (!job.holding) return;
    job.holding = false;
    slotsUsed--;
    pump();
  }

  // The gate core.js calls before slow work: resolves when this job may start.
  function makeGate(job) {
    return (info = {}) => new Promise((resolve) => {
      job.course = typeof info.course === "string" ? info.course : null;
      job.waiting = true;
      job.wake = resolve;
      const before = slotsUsed;
      pump();
      if (job.waiting) job.log.push(slotsUsed >= maxRunning && before >= maxRunning ? "[queue] waiting for a free slot" : "[queue] waiting for an earlier question about the same course");
    });
  }

  // The topic word code writes on an answer: where it belongs in the thread (never decided by a model).
  function topicOf(result) {
    if (result && (result.mode === "course" || result.mode === "study") && typeof result.courseId === "string") return `course:${result.courseId}`;
    if (result && result.mode === "study") return "study";
    if (result && (result.calendarAdd || /calendar/i.test(String(result.rule || "")))) return "calendar";
    if (result && result.topic === "study") return "study";
    return "general";
  }

  function startThread({ task, noPlan = false, image = null, deeper = false, route = null }) {
    if (!thread) throw Object.assign(new Error("the thread is off"), { status: 404 });
    if (threadJobs().filter((j) => j.status === "running").length >= MAX_THREAD_JOBS) {
      throw Object.assign(new Error("too many messages are being worked on at once, wait a little"), { status: 429 });
    }
    const running = threadJobs().filter((j) => j.status === "running");
    // The first message of a new day starts the daily summaries in the background (thread-summary.js); it never delays this message.
    if (summaries) { try { Promise.resolve(summaries.catchUp()).catch(() => {}); } catch (error) { /* a summary problem never blocks a message */ } }
    // The memory for this message: built BEFORE its own question is saved, from finished messages only. Questions still being
    // answered become one "still working on" line each.
    const history = buildHistory(thread, {
      entryOf: historyEntry,
      courseName,
      busy: running.map((j) => j.messageId),
      pending: running.map((j) => j.task),
      notes: summaries ? (() => { try { return summaries.notesBlock(); } catch (error) { return ""; } })() : "",
    });
    const startedAt = now();
    const question = thread.append({ role: "user", text: image ? "(photo attached) " + task : task, at: startedAt, topic: "general" });

    const job = {
      id: crypto.randomBytes(16).toString("hex"),
      conversationId: THREAD_ID,
      messageId: question.id,
      task,
      status: "running",
      startedAt,
      finishedAt: null,
      log: [],
      partial: "",
      lastWatched: 0,
      seq: ++sequence,
      course: null,
      waiting: false,
      holding: false,
    };
    jobs.set(job.id, job);

    (async () => {
      let message;
      let topic = "general";
      try {
        const common = {
          history,
          onPartial: (text) => { job.partial = String(text).slice(-MAX_PARTIAL_CHARS); },
          log: (text) => { if (job.log.length < MAX_LOG_LINES) job.log.push(String(text)); },
        };
        const list = courses();
        // notify: one short line written by code (core.js), saved under the question as a message marked `ack`. It is not the answer: the
        // restart check does not count it as one, the model's memory skips it, and no push is sent for it (onFinish runs only for the answer).
        const notify = (text) => { try { job.acked = true; thread.append({ role: "assistant", text: String(text).slice(0, 500), replyTo: question.id, topic: "general", ack: true, at: now() }); } catch (error) { /* the line is a courtesy; the answer still comes */ } };
        const result = await handle(task, { ...common, noPlan: noPlan === true, image, deeper: deeper === true, route: route === "general" ? "general" : null, courses: list, studyState: list.length ? studyState() : "", gate: makeGate(job), notify });
        const text = result.mode === "course" || result.mode === "study" ? result.answer : resultText(result);
        // An empty answer is a failure, not a reply: the page must never show a blank bubble.
        if (typeof text !== "string" || !text.trim()) throw new Error("the model sent back an empty answer");
        topic = topicOf(result);
        message = { role: "assistant", text, replyTo: question.id, topic, result, log: job.log.slice(-SAVED_LOG_LINES), at: now() };
        job.status = "done";
      } catch (error) {
        const text = String(error && error.message).slice(0, 500);
        message = { role: "assistant", text: "Something went wrong: " + text, replyTo: question.id, topic: "general", error: true, log: job.log.slice(-SAVED_LOG_LINES), at: now() };
        job.status = "error";
        job.error = text;
      }
      try {
        thread.append(message);
      } catch (error) {
        job.status = "error";
        job.error = "the answer could not be saved: " + String(error.message).slice(0, 200);
      }
      if (image) fs.rmSync(image.path, { force: true }); // the photo is private: it is not kept after the answer
      job.finishedAt = now();
      job.waiting = false;
      release(job);
      prune();
      try {
        // The lock screen shows the push text, so it never carries the message or the answer: only a generic word for the topic.
        const word = { calendar: "your calendar", study: "your studies", course: "your studies" }[topic.split(":")[0]] || "your message";
        onFinish({ job: view(job), title: job.status === "done" ? `An answer about ${word} is ready` : "Bot could not finish", watched: now() - job.lastWatched < WATCH_FRESH_MS });
      } catch (error) { /* a notification problem must never break a job */ }
    })();

    return view(job);
  }

  function get(id, { watching = false } = {}) {
    if (typeof id !== "string" || !JOB_ID_PATTERN.test(id)) return null;
    const job = jobs.get(id);
    if (!job) return null;
    if (watching) job.lastWatched = now();
    return view(job, { withLog: job.status === "running" });
  }

  // All running jobs plus the recently finished ones. `watching` is the conversation id the page has open.
  function list({ watching = null } = {}) {
    prune();
    const all = [...jobs.values()];
    if (watching) all.forEach((j) => { if (j.conversationId === watching) j.lastWatched = now(); });
    return all.sort((a, b) => b.startedAt - a.startedAt).map((j) => view(j, { withLog: j.status === "running" }));
  }

  return { start, startThread, get, list, running: () => runningCount + threadJobs().filter((j) => j.status === "running").length };
}

module.exports = { createJobs, describeProgress, JOB_ID_PATTERN, KEEP_FINISHED_MS, THREAD_ID, MAX_THREAD_JOBS };
