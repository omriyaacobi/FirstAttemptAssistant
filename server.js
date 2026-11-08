// server.js
// A tiny web server that lets you use Bot from Chrome.
// Start it with:  node server.js   then open  http://localhost:3000
//
// A server is a program that waits for requests and sends back responses. Ours has these routes:
//   GET    /                       -> the page itself (public/index.html)
//   GET    /api/usage              -> your agy quota, as JSON
//   POST   /api/ask                -> start a task (inside a conversation) as a BACKGROUND JOB; answers at once with its id
//   GET    /api/jobs               -> running jobs and recently finished ones (progress, plain-words step)
//   GET    /api/jobs/:id           -> one job (see jobs.js: the answer is saved into the conversation by the server)
//   GET    /api/thread?before=<ms>&limit=<n> -> ONE conversation (only when BOT_THREAD=on): the newest messages, older ones by "before"
//   DELETE /api/thread/:id         -> move one thread message to the 30-day trash; POST /api/thread/:id/restore brings it back
//   POST   /api/thread/upload?name=&text= -> a FILE or photo with a message (raw bytes): filed under a course by code, or Bot asks which one
//   POST   /api/thread/file/:id/assign    -> { courseId }: the course tapped for a file Bot asked about
//   GET    /api/study                     -> data for the Study page: per course where Omri should be, where they are, what is due, questions
//   POST   /api/study/confirm | /cancel   -> { id }: the Confirm / Cancel tap on a study card (an assignment, or lecture material)
//   GET    /api/summaries/proposals       -> facts and tasks from the daily summaries, waiting for a tap; POST .../:id/accept | /dismiss
//   GET    /api/conversations      -> the list of saved conversations
//   GET    /api/conversations/:id  -> one conversation with all its messages
//   DELETE /api/conversations/:id  -> delete a conversation
//   GET    /api/selfedit           -> the list of self-edit proposals
//   POST   /api/selfedit           -> start one: an editor model changes a PRIVATE COPY of the project
//   GET    /api/selfedit/:id       -> one proposal (diff, test results)
//   POST   /api/selfedit/:id/approve | /reject  -> merge it into the project, or throw it away
//   POST   /api/selfedit/:id/message  -> a follow-up message: the editor continues in the SAME private copy
//   GET    /api/selfedit/:id/preview  -> the changed page, sandboxed, with sample data (see preview.js)
//   (see selfedit.js: nothing changes in your project until you approve, and nothing is pushed)
//   POST   /api/calendar/confirm | /cancel -> the Confirm / Cancel tap on a calendar card ({ id }); the only way an event is ever created (see calendar-add.js)
//   POST   /api/restart            -> restart Bot to load new code (only when started by start-web.cmd)
//   GET    /api/git                -> which commits are on this computer but not on GitHub yet
//   POST   /api/git/push           -> push them (the page asks you to confirm first; see gitops.js)
//   GET    /api/reminders          -> pending reminders, plus the ones that fired and the page has not shown yet
//   POST   /api/reminders/:id/ack  -> the page says it showed one (so it is not shown twice)
//   DELETE /api/reminders/:id      -> cancel (or dismiss) a reminder
//   GET    /api/memory             -> the facts Bot remembers about you (and whether data/profile.md is loaded)
//   POST   /api/memory             -> save ONE fact you approved with the Save button, or change one ({ text, replaces: id }); checked again in code, see profile.js
//   DELETE /api/memory/:id         -> forget one fact
//   POST   /api/memory/:id/pin     -> always send this fact to the models, or stop ({ pinned: true | false })
//   GET    /api/backup             -> when the last backup of data/ ran and whether it failed (see backup.js)
//   GET    /api/morning            -> the morning brief settings; POST to change them; POST /api/morning/now for one right now (see morning.js)
//   GET    /manifest.webmanifest, /sw.js, /icon-192.png, /icon-512.png -> the phone-app files (a FIXED list, see STATIC)
//   GET    /api/session            -> is this the phone, is it logged in, and the key the phone needs for push
//   POST   /api/login | /api/logout -> the phone login (see auth.js)
//   POST   /api/push/subscribe | /api/push/unsubscribe | /api/push/test -> push notifications (see webpush.js)
//
// THE PHONE: it reaches Bot through Tailscale (`tailscale serve`), which runs on this PC and forwards
// to 127.0.0.1. Such requests must log in first. GitHub stays usable from this computer only.
//
// Conversations are saved by store.js in data/conversations/ (git-ignored, they are private).
// The models themselves remember nothing, so for each new message we send them the recent
// conversation as context (see core.js).
//
// SECURITY: this server can start tools that run under YOUR logins and spend YOUR quota,
// so it is locked down in several ways (see the checks below). Only built-in Node modules
// are used, so there is nothing to install.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { handleTask, resultText } = require("./core");
const { createStore } = require("./store");
const { createSelfEdit } = require("./selfedit");
const { buildPreviewHtml, PREVIEW_CSP } = require("./preview");
const { createGitOps } = require("./gitops");
const { getReminders } = require("./reminders");
const { createAuth, loadPhoneConfig } = require("./auth");
const { createPush } = require("./webpush");
const { createJobs, JOB_ID_PATTERN } = require("./jobs");
const { createThreadStore, loadThreadFlag, ID_PATTERN: THREAD_ID_PATTERN } = require("./thread-store");
const { createStudyCoach } = require("./study-coach");
const { createThreadFiles } = require("./thread-files");
const { createSummaries } = require("./thread-summary");
const { studyOverview } = require("./study-page");
const { visibleProposals } = require("./suggestion-filter");
const { readRawBody } = require("./upload");
const { MAX_ZIP_BYTES } = require("./unzip");
const { parsePhoto, savePhoto, MAX_PHOTO_BODY } = require("./photo");
const { createMemory, loadProfile, PROFILE_FILE, aboutBlock } = require("./profile");
const { createCourses, validId: validCourseId } = require("./courses");
const { createCourseRoutes } = require("./course-routes");
const { askCourse } = require("./study");
const { ingestFile } = require("./ingest");
const { askChain, askAgyWithFile } = require("./providers");
const { createMorning } = require("./morning");
const { createBackupScheduler, loadBackupConfig } = require("./backup");
const { getCards } = require("./calendar-add");
const { friendlyError } = require("./calendar-chat");

