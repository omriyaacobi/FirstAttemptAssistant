// moodle-bridge.js
// Bot cannot reach BGU Moodle itself: the site's edge (Akamai) refuses scripts, and Bot does not pretend to be a browser.
// So Omri's OWN Chrome does the reading, with Omri's own Moodle login, through the small extension in moodle-extension/.
// This file is Bot's side: a WAITING LIST of read jobs.
//
//   1. A brain tool asks for something (bridge.ask("course", { courseid: 68510 })).
//   2. The extension asks Bot every few seconds: GET /api/moodle/next  -> the next job, or nothing.
//   3. It runs the job in Chrome (only the read-only requests in its own allowlist) and sends the answer back:
//      POST /api/moodle/result  { id, ok, data | error, file? }
//   4. The waiting tool gets the answer, or a plain "Chrome is not connected" / "log in to Moodle" after a time limit.
//
// Rules in code:
//   - the job kinds are a closed list (KINDS) with checked arguments (numbers only); Bot never sends an address to the extension,
//     so nothing Moodle or a model writes can make the extension open some other page.
//   - only the extension may use these routes (server.js: origin chrome-extension://, the X-Bot-Bridge header, never from the phone).
//   - what comes back is untrusted DATA. A file is size-capped here again and then takes the normal upload road (course-routes.js).
//   - one job at a time is handed out (the extension also works one at a time), each job is given out once.

const crypto = require("node:crypto");

