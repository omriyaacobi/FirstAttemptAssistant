// moodle-watch.js
// THE MOODLE WATCH (Omri, 2026-11-14): every 3 hours while Bot runs, look at Moodle READ-ONLY and tell Omri what is new in the
// courses: new files and other new items, and new messages in each course's announcements forum (the lecturers' board).
//
// How: CODE only, no model, so it costs no quota. For every Moodle course in progress it reads the item list and the announcements
// list (the same checked read jobs the brain's Moodle tools use: moodle-ws.js with the token, or the Chrome extension) and compares
// them with a saved snapshot (data/moodle-watch.json: item numbers and discussion numbers only).
//
// Rules in code (tests/moodle-watch.test.js):
//   - also told: a deadline in Moodle's "coming up" list that is new or whose time changed (one more read per look).
//   - READ-ONLY, and nothing is downloaded here. New files are LISTED with their numbers; Omri says "download them" and the brain's
//     moodle_fetch does it on the normal checked road (more than 10 files is still a Confirm card).
//   - the first look at a course only saves the snapshot and says nothing (otherwise everything would be "new").
//   - what is posted is ONE message in the thread, written by code. Its first line holds counts only; everything Moodle wrote
//     (names, titles, a lecturer's first lines) comes after it, cleaned ('<' and '>' removed, short), and the models see that part
//     inside <moodle-data> markers as DATA (thread-context.js, rule "moodle watch"). It is not read by the daily summary or recall.
//   - the push shows counts only, never text, and none is sent in quiet hours (the message is still posted).
//   - no keep-alive: one look every EVERY_MS at most; after a failed look the next try is RETRY_MS later. When Moodle cannot be
//     reached because the token stopped working, Omri is told ONCE (not at every look).

const fs = require("node:fs");
const path = require("node:path");
const plan = require("./study-plan");

const EVERY_MS = 3 * 3600 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const START_DELAY_MS = 2 * 60 * 1000;
const PUSH_QUIET = { from: "22:00", to: "08:00" };
const MAX_LINES_PER_COURSE = 12;
const MAX_POSTS_READ = 3; // lecturers' messages whose first lines are shown, per look
const POST_CHARS = 400;
const RULE = "moodle watch";
const DOWNLOADABLE = new Set(["resource", "folder"]);
const STRUCTURE = new Set(["subsection"]); // how the page is laid out, not something to tell Omri about
const KIND = { resource: "file", folder: "folder", assign: "assignment", forum: "forum", url: "link", page: "page", quiz: "quiz", label: "text", lti: "external tool", zoom: "zoom meeting", book: "book" };

// Moodle text for showing: one line, no control characters, no '<' '>' (so it can never close the data marker), short.
// (The direction marks that can flip how a line is shown are built from their numbers, so no invisible character sits in this file.)
const C = String.fromCharCode;
const MARKS = new RegExp(`[${C(0)}-${C(31)}${C(127)}${C(0x200e, 0x200f)}${C(0x202a)}-${C(0x202e)}${C(0x2066)}-${C(0x2069)}]+`, "g");
const BLOCKS = /<(script|style)\b[^]{0,20000}?<\/\1\s*>/gi; // a script or style block is dropped whole, with what is inside it
const safe = (t, n = 140) => String(t == null ? "" : t).replace(BLOCKS, " ").replace(/<[^>]{0,200}>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;|&gt;|[<>]/g, " ")
  .replace(MARKS, " ").replace(/\s+/g, " ").trim().slice(0, n);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// What changed between the saved snapshot of ONE course and what Moodle shows now. Pure.
// old: { items: {cmid: 1}, files: {cmid: n}, talks: {d: 1} | undefined } or undefined (first look). Returns { fresh, news, next, first }.
function diffCourse(old, { items = [], talks = null }) {
  const next = { items: {}, files: {}, talks: old && old.talks ? { ...old.talks } : undefined };
  const news = { items: [], grown: [], talks: [] };
  for (const i of items) {
    next.items[i.id] = 1;
    if (Number.isInteger(i.files)) next.files[i.id] = i.files;
    if (!old) continue;
    if (!old.items[i.id]) news.items.push(i);
    else if (i.module === "folder" && Number.isInteger(i.files) && Number.isInteger((old.files || {})[i.id]) && i.files > old.files[i.id]) news.grown.push({ ...i, more: i.files - old.files[i.id] });
  }
  if (talks) {
    const known = old && old.talks;
    next.talks = {};
    for (const t of talks) { next.talks[t.d] = 1; if (known && !known[t.d]) news.talks.push(t); }
    if (known) for (const d of Object.keys(known)) next.talks[d] = 1; // a talk that left the first page is still known
  }
  return { first: !old, news, next };
}