const HOST = "127.0.0.1"; // listen on this computer only; other devices on your network can't connect
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 20000; // bytes; a bigger request is refused
const MAX_TASK_CHARS = 8000;
const MAX_RUNNING = 2; // at most 2 tasks at once, so a bug or a loop can't burn your whole quota
const PAGE = path.join(__dirname, "public", "index.html");
const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
// The extra files that make the page installable as an app. The request only picks a KEY of this table;
// the file name on disk comes from the table, never from the request, so no path can be smuggled in.
const STATIC = {
  "/manifest.webmanifest": { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8" },
  "/sw.js": { file: "sw.js", type: "text/javascript; charset=utf-8" },
  "/study.js": { file: "study.js", type: "text/javascript; charset=utf-8" }, // the course tabs (public/study.js)
  "/icon-192.png": { file: "icon-192.png", type: "image/png" },
  "/icon-512.png": { file: "icon-512.png", type: "image/png" },
};
// start-web.cmd restarts the server when it exits with this code (the Restart button uses it).
const RESTART_EXIT_CODE = 75;
// A proxy (like tailscale serve) adds these headers. A browser on this PC never sends them, so their
// presence means "this request came from another device", even if the Host header looks local.
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "tailscale-user-login"];
// What the phone may never do, even when logged in: the repository is public.
const PC_ONLY = /^\/api\/git(\/|$)/;

// agy prints tab-separated lines like: Gemini Models<TAB>Five Hour Limit Remaining<TAB>99%<TAB>2026-10-28T01:41:40Z
function parseUsage(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 4)
    .map(([pool, window, remaining, resets]) => ({ pool, window, remaining: parseInt(remaining, 10), resets }));
}

function getUsage() {
  return new Promise((resolve, reject) => {
    execFile(AGY_CMD, ["-p", "/usage"], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).slice(0, 200)));
      resolve(parseUsage(stdout));
    });
  });
}

// Reads the request body, but gives up if it gets too big.
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(Object.assign(new Error("request too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const sendJson = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

// Reads a JSON request body. Sends the error response itself and returns null if the request is bad.
// Only "Content-Type: application/json" is accepted. A web page on another site cannot send JSON
// to us without the browser first asking our permission, and we never give it.
// { photo: true } is only used by /api/ask: a request carrying a photo may be bigger (MAX_PHOTO_BODY).
// A request WITHOUT a photo still has to fit in MAX_BODY, like everywhere else.
async function readJsonBody(req, res, { photo = false } = {}) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
    sendJson(res, 415, { error: "send JSON" });
    return null;
  }
  try {
    const raw = await readBody(req, photo ? MAX_PHOTO_BODY : MAX_BODY);
    const parsed = JSON.parse(raw);
    if (photo && raw.length > MAX_BODY && (!parsed || typeof parsed !== "object" || parsed.image === undefined)) {
      throw Object.assign(new Error("request too large"), { status: 413 });
    }
    if (parsed && typeof parsed === "object") return parsed;
    throw new Error("not an object");
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.status ? error.message : "invalid JSON" });
    return null;
  }
}

// Turns an error from selfedit.js into an HTTP status.
const selfEditStatus = (error) => (/not found/.test(error.message) ? 404 : /still running|uncommitted|new commits|only "ready"|blocked|changed after/.test(error.message) ? 409 : 400);

