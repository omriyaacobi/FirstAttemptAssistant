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
// A Moodle FILE address, judged on the address the browser will really request: the URL is parsed first, so "..", "%2e%2e" or a
// backslash are already resolved. Before, a link that only STARTED like a file address ("...pluginfile.php/1/../../mod/...") passed
// and would have been fetched as another Moodle page, outside the list of pages Bot may open (code review, 2026-11-17).
const FILE_ORIGIN = new URL(MOODLE).origin, FILE_PATH = `${new URL(MOODLE).pathname}/pluginfile.php/`;
function isFileUrl(u) {
  if (typeof u !== "string" || /[\u0000-\u001f\\]/.test(u)) return false;
  let url;
  try { url = new URL(u); } catch (error) { return false; }
  let query = url.search;
  try { query = decodeURIComponent(query); } catch (error) { /* judged as written */ }
  return url.origin === FILE_ORIGIN && !url.username && !url.password && url.pathname.startsWith(FILE_PATH) && !/sesskey\s*=/i.test(query);
}
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

// ---- PC LOOK (2026-11-24, Bot's pc-look.js): READ the open tabs. Bot sends only a tab NUMBER (its id from the "tabs" list). ----------
// Nothing here switches, focuses, reloads, closes or types into a tab. Only http(s) pages are read; Bot checks its allowed sites and the
// never-allowed list (banking, password managers) again on the address that comes back.
const webPage = (url) => /^https?:\/\//i.test(String(url || ""));
async function tabOf(tabId) {
  let t;
  try { t = await chrome.tabs.get(tabId); } catch (error) { throw fail("unavailable", "that tab is closed now"); }
  if (t.incognito) throw fail("refused", "a private window is never read");
  if (!webPage(t.url)) throw fail("refused", "only web pages (http or https) are read");
  return t;
}
Object.assign(JOBS, {
  async tabs() {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const out = [];
    for (const w of wins) for (const t of w.tabs || []) if (!w.incognito) out.push({ id: t.id, title: String(t.title || "").slice(0, 300), url: String(t.url || t.pendingUrl || "").slice(0, 2000), active: !!t.active, windowState: w.state });
    return { data: out.slice(0, 300) };
  },
  async tab_text({ tabId }) {
    const t = await tabOf(tabId);
    if (t.discarded) throw fail("unavailable", "that tab is asleep (Chrome unloaded it), so its text cannot be read");
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (document.body ? document.body.innerText : "").slice(0, 200000) });
    return { data: { url: t.url, title: t.title, text: String((r && r.result) || "").slice(0, 200000) } };
  },
  async tab_shot({ tabId }) {
    const t = await tabOf(tabId);
    const w = await chrome.windows.get(t.windowId);
    if (!t.active || w.state === "minimized") throw fail("unavailable", "that tab is not the one in front of a visible window");
    const shot = await chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 80 });
    return { data: { url: t.url }, file: { name: "tab.jpg", type: "image/jpeg", base64: String(shot).replace(/^data:image\/jpeg;base64,/, "") } };
  },
  // NOTABILITY PAGES (2026-11-25, t40; experiments/2026-11-25-notability-pages.md). The ONE kind of control Omri allowed: SCROLLING
  // a Notability note (notability.com/app/note/...) in the tab in front, to take one picture per page, then scrolling back.
  // Bot sends only numbers: the tab id and a page range (from = 0 means "the last page with writing"). No click, no typing.
  async tab_pages({ tabId, from, to }) { return notePages(tabId, from, to); },
});