function createMoodleWatch({ source, tools, courseRoutes, patternFor = () => null, file, thread = null, push = null, now = () => Date.now(), timezone = plan.TIMEZONE, log = () => {}, everyMs = EVERY_MS }) {
  const read = () => { try { const s = JSON.parse(fs.readFileSync(file, "utf8")); return { lastCheck: Number(s.lastCheck) || 0, lastTry: Number(s.lastTry) || 0, broken: s.broken || "", courses: s.courses && typeof s.courses === "object" ? s.courses : {}, events: s.events && typeof s.events === "object" ? s.events : undefined }; } catch (error) { return { lastCheck: 0, lastTry: 0, broken: "", courses: {} }; } };
  const write = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(s)); fs.renameSync(file + ".tmp", file); };
  let running = false;
  let timer = null;
  const startedAt = now();

  const when = (unix) => { if (!unix) return ""; const p = plan.parts(unix * 1000, timezone); return `${plan.niceDate(p.date, "en")} ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`; };

  // One look. Returns { ok, posted, counts } or { ok: false, code }.
  async function check() {
    if (running) return { ok: false, code: "busy" };
    running = true;
    const state = read();
    try {
      if (!source.connected()) { write({ ...state, lastTry: now() }); return { ok: false, code: "offline" }; }
      const { data } = await source.ask("courses");
      const list = (Array.isArray(data) ? data : []).filter((c) => Number.isInteger(c.id));
      const bots = courseRoutes.list();
      const map = tools.autoMap(list.map((c) => ({ id: c.id, name: safe(c.name, 200) })), bots, patternFor);
      const blocks = [];
      const counts = { files: 0, items: 0, talks: 0, deadlines: 0 };
      let postsRead = 0;
      // Deadlines (Moodle's own "coming up" list, one read): a deadline that is new, or whose time or name changed, is told once.
      // The first time the list is read it is only saved.
      const dueNews = new Map(); // Moodle course id -> lines
      try {
        const events = ((await source.ask("events")).data || []).filter((e) => e && Number.isInteger(e.courseId) && Number(e.due) > 0);
        const known = state.events;
        const nextEvents = {};
        for (const e of events) {
          const key = `${e.courseId}|${e.due}|${safe(e.name, 80)}`;
          nextEvents[key] = 1;
          if (known && !known[key] && e.due * 1000 > now()) dueNews.set(e.courseId, [...(dueNews.get(e.courseId) || []), `- new or changed deadline: ${safe(e.name, 120)}, due ${when(e.due)}`]);
        }
        state.events = nextEvents;
      } catch (error) {
        if (error.code === "token" || error.code === "loggedout" || error.code === "offline" || error.code === "blocked") throw error;
        log(`[moodle watch] deadlines skipped: ${error.code || ""} ${error.message}`);
      }
      for (const c of list) {
        let got;
        try {
          const course = await source.ask("course", { courseid: c.id });
          const items = ((course.data && course.data.items) || []).filter((i) => Number.isInteger(i.id) && !STRUCTURE.has(i.module));
          const sectionOf = new Map();
          for (const s of (course.data && course.data.sections) || []) for (const id of s.cms || []) sectionOf.set(Number(id), safe(s.title, 50));
          const forum = items.find((i) => i.module === "forum");
          let talks = null;
          if (forum) { try { talks = ((await source.ask("forum", { cmid: forum.id })).data || []).filter((t) => Number.isInteger(t.d)); } catch (error) { if (error.code === "token" || error.code === "loggedout" || error.code === "offline") throw error; } }
          got = { items, talks, sectionOf };
        } catch (error) {
          if (error.code === "token" || error.code === "loggedout" || error.code === "offline" || error.code === "blocked") throw error;
          log(`[moodle watch] course ${c.id} skipped: ${error.code || ""} ${error.message}`);
          continue;
        }
        const d = diffCourse(state.courses[c.id], got);
        state.courses[c.id] = d.next;
        if (d.first) continue;
        const lines = [];
        for (const i of d.news.items) {
          const can = DOWNLOADABLE.has(i.module);
          if (can) counts.files++; else counts.items++;
          const sec = got.sectionOf.get(i.id);
          lines.push(`- new ${KIND[i.module] || safe(i.module, 20) || "item"} [${i.id}] ${safe(i.name)}${sec ? ` (${sec})` : ""}`);
        }
        for (const i of d.news.grown) { counts.files += i.more; lines.push(`- ${plural(i.more, "more file")} in the folder [${i.id}] ${safe(i.name)}`); }
        for (const t of d.news.talks.sort((a, b) => (a.time || 0) - (b.time || 0))) {
          counts.talks++;
          let head = `- new message${t.time ? ` (${when(t.time)})` : ""}: ${safe(t.title, 160)}`;
          if (postsRead < MAX_POSTS_READ) {
            postsRead++;
            try {
              const first = ((await source.ask("posts", { discussionid: t.d })).data || [])[0];
              if (first) {
                const body = safe(first.message, POST_CHARS);
                head = `- new message${first.author ? ` by ${safe(first.author, 60)}` : ""}${t.time ? ` (${when(t.time)})` : ""}: ${safe(first.subject || t.title, 160)}${body ? `\n  ${body}${String(first.message || "").length > POST_CHARS ? " …" : ""}` : ""}`;
              }
            } catch (error) { /* the title is enough */ }
          }
          lines.push(head);
        }
        for (const line of dueNews.get(c.id) || []) { counts.deadlines++; lines.push(line); }
        if (!lines.length) continue;
        const bot = map[c.id] ? (bots.find((b) => b.id === map[c.id]) || {}).name : null;
        const more = lines.length > MAX_LINES_PER_COURSE ? [`- and ${lines.length - MAX_LINES_PER_COURSE} more (ask me for the Moodle course to see all)`] : [];
        // The heading: my own name for the course when it is linked (short, the one Omri uses), else Moodle's name.
        blocks.push([bot ? safe(bot, 120) : `${safe(c.name, 120)} (not linked to one of my courses yet)`, ...lines.slice(0, MAX_LINES_PER_COURSE), ...more].join("\n"));
      }
      const total = counts.files + counts.items + counts.talks + counts.deadlines;
      const wasBroken = state.broken;
      write({ ...state, lastCheck: now(), lastTry: now(), broken: "" });
      if (wasBroken) log("[moodle watch] Moodle is reachable again");
      if (!total) { log("[moodle watch] nothing new"); return { ok: true, posted: false, counts }; }
      const parts = [counts.files ? plural(counts.files, "new file") : "", counts.talks ? plural(counts.talks, "new message") + " from lecturers" : "", counts.deadlines ? plural(counts.deadlines, "new or changed deadline") : "", counts.items ? plural(counts.items, "other new item") : ""].filter(Boolean);
      const head = `Moodle check: ${parts.join(", ")}.`;
      const tail = counts.files ? "\n\nTo put the new files into the course, tell me \"download them\"." : "";
      post(`${head}\n\n${blocks.join("\n\n")}${tail}`, "the Moodle watch found something new");
      log(`[moodle watch] ${head}`);
      if (push && !plan.inQuietHours(now(), PUSH_QUIET, timezone)) {
        try { await push.notifyAll({ title: "Bot", body: `Moodle: ${parts.join(", ")}. Open Bot to read.`, tag: `moodle-${now()}` }); } catch (error) { log(`[moodle watch] push failed: ${error.message}`); }
      }
      return { ok: true, posted: true, counts };
    } catch (error) {
      const code = error.code || "error";
      log(`[moodle watch] could not look: ${code} ${error.message}`);
      // Told once, and only for the thing Omri can fix: the token. (Chrome closed or logged out is normal life; the log has it.)
      if (code === "token" && state.broken !== "token") post("Moodle check: I could not look at Moodle because the token stopped working (they last a few months). On the PC, run this once in the project folder: node moodle-token.js\nUntil then I only see Moodle through Chrome when you are logged in there.", "the Moodle token stopped working");
      // The snapshot on disk is NOT touched: a look that broke halfway told Omri nothing, so the next good look must still find it all.
      write({ ...read(), lastTry: now(), broken: code === "token" ? "token" : state.broken });
      return { ok: false, code };
    } finally { running = false; }
  }

  function post(text, reason) {
    if (!thread) return;
    const result = { mode: "single", rule: RULE, reason, chain: [], used: { provider: "code", model: "written by code, no model" }, answer: text, seconds: 0 };
    thread.append({ role: "assistant", text, result, topic: "general", at: now() });
  }

  // Is a look due? Every everyMs after the last good one; RETRY_MS after a failed try; never in the first minutes after a start.
  function due() {
    const s = read();
    if (now() - startedAt < START_DELAY_MS) return false;
    if (now() - s.lastCheck < everyMs) return false;
    return now() - s.lastTry >= RETRY_MS;
  }
  const tick = () => (due() ? check() : Promise.resolve(null));
  function start() { if (timer) return; timer = setInterval(() => { tick().catch((error) => log(`[moodle watch] ${error.message}`)); }, TICK_MS); if (timer.unref) timer.unref(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { check, tick, due, start, stop, state: read };
}

module.exports = { createMoodleWatch, diffCourse, safe, RULE, EVERY_MS, RETRY_MS };
