// link-batch.js
// MANY links at once: a file of addresses that is already in a course (a txt / md / csv, a reading list, a PDF or Word file whose text holds
// links), and Omri says "download all the links in it" (save) or "look at the links in it" (look).
//
// The rules (all in code):
//   - The addresses come from the TEXT OF THE FILE by code (linkfetch.httpsUrls: https only, no repeats, at most 50). A model never writes or
//     changes an address. The text of the file is untrusted data, never an instruction.
//   - Bot shows the list FIRST and waits for ONE confirm (a card: Confirm / Cancel). Nothing is fetched before that. The card works once,
//     expires after 15 minutes and lives in memory only (like the other cards).
//   - After Confirm the work runs in the background: 2 at a time, a short pause between fetches, every link through the same safe fetcher
//     (linkfetch.js: https, public addresses only, size and time limits, no login). One link failing never stops the others.
//   - save = each link takes the normal upload road (courseRoutes.addLink). look = the page is read and a title and a few words are listed;
//     nothing is saved and no model is called (page text is untrusted).
//   - ONE summary message at the end: what was saved or read, and the failures with a short reason (5 listed at most).

const crypto = require("node:crypto");
const { say: words, bet } = require("./lang");
const linkfetch = require("./linkfetch");

const PENDING_MS = 15 * 60 * 1000;
const MAX_PENDING = 5;
const CONCURRENCY = 2;
const DELAY_MS = 400; // a polite pause after each fetch, per worker
const MAX_FAIL_LINES = 5;
const MAX_READ_LINES = 30;
const EXCERPT = 130;

