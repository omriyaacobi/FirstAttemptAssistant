// moodle-tools.js
// What Bot can do with Moodle, on top of the bridge (moodle-bridge.js -> the Chrome extension -> Omri's logged-in Moodle).
// READ-ONLY toward Moodle. The only thing that changes on Bot's side: files downloaded into one of Bot's courses (the normal upload
// road, untrusted data) and a small map file data/moodle-map.json (which Moodle course is which Bot course, which items were fetched).
//
// Rules in code:
//   - a Moodle course is matched to a Bot course by CODE: the saved map, then the same name, then the timetable's own name pattern
//     (that is where the Hebrew names live). Two candidates = not clear: Bot asks Omri and remembers his answer (link()).
//   - items to download must be real items of that Moodle course (by number or by name), of kind file or folder. Nothing a model
//     writes becomes an address.
//   - more than MAX_DIRECT files at once -> a Confirm card first (link-batch.js), nothing downloaded before the tap.
//   - a running total of MAX_TOTAL_BYTES per request; past it the rest is skipped and said.
//   - everything that comes from Moodle is untrusted data; the brain puts it in marked blocks.

const fs = require("node:fs");
const path = require("node:path");
const { say } = require("./lang");

const MAX_DIRECT = 10;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const COURSES_CACHE_MS = 10 * 60 * 1000;
const NEWS_POSTS = 3;
const POST_CHARS = 3000;
const KIND = { resource: "file", folder: "folder", assign: "assignment", forum: "forum", url: "link", page: "page", quiz: "quiz", label: "text", lti: "external tool", zoom: "zoom", choicegroup: "group choice", questionnaire: "questionnaire", wooclap: "wooclap", book: "book" };

