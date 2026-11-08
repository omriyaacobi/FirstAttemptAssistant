// study-nudges.js
// The study line of the morning brief. CODE writes it; no model is involved and nothing is sent by a model.
//
// Rules (agreed): at most ONE nudge a day, each tied to a real date (an assignment's due date or a lecture that was held),
// quiet after TWO ignored in a row (ignored = no study activity within 24 h of the nudge), a pause switch for reserve duty,
// quiet hours (default 22:00 to 08:00, changeable), and the lock-screen push shows counts only.

const plan = require("./study-plan");
const { clean } = require("./study-tracker");

const IGNORED_LIMIT = 2;
const JUDGE_AFTER_MS = 24 * 3600 * 1000;
const DUE_SOON_DAYS = 3;
const BEHIND_AFTER_DAYS = 3;
const EXAM_SOON_DAYS = 7;

function createNudges({ tracker, courseList, now = () => Date.now(), timezone = plan.TIMEZONE }) {
  const today = () => plan.parts(now(), timezone).date;
  const refs = () => tracker.refsFor(courseList());

  // ---- settings (only these, each checked) ----
  function settings() { const s = tracker.state(); return { ...s.settings, ignoredInRow: ignoredInRow(s) }; }
  function pause(untilDate = null) {
    if (untilDate !== null && !plan.isIsoDate(untilDate)) throw new Error("that is not a real date");
    if (untilDate !== null && untilDate < today()) throw new Error("that date is in the past");
    const s = tracker.state();
    s.settings.paused = true; s.settings.pausedUntil = untilDate;
    tracker.saveState(s);
    return settings();
  }
  function resume() {
    const s = tracker.state();
    s.settings.paused = false; s.settings.pausedUntil = null;
    s.nudges = s.nudges.map((n) => ({ ...n, forgiven: true })); // coming back clears the "ignored" count
    tracker.saveState(s);
    return settings();
  }
  function setQuiet({ from, to }) {
    const ok = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!ok.test(from) || !ok.test(to)) throw new Error("times must look like 22:00");
    const s = tracker.state();
    s.settings.quiet = { from, to };
    tracker.saveState(s);
    return settings();
  }
  function isPaused(s = tracker.state()) {
    if (!s.settings.paused) return false;
    if (s.settings.pausedUntil && today() > s.settings.pausedUntil) return false; // the pause ended by itself
    return true;
  }

  // Consecutive judged nudges (newest first) with no study activity in the 24 h after them.
  function ignoredInRow(s = tracker.state()) {
    let n = 0;
    for (const nudge of [...s.nudges].reverse()) {
      if (nudge.forgiven) break;
      if (now() < nudge.at + JUDGE_AFTER_MS) continue; // too new to judge
      const acted = s.activity.some((t) => t >= nudge.at && t < nudge.at + JUDGE_AFTER_MS);
      if (acted) break;
      n++;
    }
    return n;
  }

  // ---- what could be said today, best first. Each has a date it is tied to. ----
  function candidates() {
    const out = [];
    const t = today();
    for (const ref of refs()) {
      const p = tracker.progress(ref);
      for (const a of p.assignments) {
        if (a.due && a.due >= t && plan.daysBetween(t, a.due) <= DUE_SOON_DAYS) {
          const d = plan.daysBetween(t, a.due);
          out.push({ kind: "assignment", rank: 1, ref: ref.key, date: a.due, text: `"${clean(a.title, 80)}" (${ref.name}) is due ${d === 0 ? "today" : d === 1 ? "tomorrow" : `${plan.niceDate(a.due)}, in ${d} days`}. Say "help me start ${clean(a.title, 40)}" and I will check you have what it needs.` });
        }
      }
      // The student's own words (position v2): a confirmed exam date within a week is a real date; revising or paused means no catch-up nudge.
      const mode = p.position.mode;
      if (p.position.examDate && p.position.confirmed && p.position.examDate >= t && plan.daysBetween(t, p.position.examDate) <= EXAM_SOON_DAYS) {
        const d = plan.daysBetween(t, p.position.examDate);
        out.push({ kind: "exam", rank: 1, ref: ref.key, date: p.position.examDate, text: `${ref.name}: the exam is ${d === 0 ? "today" : d === 1 ? "tomorrow" : `${plan.niceDate(p.position.examDate)}, in ${d} days`}. Say "quiz me on ${ref.name}" for a short round on what you covered.` });
      }
      const stale = mode === "revising" || mode === "paused" ? null : p.behind.find((b) => (b.hasMaterial || b.topic) && plan.daysBetween(b.date, t) >= BEHIND_AFTER_DAYS);
      if (stale) out.push({ kind: "lecture", rank: 2, ref: ref.key, date: stale.date, text: `${ref.name}: the lecture of ${plan.niceDate(stale.date)} is not checked yet. Say "quiz me on ${ref.name}" for 3 questions, or "teach me" and I explain it first.` });
      if (p.topicsDue) out.push({ kind: "review", rank: 3, ref: ref.key, date: t, text: `${ref.name}: ${p.topicsDue} topic${p.topicsDue === 1 ? " is" : "s are"} due for review today. Say "quiz me" for a short round.` });
      if (tracker.goodTimeToAsk()) {
        const empty = tracker.slotsToAskAbout(ref).filter((s) => plan.daysBetween(s.date, t) <= 10).pop();
        if (empty) out.push({ kind: "material", rank: 4, ref: ref.key, date: empty.date, text: `${ref.name}: was there a lecture on ${plan.niceDate(empty.date)}? Send me the slides or tell me the topic. If there was no class, say so ("no lecture on ${plan.niceDate(empty.date)}") and I will fix the count.` });
      }
    }
    return out.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date));
  }

  // The study part of the morning brief, or null. Records the nudge BEFORE returning, so a crash can never double it.
  function morningBlock() {
    const s = tracker.state();
    if (isPaused(s) || plan.inQuietHours(now(), s.settings.quiet, timezone)) return null;
    if (s.nudges.some((n) => n.day === today())) return null; // one a day
    const last = s.nudges[s.nudges.length - 1];
    if (ignoredInRow(s) >= IGNORED_LIMIT && !(last && s.activity.some((t) => t > last.at))) return null; // two ignored in a row: quiet until the student studies again
    const pick = candidates()[0];
    if (!pick) return null;
    s.nudges = [...s.nudges, { day: today(), at: now(), kind: pick.kind, ref: pick.ref, date: pick.date }].slice(-60);
    tracker.saveState(s);
    if (pick.kind === "material") {
      const ref = refs().find((r) => r.key === pick.ref);
      if (ref) tracker.markAsked(ref, { dates: [pick.date] }); // asked once per slot, never twice
    }
    return { text: `Study\n  ${pick.text}`, count: 1, kind: pick.kind };
  }

  // The lock screen shows counts only: never a course or an assignment name.
  const pushCount = (block) => (block ? `, ${block.count} study item` : "");

  return { settings, pause, resume, setQuiet, isPaused: () => isPaused(), candidates, morningBlock, pushCount, ignoredInRow: () => ignoredInRow() };
}

module.exports = { createNudges, IGNORED_LIMIT };