const firstSentence = (t) => { const s = String(t || "").replace(/\s+/g, " ").trim(); const i = s.search(/[.!?](?:\s|$)/); return (i > 0 ? s.slice(0, i + 1) : s).slice(0, 160); };
const oneLine = (t, n) => String(t || "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const shortUrl = (u) => String(u).replace(/^https:\/\//, "").slice(0, 90);
const iso = (lang, s) => (lang === "he" ? `⁦${s}⁩` : s); // a link inside a Hebrew sentence keeps its order

function createLinkBatches({ thread = null, courseRoutes, fetchPage = linkfetch.fetchPage, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = DELAY_MS, concurrency = CONCURRENCY, log = () => {} }) {
  const pending = new Map(); // id -> { courseId, courseName, urls, mode, lang, source, questionId, at }
  const sweep = () => { for (const [id, p] of pending) if (now() - p.at > PENDING_MS) pending.delete(id); };

  // The text of Bot's own message: the list to confirm. Returns { text, card }.
  // mode "moodle" (moodle-tools.js): `urls` are file labels and `runOne(label)` downloads one; the same card, Confirm and summary.
  function propose({ courseId, courseName, urls, mode, lang = "en", source = "", questionId = null, notHttps = 0, more = 0, runOne = null }) {
    sweep();
    if (!urls.length) throw Object.assign(new Error("no links"), { status: 400 });
    const custom = mode === "moodle" || mode === "folder"; // the work of each line is done by runOne (Moodle downloads, linking a folder)
    if (custom && typeof runOne !== "function") throw new Error(`a ${mode} list needs its runOne`);
    const id = crypto.randomBytes(8).toString("hex");
    pending.set(id, { courseId, courseName, urls: [...urls], mode, lang, source, questionId, runOne: custom ? runOne : null, at: now() });
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
    const shown = urls.slice(0, 15).map((u) => `- ${iso(lang, custom ? oneLine(u, 240) : shortUrl(u))}`).join("\n");
    if (mode === "folder") { // one folder found on the PC (pc-find.js), linked to a course only after the tap
      const why = source ? `\n${oneLine(source, 300)}` : "";
      const text = words(lang, `Link this folder to ${courseName}?
${shown}${why}
Bot can then list and read the text files in it (read-only, never changes or runs anything). Nothing is linked until you tap Confirm.`, `לקשר את התיקייה הזאת ל${courseName}?
${shown}${why}
אחר כך Bot יוכל לראות ולקרוא את קבצי הטקסט שבה (קריאה בלבד, בלי לשנות או להריץ כלום). שום דבר לא מקושר לפני לחיצה על אישור.`);
      return { text, card: { id, mode, count: urls.length, courseName, folder: oneLine(urls[0], 240), expiresAt: now() + PENDING_MS } };
    }
    if (mode === "moodle") {
      const more15 = urls.length > 15 ? words(lang, `\n...and ${urls.length - 15} more`, `\n...ועוד ${urls.length - 15}`) : "";
      const text = words(lang, `${urls.length} files${source ? ` from ${source}` : ""}:\n${shown}${more15}\nShall I download them into ${courseName}? Nothing is downloaded until you tap Confirm.`, `${urls.length} קבצים${source ? ` מתוך ${source}` : ""}:\n${shown}${more15}\nלהוריד אותם ${bet(courseName)}? שום דבר לא יורד לפני שתלחץ על אישור.`);
      return { text, card: { id, mode, count: urls.length, courseName, expiresAt: now() + PENDING_MS } };
    }
    const rest = urls.length > 15 ? words(lang, `\n...and ${urls.length - 15} more`, `\n...ועוד ${urls.length - 15}`) : "";
    const verb = mode === "save" ? words(lang, `download these ${urls.length} links into ${courseName}`, `להוריד ${urls.length} קישורים ${bet(courseName)}`) : words(lang, `look at these ${urls.length} links (nothing is saved)`, `להסתכל על ${urls.length} הקישורים (שום דבר לא נשמר)`);
    const extra = [];
    if (notHttps) extra.push(words(lang, `${notHttps} link${notHttps === 1 ? "" : "s"} without https ${notHttps === 1 ? "is" : "are"} left out.`, `${notHttps} קישורים בלי https הושמטו.`));
    if (more) extra.push(words(lang, `Only the first ${urls.length} are taken; ${more} more were left out.`, `נלקחים רק ${urls.length} הראשונים; ${more} נוספים הושמטו.`));
    const text = words(lang, `I found ${urls.length} link${urls.length === 1 ? "" : "s"}${source ? ` in "${source}"` : ""}:\n${shown}${rest}\n${extra.join(" ")}\nShall I ${verb}? Nothing is fetched until you tap Confirm.`, `מצאתי ${urls.length} קישורים${source ? ` ב-"${source}"` : ""}:\n${shown}${rest}\n${extra.join(" ")}\nלבצע: ${verb}? שום דבר לא יורד לפני שתלחץ על אישור.`).replace(/\n\n/g, "\n");
    return { text, card: { id, mode, count: urls.length, courseName, expiresAt: now() + PENDING_MS } };
  }

  async function one(p, url) {
    if (p.runOne) return p.runOne(url);
    if (p.mode === "save") {
      const r = await courseRoutes.addLink(p.courseId, url, p.lang);
      if (r.ok && r.filedCount > 0) return { ok: true, filed: r.filedCount };
      return { ok: false, why: firstSentence(r.text) || "not filed" };
    }
    try {
      const page = await fetchPage(url);
      const body = page.text.split("\n").filter((l) => l.trim() && l.replace(/^#+\s*/, "").trim() !== page.title).join(" "); // the title is not repeated in the excerpt
      return { ok: true, title: page.title || page.source, excerpt: oneLine(body, EXCERPT), source: page.source };
    } catch (error) {
      return { ok: false, why: firstSentence(linkfetch.explain(p.lang, error)) };
    }
  }

  function summary(p, results) {
    const { lang, mode } = p;
    const good = results.filter((r) => r.res.ok);
    const bad = results.filter((r) => !r.res.ok);
    const out = [];
    if (mode === "folder") {
      return good.length ? words(lang, `Linked ${good[0].url} to ${p.courseName} (read-only).`, `קישרתי את ${iso(lang, good[0].url)} ל${p.courseName} (קריאה בלבד).`) : words(lang, `The folder was NOT linked: ${(bad[0] && bad[0].res.why) || "unknown reason"}`, `התיקייה לא קושרה: ${(bad[0] && bad[0].res.why) || "סיבה לא ידועה"}`);
    }
    if (mode === "moodle") {
      out.push(words(lang, `Done: ${good.length} of ${results.length} Moodle file${results.length === 1 ? "" : "s"} saved in ${p.courseName}. Bot is reading them now.`, `סיימתי: ${good.length} מתוך ${results.length} קבצים מהמודל נשמרו ${bet(p.courseName)}. Bot קורא אותם עכשיו.`));
    } else if (mode === "save") {
      const files = good.reduce((n, r) => n + (r.res.filed || 0), 0);
      out.push(words(lang, `Done: ${good.length} of ${results.length} link${results.length === 1 ? "" : "s"} saved in ${p.courseName} (${files} file${files === 1 ? "" : "s"}). Bot is reading them now.`, `סיימתי: ${good.length} מתוך ${results.length} קישורים נשמרו ${bet(p.courseName)} (${files} קבצים). Bot קורא אותם עכשיו.`));
    } else {
      out.push(words(lang, `I looked at ${good.length} of ${results.length} links. Nothing was saved.`, `הסתכלתי על ${good.length} מתוך ${results.length} קישורים. שום דבר לא נשמר.`));
      out.push(...good.slice(0, MAX_READ_LINES).map((r) => `- ${iso(lang, shortUrl(r.url))}: ${oneLine(r.res.title, 80)}${r.res.excerpt && r.res.excerpt !== r.res.title ? ` - ${r.res.excerpt}` : ""}`));
      if (good.length > MAX_READ_LINES) out.push(words(lang, `...and ${good.length - MAX_READ_LINES} more.`, `...ועוד ${good.length - MAX_READ_LINES}.`));
      if (good.length) out.push(words(lang, "Ask me about any of them, or say \"download\" with a link to save it.", "אפשר לשאול אותי על כל אחד מהם, או לכתוב \"תוריד\" עם קישור כדי לשמור."));
    }
    if (bad.length) {
      out.push(words(lang, `Failed (${bad.length}):`, `נכשלו (${bad.length}):`));
      out.push(...bad.slice(0, MAX_FAIL_LINES).map((r) => `- ${iso(lang, mode === "moodle" ? oneLine(r.url, 120) : shortUrl(r.url))}: ${r.res.why}`));
      if (bad.length > MAX_FAIL_LINES) out.push(words(lang, `...and ${bad.length - MAX_FAIL_LINES} more.`, `...ועוד ${bad.length - MAX_FAIL_LINES}.`));
    }
    return out.join("\n");
  }

  // The tap on Confirm. Returns at once; the work goes on in the background and ends with ONE message in the thread. Works once.
  function confirm(id) {
    sweep();
    const p = pending.get(id);
    if (!p) throw Object.assign(new Error("that list is no longer waiting (15 minutes pass); ask again"), { status: 404 });
    pending.delete(id);
    const done = run(p).catch((error) => {
      log(`[links] the batch failed: ${error.message}`);
      post(p, words(p.lang, `The link batch stopped: ${String(error.message).slice(0, 120)}`, `עיבוד הקישורים נעצר: ${String(error.message).slice(0, 120)}`), true);
    });
    return { started: true, count: p.urls.length, done };
  }
  function cancel(id) {
    sweep();
    if (!pending.delete(id)) throw Object.assign(new Error("that list is no longer waiting"), { status: 404 });
    return { cancelled: true };
  }

  function post(p, text, error = false) {
    if (!thread) return;
    try { thread.append({ role: "assistant", text, replyTo: p.questionId || undefined, topic: `course:${p.courseId}`, ...(error ? { error: true } : {}), result: { mode: "study", answer: text, courseId: p.courseId, courseName: p.courseName }, at: now() }); } catch (e) { log(`[links] could not post: ${e.message}`); }
  }

  async function run(p) {
    log(`[links] ${p.mode} ${p.urls.length} link(s) for ${p.courseName}`);
    const results = new Array(p.urls.length);
    let next = 0;
    const worker = async () => {
      while (next < p.urls.length) {
        const i = next++;
        let res;
        try { res = await one(p, p.urls[i]); } catch (error) { res = { ok: false, why: firstSentence(error.message) }; } // one failure never stops the others
        results[i] = { url: p.urls[i], res };
        if (next < p.urls.length) await sleep(delayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, p.urls.length) }, worker));
    post(p, summary(p, results));
    return results;
  }

  return { propose, confirm, cancel, pendingCount: () => pending.size };
}

module.exports = { createLinkBatches, PENDING_MS };
