// Bot Moodle reader (a Chrome extension, loaded once by Omri from chrome://extensions, "Load unpacked", this folder).
//
// Why it exists: BGU's Moodle refuses scripts at its edge, and Bot will not pretend to be a browser. So THIS browser, where Omri
// logs in to Moodle himself, does the reading. Every couple of seconds it asks Bot on this PC "any Moodle reads waiting?"
// (GET /api/moodle/next), runs the job with Omri's session, and sends the answer back (POST /api/moodle/result).
//
// READ-ONLY, enforced here:
//   - Bot sends only a job KIND and NUMBERS (never an address). Each kind maps to one fixed request below.
//   - The only POST to Moodle is /lib/ajax/service.php with a method from READ_METHODS. Nothing here submits, posts, subscribes,
//     marks or changes a setting. Every other request is a GET of a fixed page (my/, mod/forum|resource|folder/view.php) or a
//     pluginfile.php file address found on those pages.
//   - No password is ever seen: Omri logs in himself. If the session ended, the answer is "loggedout" and Bot tells Omri.
//   - Files over 50 MB are refused.

const MOODLE = "https://moodle.bgu.ac.il/moodle";
const BOTS = ["http://localhost:3000", "http://localhost:3100"]; // 3100 = a test copy of Bot
const READ_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_courseformat_get_state",
  "core_calendar_get_action_events_by_timesort",
  "mod_forum_get_discussion_posts",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const POLL_MS = 2000;
const HDR = { "X-Bot-Bridge": "1" };

const fail = (code, message) => Object.assign(new Error(message), { code });
let sesskey = null;
let loggedIn = null;

// ---- Moodle, read-only ----------------------------------------------------------------------------------------------------------
const isLogin = (url) => /\/login\/index\.php/.test(new URL(url).pathname);

async function session(force) {
  if (sesskey && !force) return sesskey;
  const r = await fetch(`${MOODLE}/my/`, { credentials: "include" });
  const html = await r.text();
  const m = /"sesskey"\s*:\s*"([A-Za-z0-9]{5,40})"/.exec(html);
  loggedIn = !!m && !isLogin(r.url) && /login\/logout\.php/.test(html);
  sesskey = loggedIn ? m[1] : null;
  if (!sesskey) throw fail("loggedout", "not logged in to Moodle in Chrome");
  return sesskey;
}

async function ajax(methodname, args) {
  if (!READ_METHODS.has(methodname)) throw fail("refused", `${methodname} is not on the read-only list`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = await session(attempt > 0);
    const r = await fetch(`${MOODLE}/lib/ajax/service.php?sesskey=${encodeURIComponent(key)}&info=${methodname}`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });
    let j = null;
    try { j = await r.json(); } catch (error) { /* checked below */ }
    const d = Array.isArray(j) ? j[0] : j;
    if (d && !d.error && Array.isArray(j)) return d.data;
    const code = String((d && (d.errorcode || (d.exception && d.exception.errorcode))) || "");
    if (/servicerequireslogin|invalidsesskey|requirelogin/.test(code)) { sesskey = null; if (attempt === 0) continue; throw fail("loggedout", "not logged in to Moodle in Chrome"); }
    throw fail("moodle", String((d && ((d.exception && d.exception.message) || d.message)) || code || "Moodle refused").slice(0, 200));
  }
}