function createServer({
  handle = handleTask,
  usage = getUsage,
  store = createStore(path.join(__dirname, "data", "conversations")),
  selfEdit = createSelfEdit({ repoDir: __dirname, dataDir: path.join(__dirname, "data") }),
  gitOps = createGitOps({ repoDir: __dirname }),
  reminders = getReminders(),
  calendarCards = getCards(), // the calendar cards waiting for a tap (calendar-add.js); tests pass cards with a fake calendar
  memory = createMemory(),
  profileFile = PROFILE_FILE,
  uploadDir = path.join(__dirname, "data", "uploads"), // a photo waits here only while its task runs (data/ is git-ignored)
  auth = createAuth({ config: loadPhoneConfig(path.join(__dirname, ".env")) }),
  push = createPush({ dir: path.join(__dirname, "data") }),
  coach = null, // the study coach (study-coach.js), only with the thread
  summaries = null, // the daily summaries (thread-summary.js), only with the thread
  threadFiles = null, // files that arrive with a message (thread-files.js), only with the thread
  thread = null, // the ONE conversation (thread-store.js); off unless given (BOT_THREAD=on), so with it off every route is exactly as before
  courseRoutes = null, // the study notebooks (course-routes.js); off unless given, so tests never touch data/courses
  backup = null, // the data/ backup (backup.js); off unless given, so tests never read data/
  morning = null, // the morning brief (morning.js); off unless given, so tests never touch data/morning.json
  // Restarting only works when start-web.cmd is watching, because it is what starts us again.
  threadDeps = null, // (thread) extra fakes or helpers for core.js, for example the thread search for "recall"; tests pass their own
  supervised = process.env.BOT_SUPERVISED === "1",
  restart = () => setTimeout(() => process.exit(RESTART_EXIT_CODE), 300), // give the reply time to reach the page
} = {}) {
  // Tasks run as background jobs (see jobs.js), so they survive the page being closed or reloaded.
  // When one finishes and nobody is looking at that chat, every subscribed phone gets a push.
  // Thread jobs (BOT_THREAD=on) pass the real course list; only then is the course action possible, and the answer comes from the notebook.
  const threadHandle = (task, options = {}) => (options.courses && courseRoutes
    ? handle(task, { ...options, deps: { ...(options.deps || {}), courseAnswer: (id, question, o) => courseRoutes.answer(id, question, o), ...(coach ? { studyAnswer: (args) => coach.answerStudy(args) } : {}), ...(threadDeps ? threadDeps() : {}) } })
    : handle(task, options));
  // One short block of study state for the front desk (written by code from the tracker; data, never instructions).
  const studyState = () => {
    if (!coach) return "";
    try {
      const lines = [coach.questionLine(), coach.studyLine()];
      const card = coach.pendingProposal();
      if (card) lines.push(`A confirmation card is waiting for the user's yes or no (${card.kind} for ${card.course}).`);
      for (const ref of coach.tracker.refsFor(courseRoutes ? courseRoutes.list() : [])) {
        if (coach.tracker.getSession(ref)) lines.push(`A quiz or lesson is open in ${ref.name}: the user's next message is probably an answer (studyIntent answer).`);
      }
      return lines.filter(Boolean).join("\n").slice(0, 900);
    } catch (error) { return ""; }
  };
  const jobs = createJobs({
    handle: threadHandle,
    thread,
    summaries,
    studyState,
    courses: () => (courseRoutes ? courseRoutes.list() : []),
    courseName: courseRoutes ? (id) => courseRoutes.name(id) : null,
    cardNote: (add, options) => calendarCards.note(add, options), // the chat history tells the next message what the calendar cards held and what happened to them
    handleCourse: courseRoutes ? (task, opts) => courseRoutes.answer(opts.courseId, task, opts) : null, // chats inside a course
    store,
    maxRunning: MAX_RUNNING,
    onFinish: ({ job, title, watched }) => {
      if (watched) return;
      const ok = job.status === "done";
      push.notifyAll({ title: ok ? "Bot finished" : "Bot could not finish", body: title, tag: `job-${job.id}` }).catch(() => {});
    },
  });

  // Every route runs inside this function. If one throws (a locked or damaged file, a bug), the page gets a plain 500 and Bot keeps running:
  // an async handler that throws would otherwise be an unhandled rejection, and Node ends the whole program on those.
  const handleRequest = async (req, res) => {
    const port = server.address().port;
    const me = [`localhost:${port}`, `127.0.0.1:${port}`];
    const host = String(req.headers.host || "").toLowerCase();
    const phoneHost = auth.enabled && host === auth.host;

    // CHECK 1 - the Host header must be our own address. This blocks "DNS rebinding", a trick
    // where a malicious website points its own name at 127.0.0.1 to talk to local servers.
    // The only other name allowed is this PC's own Tailscale name, and only when phone access is on.
    if (!me.includes(host) && !phoneHost) return sendJson(res, 403, { error: "bad host" });

    // Is this the phone (or any other device) coming in through Tailscale?
    const remote = phoneHost || PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
    if (remote && !auth.enabled) return sendJson(res, 403, { error: "phone access is off (see auth.js)" });

    // CHECK 2 - browsers say which site a request came from. Refuse anything not from this page.
    // This blocks other websites you have open from sending tasks to this server.
    const origin = req.headers.origin;
    const allowedOrigins = remote ? [`https://${auth.host}`] : me.map((h) => `http://${h}`);
    if (origin && !allowedOrigins.includes(origin)) return sendJson(res, 403, { error: "bad origin" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Opening the page itself (or the app files) is allowed from anywhere: they are fixed files with
    // no private data, and GET changes nothing. This is needed because Android marks a launch from the
    // home-screen app icon as "cross-site". Every /api request still must come from this page.
    const pageFile = req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || Object.hasOwn(STATIC, url.pathname));
    const site = req.headers["sec-fetch-site"];
    if (site && !pageFile && !["same-origin", "none"].includes(site)) return sendJson(res, 403, { error: "cross-site request" });

    // CHECK 3 (phone only) - log in first, and never the PC-only routes.
    if (remote) {
      const open = pageFile || url.pathname === "/api/session" || url.pathname === "/api/login";
      if (!open && PC_ONLY.test(url.pathname)) return sendJson(res, 403, { error: "this only works on the PC" });
      if (!open && !auth.isLoggedIn(req)) return sendJson(res, 401, { error: "log in first" });
    }

    // Phone login and session info
    if (req.method === "GET" && url.pathname === "/api/session") {
      return sendJson(res, 200, {
        remote,
        phoneAccess: auth.enabled,
        loggedIn: remote ? auth.isLoggedIn(req) : true,
        images: true, // this Bot can receive a photo with a message
        ...(thread ? { thread: true } : {}), ...(thread && coach ? { study: true } : {}), // one conversation (BOT_THREAD=on): the page shows the thread; with it off the answer has no such key, as before
        pushKey: !remote || auth.isLoggedIn(req) ? push.publicKey() : null,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      if (!remote) return sendJson(res, 400, { error: "no login is needed on this computer" });
      const result = auth.login(input.token);
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      res.setHeader("Set-Cookie", result.cookie);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      if (!(await readJsonBody(req, res))) return;
      res.setHeader("Set-Cookie", auth.logoutCookie());
      return sendJson(res, 200, { ok: true });
    }

    // Push notifications
    if (req.method === "POST" && url.pathname === "/api/push/subscribe") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      try {
        return sendJson(res, 200, { ok: true, devices: push.subscribe(input.subscription) });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/push/unsubscribe") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      return sendJson(res, 200, { ok: push.unsubscribe(String(input.endpoint || "")) });
    }
    if (req.method === "POST" && url.pathname === "/api/push/test") {
      if (!(await readJsonBody(req, res))) return;
      try {
        return sendJson(res, 200, await push.notifyAll({ title: "Bot", body: "Test notification: push works.", tag: "bot-test" }));
      } catch (error) {
        return sendJson(res, 500, { error: error.message });
      }
    }

    // The page itself
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      fs.readFile(PAGE, (error, html) => {
        if (error) return sendJson(res, 500, { error: "page missing" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
      });
      return;
    }

    // The phone-app files (manifest, service worker, icons): only the fixed names in STATIC.
    if (req.method === "GET" && Object.hasOwn(STATIC, url.pathname)) {
      const item = STATIC[url.pathname];
      fs.readFile(path.join(__dirname, "public", item.file), (error, data) => {
        if (error) return sendJson(res, 404, { error: "not found" });
        res.writeHead(200, { "Content-Type": item.type, "Cache-Control": "no-store" });
        res.end(data);
      });
      return;
    }

    // Reminders. They are created from the chat ("remind me ..."); here the page lists, dismisses and cancels them.
    if (req.method === "GET" && url.pathname === "/api/reminders") {
      return sendJson(res, 200, { reminders: reminders.list(), due: reminders.undelivered() });
    }
    const reminderRoute = url.pathname.match(/^\/api\/reminders\/([^/]+?)(?:\/(ack))?$/);
    if (reminderRoute) {
      const [, id, action] = reminderRoute;
      if (action && req.method === "POST") {
        if (!(await readJsonBody(req, res))) return;
        return reminders.acknowledge(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "reminder not found" });
      }
      if (!action && req.method === "DELETE") {
        return reminders.cancel(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "reminder not found" });
      }
    }

    // What Bot remembers about you. Facts are only ever added by a click on Save (the front desk just proposes),
    // and only from this page: these routes sit behind the same Host, Origin and phone-login checks as the others.
    if (req.method === "GET" && url.pathname === "/api/memory") {
      return sendJson(res, 200, { facts: memory.list(), profile: { loaded: loadProfile(profileFile).length > 0 } });
    }
    if (req.method === "POST" && url.pathname === "/api/memory") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      try {
        const { fact, already } = memory.add(input.text, input.replaces === undefined ? {} : { replaces: input.replaces });
        return sendJson(res, already ? 200 : 201, { fact, already });
      } catch (error) {
        return sendJson(res, /not found/.test(error.message) ? 404 : 400, { error: error.message });
      }
    }
    const memoryRoute = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (memoryRoute && req.method === "DELETE") {
      return memory.remove(memoryRoute[1]) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "fact not found" });
    }

    const pinRoute = url.pathname.match(/^\/api\/memory\/([^/]+)\/pin$/);
    if (pinRoute && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      return memory.pin(pinRoute[1], input.pinned === true) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "fact not found" });
    }

    // When the last backup ran. Status only: no folder name, no passphrase.
    if (backup && req.method === "GET" && url.pathname === "/api/backup") {
      const { enabled, ok, lastSuccess, lastAttempt, error, running, reason } = backup.status();
      return sendJson(res, 200, { enabled, ok, lastSuccess, lastAttempt, error, running, reason });
    }

    // The morning brief settings. Only the page can reach these; all the checks above have already run.
    if (morning && (await morning.handle(req, res, url, { sendJson, readJsonBody }))) return;

    // Quota panel
    if (req.method === "GET" && url.pathname === "/api/usage") {
      try {
        return sendJson(res, 200, { rows: await usage() });
      } catch (error) {
        return sendJson(res, 502, { error: error.message });
      }
    }

    // Study notebooks: courses, their files and chats. All checks above (host, origin, phone login) have already run.
    if (courseRoutes && (await courseRoutes.handle(req, res, url, { sendJson, readJsonBody }))) return;

    if (thread && coach && req.method === "GET" && url.pathname === "/api/study") {
      return sendJson(res, 200, studyOverview({ coach, courseList: courseRoutes ? courseRoutes.list() : [], lang: url.searchParams.get("lang") === "he" ? "he" : "en" })); // ?lang=he: the questions Bot writes by code come in Hebrew
    }
    const studyCard = url.pathname.match(/^\/api\/study\/(confirm|cancel)$/);
    if (thread && coach && studyCard && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      if (typeof input.id !== "string" || !/^p[a-z0-9]{3,24}$/.test(input.id)) return sendJson(res, 400, { error: "bad card id" });
      const r = studyCard[1] === "confirm" ? coach.confirmProposal(input.id) : coach.cancelProposal(input.id);
      try { thread.append({ role: "assistant", text: r.answer, topic: "study", result: { mode: "study", answer: r.answer } }); } catch (error) { /* the reply still reaches the page */ }
      return sendJson(res, r.ok ? 200 : 409, r);
    }
    if (thread && summaries && url.pathname.startsWith("/api/summaries/proposals")) {
      if (req.method === "GET" && url.pathname === "/api/summaries/proposals") {
        // Hide what Bot already has: a reminder, a saved fact, an assignment, a calendar card, or a place in a course (suggestion-filter.js).
        let existing = { facts: [], reminders: [], assignments: [], calendar: [] };
        try {
          existing = {
            facts: memory.list().map((f) => f.text),
            reminders: reminders.list().map((r) => r.text),
            assignments: coach ? coach.tracker.refsFor(courseRoutes ? courseRoutes.list() : []).flatMap((r) => coach.tracker.progress(r).assignments.map((x) => x.title)) : [],
            calendar: thread.recent(200).flatMap((m) => (m.result && m.result.calendarAdd && Array.isArray(m.result.calendarAdd.events) ? m.result.calendarAdd.events.map((e) => e.summary) : [])),
          };
        } catch (error) { /* without the lists nothing is hidden */ }
        return sendJson(res, 200, { proposals: visibleProposals(summaries.proposals(), existing) });
      }
      const act = url.pathname.match(/^\/api\/summaries\/proposals\/([a-z]_\d{4}-\d{2}-\d{2}_\d{1,2})\/(accept|dismiss)$/);
      if (act && req.method === "POST") {
        const item = summaries.peek(act[1]);
        if (!item) return sendJson(res, 404, { error: "that proposal is gone or was already answered" });
        if (act[2] === "dismiss") { summaries.dismiss(act[1]); return sendJson(res, 200, { ok: true }); }
        // Only this tap saves anything. A fact goes through memory (profile.js checks it again); a task needs a real date.
        try {
          if (item.kind === "fact") memory.add(item.text);
          else {
            if (!item.due) return sendJson(res, 400, { error: "this task has no date, so no reminder can be set: tell Bot when to remind you" });
            reminders.create({ text: item.text, at: new Date(`${item.due}T09:00:00`).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
          }
        } catch (error) { return sendJson(res, 400, { error: error.message }); }
        summaries.accept(act[1]);
        return sendJson(res, 200, { ok: true, saved: item.kind });
      }
      return sendJson(res, 404, { error: "not found" });
    }
    // A file or photo that comes with a message. Same checks as a course file (real first bytes, 50 MB), then code picks the course.
    if (thread && threadFiles && req.method === "POST" && url.pathname === "/api/thread/upload") {
      if (!String(req.headers["content-type"] || "").startsWith("application/octet-stream")) return sendJson(res, 415, { error: "send the file as application/octet-stream" });
      try {
        // A zip may be bigger than one file (its files are unpacked and checked one by one in unzip.js); anything else keeps the 50 MB limit.
        const bytes = await readRawBody(req, /\.zip$/i.test(String(url.searchParams.get("name") || "")) ? MAX_ZIP_BYTES : undefined);
        const text = String(url.searchParams.get("text") || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 500);
        return sendJson(res, 201, threadFiles.receive({ bytes, name: url.searchParams.get("name"), text }));
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message });
      }
    }
    const assignRoute = url.pathname.match(/^\/api\/thread\/file\/([a-f0-9]{16})\/assign$/);
    if (thread && threadFiles && assignRoute && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      try { return sendJson(res, 201, threadFiles.assign(assignRoute[1], String(input.courseId || ""))); } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
    }

    // The ONE conversation (only when BOT_THREAD=on; with it off these routes do not exist).
    const threadRoute = url.pathname.match(/^\/api\/thread(?:\/([^/]+?)(\/restore)?)?$/);
    if (threadRoute) {
      if (!thread) return sendJson(res, 404, { error: "the thread is off (BOT_THREAD in .env)" });
      const [, id, restore] = threadRoute;
      if (!id && req.method === "GET") {
        // before = a time in ms (only older messages), limit = how many (1 to 200, default 50). Both are checked here; nothing else is read.
        const beforeText = url.searchParams.get("before");
        const limitText = url.searchParams.get("limit");
        const before = beforeText === null ? null : /^\d{1,15}$/.test(beforeText) ? Number(beforeText) : NaN;
        const limit = limitText === null ? 50 : /^\d{1,4}$/.test(limitText) ? Number(limitText) : NaN;
        if (Number.isNaN(before) || Number.isNaN(limit)) return sendJson(res, 400, { error: "before and limit must be numbers" });
        return sendJson(res, 200, { ...thread.page({ before, limit }), courses: courseRoutes ? courseRoutes.list() : [] });
      }
      // The 30-day trash, newest first: so Restore works after a reload too (not only right after deleting). Text is cut; the page draws it with textContent.
      if (id === "trash" && !restore && req.method === "GET") {
        const nowMs = Date.now();
        return sendJson(res, 200, { items: thread.trashList().slice(0, 100).map((t) => ({ id: t.message.id, role: t.message.role, text: String(t.message.text || "").slice(0, 300), at: t.message.at, trashedAt: t.trashedAt, daysLeft: Math.max(0, 30 - Math.floor((nowMs - t.trashedAt) / 86400000)) })) });
      }
      if (id && !THREAD_ID_PATTERN.test(id)) return sendJson(res, 404, { error: "message not found" });
      if (id && !restore && req.method === "DELETE") return thread.trash(id) ? sendJson(res, 200, { ok: true, keptDays: 30 }) : sendJson(res, 404, { error: "message not found" });
      if (id && restore && req.method === "POST") return thread.restore(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "message not found in the trash" });
      return sendJson(res, 404, { error: "not found" });
    }

    // Saved conversations
    if (req.method === "GET" && url.pathname === "/api/conversations") {
      return sendJson(res, 200, { conversations: store.list() });
    }
    const conversationRoute = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationRoute && req.method === "GET") {
      const conversation = store.get(conversationRoute[1]);
      // A course chat also carries its course name, for the title bar.
      return conversation ? sendJson(res, 200, conversation.courseId && courseRoutes ? { ...conversation, courseName: courseRoutes.name(conversation.courseId) } : conversation) : sendJson(res, 404, { error: "conversation not found" });
    }
    if (conversationRoute && req.method === "DELETE") {
      return store.remove(conversationRoute[1]) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "conversation not found" });
    }

    // Self-edit proposals. Only YOU start these (from the "Improve Bot" panel);
    // the models can never start one on their own.
    if (url.pathname === "/api/selfedit" && req.method === "GET") {
      return sendJson(res, 200, { proposals: selfEdit.list(), busy: selfEdit.isActive() });
    }
    if (url.pathname === "/api/selfedit" && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      const model = input.model === undefined ? "sonnet" : input.model;
      if (!["sonnet", "opus", "argon"].includes(model)) return sendJson(res, 400, { error: "model must be sonnet, opus or argon" });
      try {
        const { record } = await selfEdit.start(input.request, { model });
        return sendJson(res, 202, { proposal: record });
      } catch (error) {
        return sendJson(res, selfEditStatus(error), { error: error.message });
      }
    }
    const selfEditRoute = url.pathname.match(/^\/api\/selfedit\/([^/]+?)(?:\/(approve|reject|message|preview))?$/);
    if (selfEditRoute) {
      const [, id, action] = selfEditRoute;
      if (!action && req.method === "GET") {
        const proposal = selfEdit.get(id);
        return proposal ? sendJson(res, 200, { proposal, now: Date.now() }) : sendJson(res, 404, { error: "proposal not found" });
      }
      if (action === "preview" && req.method === "GET") {
        const dir = selfEdit.previewDir(id);
        const html = dir && buildPreviewHtml(dir);
        if (!html) return sendJson(res, 404, { error: "there is no page to preview (it must be ready, and have a public/index.html)" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": PREVIEW_CSP });
        res.end(html);
        return;
      }
      if (action === "message" && req.method === "POST") {
        const input = await readJsonBody(req, res);
        if (!input) return;
        try {
          const { record } = await selfEdit.followUp(id, input.message);
          return sendJson(res, 202, { proposal: record });
        } catch (error) {
          return sendJson(res, selfEditStatus(error), { error: error.message });
        }
      }
      if ((action === "approve" || action === "reject") && req.method === "POST") {
        if (!(await readJsonBody(req, res))) return;
        try {
          const proposal = action === "approve" ? await selfEdit.approve(id) : await selfEdit.reject(id);
          return sendJson(res, 200, { proposal });
        } catch (error) {
          return sendJson(res, selfEditStatus(error), { error: error.message });
        }
      }
    }

    // The Confirm / Cancel tap on a calendar card. Only a tap here ever creates events (no model can). The same phone login as the
    // other chat actions is enough: the card shows every event in full, only adds (Bot cannot delete or change events), works once
    // and expires after 15 minutes.
    const calendarRoute = url.pathname.match(/^\/api\/calendar\/(confirm|cancel)$/);
    if (calendarRoute && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return;
      if (calendarRoute[1] === "cancel") return sendJson(res, 200, { cancelled: calendarCards.cancel(input.id) });
      try {
        return sendJson(res, 200, await calendarCards.confirm(input.id));
      } catch (error) {
        const message = error.loginProblem ? friendlyError(error) + " The card is kept: log in, then tap Confirm again." : error.message;
        return sendJson(res, error.status || 500, { error: message, loginProblem: !!error.loginProblem });
      }
    }

    // Restart, to load new code after an approved change.
    if (req.method === "POST" && url.pathname === "/api/restart") {
      if (!(await readJsonBody(req, res))) return;
      if (!supervised) {
        return sendJson(res, 409, { error: "Bot can only restart itself when it was started with start-web.cmd. Close this server and double-click start-web.cmd." });
      }
      if (jobs.running() > 0 || selfEdit.isActive() || (courseRoutes && !courseRoutes.idle())) return sendJson(res, 409, { error: "busy: wait until the running tasks and edits finish" });
      sendJson(res, 200, { restarting: true });
      restart();
      return;
    }

    // GitHub: what is not pushed yet, and pushing it.
    if (req.method === "GET" && url.pathname === "/api/git") {
      try {
        return sendJson(res, 200, await gitOps.status());
      } catch (error) {
        return sendJson(res, 500, { error: error.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/git/push") {
      if (!(await readJsonBody(req, res))) return;
      try {
        return sendJson(res, 200, await gitOps.push());
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    // Start a task. It runs as a background job (jobs.js) and we answer at once with the job's id,
    // so the page can close, reload or switch chats while Bot works, and pick the job up again later.
    if (req.method === "POST" && url.pathname === "/api/ask") {
      // Only JSON is accepted (readJsonBody): a web page on another site can't send JSON to us
      // without the browser first asking our permission, and we never give it.
      const input = await readJsonBody(req, res, { photo: true });
      if (!input) return;

      // Never trust what arrives: check the type and the size.
      const task = typeof input.task === "string" ? input.task.trim() : "";
      if (!task) return sendJson(res, 400, { error: "task is empty" });
      if (task.length > MAX_TASK_CHARS) return sendJson(res, 413, { error: `task is longer than ${MAX_TASK_CHARS} characters` });

      // An optional photo: really check it (size, then the first bytes) and save it under a random name.
      let image = null;
      if (input.image !== undefined) {
        try {
          image = savePhoto(uploadDir, parsePhoto(input.image));
        } catch (error) {
          return sendJson(res, error.status || 400, { error: error.message });
        }
      }

      // The thread: there is no chat, so no chat id and no course id is read. Every message is its own job (jobs.js startThread).
      if (thread) {
        try {
          if (input.route !== undefined && input.route !== "general") { if (image) fs.rmSync(image.path, { force: true }); return sendJson(res, 400, { error: 'route can only be "general"' }); }
          const job = jobs.startThread({ task, noPlan: input.noPlan === true, image, deeper: input.deeper === true, route: input.route === "general" ? "general" : null });
          return sendJson(res, 202, { job });
        } catch (error) {
          if (image) fs.rmSync(image.path, { force: true });
          return sendJson(res, error.status || 500, { error: error.message });
        }
      }

      // A new chat inside a course: the course must exist (an id from the page is never trusted).
      let courseId = null;
      if (input.courseId !== undefined && input.conversationId == null) {
        if (typeof input.courseId !== "string" || !validCourseId(input.courseId) || !courseRoutes || !courseRoutes.exists(input.courseId)) {
          if (image) fs.rmSync(image.path, { force: true });
          return sendJson(res, 404, { error: "course not found" });
        }
        courseId = input.courseId;
      }

      try {
        // Also checks the conversation id, that this chat has no job running already (409),
        // and the cap on simultaneous tasks (429).
        const job = jobs.start({ task, noPlan: input.noPlan === true, conversationId: input.conversationId, image, courseId, deeper: input.deeper === true });
        return sendJson(res, 202, { job });
      } catch (error) {
        if (image) fs.rmSync(image.path, { force: true }); // the job never started, so nothing else will delete the photo
        return sendJson(res, error.status || 500, { error: error.message });
      }
    }

    // Following jobs. `?watching=<conversation id>` tells Bot which chat the page is showing,
    // so it only sends a push notification when nobody is looking at the chat that finished.
    if (req.method === "GET" && url.pathname === "/api/jobs") {
      const watching = url.searchParams.get("watching");
      return sendJson(res, 200, { jobs: jobs.list({ watching }) });
    }
    const jobRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobRoute && req.method === "GET") {
      const job = JOB_ID_PATTERN.test(jobRoute[1]) ? jobs.get(jobRoute[1], { watching: url.searchParams.get("watching") === "1" }) : null;
      return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: "job not found" });
    }

    sendJson(res, 404, { error: "not found" });
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Request failed:", req.method, String(req.url || "").split("?")[0], String(error && error.message).slice(0, 200)); // never the body or the query: they can hold message text
      try {
        if (!res.headersSent) sendJson(res, 500, { error: "Bot hit an internal problem with this request" });
        else res.end();
      } catch (inner) { /* the connection is gone */ }
    });
  });

  return server;
}