const plain = (html) => String(html || "").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const oneLine = (t, n = 200) => String(t || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
// "תכנות מערכות סמ 1" / "High-Performance Systems Programming S1" -> comparable words
const norm = (s) => String(s || "").toLowerCase().replace(/["'״׳`]/g, "").replace(/\s+(?:סמ|סמסטר|s|sem)\s*\d+\s*$/i, "").replace(/[^a-z0-9֐-׿]+/g, " ").trim();
const day = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "?");

const fail = (message, code = "tool") => Object.assign(new Error(message), { code });

// Plain words for the bridge's errors (what Omri must do).
function explain(error, lang = "en") {
  const c = error && error.code;
  if (c === "offline") return say(lang, "Moodle cannot be reached: Chrome with the Bot Moodle extension is not open on the PC. Open Chrome (the extension is in moodle-extension/) and ask again.", "אין גישה למודל: כרום עם התוסף של Bot לא פתוח במחשב. צריך לפתוח את כרום ולשאול שוב.");
  if (c === "loggedout") return say(lang, "Moodle logged you out. Log in to Moodle in Chrome on the PC, then ask again.", "המודל ניתק את החיבור. צריך להתחבר למודל בכרום במחשב ולשאול שוב.");
  if (c === "timeout") return say(lang, "Moodle did not answer in time. Try again in a minute.", "המודל לא ענה בזמן. אפשר לנסות שוב בעוד דקה.");
  if (c === "toobig") return say(lang, "That file is bigger than 50 MB, so Bot did not download it.", "הקובץ גדול מ-50 מגה-בייט ולכן לא הורד.");
  return say(lang, `Moodle did not give it: ${oneLine(error && error.message, 200)}`, `המודל לא החזיר את זה: ${oneLine(error && error.message, 200)}`);
}

function createMoodleTools({ bridge, courseRoutes, dataDir, linkBatches = null, now = () => Date.now() }) {
  const mapFile = path.join(dataDir, "moodle-map.json");
  const readMap = () => { try { const m = JSON.parse(fs.readFileSync(mapFile, "utf8")); return { links: m.links || {}, fetched: m.fetched || {} }; } catch (error) { return { links: {}, fetched: {} }; } };
  const writeMap = (m) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(mapFile, JSON.stringify(m, null, 2)); };
  let coursesCache = { at: 0, list: null };

  async function moodleCourses() {
    if (coursesCache.list && now() - coursesCache.at < COURSES_CACHE_MS) return coursesCache.list;
    const { data } = await bridge.ask("courses");
    const list = (Array.isArray(data) ? data : []).filter((c) => Number.isInteger(c.id)).map((c) => ({ id: c.id, name: oneLine(c.name, 200), category: oneLine(c.category, 120) }));
    coursesCache = { at: now(), list };
    return list;
  }

  // Moodle id -> Bot course id (or null). saved map first, then the same name, then the timetable pattern; only one-to-one matches.
  // patternFor(botCourse) -> a RegExp of the course's other names (Hebrew), or null.
  function autoMap(mList, bList, patternFor = () => null) {
    const saved = readMap().links;
    const out = {};
    const taken = new Set();
    for (const m of mList) {
      const b = saved[m.id];
      if (b === null) { out[m.id] = null; continue; } // Omri said: no Bot course for this one
      if (b && bList.some((x) => x.id === b)) { out[m.id] = b; taken.add(b); }
    }
    const open = () => mList.filter((m) => !(m.id in out));
    for (const m of open()) {
      const same = bList.filter((b) => !taken.has(b.id) && norm(b.name) === norm(m.name));
      if (same.length === 1) { out[m.id] = same[0].id; taken.add(same[0].id); }
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const m of open()) {
        const fits = bList.filter((b) => { if (taken.has(b.id)) return false; const re = patternFor(b); return norm(m.name).includes(norm(b.name)) || (re && re.test(m.name)); });
        if (fits.length !== 1) continue;
        const b = fits[0];
        const rivals = open().filter((x) => { const re = patternFor(b); return norm(x.name).includes(norm(b.name)) || (re && re.test(x.name)); });
        if (rivals.length !== 1) continue;
        out[m.id] = b.id; taken.add(b.id); changed = true;
      }
    }
    return out;
  }

  // Which Moodle course does the model mean? A Moodle id, a Moodle name, or a Bot course name (through the map).
  async function resolve(name, patternFor) {
    const list = await moodleCourses();
    const bots = courseRoutes.list();
    const map = autoMap(list, bots, patternFor);
    const q = String(name == null ? "" : name).trim();
    const byId = /^\d+$/.test(q) ? list.find((m) => m.id === Number(q)) : null;
    if (byId) return { m: byId, botId: map[byId.id] || null, list, bots };
    const nq = norm(q);
    if (!nq) throw fail("say which Moodle course");
    // a Bot course name -> its Moodle course (through the map, then its timetable pattern)
    const viaBot = (b) => {
      if (!b) return [];
      const mapped = list.filter((m) => map[m.id] === b.id);
      if (mapped.length) return mapped;
      const re = patternFor(b);
      return re ? list.filter((m) => re.test(m.name)) : [];
    };
    let hits = list.filter((m) => norm(m.name) === nq);
    if (!hits.length) hits = viaBot(bots.find((x) => norm(x.name) === nq));
    if (!hits.length) hits = list.filter((m) => norm(m.name).includes(nq) || nq.includes(norm(m.name)));
    if (!hits.length) hits = viaBot(bots.find((x) => norm(x.name).includes(nq)));
    if (hits.length !== 1) throw fail(hits.length ? `more than one Moodle course fits "${q.slice(0, 60)}": ${hits.map((m) => `${m.name} (id ${m.id})`).join("; ")}. Use the Moodle id.` : `no Moodle course like "${q.slice(0, 60)}". Moodle courses: ${list.map((m) => `${m.name} (id ${m.id})`).join("; ")}`);
    return { m: hits[0], botId: map[hits[0].id] || null, list, bots };
  }

  const botName = (bots, id) => (bots.find((b) => b.id === id) || {}).name || null;

  // ---- the tools (each returns text for the model; the brain marks Moodle text as data) ----
  async function listText(patternFor) {
    const list = await moodleCourses();
    const bots = courseRoutes.list();
    const map = autoMap(list, bots, patternFor);
    return list.map((m) => `- ${m.name} (Moodle id ${m.id}) -> ${map[m.id] ? `Bot course "${botName(bots, map[m.id])}"` : "not linked to a Bot course"}`).join("\n") || "Moodle shows no current courses.";
  }

  async function contents(m) {
    const { data } = await bridge.ask("course", { courseid: m.id });
    return { sections: (data && data.sections) || [], items: ((data && data.items) || []).filter((i) => Number.isInteger(i.id)) };
  }

  async function courseText(name, patternFor) {
    const { m, botId, bots } = await resolve(name, patternFor);
    const { sections, items } = await contents(m);
    const byId = new Map(items.map((i) => [i.id, i]));
    const fetched = readMap().fetched[m.id] || {};
    const lines = [`Moodle course "${m.name}" (id ${m.id}) -> ${botId ? `Bot course "${botName(bots, botId)}"` : "not linked to a Bot course yet"}.`];
    for (const s of sections) {
      const its = (s.cms || []).map((id) => byId.get(Number(id))).filter(Boolean);
      if (!its.length) continue;
      lines.push(`## ${oneLine(s.title, 120) || `Section ${s.number}`}`);
      for (const i of its.slice(0, 60)) lines.push(`- [${i.id}] (${KIND[i.module] || i.module}) ${oneLine(i.name, 160)}${fetched[i.id] ? " [already downloaded]" : ""}`);
    }
    try {
      const { data } = await bridge.ask("events");
      const due = (Array.isArray(data) ? data : []).filter((e) => e.courseId === m.id).slice(0, 10);
      if (due.length) lines.push("## Coming deadlines", ...due.map((e) => `- ${oneLine(e.name, 160)}: ${day(e.due)}`));
    } catch (error) { lines.push(`(deadlines could not be read: ${explain(error)})`); }
    const forum = items.find((i) => i.module === "forum");
    if (forum) {
      try {
        const { data } = await bridge.ask("forum", { cmid: forum.id });
        const top = (Array.isArray(data) ? data : []).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 5);
        if (top.length) lines.push(`## Newest posts in "${oneLine(forum.name, 80)}"`, ...top.map((d) => `- ${day(d.time)}: ${oneLine(d.title, 160)}`));
      } catch (error) { lines.push(`(the announcements could not be read: ${explain(error)})`); }
    }
    return lines.join("\n");
  }

  async function newsText(name, patternFor, count = NEWS_POSTS) {
    const { m } = await resolve(name, patternFor);
    const { items } = await contents(m);
    const forum = items.find((i) => i.module === "forum");
    if (!forum) return `The Moodle course "${m.name}" has no announcements forum.`;
    const { data } = await bridge.ask("forum", { cmid: forum.id });
    const top = (Array.isArray(data) ? data : []).filter((d) => Number.isInteger(d.d)).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, Math.min(5, Math.max(1, Number(count) || NEWS_POSTS)));
    if (!top.length) return `No posts in "${forum.name}" of ${m.name}.`;
    const out = [`The newest posts in "${oneLine(forum.name, 80)}" of the Moodle course "${m.name}":`];
    for (const d of top) {
      try {
        const { data: posts } = await bridge.ask("posts", { discussionid: d.d });
        const first = Array.isArray(posts) && posts[0];
        if (!first) continue;
        const replies = posts.length - 1;
        out.push(`### ${oneLine(first.subject || d.title, 200)}\n${day(first.created)}, by ${oneLine(first.author, 80) || "?"}${replies > 0 ? `, ${replies} repl${replies === 1 ? "y" : "ies"}` : ""}${(first.attachments || []).length ? `, attachments: ${first.attachments.map((a) => oneLine(a, 80)).join(", ")}` : ""}\n${plain(first.message).slice(0, POST_CHARS)}`);
      } catch (error) { out.push(`### ${oneLine(d.title, 200)}\n(could not be read: ${explain(error)})`); }
    }
    return out.join("\n\n");
  }

  // The address of a Moodle course page, or of one REAL item of it, for opening in Omri's own Chrome (pc-open.js). The item is looked up
  // in the course as Moodle shows it now; the address is built by code from its numbers (moodleUrl), never from model or Moodle text.
  async function openTarget(name, item, patternFor) {
    const { moodleUrl } = require("./pc-open");
    const { m } = await resolve(name, patternFor);
    const s = String(item == null ? "" : item).trim();
    if (!s) return { url: moodleUrl({ courseId: m.id }), label: `the Moodle page of ${m.name}` };
    const { items } = await contents(m);
    let hits = /^\d+$/.test(s) ? items.filter((i) => i.id === Number(s)) : items.filter((i) => norm(i.name) === norm(s));
    if (!hits.length && norm(s)) hits = items.filter((i) => norm(i.name).includes(norm(s)));
    if (hits.length !== 1) throw fail(hits.length ? `more than one item of ${m.name} fits "${s.slice(0, 60)}": ${hits.slice(0, 6).map((i) => `[${i.id}] ${oneLine(i.name, 60)}`).join("; ")}. Use its number.` : `no item like "${s.slice(0, 60)}" in the Moodle course ${m.name}. moodle_course lists its items.`);
    return { url: moodleUrl({ cmid: hits[0].id, module: hits[0].module }), label: `"${oneLine(hits[0].name, 120)}" in ${m.name}` };
  }

  // Remember which Bot course a Moodle course is (Omri's answer). botId null = "no Bot course for it".
  async function link(moodleName, botCourse, patternFor) {
    const { m, bots } = await resolve(moodleName, patternFor);
    let b = null;
    if (botCourse !== null && botCourse !== "none") {
      const q = norm(botCourse);
      b = bots.find((x) => norm(x.name) === q) || bots.find((x) => norm(x.name).includes(q) && q);
      if (!b) throw fail(`there is no Bot course "${String(botCourse).slice(0, 60)}". Bot courses: ${bots.map((x) => x.name).join("; ")}`);
    }
    const map = readMap();
    for (const [k, v] of Object.entries(map.links)) if (b && v === b.id && Number(k) !== m.id) delete map.links[k]; // one Moodle course per Bot course
    map.links[m.id] = b ? b.id : null;
    writeMap(map);
    return b ? `Linked: Moodle "${m.name}" is Bot's course "${b.name}" (remembered).` : `Remembered: Moodle "${m.name}" has no Bot course.`;
  }

  // The download list: real items of the course (files, folders), by number or name, or "new" (not downloaded before).
  async function plan(m, items) {
    const { items: all } = await contents(m);
    const kinds = all.filter((i) => i.module === "resource" || i.module === "folder");
    const fetched = readMap().fetched[m.id] || {};
    const want = [].concat(items == null ? [] : items).slice(0, 200);
    let chosen = [];
    const missing = [];
    if (want.length === 1 && /^(new|all new|חדש|חדשים)$/i.test(String(want[0]).trim())) chosen = kinds.filter((i) => !fetched[i.id]);
    else if (want.length === 1 && /^(all|הכל|הכול)$/i.test(String(want[0]).trim())) chosen = kinds;
    else for (const w of want) {
      const s = String(w).trim();
      const hit = /^\d+$/.test(s) ? kinds.find((i) => i.id === Number(s)) : (kinds.find((i) => norm(i.name) === norm(s)) || kinds.filter((i) => norm(i.name).includes(norm(s)) && norm(s)).slice(0, 1)[0]);
      if (hit && !chosen.includes(hit)) chosen.push(hit); else if (!hit) missing.push(s.slice(0, 60));
    }
    // a folder is opened to count (and later fetch) its files
    const jobs = [];
    for (const i of chosen) {
      if (i.module === "resource") { jobs.push({ cm: i.id, kind: "file", label: oneLine(i.name, 120) }); continue; }
      try {
        const { data } = await bridge.ask("folder", { cmid: i.id });
        for (const f of (Array.isArray(data) ? data : []).filter((x) => Number.isInteger(x.index))) jobs.push({ cm: i.id, kind: "folderfile", index: f.index, label: `${oneLine(i.name, 60)}/${oneLine(f.name, 100)}` });
      } catch (error) { missing.push(`${oneLine(i.name, 60)} (${explain(error)})`); }
    }
    return { jobs, missing };
  }

  // One download, filed into the Bot course (the upload road). Returns { ok, why?, filed, bytes }.
  async function fetchOne(m, botId, botCourseName, job, lang) {
    const { file } = await bridge.ask(job.kind, job.kind === "file" ? { cmid: job.cm } : { cmid: job.cm, index: job.index });
    if (!file || !file.bytes || !file.bytes.length) return { ok: false, why: "empty", bytes: 0 };
    try {
      const r = courseRoutes.fileFetched(botId, botCourseName, { bytes: file.bytes, name: file.name }, lang);
      return { ok: true, filed: r.filedCount, bytes: file.bytes.length, name: file.name };
    } catch (error) {
      return { ok: false, why: oneLine(error.message, 120), bytes: file.bytes.length, name: file.name, duplicate: /already|duplicate|קיים/i.test(error.message) };
    } finally {
      const map = readMap();
      map.fetched[m.id] = { ...(map.fetched[m.id] || {}), [job.cm]: now() };
      writeMap(map);
    }
  }

  // moodle_fetch. Returns { text, card? }.
  async function fetchFiles(name, items, { lang = "en", patternFor, questionId = null } = {}) {
    const { m, botId, bots } = await resolve(name, patternFor);
    if (!botId) throw fail(`the Moodle course "${m.name}" is not linked to a Bot course. Ask Omri which Bot course it is (then call moodle_link), or whether to make a new course on the Courses page.`);
    const bName = botName(bots, botId);
    const { jobs, missing } = await plan(m, items);
    const miss = missing.length ? ` Not found among the course's files and folders: ${missing.slice(0, 8).join("; ")}.` : "";
    if (!jobs.length) return { text: `Nothing to download from "${m.name}".${miss}` };
    if (jobs.length > MAX_DIRECT) {
      if (!linkBatches) throw fail(`that is ${jobs.length} files; ask Omri to pick at most ${MAX_DIRECT}.`);
      const p = linkBatches.propose({ courseId: botId, courseName: bName, urls: jobs.map((j) => j.label), mode: "moodle", lang, source: `Moodle: ${m.name}`, questionId, runOne: makeRunner(m, botId, bName, jobs, lang) });
      return { text: `${jobs.length} files would be downloaded from Moodle "${m.name}" into "${bName}". A card with the list is shown to Omri; NOTHING is downloaded until Omri taps Confirm.${miss}`, card: p.card, cardText: p.text };
    }
    const results = [];
    let total = 0;
    for (const j of jobs) {
      if (total > MAX_TOTAL_BYTES) { results.push({ j, res: { ok: false, why: "skipped: over 200 MB in one request" } }); continue; }
      let res;
      try { res = await fetchOne(m, botId, bName, j, lang); } catch (error) { res = { ok: false, why: explain(error, "en") }; if (error.code === "offline" || error.code === "loggedout") { results.push({ j, res }); break; } }
      total += res.bytes || 0;
      results.push({ j, res });
    }
    const good = results.filter((r) => r.res.ok);
    const dup = results.filter((r) => !r.res.ok && r.res.duplicate);
    const bad = results.filter((r) => !r.res.ok && !r.res.duplicate);
    const text = [`DOWNLOADED from Moodle "${m.name}" into Bot's course "${bName}": ${good.length} of ${jobs.length}${good.length ? ` (${good.map((r) => oneLine(r.res.name || r.j.label, 80)).join(", ")})` : ""}. Bot reads them now.`,
      dup.length ? `Already in the course (${dup.length}): ${dup.map((r) => oneLine(r.res.name || r.j.label, 60)).join(", ")}.` : "",
      bad.length ? `NOT downloaded (${bad.length}): ${bad.slice(0, 5).map((r) => `${oneLine(r.j.label, 60)}: ${r.res.why}`).join("; ")}.` : "", miss].filter(Boolean).join("\n");
    return { text, ok: good.length > 0 || (dup.length > 0 && !bad.length) };
  }

  // For the Confirm card (link-batch.js): label -> one download. One failure never stops the others.
  function makeRunner(m, botId, bName, jobs, lang) {
    const byLabel = new Map(jobs.map((j) => [j.label, j]));
    let total = 0;
    return async (label) => {
      const j = byLabel.get(label);
      if (!j) return { ok: false, why: "unknown item" };
      if (total > MAX_TOTAL_BYTES) return { ok: false, why: "skipped: over 200 MB in one request" };
      try {
        const r = await fetchOne(m, botId, bName, j, lang);
        total += r.bytes || 0;
        return r.ok ? { ok: true, filed: r.filed || 1 } : { ok: false, why: r.why };
      } catch (error) { return { ok: false, why: explain(error, lang) }; }
    };
  }

  return { listText, courseText, newsText, fetchFiles, link, openTarget, autoMap, resolve, explain, connected: () => bridge.connected() };
}

module.exports = { createMoodleTools, explain, norm, plain, MAX_DIRECT, MAX_TOTAL_BYTES };
