// moodle-ws.js
// Moodle WITHOUT Chrome and without logging in each time: the web-service TOKEN the official Moodle phone app uses.
// (A token is a long secret string that stands in for a login. Omri gets it ONCE with `node moodle-token.js`, typing the password
// himself; it is kept in .env as MOODLE_TOKEN and lasts for weeks. Research: experiments/2026-11-14-moodle-token.md.)
//
// This file gives the SAME jobs as the Chrome extension (moodle-bridge.js KINDS: courses, course, forum, posts, events, file, folder,
// folderfile) and answers in the same shapes, so moodle-tools.js works with either. Node built-ins only.
//
// Rules in code (tests/moodle-ws.test.js):
//   - ONE address for calls: POST https://moodle.bgu.ac.il/moodle/webservice/rest/server.php, with a function from READ_FUNCTIONS
//     only. Every one of them only READS. The token can do more in Moodle (the phone app can submit); Bot's code cannot ask for it.
//   - files: only an address Moodle itself listed for that item, on Moodle's own host under /moodle/webservice/pluginfile.php/,
//     50 MB at most. Nothing a model writes becomes an address (the jobs carry whole numbers only, checked by moodle-bridge.checkArgs).
//   - the token travels in the request BODY, never in an address, and is never logged, returned or put in an error message.
//   - Bot says what it is: the User-Agent is "node" (the program that runs Bot). It never pretends to be a browser or the phone app.
//   - no keep-alive: nothing is asked unless a tool or the Moodle watch needs it. One request at a time, a short pause between them.
// Everything Moodle sends back is untrusted DATA, never instructions.

const fs = require("node:fs");
const { httpsSend, HOST, ROOT } = require("./moodle");
const { checkArgs, MAX_FILE_BYTES } = require("./moodle-bridge");

const REST_URL = `https://${HOST}${ROOT}/webservice/rest/server.php`;
const FILE_PREFIX = `${ROOT}/webservice/pluginfile.php/`;
const USER_AGENT = "node";
const PAUSE_MS = 300;
const TIMEOUT_MS = 45 * 1000;
const FILE_TIMEOUT_MS = 4 * 60 * 1000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const CM_CACHE_MS = 10 * 60 * 1000;

// The only functions Bot may call. All of them read. Never add one that writes, submits, marks or changes a setting.
const READ_FUNCTIONS = new Set([
  "core_webservice_get_site_info",
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_course_get_contents",
  "core_course_get_course_module",
  "mod_forum_get_forum_discussions",
  "mod_forum_get_discussion_posts",
  "core_calendar_get_action_events_by_timesort",
]);

const fail = (code, message) => Object.assign(new Error(message), { code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The token from .env (Bot does not load .env into process.env). Read again when the file changed, so a new token works without a restart.
function tokenReader(envFile) {
  let seen = { mtime: -1, token: "" };
  return () => {
    try {
      const mtime = fs.statSync(envFile).mtimeMs;
      if (mtime !== seen.mtime) seen = { mtime, token: String(require("./auth").parseEnv(fs.readFileSync(envFile, "utf8")).MOODLE_TOKEN || "").trim() };
    } catch (error) { seen = { mtime: -1, token: "" }; }
    return /^[A-Za-z0-9]{20,128}$/.test(seen.token) ? seen.token : "";
  };
}

// { a: 1, b: [2, 3] } -> "a=1&b[0]=2&b[1]=3" (the way Moodle's REST server reads lists). Values are numbers, booleans or short strings.
function formBody(pairs) {
  const out = [];
  const add = (k, v) => {
    if (Array.isArray(v)) v.forEach((x, i) => add(`${k}[${i}]`, x));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv);
    else out.push(`${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "boolean" ? (v ? 1 : 0) : String(v))}`);
  };
  for (const [k, v] of Object.entries(pairs)) add(k, v);
  return out.join("&");
}

// A file address Moodle listed: the checked URL (query removed), or throws "refused".
function checkFileUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (error) { throw fail("refused", "not a file address"); }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== HOST || (u.port && u.port !== "443") || u.username || u.password) throw fail("refused", "only Moodle's own file addresses are downloaded");
  if (!u.pathname.startsWith(FILE_PREFIX) || /(^|\/)\.\.?(\/|$)/.test(u.pathname) || /%2e%2e|%2f|%5c/i.test(u.pathname)) throw fail("refused", "only Moodle's own file addresses are downloaded");
  return `https://${HOST}${u.pathname}`;
}

