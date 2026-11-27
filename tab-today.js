// tab-today.js
// "TODAY IN THE COURSE TABS" (2026-11-27, the course tabs; Omri asked that Main know what happened in the tabs today).
// One short line per course tab that had messages today, made by CODE from facts Bot already keeps. No model writes it:
//   - time:    the first and last message of the tab today, and the ACTIVE minutes (gaps under 20 minutes between messages)
//   - parts:   the lecture parts marked "worked on" today (lecture-parts.js, by topic: the "4.2" ids are for tools only)
//   - quiz:    the tutor session started today: "quiz 2/3", or "quiz open" / "quiz paused"
//   - lessons: how many teach_next lessons were given in the tab today
//   - plan:    exam-plan items ticked today
// Copies (copyOf) are never counted. The text goes ONLY into Main's prompt, inside its own heading, capped at MAX_CHARS. Earlier
// days are covered by the daily summary (thread-summary.js). "Worked on" is never "understood".

const MAX_CHARS = 800; // about 3 courses x 250 characters
const ACTIVE_GAP_MS = 20 * 60 * 1000;
const MAX_TOPICS = 4;

const dayKey = (ms, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const hhmm = (ms, timeZone) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const oneLine = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function activeMinutes(times) {
  let ms = 0;
  for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i - 1]; if (gap > 0 && gap < ACTIVE_GAP_MS) ms += gap; }
  return Math.max(1, Math.round(ms / 60000));
}

function usedTool(m, name) {
  const r = m.result || {};
  if (Array.isArray(r.tools) && r.tools.some((t) => t === name || (t && (t.tool === name || t.name === name)))) return true;
  return Array.isArray(m.log) && m.log.some((l) => new RegExp(`\\btool ${name}\\b`).test(String(l)));
}

function quizText(session, today, timeZone) {
  if (!session || !Array.isArray(session.questions) || !session.questions.length || session.fromTeach) return "";
  if (!Number.isFinite(session.startedAt) || dayKey(session.startedAt, timeZone) !== today) return "";
  if (session.paused) return "quiz paused";
  const graded = session.questions.filter((q) => q && ["right", "partly", "wrong"].includes(q.verdict));
  const right = graded.filter((q) => q.verdict === "right").length;
  if (session.questions.some((q) => q && q.state === "open")) return graded.length ? `quiz open (${right}/${graded.length} right so far)` : "quiz open";
  return graded.length ? `quiz ${right}/${graded.length}` : "";
}

// messages: today's thread messages (any order). courses: [{ id, name }]. recordOf(courseId): { worked, session, planItems } or null.
function todayText({ messages = [], courses = [], recordOf = () => null, now = Date.now(), timeZone = "Asia/Jerusalem", maxChars = MAX_CHARS } = {}) {
  const today = dayKey(now, timeZone);
  const lines = [];
  for (const c of courses) {
    const place = `course:${c.id}`;
    const mine = messages.filter((m) => m && m.place === place && !m.copyOf && !m.error && !m.ack && Number.isFinite(m.at) && m.at <= now && dayKey(m.at, timeZone) === today).sort((a, b) => a.at - b.at);
    if (!mine.length) continue;
    const times = mine.map((m) => m.at);
    const parts = [`${oneLine(c.name, 80)} tab: ${hhmm(times[0], timeZone)}-${hhmm(times[times.length - 1], timeZone)} (${activeMinutes(times)} min active)`];
    let rec = null;
    try { rec = recordOf(c.id); } catch (error) { rec = null; }
    if (rec && rec.worked && typeof rec.worked === "object") {
      const topics = [...new Set(Object.values(rec.worked).flat().filter((w) => w && Number.isFinite(w.at) && dayKey(w.at, timeZone) === today).sort((a, b) => a.at - b.at).map((w) => oneLine(w.topic, 60)).filter(Boolean))];
      if (topics.length) parts.push(`worked on: ${topics.slice(0, MAX_TOPICS).join(", ")}${topics.length > MAX_TOPICS ? ` and ${topics.length - MAX_TOPICS} more` : ""}`);
    }
    const quiz = rec ? quizText(rec.session, today, timeZone) : "";
    if (quiz) parts.push(quiz);
    const lessons = mine.filter((m) => m.role === "assistant" && usedTool(m, "teach_next")).length;
    if (lessons) parts.push(`${lessons} lesson${lessons > 1 ? "s" : ""}`);
    const ticked = rec && Array.isArray(rec.planItems) ? rec.planItems.filter((i) => i && i.done && Number.isFinite(i.doneAt) && dayKey(i.doneAt, timeZone) === today).length : 0;
    if (ticked) parts.push(`${ticked} exam-plan item${ticked > 1 ? "s" : ""} ticked`);
    lines.push(parts.join("; ") + ".");
  }
  const out = [];
  let used = 0;
  for (const line of lines) {
    const l = line.length > maxChars ? line.slice(0, maxChars - 1) + "…" : line;
    if (used + l.length + 1 > maxChars) break;
    out.push(l);
    used += l.length + 1;
  }
  return out.join("\n");
}

module.exports = { todayText, activeMinutes, MAX_CHARS, ACTIVE_GAP_MS };