const KINDS = {
  courses: {}, // my courses (in progress)
  course: { courseid: "id" }, // one course: sections and items
  forum: { cmid: "id" }, // the discussions of a forum (the announcements)
  posts: { discussionid: "id" }, // the posts of one discussion
  events: {}, // upcoming deadlines
  file: { cmid: "id" }, // the file of a "resource" item
  folder: { cmid: "id" }, // the file list of a "folder" item (names + numbers only)
  folderfile: { cmid: "id", index: "small" }, // one file of a folder, by its place in that list
  item: { cmid: "id" }, // the TEXT of one item: token route only (moodle-ws.js); never handed to the extension
  // PC LOOK (2026-11-24, pc-look.js): Omri's open Chrome tabs. Numbers only here too: the extension finds the tab by its id.
  tabs: {}, // id, title, address of every tab
  tab_text: { tabId: "id" }, // the page text of one tab
  tab_shot: { tabId: "id" }, // a picture of one tab, only when it is the tab in front of a visible window
  // NOTABILITY PAGES (2026-11-25, t40): the extension scrolls a Notability note in the tab in front, one picture per page, then back.
  // from = 0: the last page with writing; otherwise pages from..to (pc-look.js checkPages keeps it to 4 pages).
  tab_pages: { tabId: "id", from: "small", to: "small" },
};
const MAX_FILES = 4; // pictures in one answer (tab_pages)
const PAGES_TIMEOUT_MS = 90 * 1000; // scrolling and up to 14 captures, 2 a second
const PC_KINDS = new Set(["tabs", "tab_text", "tab_shot", "tab_pages"]); // not Moodle: their answers say nothing about the Moodle login
const TOKEN_ONLY = new Set(["item"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RESULT_CHARS = 70 * 1024 * 1024; // a 50 MB file is about 67 MB as base64
const JOB_TIMEOUT_MS = 45 * 1000; // a page or a JSON call
const FILE_TIMEOUT_MS = 4 * 60 * 1000;
const SEEN_MS = 40 * 1000; // the extension asked within this time = Chrome is connected

const fail = (code, message) => Object.assign(new Error(message), { code });

function checkArgs(kind, args) {
  const spec = KINDS[kind];
  if (!spec) throw fail("refused", `unknown Moodle job "${String(kind).slice(0, 30)}"`);
  const out = {};
  for (const [k, type] of Object.entries(spec)) {
    const n = Number(args && args[k]);
    const ok = Number.isInteger(n) && (type === "id" ? n > 0 && n < 1e10 : n >= 0 && n < 1000);
    if (!ok) throw fail("refused", `the Moodle job ${kind} needs a whole number ${k}`);
    out[k] = n;
  }
  return out;
}

function createBridge({ now = () => Date.now(), jobTimeoutMs = JOB_TIMEOUT_MS, fileTimeoutMs = FILE_TIMEOUT_MS } = {}) {
  const waiting = []; // jobs not handed out yet
  const out = new Map(); // id -> job handed out, waiting for its answer
  let lastSeen = 0;
  let lastState = null; // what the extension said last time ({ loggedIn })

  const connected = () => now() - lastSeen < SEEN_MS;

  // Ask for one read. Resolves with { data, file? } or rejects with code "offline" | "loggedout" | "timeout" | "moodle" | "refused".
  function ask(kind, args = {}) {
    const clean = checkArgs(kind, args);
    if (TOKEN_ONLY.has(kind)) return Promise.reject(fail("tokenonly", "the Chrome extension cannot read the text of a Moodle item"));
    if (!connected()) return Promise.reject(fail("offline", "Chrome with the Bot Moodle extension is not connected"));
    const id = crypto.randomBytes(8).toString("hex");
    return new Promise((resolve, reject) => {
      const limit = kind === "file" || kind === "folderfile" ? fileTimeoutMs : kind === "tab_pages" ? Math.max(jobTimeoutMs, PAGES_TIMEOUT_MS) : jobTimeoutMs;
      const job = { id, kind, args: clean, resolve, reject };
      job.timer = setTimeout(() => {
        const i = waiting.indexOf(job);
        if (i >= 0) waiting.splice(i, 1);
        out.delete(id);
        reject(fail(connected() ? "timeout" : "offline", connected() ? "Moodle did not answer in time" : "Chrome with the Bot Moodle extension is not connected"));
      }, limit);
      if (job.timer.unref) job.timer.unref();
      waiting.push(job);
    });
  }

  // The extension asks for work. Returns the next job ({ id, kind, args }) or null.
  function next(state = {}) {
    lastSeen = now();
    if (state && typeof state.loggedIn === "boolean") lastState = { loggedIn: state.loggedIn };
    const job = waiting.shift();
    if (!job) return null;
    out.set(job.id, job);
    return { id: job.id, kind: job.kind, args: job.args };
  }

  // The extension's answer. Checks the shape; a file is decoded and size-capped here.
  function result(body) {
    lastSeen = now();
    const id = String(body && body.id || "");
    const job = out.get(id);
    if (!job) throw Object.assign(new Error("no such job (it may have timed out)"), { status: 404 });
    out.delete(id);
    clearTimeout(job.timer);
    if (!body.ok) {
      const code = ["loggedout", "moodle", "toobig", "notfile", "refused", "unavailable"].includes(body.code) ? body.code : "moodle";
      if (code === "loggedout" && !PC_KINDS.has(job.kind)) lastState = { loggedIn: false };
      job.reject(fail(code, String(body.error || "Moodle refused").slice(0, 300)));
      return { ok: true };
    }
    if (!PC_KINDS.has(job.kind)) lastState = { loggedIn: true };
    // A file (or, for tab_pages only, a list of at most MAX_FILES): base64 checked, decoded and size-capped here.
    const decode = (f) => {
      const b64 = String((f && f.base64) || "");
      if (!/^[A-Za-z0-9+/=]*$/.test(b64)) throw fail("moodle", "the file came back broken");
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length > MAX_FILE_BYTES) throw fail("toobig", "the file is bigger than 50 MB");
      return { bytes, name: String(f.name || "file").slice(0, 200), type: String(f.type || "").slice(0, 100) };
    };
    let file = null, files = null;
    try {
      if (body.file) file = decode(body.file);
      if (body.files !== undefined) {
        if (job.kind !== "tab_pages" || !Array.isArray(body.files) || body.files.length > MAX_FILES) throw fail("moodle", `at most ${MAX_FILES} pictures come back, and only for tab_pages`);
        files = body.files.map(decode);
        if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_FILE_BYTES) throw fail("toobig", "the pictures are bigger than 50 MB together");
      }
    } catch (error) { job.reject(error); return { ok: true }; }
    job.resolve({ data: body.data === undefined ? null : body.data, file, ...(files ? { files } : {}) });
    return { ok: true };
  }

  // The two routes, for server.js. Returns true when it answered.
  async function handle(req, res, url, { sendJson, readBody }) {
    if (!url.pathname.startsWith("/api/moodle/")) return false;
    if (req.method === "GET" && url.pathname === "/api/moodle/next") {
      const job = next({ loggedIn: url.searchParams.get("loggedIn") === "1" ? true : url.searchParams.get("loggedIn") === "0" ? false : undefined });
      return sendJson(res, 200, { job }), true;
    }
    if (req.method === "POST" && url.pathname === "/api/moodle/result") {
      let body;
      try { body = JSON.parse(await readBody(req, MAX_RESULT_CHARS)); } catch (error) { return sendJson(res, error.status || 400, { error: error.status ? error.message : "invalid JSON" }), true; }
      try { return sendJson(res, 200, result(body)), true; } catch (error) { return sendJson(res, error.status || 400, { error: error.message }), true; }
    }
    return sendJson(res, 404, { error: "unknown Moodle route" }), true;
  }

  return { ask, next, result, handle, connected, state: () => ({ connected: connected(), loggedIn: lastState ? lastState.loggedIn : null, waiting: waiting.length, out: out.size }) };
}

// Is this request from the extension? (server.js lets ONLY these through to /api/moodle/, and only on this PC)
// A web page cannot send the custom X-Bot-Bridge header to another site without the browser asking first (CORS), and Bot never
// says yes. If an Origin is sent at all, it must be an extension's.
function fromExtension(req) {
  const origin = req.headers.origin;
  return req.headers["x-bot-bridge"] === "1" && (origin === undefined || /^chrome-extension:\/\/[a-p]{32}$/.test(String(origin)));
}

module.exports = { createBridge, checkArgs, fromExtension, KINDS, PC_KINDS, MAX_FILES, MAX_FILE_BYTES, JOB_TIMEOUT_MS, SEEN_MS };