// ---- NOTABILITY PAGES ---------------------------------------------------------------------------------------------------------------
// What the page showed (measured 2026-11-25): the ink is drawn on ONE canvas the size of the view; the page box
// ([data-testid=page-navigator] input) has max = the number of pages; a thin custom scrollbar div shows the true position (scrollTop,
// scrollHeight = pages x page height) but setting it does not move the note, while a wheel event on the canvas does, exactly.
const NOTE_PAGES_MAX = 4; // pages per request (one model call takes at most 4 pictures: photo.js MAX_PHOTOS)
const NOTE_LAST_BACK = 4; // "last": the last page and at most 3 before it are checked for writing
const NOTE_SHOTS_MAX = 14; // screen captures per job
const PACE = { gap: 550, settle: 350, poll: 100, wait: 2500 }; // Chrome allows 2 captures a second; the canvas needs a moment to draw
const isNote = (url) => {
  try { const u = new URL(url); return u.protocol === "https:" && u.hostname.replace(/^www\./, "") === "notability.com" && u.pathname.startsWith("/app/note/"); } catch (error) { return false; }
};
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// Runs INSIDE the note's page (chrome.scripting, this fixed function; only a number goes in). Reads where the note is; when `target`
// is a number, first scrolls the note there with ONE wheel event at the canvas center. Returns null when this is not a note page.
function noteProbe(target) {
  const nav = document.querySelector('[data-testid="page-navigator"] input');
  const bar = Array.from(document.querySelectorAll("div")).find((e) => /overflowY_scroll/.test(String(e.className)) && e.scrollHeight > e.clientHeight + 50);
  const cv = Array.from(document.querySelectorAll("canvas")).find((c) => c.getBoundingClientRect().width > 300);
  if (!nav || !bar || !cv) return null;
  const box = cv.getBoundingClientRect();
  if (typeof target === "number" && target >= 0) {
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    (document.elementFromPoint(x, y) || cv).dispatchEvent(new WheelEvent("wheel", { deltaY: target - bar.scrollTop, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return { top: bar.scrollTop };
  }
  const gl = document.querySelector('[data-testid="page-bounds-gutter-left"]');
  const gr = document.querySelector('[data-testid="page-bounds-gutter-right"]');
  const below = Array.from(document.querySelectorAll("button")).map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0 && r.top > box.bottom - 140 && r.top < box.bottom && r.left >= box.left);
  return {
    top: bar.scrollTop, height: bar.scrollHeight, view: bar.clientHeight, pages: Number(nav.max), page: Number(nav.value), vw: window.innerWidth,
    hidden: document.visibilityState === "hidden",
    canvas: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
    pageLeft: gl ? gl.getBoundingClientRect().right : box.left, pageRight: gr ? gr.getBoundingClientRect().left : box.right,
    toolbarTop: below.length ? Math.min(...below.map((r) => r.top)) : box.bottom,
  };
}

// Pure (tested): the scroll positions that show content rows [pageTop, pageBottom), each screen showing `usable` rows, never past maxScroll.
// Each slice: scroll there, then copy content rows [from, to) of that screen.
function slices(pageTop, pageBottom, usable, maxScroll) {
  const out = [];
  let y = pageTop;
  while (y < pageBottom && out.length < 8) {
    const scroll = Math.max(0, Math.min(y, maxScroll));
    const to = Math.min(pageBottom, scroll + usable);
    if (to <= y) break; // the note cannot scroll further: the rest is out of reach
    out.push({ scroll, from: y, to });
    y = to;
  }
  return out;
}

// Pure (tested): the share of "ink" pixels in RGBA bytes (every 4th pixel). Ink = dark, or clearly colored and not light; the paper and
// the light grid lines are not ink. A dark paper counts as all ink, so then nothing is skipped as empty (the safe side).
function inkShare(rgba) {
  let ink = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 16) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum < 140 || (chroma > 90 && lum < 200)) ink++;
    n++;
  }
  return n ? ink / n : 0;
}
const INK_MIN = 0.0005; // a page with less than 0.05% ink pixels is empty

// A FULLY COVERED note window (measured 2026-11-25, t40): Chrome on Windows stops painting it, and captureVisibleTab returns the last
// frame it painted, the same picture at every scroll position (the scroll itself still happens). Never hand that over as a page.
const COVERED = "the note's window is fully covered, so Chrome isn't drawing it; leave a strip of it visible, or put it beside Bot";
// The ink share of one screen, from a small copy (a stale frame is caught only when it has ink: two EMPTY screens of the grid at
// different places can really look the same).
async function screenInk(bmp) {
  const w = Math.max(1, Math.round(bmp.width / 4)), h = Math.max(1, Math.round(bmp.height / 4));
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext("2d");
  x.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, w, h);
  return inkShare(x.getImageData(0, 0, w, h).data);
}

async function probe(tabId, target) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: noteProbe, args: [typeof target === "number" ? Math.round(target) : null] });
  return r && r.result;
}

// The tab must still be this note, in front of a visible window, at every step (Omri may move on in the middle: then Bot stops).
async function stillNote(tabId, url) {
  const t = await tabOf(tabId);
  const w = await chrome.windows.get(t.windowId);
  if (!t.active || w.state === "minimized") throw fail("unavailable", "the note's tab is no longer the one in front of a visible window");
  if (t.url !== url) throw fail("unavailable", "the tab left the note in the middle, so Bot stopped");
  return t;
}