function createMoodleWs({ getToken, send = httpsSend, pauseMs = PAUSE_MS, now = () => Date.now() } = {}) {
  let chain = Promise.resolve(); // one request at a time
  const scrub = (text) => { const t = getToken(); return t ? String(text).split(t).join("[token]") : String(text); };
  const queued = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => sleep(pauseMs), () => sleep(pauseMs)); return run; };

  async function post(url, body, { maxBytes, timeoutMs }) {
    let r;
    try {
      r = await send({ method: "POST", url, body, maxBytes, timeoutMs, headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } });
    } catch (error) { throw fail(error.code === "toobig" ? "toobig" : error.code === "timeout" ? "timeout" : "network", scrub(error.message)); }
    if (r.status === 403) throw fail("blocked", "Moodle's edge refused Bot (403) before Moodle was reached");
    if (r.status >= 300 && r.status < 400) throw fail("moodle", "Moodle sent Bot to another page instead of answering");
    if (r.status !== 200) throw fail("moodle", `Moodle answered ${r.status}`);
    return r;
  }

  // One read call. Returns the parsed answer.
  function call(wsfunction, args = {}) {
    if (!READ_FUNCTIONS.has(wsfunction)) return Promise.reject(fail("refused", `${String(wsfunction).slice(0, 80)} is not on the read-only list`));
    const token = getToken();
    if (!token) return Promise.reject(fail("token", "no Moodle token in .env"));
    return queued(async () => {
      const r = await post(REST_URL, formBody({ wstoken: token, wsfunction, moodlewsrestformat: "json", ...args }), { maxBytes: MAX_JSON_BYTES, timeoutMs: TIMEOUT_MS });
      let j;
      try { j = JSON.parse(r.bytes.toString("utf8")); } catch (error) { throw fail("moodle", "Moodle's answer was not JSON"); }
      if (j && typeof j === "object" && !Array.isArray(j) && (j.exception || j.errorcode)) {
        const code = String(j.errorcode || "");
        if (/invalidtoken|invalidlogin|usernotfullysetup|forcepasswordchange|sitepolicynotagreed/i.test(code)) throw fail("token", `Moodle refused the token (${code})`);
        throw fail("moodle", scrub(String(j.message || code || "Moodle refused")).slice(0, 200));
      }
      return j;
    });
  }

  // cmid -> { course, instance, module } and course -> its sections, remembered for a few minutes (a file job only carries the item number).
  const cms = new Map();
  const courses = new Map();
  async function contents(courseid) {
    const hit = courses.get(courseid);
    if (hit && now() - hit.at < CM_CACHE_MS) return hit.sections;
    const raw = await call("core_course_get_contents", { courseid });
    const sections = Array.isArray(raw) ? raw : [];
    courses.set(courseid, { at: now(), sections });
    for (const s of sections) for (const m of s.modules || []) if (Number.isInteger(m.id)) cms.set(m.id, { course: courseid, instance: m.instance, module: m.modname });
    return sections;
  }
  async function moduleOf(cmid) {
    let known = cms.get(cmid);
    if (!known) {
      const r = await call("core_course_get_course_module", { cmid });
      const cm = r && r.cm;
      if (!cm || !Number.isInteger(cm.course)) throw fail("moodle", "Moodle does not show that item");
      known = { course: cm.course, instance: cm.instance, module: cm.modname };
      cms.set(cmid, known);
    }
    const sections = await contents(known.course);
    for (const s of sections) for (const m of s.modules || []) if (m.id === cmid) return m;
    throw fail("moodle", "Moodle does not show that item");
  }
  const filesOf = (m) => (Array.isArray(m.contents) ? m.contents : []).filter((c) => c && c.type === "file" && typeof c.fileurl === "string");

  function download(entry) {
    const url = checkFileUrl(entry.fileurl);
    if (Number(entry.filesize) > MAX_FILE_BYTES) return Promise.reject(fail("toobig", "the file is bigger than 50 MB"));
    const token = getToken();
    if (!token) return Promise.reject(fail("token", "no Moodle token in .env"));
    return queued(async () => {
      const r = await post(url, formBody({ token }), { maxBytes: MAX_FILE_BYTES, timeoutMs: FILE_TIMEOUT_MS });
      const type = String(r.headers["content-type"] || "");
      // Moodle answers a refused file with a small JSON error, not with the file.
      if (/json/i.test(type) && r.bytes.length < 4096 && /"(?:errorcode|exception|error)"/.test(r.bytes.toString("utf8"))) throw fail(/invalidtoken/i.test(r.bytes.toString("utf8")) ? "token" : "moodle", "Moodle did not give the file");
      return { bytes: r.bytes, name: String(entry.filename || "file").slice(0, 200), type: type.slice(0, 100) };
    });
  }

  const JOBS = {
    async courses() {
      const d = await call("core_course_get_enrolled_courses_by_timeline_classification", { classification: "inprogress", limit: 0, offset: 0, sort: "fullname" });
      return { data: ((d && d.courses) || []).map((c) => ({ id: c.id, name: c.fullname, short: c.shortname, category: c.coursecategory, start: c.startdate })) };
    },
    async course({ courseid }) {
      courses.delete(courseid); // a direct question about a course always reads it fresh
      const sections = await contents(courseid);
      const items = [];
      for (const s of sections) for (const m of s.modules || []) if (Number.isInteger(m.id) && m.uservisible !== false) items.push({ id: m.id, name: m.name, module: m.modname, section: s.id, files: filesOf(m).length });
      return { data: { name: null, sections: sections.map((s) => ({ id: s.id, number: s.section, title: s.name, cms: (s.modules || []).filter((m) => m.uservisible !== false).map((m) => m.id) })), items } };
    },
    async forum({ cmid }) {
      const m = await moduleOf(cmid);
      if (m.modname !== "forum" || !Number.isInteger(m.instance)) throw fail("moodle", "that item is not a forum");
      const d = await call("mod_forum_get_forum_discussions", { forumid: m.instance, sortorder: -1, page: 0, perpage: 50 });
      return { data: ((d && d.discussions) || []).filter((x) => Number.isInteger(x.discussion)).slice(0, 50).map((x) => ({ d: x.discussion, title: String(x.name || x.subject || "").slice(0, 300), time: x.created || x.timemodified || null })) };
    },
    async posts({ discussionid }) {
      const d = await call("mod_forum_get_discussion_posts", { discussionid, sortby: "created", sortdirection: "ASC" });
      return { data: ((d && d.posts) || []).slice(0, 20).map((p) => ({ subject: p.subject, author: (p.author && p.author.fullname) || "", created: p.timecreated, message: String(p.message || "").slice(0, 60000), attachments: (p.attachments || []).map((x) => x.filename) })) };
    },
    async events() {
      const d = await call("core_calendar_get_action_events_by_timesort", { timesortfrom: Math.floor(now() / 1000) - 86400, limitnum: 30 });
      return { data: ((d && d.events) || []).map((e) => ({ name: e.name, courseId: e.course && e.course.id, course: e.course && e.course.fullname, due: e.timesort, module: e.modulename })) };
    },
    async file({ cmid }) {
      const m = await moduleOf(cmid);
      const f = filesOf(m)[0];
      if (m.modname !== "resource" || !f) throw fail("notfile", "this item has no file to download");
      return { file: await download(f) };
    },
    async folder({ cmid }) {
      const m = await moduleOf(cmid);
      if (m.modname !== "folder") throw fail("notfile", "that item is not a folder");
      return { data: filesOf(m).slice(0, 300).map((f, index) => ({ index, name: String(f.filename || "file") })) };
    },
    async folderfile({ cmid, index }) {
      const m = await moduleOf(cmid);
      const f = m.modname === "folder" ? filesOf(m)[index] : null;
      if (!f) throw fail("notfile", "that file is not in the folder");
      return { file: await download(f) };
    },
  };

  // The same call as bridge.ask: resolves { data, file } or rejects with a code (token | blocked | timeout | network | moodle | toobig | notfile | refused).
  async function ask(kind, args = {}) {
    const clean = checkArgs(kind, args);
    const r = await JOBS[kind](clean);
    return { data: r.data === undefined ? null : r.data, file: r.file || null };
  }

  return { ask, call, enabled: () => !!getToken(), connected: () => !!getToken(), state: () => ({ token: !!getToken() }) };
}

