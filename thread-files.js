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

const crypto = require("node:crypto");
const plan = require("./study-plan");
const { sniffFile, cleanName } = require("./upload");

const PENDING_MS = 30 * 60 * 1000;
const MAX_PENDING = 5;
const AFTER_CLASS_MS = 3 * 3600 * 1000;

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
    const reply = say(`Filed "${saved.name}" under ${ref.name} (I chose it from ${how}). Bot is reading it now and will tell you when it is ready.`, questionId, { topic: `course:${courseId}`, result: { courseId, courseName: ref.name, fileId: saved.id } });
    return { status: "filed", courseId, fileId: saved.id, messageId: reply.id };
  }

  // The file with its message. Everything is checked here BEFORE anything is written. Returns { status: "filed" | "asking", ... }.
  function receive({ bytes, name, text = "" }) {
    sniffFile(bytes); // the real type; throws a 400 / 415
    sweep();
    const clean = cleanName(name);
    const question = thread.append({ role: "user", text: `(file attached: ${clean}) ${text}`.trim(), topic: "general", at: now() });
    const list = courseRoutes.list();
    if (!list.length) { say("There are no courses yet, so I have nowhere to file this. Add a course first.", question.id); return { status: "no-course", questionId: question.id }; }
    const choice = pickCourse({ fileName: clean, text, coach, courseList: list, now: now() });
    if (choice) {
      try {
        return { ...file(choice.ref.courseId, choice.ref, choice.how, { bytes, name: clean, text, questionId: question.id }), questionId: question.id };
      } catch (error) { // a duplicate or a too big file: the message is already in the thread, so it gets its answer (else the next restart says "Bot was stopped")
        thread.append({ role: "assistant", text: `I could not file "${clean}": ${String(error.message).slice(0, 200)}`, replyTo: question.id, topic: "general", error: true, at: now() });
        throw error;
      }
    }
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
    const id = crypto.randomBytes(8).toString("hex");
    pending.set(id, { bytes, name: clean, text, questionId: question.id, at: now() });
    const reply = say(`Which course is "${clean}" for? Tap one: ${list.map((c) => c.name).join(", ")}. Nothing is saved until you choose.`, question.id, { result: { fileChoice: { id, name: clean, courses: list, expiresAt: now() + PENDING_MS } } });
    return { status: "asking", pendingId: id, questionId: question.id, messageId: reply.id, courses: list };
  }

  // Omri tapped a course for a waiting file.
  function assign(pendingId, courseId) {
    sweep();
    const p = pending.get(pendingId);
    if (!p) throw Object.assign(new Error("that file is no longer waiting (30 minutes pass); send it again"), { status: 404 });
    const ref = courseRoutes.list().find((c) => c.id === courseId);
    if (!ref) throw Object.assign(new Error("course not found"), { status: 404 });
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
    if (info.status === "failed" || !info.pages) { say(`I could not read "${info ? info.fileName : "the file"}". It is still in the course; you can try reading it again on the Courses screen.`, ctx.questionId, { topic: `course:${courseId}` }); return; }
    let r;
    try {
      r = await coach.onUpload({ courseId, files: [{ fileId, fileName: info.fileName, pages: info.pages }], text: info.text, dateText: `${ctx.text} ${info.fileName}` });
    } catch (error) {
      log(`[files] the coach failed: ${error.message}`);
      r = { answer: `"${info.fileName}" is read (${info.pages} pages). I could not decide where it belongs: ${String(error.message).slice(0, 120)}.` };
    }
    say(r.answer, ctx.questionId, { topic: `course:${courseId}`, result: { courseId, ...(r.proposal ? { proposal: r.proposal } : {}) } });
  }

  return { receive, assign, onFileReady, pendingCount: () => pending.size };
}

module.exports = { createThreadFiles, pickCourse, PENDING_MS };