// A GET of one of the fixed pages. Returns { html, url }.
async function page(path, id) {
  if (!/^\/mod\/(forum|resource|folder)\/view\.php$/.test(path)) throw fail("refused", "not a page Bot may open");
  const r = await fetch(`${MOODLE}${path}?id=${Number(id)}`, { credentials: "include" });
  if (isLogin(r.url)) { loggedIn = false; sesskey = null; throw fail("loggedout", "not logged in to Moodle in Chrome"); }
  if (!r.ok) throw fail("moodle", `Moodle answered ${r.status}`);
  return { r, url: r.url };
}

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const plain = (s) => decode(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const isFileUrl = (u) => typeof u === "string" && u.startsWith(`${MOODLE}/pluginfile.php/`) && !/[?&]sesskey=/.test(u);
const fileName = (u) => { const last = new URL(u).pathname.split("/").pop() || "file"; try { return decodeURIComponent(last); } catch (error) { return last; } };

// Bytes of a pluginfile.php address, as base64. Over 50 MB is refused before reading when the size is known, and while reading anyway.
async function download(url, response) {
  if (!isFileUrl(url)) throw fail("refused", "only Moodle file addresses are downloaded");
  const r = response || await fetch(url, { credentials: "include" });
  if (isLogin(r.url)) throw fail("loggedout", "not logged in to Moodle in Chrome");
  if (!r.ok) throw fail("moodle", `Moodle answered ${r.status}`);
  const declared = Number(r.headers.get("content-length"));
  if (declared > MAX_FILE_BYTES) throw fail("toobig", "the file is bigger than 50 MB");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw fail("toobig", "the file is bigger than 50 MB");
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { name: fileName(r.url || url), type: r.headers.get("content-type") || "", base64: btoa(bin) };
}

// The file links of a folder page (only that folder's own files).
function folderFiles(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/href="([^"]*\/pluginfile\.php\/\d+\/mod_folder\/content\/[^"]+)"/g)) {
    const u = decode(m[1]).replace(/[?&]forcedownload=1$/, "");
    if (!isFileUrl(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

const JOBS = {
  async courses() {
    const d = await ajax("core_course_get_enrolled_courses_by_timeline_classification", { offset: 0, limit: 0, classification: "inprogress", sort: "fullname" });
    return { data: (d.courses || []).map((c) => ({ id: c.id, name: c.fullname, short: c.shortname, category: c.coursecategory, start: c.startdate })) };
  },
  async course({ courseid }) {
    const raw = await ajax("core_courseformat_get_state", { courseid });
    const st = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { data: {
      name: st.course && st.course.fullname || null,
      sections: (st.section || []).map((s) => ({ id: s.id, number: s.number, title: s.title, cms: s.cmlist || [] })),
      items: (st.cm || []).filter((c) => c.uservisible !== false).map((c) => ({ id: Number(c.id), name: c.name, module: c.module, section: c.sectionid })),
    } };
  },
  async forum({ cmid }) {
    const { r } = await page("/mod/forum/view.php", cmid);
    const html = await r.text();
    const rows = html.split(/data-region="discussion-list-item"/).slice(1);
    const list = [];
    for (const row of rows) {
      const a = /href="[^"]*\/mod\/forum\/discuss\.php\?d=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(row);
      if (!a) continue;
      const t = /data-timestamp="(\d+)"/.exec(row);
      list.push({ d: Number(a[1]), title: plain(a[2]).slice(0, 300), time: t ? Number(t[1]) : null });
    }
    return { data: list.slice(0, 50) };
  },
  async posts({ discussionid }) {
    const d = await ajax("mod_forum_get_discussion_posts", { discussionid, sortby: "created", sortdirection: "ASC", includeinlineattachments: false });
    return { data: (d.posts || []).slice(0, 20).map((p) => ({ subject: p.subject, author: p.author && p.author.fullname || "", created: p.timecreated, message: String(p.message || "").slice(0, 60000), attachments: (p.attachments || []).map((x) => x.filename) })) };
  },
  async events() {
    const d = await ajax("core_calendar_get_action_events_by_timesort", { timesortfrom: Math.floor(Date.now() / 1000) - 86400, limitnum: 30 });
    return { data: (d.events || []).map((e) => ({ name: e.name, courseId: e.course && e.course.id, course: e.course && e.course.fullname, due: e.timesort, module: e.modulename })) };
  },
  async file({ cmid }) {
    const { r, url } = await page("/mod/resource/view.php", cmid);
    if (isFileUrl(url)) return { file: await download(url, r) }; // Moodle sent the file itself
    const html = await r.text(); // a page that shows or links the file
    const m = /(https:\/\/moodle\.bgu\.ac\.il\/moodle\/pluginfile\.php\/\d+\/mod_resource\/content\/[^"'<>\s]+)/.exec(html);
    if (!m) throw fail("notfile", "this item has no file to download");
    return { file: await download(decode(m[1]).replace(/[?&]forcedownload=1$/, "")) };
  },
  async folder({ cmid }) {
    const { r } = await page("/mod/folder/view.php", cmid);
    return { data: folderFiles(await r.text()).slice(0, 300).map((u, index) => ({ index, name: fileName(u) })) };
  },
  async folderfile({ cmid, index }) {
    const { r } = await page("/mod/folder/view.php", cmid);
    const u = folderFiles(await r.text())[index];
    if (!u) throw fail("notfile", "that file is not in the folder");
    return { file: await download(u) };
  },
};

async function run(job) {
  const fn = Object.prototype.hasOwnProperty.call(JOBS, job.kind) ? JOBS[job.kind] : null;
  if (!fn) throw fail("refused", "unknown job");
  return fn(job.args || {});
}

// ---- talking to Bot ---------------------------------------------------------------------------------------------------------------
async function pollOnce(bot) {
  let job;
  try {
    const r = await fetch(`${bot}/api/moodle/next?loggedIn=${loggedIn === null ? "" : loggedIn ? 1 : 0}`, { headers: HDR });
    if (!r.ok) return false;
    job = (await r.json()).job;
  } catch (error) { return false; } // that Bot is not running
  if (!job) return false;
  let body;
  try { body = { id: job.id, ok: true, ...(await run(job)) }; } catch (error) { body = { id: job.id, ok: false, code: error.code || "moodle", error: String(error.message || error).slice(0, 300) }; }
  try { await fetch(`${bot}/api/moodle/result`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch (error) { /* Bot went away */ }
  return true;
}

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      let busy = false;
      for (const bot of BOTS) busy = (await pollOnce(bot)) || busy;
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getPlatformInfo) await chrome.runtime.getPlatformInfo(); // keeps this worker awake while Chrome is open
      if (!busy) await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally { running = false; }
}

if (typeof chrome !== "undefined" && chrome.alarms) {
  chrome.alarms.create("bot-moodle", { periodInMinutes: 0.5 }); // if Chrome put the worker to sleep, this wakes it again
  chrome.alarms.onAlarm.addListener(() => loop());
  chrome.runtime.onStartup.addListener(() => loop());
  chrome.runtime.onInstalled.addListener(() => loop());
  loop();
}
if (typeof module !== "undefined") module.exports = { run, JOBS, READ_METHODS, folderFiles, isFileUrl, pollOnce, _reset: () => { sesskey = null; loggedIn = null; } };
