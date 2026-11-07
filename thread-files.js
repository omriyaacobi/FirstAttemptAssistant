// thread-files.js
// A FILE or PHOTO that arrives with a message in the one conversation (BOT_THREAD=on). There is no "open the course first" any more, so
// code files it under the right course:
//   1. the course named in the file name or in Omri's words (the timetable's names, then the course names),
//   2. else the one course whose lecture is on right now or ended in the last 3 hours (the file is probably from that class),
//   3. else Bot ASKS (the file waits in memory for 30 minutes; the page shows the course buttons; nothing is saved until a course is chosen).
// The checks are the old ones, not new ones: the real first bytes, 50 MB, 400 MB per course, no duplicate (course-routes.js addUpload).
// After the file is read, the study coach (study-coach.js onUpload) looks at it: an assignment, or lecture material. It answers with a
// PROPOSAL (a Confirm card: "is this the lecture of Thursday 5 Nov?"), and nothing is attached until Omri confirms.
// A photo that says "add this to my calendar" is NOT handled here: it still goes through /api/ask exactly as before.

const { langOf, say: words, bet } = require("./lang");
const crypto = require("node:crypto");
const plan = require("./study-plan");
const { sniffFile, cleanName } = require("./upload");
const { unzip, looksLikeZip } = require("./unzip");
const { sniffOffice } = require("./office");
const { dueFromWords } = require("./due-date");

const PENDING_MS = 30 * 60 * 1000;
const MAX_PENDING = 5;
const MAX_PENDING_BYTES = 400 * 1024 * 1024; // all waiting files together (a waiting zip is held unpacked, in memory)
const MAX_SHOWN = 8; // lines of "skipped" a zip summary lists; the rest is only counted
const AFTER_CLASS_MS = 3 * 3600 * 1000;
// Words of a course name that say nothing about WHICH course it is.
const GENERIC = new Set(["intro", "introduction", "demo", "course", "class", "advanced", "basic", "basics", "lecture", "with", "from", "that", "this", "and", "the", "for", "part", "level", "semester"]);
const wordsOf = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const sameWord = (a, b) => a === b || a + "s" === b || a === b + "s";

// The course whose own name words (not generic ones) appear in the words: "the programming course" -> "Intro Programming Demo".
// Several courses sharing the word, or two different courses named, is not a clue: null (Bot asks).
function pickByNameWords(refs, probe) {
  const said = wordsOf(probe);
  const hits = [];
  for (const r of refs) {
    const mine = [...new Set(wordsOf(r.name).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)))];
    const matched = mine.filter((w) => said.some((x) => sameWord(w, x)));
    if (matched.length) hits.push({ ref: r, matched });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.matched.length - a.matched.length);
  const top = hits[0];
  if (hits.length > 1 && hits[1].matched.length === top.matched.length) return null;
  if (hits.slice(1).some((h) => h.matched.some((w) => !top.matched.includes(w)))) return null; // another course is named too
  return top.ref;
}

// Which course is meant? Returns { ref, how } or null (then Bot asks).
function pickCourse({ fileName = "", text = "", coach, courseList, now = Date.now() }) {
  const tracker = coach.tracker;
  const refs = tracker.refsFor(courseList);
  const probe = `${fileName} ${text}`;
  const key = plan.courseKeyFor(tracker.timetable(), probe);
  const byKey = key && refs.find((r) => r.key === key);
  if (byKey) return { ref: byKey, how: "the name of the course in your message or the file name" };
  const lower = probe.toLowerCase();
  const named = refs.filter((r) => r.name && lower.includes(String(r.name).toLowerCase()));
  if (named.length === 1) return { ref: named[0], how: "the course name in your message or the file name" };
  const byWords = pickByNameWords(refs, probe);
  if (byWords) return { ref: byWords, how: "the course name in your message or the file name" };
  // a class that is on right now or ended a moment ago
  const p = plan.parts(now, tracker.timezone || plan.TIMEZONE);
  const recent = refs.filter((r) => tracker.slots(r.key).some((s) => s.date === p.date && s.attends !== false
    && p.minutes >= Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3)) && p.minutes <= Number(s.end.slice(0, 2)) * 60 + Number(s.end.slice(3)) + AFTER_CLASS_MS / 60000));
  if (recent.length === 1) return { ref: recent[0], how: "a lecture of this course is on right now or just ended" };
  return null;
}