module.exports = { createServer, parseUsage, MAX_BODY, MAX_TASK_CHARS, MAX_RUNNING, RESTART_EXIT_CODE };

// Start listening only when run directly ("node server.js"), not when a test imports this file.
if (require.main === module) {
  const push = createPush({ dir: path.join(__dirname, "data"), log: console.log });
  const auth = createAuth({ config: loadPhoneConfig(path.join(__dirname, ".env")) });
  const store = createStore(path.join(__dirname, "data", "conversations")); // the course chats live here too
  const coursesStore = createCourses(path.join(__dirname, "data", "courses"));
  const threadOn = loadThreadFlag(path.join(__dirname, ".env"));
  let threadFiles = null; // set below when the thread is on; the course reader calls it after a file is read
  const courseRoutes = createCourseRoutes({
    store,
    courses: coursesStore,
    onFileReady: threadOn ? (args) => (threadFiles ? threadFiles.onFileReady(args) : undefined) : null,
    askCourse, ingestFile, askChain, askFile: askAgyWithFile,
    // Other-language search words for course questions (crosslang.js): one short Flash call through the front desk's pre-warmed agy.
    expand: (text) => { const { expandQuery } = require("./crosslang"); const fd = require("./frontdesk"); return expandQuery({ text, askStructured: fd.warm.askStructured, model: fd.FRONT_DESK_MODEL.model }); },
    about: () => aboutBlock(), // the profile ("learns from exercises") reaches the study model; never a web model
    log: console.log,
  });
  // BOT_THREAD=on in .env turns the one-conversation thread on (default off: Bot is then exactly what it was).
  const thread = threadOn ? createThreadStore(path.join(__dirname, "data", "thread")) : null;
  if (thread) { try { const n = thread.markUnanswered(); if (n) console.log(`Thread: ${n} question(s) had no answer because Bot was stopped; each now says so.`); } catch (error) { console.error("Thread:", error.message); } } // nothing is lost silently after a restart
  const coach = thread ? createStudyCoach({ dir: path.join(__dirname, "data", "study"), courses: coursesStore, askChain: require("./providers").askChain, log: console.log }) : null;
  const summaries = thread ? createSummaries({ thread, dir: path.join(__dirname, "data", "thread", "summaries"), askChain: require("./providers").askChain, log: console.log }) : null;
  if (thread) threadFiles = createThreadFiles({ thread, courseRoutes, coach, log: console.log });
  const morning = createMorning({ file: path.join(__dirname, "data", "morning.json"), store, reminders: getReminders(), push, study: coach, thread, log: console.log });
  const backup = createBackupScheduler({ dataDir: path.join(__dirname, "data"), repoDir: __dirname, config: loadBackupConfig(path.join(__dirname, ".env")) });
  let threadDeps = null;
  if (thread) {
    const { findInThread } = require("./recall");
    threadDeps = () => ({ searchChats: (query) => findInThread(thread, query, { oldChats: store }) });
    console.log("BOT_THREAD is on: one conversation (data/thread).");
    const purge = () => { try { const n = thread.purgeTrash(); if (n) console.log(`Thread trash: removed ${n} message(s) older than 30 days.`); } catch (error) { console.error("Thread trash:", error.message); } };
    purge();
    setInterval(purge, 6 * 3600 * 1000).unref();
  }
  const server = createServer({ push, auth, courseRoutes, store, morning, backup, thread, threadDeps, coach, summaries, threadFiles });
  // When a reminder is due, send it to every phone that turned notifications on.
  getReminders().onFire((r) => push.notifyAll({ title: r.late ? "Bot reminder (late)" : "Bot reminder", body: r.text, tag: `reminder-${r.id}` }));
  let tries = 0;
  server.on("error", (error) => {
    // Right after a restart the old server may still be letting go of the port, so wait a little.
    if (error.code === "EADDRINUSE" && tries < 10) {
      tries++;
      return setTimeout(() => server.listen(PORT, HOST), 500);
    }
    if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Is the server already running? Or try: PORT=3001 node server.js`);
    else console.error("Server error:", error.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Bot web page: http://localhost:${PORT}  (only reachable from this computer)`);
    console.log(auth.enabled ? `Phone access ON for https://${auth.host} (login required)` : `Phone access off: ${auth.reason}`);
    try { require("./providers").removeStaleWorkDirs(); } catch (error) { /* only housekeeping */ } // old bot-file-* / bot-photo-* folders from earlier runs
    getReminders().start(); // checks for due reminders every 30 s; missed ones fire right now (catch-up)
    backup.start(); // first check 2 minutes after start, then hourly; a copy is made at most once a day (backup.js)
    morning.start(); // does nothing until you turn the morning brief on in the page
    try { require("./frontdesk").warmUpDesk(); } catch (error) { console.error("Could not prepare the front desk:", error.message); } // only makes the first message slower
    console.log(process.env.BOT_SUPERVISED === "1" ? "Started by start-web.cmd: the Restart button works. Close this window to stop." : "Press Ctrl+C to stop.");
  });
}
