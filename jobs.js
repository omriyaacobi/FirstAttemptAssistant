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

// Job ids are random and checked everywhere. 32 hex characters = 128 random bits, so they
// cannot be guessed.
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;
const KEEP_FINISHED_MS = 30 * 60 * 1000; // finished jobs stay visible this long
const MAX_FINISHED = 50;
const MAX_PARTIAL_CHARS = 20000; // the growing answer sent to the page while a job runs
const MAX_LOG_LINES = 200; // kept per job in memory
const SAVED_LOG_LINES = 40; // saved into the conversation
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
      text = { answer: "The front desk is answering", clarify: "The front desk has a question for you", delegate: "Choosing the right model", split: "Splitting your message into steps", remind: "Setting your reminder", improve: "Preparing a pointer to Improve Bot", remember: "Noting that down", forget: "Looking for that fact", calendar: "Reading your calendar", addEvent: "Preparing your calendar card", recall: "Looking through your earlier chats" }[m[1]] || "The front desk decided";
    } else if ((m = line.match(/^\[router\] trying (.+)$/))) text = `Asking ${short(m[1])}`;
    else if ((m = line.match(/^\[router\] (\S+) failed/))) text = `${short(m[1])} did not answer, trying the next model`;
    else if ((m = line.match(/^\[router\] answered by /))) text = "Got the answer";
    else if ((m = line.match(/^\[planner\] (\d+) step\(s\)/))) { total = Number(m[1]); text = `Plan ready: ${total} steps`; }
    else if (/^\[planner\] (?!step \d)/.test(line) && /failed|error|could not/i.test(line)) text = "The planner failed, so Claude Sonnet takes over";
    else if ((m = line.match(/^\[planner\] step (\d+) \([^)]*\) starting: (.+)$/))) { started.add(m[1]); models.set(m[1], short(m[2])); }
    else if ((m = line.match(/^\[planner\] step (\d+) (?:FAILED|done)/))) finished.add(m[1]);
    else if (/^\[planner\] all steps finished/.test(line)) text = "All steps finished";
    else if (/^\[reminder\]/.test(line)) text = "Setting your reminder";
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
function createJobs({ handle, handleCourse = null, store, maxRunning = 2, onFinish = () => {}, now = Date.now }) {
  const jobs = new Map(); // id -> job
  let runningCount = 0;

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
    const history = conversation ? conversation.messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })) : [];
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

  return { start, get, list, running: () => runningCount };
}

module.exports = { createJobs, describeProgress, JOB_ID_PATTERN, KEEP_FINISHED_MS };