function createThreadFiles({ thread, courseRoutes, coach, now = Date.now, log = () => {} }) {
  const pending = new Map(); // id -> { bytes, name, text, questionId, at }
  const context = new Map(); // "courseId/fileId" -> { text, questionId } what to tell the coach when the file is read

  const sweep = () => { for (const [id, p] of pending) if (now() - p.at > PENDING_MS) pending.delete(id); };

  function say(text, questionId, extra = {}) {
    return thread.append({ role: "assistant", text, replyTo: questionId, topic: extra.topic || "general", result: { mode: "study", answer: text, ...extra.result }, at: now() });
  }

  function file(courseId, ref, how, { bytes, name, text, questionId }) {
    const saved = courseRoutes.addUpload(courseId, bytes, name); // may throw 400/409/413/415: the caller shows the reason
    context.set(`${courseId}/${saved.id}`, { text, questionId });
    const reply = say(words(langOf(text), `Filed "${saved.name}" under ${ref.name} (I chose it from ${how}). Bot is reading it now and will tell you when it is ready.`, `תייקתי את "${saved.name}" ${bet(ref.name)} (לפי שם הקובץ או ההודעה). Bot קורא אותו עכשיו ויעדכן כשזה מוכן.`), questionId, { topic: `course:${courseId}`, result: { courseId, courseName: ref.name, fileId: saved.id } });
    return { status: "filed", courseId, fileId: saved.id, messageId: reply.id };
  }

  // ---- a ZIP: opened by unzip.js (all its limits live there), then each file takes the same road as a single upload ----
  // Every file passes the same checks (addUpload: real first bytes, 50 MB, course size, no duplicate). A file that fails is SKIPPED
  // with its reason and the others go on. Bot answers with ONE summary message. Files from a zip are read like any course file,
  // but the study coach is not asked about each one (that would be one card per file): ask Bot about a lecture afterwards.
  // What is inside the zip is untrusted data: names are only shown as text, never used as paths, never read as instructions.
  const showName = (n) => cleanName(n, "file");
  const pendingBytes = () => [...pending.values()].reduce((n, p) => n + (p.size || 0), 0);

  function zipSummary(lang, zipName, filed, skipped, waiting) {
    const extra = skipped.length > MAX_SHOWN ? skipped.length - MAX_SHOWN : 0;
    const skipLines = skipped.slice(0, MAX_SHOWN).map((s) => `- ${showName(s.name)}: ${s.reason}`).join("\n");
    const byCourse = new Map();
    for (const f of filed) byCourse.set(f.courseName, (byCourse.get(f.courseName) || 0) + 1);
    const where = [...byCourse].map(([c, n]) => `${n} ${lang === "he" ? bet(c) : `in ${c}`}`).join(", ");
    const parts = [];
    if (filed.length) parts.push(words(lang, `From "${zipName}" I filed ${filed.length} file${filed.length === 1 ? "" : "s"}: ${where}. Bot is reading them now.`, `מתוך "${zipName}" תייקתי ${filed.length} קבצים: ${where}. Bot קורא אותם עכשיו.`));
    else parts.push(words(lang, `Nothing from "${zipName}" was filed.`, `שום דבר מתוך "${zipName}" לא תויק.`));
    if (waiting) parts.push(words(lang, `${waiting} more file${waiting === 1 ? "" : "s"} wait for you: which course are they for? Tap one below. Nothing is saved until you choose.`, `עוד ${waiting} קבצים מחכים: לאיזה קורס הם שייכים? אפשר ללחוץ על אחד למטה. שום דבר לא נשמר לפני הבחירה.`));
    if (skipped.length) parts.push(words(lang, `Skipped ${skipped.length}:\n${skipLines}${extra ? `\n...and ${extra} more` : ""}`, `דולגו ${skipped.length}:\n${skipLines}${extra ? `\n...ועוד ${extra}` : ""}`));
    return parts.join("\n\n");
  }

  // Files from a zip, into one course. Adds to `filed` and `skipped`. The coach is not told (see above).
  function fileMany(courseId, courseName, items, filed, skipped) {
    for (const item of items) {
      try {
        courseRoutes.addUpload(courseId, item.bytes, item.name);
        filed.push({ name: item.name, courseName });
      } catch (error) { skipped.push({ name: item.name, reason: String(error.message).slice(0, 120) }); }
    }
  }

  function receiveZip({ bytes, name, text = "" }) {
    sweep();
    const clean = cleanName(name, "archive.zip");
    const lang = langOf(text);
    const question = thread.append({ role: "user", text: `(file attached: ${clean}) ${text}`.trim(), topic: "general", at: now() });
    let opened;
    try { opened = unzip(bytes); } catch (error) { // the whole zip is refused: the message is already in the thread, so it gets its answer
      thread.append({ role: "assistant", text: words(lang, `I did not open "${clean}": ${String(error.message).slice(0, 200)}`, `לא פתחתי את "${clean}": ${String(error.message).slice(0, 200)}`), replyTo: question.id, topic: "general", error: true, at: now() });
      throw error;
    }
    const skipped = [...opened.skipped];
    const list = courseRoutes.list();
    if (!opened.files.length || !list.length) {
      say(!list.length ? words(lang, "There are no courses yet, so I have nowhere to file these. Add a course first.", "עדיין אין קורסים, אז אין לי איפה לתייק את אלה. צריך קודם להוסיף קורס.") : zipSummary(lang, clean, [], skipped, 0), question.id);
      return { status: "no-files", questionId: question.id };
    }
    // Each file is matched to a course the way a single file is (its name, the zip's name, your words, the class on right now).
    const filed = [];
    const undecided = [];
    const groups = new Map(); // courseId -> { ref, items }
    for (const item of opened.files) {
      const choice = pickCourse({ fileName: `${clean} ${showName(item.name)}`, text, coach, courseList: list, now: now() });
      if (!choice) { undecided.push({ bytes: item.bytes, name: showName(item.name) }); continue; }
      const g = groups.get(choice.ref.courseId) || { ref: choice.ref, items: [] };
      g.items.push({ bytes: item.bytes, name: showName(item.name) });
      groups.set(choice.ref.courseId, g);
    }
    for (const [courseId, g] of groups) fileMany(courseId, g.ref.name, g.items, filed, skipped);
    let waiting = null;
    if (undecided.length) { // ONE question for all the files that no rule could place
      const id = crypto.randomBytes(8).toString("hex");
      pending.set(id, { files: undecided, zipName: clean, text, questionId: question.id, at: now(), size: undecided.reduce((n, f) => n + f.bytes.length, 0) });
      while (pending.size > 1 && (pending.size > MAX_PENDING || pendingBytes() > MAX_PENDING_BYTES)) pending.delete(pending.keys().next().value);
      waiting = { id, name: clean, courses: list, expiresAt: now() + PENDING_MS };
    }
    const reply = say(zipSummary(lang, clean, filed, skipped, undecided.length), question.id, { result: { filedCount: filed.length, skippedCount: skipped.length, ...(waiting ? { fileChoice: waiting } : {}) } });
    return { status: waiting ? "asking" : "filed", filedCount: filed.length, skippedCount: skipped.length, questionId: question.id, messageId: reply.id, ...(waiting ? { pendingId: waiting.id, courses: list } : {}) };
  }

  // The waiting files of a zip, to the course Omri tapped.
  function assignMany(pendingId, p, courseId, ref) {
    const filed = [];
    const skipped = [];
    fileMany(courseId, ref.name, p.files, filed, skipped);
    pending.delete(pendingId);
    const reply = say(zipSummary(langOf(p.text), p.zipName, filed, skipped, 0), p.questionId, { topic: `course:${courseId}`, result: { courseId, courseName: ref.name, filedCount: filed.length, skippedCount: skipped.length } });
    return { status: "filed", courseId, filedCount: filed.length, skippedCount: skipped.length, messageId: reply.id };
  }

  // The file with its message. Everything is checked here BEFORE anything is written. Returns { status: "filed" | "asking", ... }.
  function receive({ bytes, name, text = "" }) {
    if (looksLikeZip(bytes) && !sniffOffice(bytes)) return receiveZip({ bytes, name, text }); // a folder of files; a Word or PowerPoint file is ONE file
    sniffFile(bytes); // the real type; throws a 400 / 415
    sweep();
    const clean = cleanName(name);
    const question = thread.append({ role: "user", text: `(file attached: ${clean}) ${text}`.trim(), topic: "general", at: now() });
    const lang = langOf(text);
    const list = courseRoutes.list();
    if (!list.length) { say(words(lang, "There are no courses yet, so I have nowhere to file this. Add a course first.", "עדיין אין קורסים, אז אין לי איפה לתייק את זה. צריך קודם להוסיף קורס."), question.id); return { status: "no-course", questionId: question.id }; }
    const choice = pickCourse({ fileName: clean, text, coach, courseList: list, now: now() });
    if (choice) {
      try {
        return { ...file(choice.ref.courseId, choice.ref, choice.how, { bytes, name: clean, text, questionId: question.id }), questionId: question.id };
      } catch (error) { // a duplicate or a too big file: the message is already in the thread, so it gets its answer (else the next restart says "Bot was stopped")
        thread.append({ role: "assistant", text: words(lang, `I could not file "${clean}": ${String(error.message).slice(0, 200)}`, `לא הצלחתי לתייק את "${clean}": ${String(error.message).slice(0, 200)}`), replyTo: question.id, topic: "general", error: true, at: now() });
        throw error;
      }
    }
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
    const id = crypto.randomBytes(8).toString("hex");
    pending.set(id, { bytes, name: clean, text, questionId: question.id, at: now() });
    const reply = say(words(lang, `Which course is "${clean}" for? Tap one: ${list.map((c) => c.name).join(", ")}. Nothing is saved until you choose.`, `לאיזה קורס שייך "${clean}"? אפשר ללחוץ על אחד: ${list.map((c) => c.name).join(", ")}. שום דבר לא נשמר לפני הבחירה.`), question.id, { result: { fileChoice: { id, name: clean, courses: list, expiresAt: now() + PENDING_MS } } });
    return { status: "asking", pendingId: id, questionId: question.id, messageId: reply.id, courses: list };
  }

  // Omri tapped a course for a waiting file.
  function assign(pendingId, courseId) {
    sweep();
    const p = pending.get(pendingId);
    if (!p) throw Object.assign(new Error("that file is no longer waiting (30 minutes pass); send it again"), { status: 404 });
    const ref = courseRoutes.list().find((c) => c.id === courseId);
    if (!ref) throw Object.assign(new Error("course not found"), { status: 404 });
    if (p.files) return assignMany(pendingId, p, courseId, { name: ref.name });
    pending.delete(pendingId);
    try {
      return file(courseId, { name: ref.name }, "your choice", p);
    } catch (error) {
      pending.set(pendingId, p); // a refused file (duplicate, too big) can be sent to another course
      throw error;
    }
  }

  // course-routes.js calls this after a file was read. Tells the coach and puts its answer (and a Confirm card, if any) in the thread.
  async function onFileReady({ courseId, fileId }) {
    const ctx = context.get(`${courseId}/${fileId}`);
    if (!ctx) return; // a file uploaded on the Courses screen, not through the thread: the old behaviour, nothing new to say
    context.delete(`${courseId}/${fileId}`);
    const info = courseRoutes.fileInfo(courseId, fileId);
    if (!info) return;
    if (info.status === "failed" || !info.pages) { say(words(langOf(ctx.text), `I could not read "${info ? info.fileName : "the file"}". It is still in the course; you can try reading it again on the Courses screen.`, `לא הצלחתי לקרוא את "${info ? info.fileName : "הקובץ"}". הוא עדיין בקורס, ואפשר לנסות לקרוא אותו שוב במסך הקורסים.`), ctx.questionId, { topic: `course:${courseId}` }); return; }
    let r;
    // "Due next Sunday" in the message or the file: CODE turns it into a real date and tells the coach (a model never works out dates).
    const due = dueFromWords(`${ctx.text}\n${String(info.text || "").slice(0, 20000)}`, now());
    try {
      r = await coach.onUpload({ courseId, files: [{ fileId, fileName: info.fileName, pages: info.pages }], text: info.text, dateText: `${ctx.text} ${info.fileName}${due ? ` (due date worked out by Bot from the calendar: ${due})` : ""}` });
    } catch (error) {
      log(`[files] the coach failed: ${error.message}`);
      r = { answer: words(langOf(ctx.text), `"${info.fileName}" is read (${info.pages} pages). I could not decide where it belongs: ${String(error.message).slice(0, 120)}.`, `"${info.fileName}" נקרא (${info.pages} עמודים). לא הצלחתי להחליט לאן הוא שייך: ${String(error.message).slice(0, 120)}.`) };
    }
    // Several files in a row would each get the same "Which date was it?": name the file so the answers can be told apart.
    let answer = r.answer;
    if (!r.proposal && /Which date was it\?|באיזה תאריך היא הייתה\?/.test(String(answer))) answer = `"${info.fileName}": ${answer}`;
    say(answer, ctx.questionId, { topic: `course:${courseId}`, result: { courseId, ...(r.proposal ? { proposal: r.proposal } : {}) } });
  }

  return { receive, assign, onFileReady, pendingCount: () => pending.size };
}

module.exports = { createThreadFiles, pickCourse, PENDING_MS };