// What moodle-tools.js and the Moodle watch talk to: the token first; if there is no token, or Moodle refuses it or its edge refuses
// Bot, the Chrome extension when it is connected. Nothing else is ever tried.
function createMoodleSource({ ws, bridge, log = () => {} }) {
  const FALL = new Set(["token", "blocked", "network", "timeout"]);
  let said = "";
  async function ask(kind, args = {}) {
    if (ws && ws.enabled()) {
      try { const r = await ws.ask(kind, args); said = ""; return r; } catch (error) {
        if (!FALL.has(error.code)) throw error;
        if (said !== error.code) { said = error.code; log(`[moodle] the token route failed (${error.code}: ${error.message})${bridge && bridge.connected() ? "; using Chrome instead" : ""}`); }
        if (!bridge || !bridge.connected()) throw error;
      }
    }
    if (!bridge) throw fail("token", "no Moodle token in .env");
    try { return await bridge.ask(kind, args); } catch (error) {
      // Neither route: with no token and no Chrome, the token is the thing to set up once.
      if (error.code === "offline" && ws && !ws.enabled()) throw fail("offline", error.message);
      throw error;
    }
  }
  return { ask, connected: () => !!(ws && ws.enabled()) || !!(bridge && bridge.connected()), via: () => (ws && ws.enabled() ? "token" : bridge && bridge.connected() ? "chrome" : "none") };
}

module.exports = { createMoodleWs, createMoodleSource, tokenReader, formBody, checkFileUrl, READ_FUNCTIONS, REST_URL, USER_AGENT };