async function notePages(tabId, from, to) {
  const t = await tabOf(tabId);
  if (!isNote(t.url)) throw fail("refused", "only a Notability note (notability.com/app/note/...) is scrolled");
  const w = await chrome.windows.get(t.windowId);
  if (!t.active || w.state === "minimized") throw fail("unavailable", "that tab is not the one in front of a visible window");
  const s = await probe(tabId, null);
  if (!s || !(s.pages >= 1) || !(s.height > 0)) throw fail("unavailable", "the note has not finished loading (no pages found)");
  if (s.hidden) throw fail("unavailable", COVERED); // Chrome says the page is not visible: nothing is scrolled
  const pages = Math.min(Math.floor(s.pages), 1000);
  const last = from === 0;
  if (!last && from > pages) throw fail("unavailable", `the note has only ${pages} page${pages === 1 ? "" : "s"}`);
  const want = last ? [] : Array.from({ length: Math.min(to, pages) - from + 1 }, (_, i) => from + i).slice(0, NOTE_PAGES_MAX);
  const pitch = s.height / pages;
  const maxScroll = Math.max(0, s.height - s.view);
  const usable = Math.max(100, Math.min(s.toolbarTop - 6, s.canvas.bottom) - s.canvas.top);
  const width = Math.max(50, s.pageRight - s.pageLeft);
  const back = s.top;
  let shots = 0, lastShot = 0;
  // Every capture of this job, by its exact bytes -> the scroll position it was taken at. The same bytes at ANOTHER position, with ink
  // on them, mean Chrome is not drawing the note (a stale frame): stop, never label it as a page.
  const frames = new Map();
  const capture = async (at) => {
    await sleep(lastShot + PACE.gap - Date.now());
    const shot = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
    lastShot = Date.now();
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const before = frames.get(shot);
    if (before !== undefined && Math.abs(before - at) > 2 && (await screenInk(bmp)) >= INK_MIN) throw fail("unavailable", COVERED);
    if (before === undefined) frames.set(shot, at);
    return bmp;
  };
  const scrollTo = async (target) => {
    await probe(tabId, target);
    let seen = null;
    for (let waited = 0; waited < PACE.wait; waited += PACE.poll) {
      await sleep(PACE.poll);
      const now = (await probe(tabId, null) || {}).top;
      if (now === seen && Math.abs(now - target) <= 2) break;
      seen = now;
    }
    await sleep(PACE.settle);
    return (await probe(tabId, null) || {}).top;
  };
  // ONE picture of page n: its screens joined, cut to the page's edges.
  const page = async (n) => {
    const top = (n - 1) * pitch, bottom = n * pitch;
    let canvas = null, ctx = null, scale = 1;
    for (const sl of slices(top, bottom, usable, maxScroll)) {
      if (++shots > NOTE_SHOTS_MAX) throw fail("unavailable", "too many screens for one request");
      const at = await scrollTo(sl.scroll);
      if (typeof at !== "number" || Math.abs(at - sl.scroll) > 2) throw fail("unavailable", "the note did not scroll as expected");
      await stillNote(tabId, t.url);
      const bmp = await capture(sl.scroll);
      if (!canvas) {
        scale = bmp.width / s.vw;
        canvas = new OffscreenCanvas(Math.round(width * scale), Math.round((bottom - top) * scale));
        ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      // From where the note REALLY is (`at`: a whole pixel, up to 2 px from the plan), so the strips join without a seam or a repeat.
      const sy = (s.canvas.top + (sl.from - at)) * scale, h = (sl.to - sl.from) * scale;
      ctx.drawImage(bmp, s.pageLeft * scale, sy, width * scale, h, 0, (sl.from - top) * scale, width * scale, h);
    }
    if (!canvas) throw fail("unavailable", "that page could not be shown");
    const ink = inkShare(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { n, ink, file: { name: `page${n}.jpg`, type: "image/jpeg", base64: btoa(bin) } };
  };
  const got = [];
  try {
    // A first picture where the note is now (nothing scrolled yet): the frame every later screen is compared with, so even a page
    // that fits on one screen cannot pass a stale frame.
    if (++shots > NOTE_SHOTS_MAX) throw fail("unavailable", "too many screens for one request");
    await capture(back);
    if (last) {
      for (let n = pages; n >= 1 && n > pages - NOTE_LAST_BACK; n--) {
        const p = await page(n);
        if (p.ink >= INK_MIN) { got.push(p); break; }
      }
      if (!got.length) throw fail("unavailable", `the last ${Math.min(NOTE_LAST_BACK, pages)} pages of the note look empty`);
    } else {
      for (const n of want) got.push(await page(n));
    }
  } finally {
    try { await scrollTo(back); } catch (error) { /* the tab went away: nothing to put back */ }
  }
  return { data: { url: t.url, pages, shown: got.map((p) => p.n) }, files: got.map((p) => p.file) };
}

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
if (typeof module !== "undefined") module.exports = { run, JOBS, READ_METHODS, folderFiles, isFileUrl, pollOnce, slices, inkShare, isNote, noteProbe, PACE, NOTE_PAGES_MAX, _reset: () => { sesskey = null; loggedIn = null; } };
