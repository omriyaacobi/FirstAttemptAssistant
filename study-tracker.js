// study-tracker.js
// What Bot knows about how the semester is going. WRITTEN ONLY BY CODE: a model may propose (a topic, a verdict, an assignment),
// code checks it, and only then does it land here. Nothing in this file is ever set because the student said "I understand".
//
// Files, inside the folder given to createTracker (data/study/, git-ignored):
//   timetable.json     the weekly timetable (study-plan.js has the default; this file wins)
//   state.json         skips (cancelled classes), settings (pause, quiet hours) and the nudge log
//   <key>.json         one course: position, lectures (by date), assignments, topic boxes, the running tutor session
//
// Words: a "lecture" is one held class, named by its DATE (numbers can shift when a class is cancelled). "Understood" needs
// a real check: at least 3 different questions in one check, a score of 70% or more, a revealed answer counts as wrong.

const fs = require("node:fs");
const path = require("node:path");
const plan = require("./study-plan");

const KEY_PATTERN = /^[a-z0-9-]{1,40}$/;
const BOX_DAYS = [1, 2, 4, 8, 16]; // Leitner boxes: how many days until the next review, by box
const MIN_QUESTIONS = 3;
const PASS_SCORE = 0.7;
const GRACE_DAYS = 2; // a lecture held in the last 2 days is "fresh", not "behind"
const MAX_ASSIGNMENTS = 40;
const MAX_TEXT = 8000;
const MAX_NOTES = 5;
const SAID_MAX = 300;
const clean = (s, n = 200) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

function createTracker({ dir, now = () => Date.now(), timezone = plan.TIMEZONE } = {}) {
  if (!dir) throw new Error("createTracker needs a folder");
  fs.mkdirSync(dir, { recursive: true });

  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; } };
  const writeJson = (file, data) => { const temp = file + ".tmp"; fs.writeFileSync(temp, JSON.stringify(data, null, 1)); fs.renameSync(temp, file); };
  const today = () => plan.parts(now(), timezone).date;

  // ---- timetable and state ----
  function timetable() {
    const file = path.join(dir, "timetable.json");
    const saved = plan.cleanTimetable(readJson(file));
    if (saved) return saved;
    const fresh = plan.cleanTimetable(plan.DEFAULT_TIMETABLE);
    writeJson(file, fresh);
    return fresh;
  }
  const stateFile = path.join(dir, "state.json");
  const DEFAULT_STATE = { skips: [], settings: { paused: false, pausedUntil: null, quiet: { ...plan.DEFAULT_QUIET } }, nudges: [], lastActivity: 0, activity: [] };
  function state() {
    const s = readJson(stateFile) || {};
    return {
      skips: Array.isArray(s.skips) ? s.skips.filter((k) => plan.isIsoDate(k.date) && typeof k.course === "string") : [],
      settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}), quiet: { ...DEFAULT_STATE.settings.quiet, ...((s.settings || {}).quiet || {}) } },
      nudges: Array.isArray(s.nudges) ? s.nudges.slice(-60) : [],
      lastActivity: Number(s.lastActivity) || 0,
      activity: Array.isArray(s.activity) ? s.activity.filter(Number.isFinite).slice(-100) : [],
    };
  }
  const saveState = (s) => writeJson(stateFile, s);

  // ---- skips (cancelled classes, holidays) ----
  function addSkip({ date, course = "*" }) {
    if (!plan.isIsoDate(date)) throw new Error("that is not a real date");
    const keys = timetable().courses.map((c) => c.key);
    if (course !== "*" && !keys.includes(course)) throw new Error("unknown course");
    const s = state();
    if (!s.skips.some((k) => k.date === date && k.course === course)) s.skips.push({ date, course });
    saveState(s);
    return s.skips;
  }
  function removeSkip({ date, course = "*" }) {
    const s = state();
    s.skips = s.skips.filter((k) => !(k.date === date && k.course === course));
    saveState(s);
    return s.skips;
  }
  // "No lecture this week": every lecture slot of that course in the week (Sunday to Saturday) of refDate. Returns the dates skipped.
  function skipWeek(course, refDate = today()) {
    const start = plan.weekStart(refDate);
    const all = plan.slotsOf(timetable(), course, []).filter((x) => x.date >= start && x.date <= plan.addDays(start, 6));
    for (const slot of all) addSkip({ date: slot.date, course });
    return all.map((x) => x.date);
  }

  // ---- one course ----
  const fileOf = (key) => { if (!KEY_PATTERN.test(key)) throw new Error("bad course key"); return path.join(dir, key + ".json"); };
  function course(ref) {
    const saved = readJson(fileOf(ref.key));
    const base = { key: ref.key, courseId: ref.courseId || null, name: clean(ref.name || ref.key, 100), position: { known: false, seenThrough: null, note: "", at: 0 }, askedPosition: 0, askedSlots: {}, lectures: {}, assignments: [], topics: {}, session: null };
    const c = { ...base, ...(saved || {}) };
    if (ref.courseId) c.courseId = ref.courseId;
    if (ref.name) c.name = clean(ref.name, 100);
    return c;
  }
  const save = (c) => writeJson(fileOf(c.key), c);

  // The courses.js course list -> refs { key, courseId, name } (key from the timetable, or "c-<id>" for a course outside it).
  function refsFor(courseList) {
    const t = timetable();
    return courseList.map((c) => ({ key: plan.courseKeyFor(t, c.name) || `c-${String(c.id).slice(0, 12)}`, courseId: c.id, name: c.name }));
  }

  const slots = (key) => plan.slotsOf(timetable(), key, state().skips);
  const slotOn = (key, date) => slots(key).find((s) => s.date === date) || null;

  // ---- where the student is ----
  // Only these three facts are ever accepted: a date (a real lecture date), a lecture number, or a topic note.
  // `said` is the student's own words (control characters removed, 300 characters at most). It is kept next to whatever code could place.
  // Alone it still makes the position "known" (so Bot does not ask the same question again), but it never places anything by itself.
  function setPosition(ref, { date, n, note, said } = {}) {
    const c = course(ref);
    const all = slots(ref.key);
    let seenThrough = null;
    if (date !== undefined) {
      if (!plan.isIsoDate(date)) throw new Error("that is not a real date");
      seenThrough = [...all].reverse().find((s) => s.date <= date && plan.isHeld(s, now(), timezone));
      if (!seenThrough) throw new Error("no held lecture on or before that date");
    } else if (n !== undefined) {
      seenThrough = all.find((s) => s.n === Number(n) && plan.isHeld(s, now(), timezone));
      if (!seenThrough) throw new Error("there is no held lecture with that number");
    } else if (!note && !clean(said, SAID_MAX)) throw new Error("say a date, a lecture number or a topic");
    const { said: oldWords, ...before } = c.position; // an older sentence never stays next to a newer position
    c.position = { ...before, known: true, seenThrough: seenThrough ? seenThrough.date : c.position.seenThrough, note: clean(note || c.position.note, 200), at: now() };
    if (clean(said, SAID_MAX)) c.position.said = clean(said, SAID_MAX);
    save(c);
    return c.position;
  }

  // ---- material ----
  // material: [{ fileId, from, to, fileName? }]. A date must be a real lecture slot of this course (held or in the future).
  function attachMaterial(ref, date, material, { assumed = false, topic = "" } = {}) {
    if (!slotOn(ref.key, date)) throw new Error("that date is not one of the lecture days of this course");
    const refs = (material || []).filter((m) => m && typeof m.fileId === "string" && Number.isInteger(m.from) && Number.isInteger(m.to) && m.from >= 1 && m.to >= m.from).map((m) => ({ fileId: m.fileId, from: m.from, to: m.to, fileName: clean(m.fileName || "", 120) }));
    const c = course(ref);
    const l = c.lectures[date] || { date, material: [], topic: "", assumed: false, checks: [], understood: false, taught: 0 };
    if (refs.length) { l.material = refs; l.assumed = assumed; }
    if (topic) l.topic = clean(topic, 120);
    c.lectures[date] = l;
    save(c);
    return l;
  }
  // Notebook lecture k -> the k-th slot of the course. Only for a course that already has all its lectures (Calculus 2). ASSUMED: it says so.
  // index: study.lectureIndex(pages) -> [{ lecture, fileId, from, to }]. Never overwrites a lecture that already has material.
  function alignNotebook(ref, index) {
    const all = slots(ref.key);
    const c = course(ref);
    let placed = 0;
    for (const entry of index) {
      const slot = all.find((s) => s.n === entry.lecture);
      if (!slot) continue;
      const l = c.lectures[slot.date] || { date: slot.date, material: [], topic: "", assumed: false, checks: [], understood: false, taught: 0 };
      if (l.material.length) continue;
      l.material = [{ fileId: entry.fileId, from: entry.from, to: entry.to, fileName: "" }];
      l.assumed = true;
      c.lectures[slot.date] = l;
      placed++;
    }
    if (placed) save(c);
    return placed;
  }
  // Material arrived with no date: which slot is it most likely? The most recent HELD slot with no material. Only a PROPOSAL.
  function suggestSlot(ref) {
    const c = course(ref);
    const held = [...slots(ref.key)].filter((s) => plan.isHeld(s, now(), timezone)).reverse();
    return held.find((s) => !(c.lectures[s.date] && c.lectures[s.date].material.length)) || null;
  }
  // Held slots with nothing at all (no material, no topic). The ask rule: once per slot, not in quiet hours, not during a class.
  function slotsToAskAbout(ref) {
    const c = course(ref);
    const s = state();
    return slots(ref.key).filter((x) => plan.isHeld(x, now(), timezone) && x.attends && !(c.lectures[x.date] && (c.lectures[x.date].material.length || c.lectures[x.date].topic)) && !c.askedSlots[x.date]);
  }
  const goodTimeToAsk = () => !plan.inQuietHours(now(), state().settings.quiet, timezone) && !plan.inClass(timetable(), now(), timezone);
  function markAsked(ref, { dates = [], position = false } = {}) {
    const c = course(ref);
    for (const d of dates) c.askedSlots[d] = now();
    if (position) c.askedPosition = now();
    save(c);
  }

  // ---- assignments ----
  // Already checked by tutor.checkAssignment. status: todo | started | done.
  function addAssignment(ref, a) {
    const c = course(ref);
    if (c.assignments.length >= MAX_ASSIGNMENTS) throw new Error("too many assignments saved");
    const item = { id: `a${now().toString(36)}${c.assignments.length}`, title: clean(a.title, 120), due: plan.isIsoDate(a.due) ? a.due : null, status: "todo", needs: (a.needs || []).slice(0, 8).map((x) => clean(x, 120)).filter(Boolean), text: clean(a.text || "", MAX_TEXT), created: now() };
    if (!item.title) throw new Error("the assignment needs a title");
    c.assignments.push(item);
    save(c);
    return item;
  }
  function setAssignment(ref, id, patch) {
    const c = course(ref);
    const a = c.assignments.find((x) => x.id === id);
    if (!a) throw new Error("no such assignment");
    if (patch.status !== undefined) { if (!["todo", "started", "done"].includes(patch.status)) throw new Error("bad status"); a.status = patch.status; }
    if (patch.due !== undefined) { if (!plan.isIsoDate(patch.due)) throw new Error("that is not a real date"); a.due = patch.due; }
    save(c);
    return a;
  }

  // ---- real checks: the ONLY way a topic or a lecture becomes "understood" ----
  // results: [{ topic: "<name>", verdict: "right"|"partly"|"wrong" }] for DISTINCT questions already graded and validated by tutor.js.
  // target: { type: "lecture", date } or { type: "assignment", id }.
  function recordCheck(ref, target, results) {
    const c = course(ref);
    const valid = results.filter((r) => r && ["right", "partly", "wrong"].includes(r.verdict));
    const total = valid.length;
    const score = total ? valid.reduce((a, r) => a + (r.verdict === "right" ? 1 : r.verdict === "partly" ? 0.5 : 0), 0) / total : 0;
    for (const r of valid) {
      const id = `t_${(target.date || target.id || "x")}_${clean(r.topic || "general", 60).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "general"}`;
      const t = c.topics[id] || { name: clean(r.topic || "general", 80), box: 1, lastAt: 0, nextDue: null, seen: 0, right: 0, wrong: 0, notes: [] };
      t.seen++;
      if (r.verdict === "right") { t.right++; t.box = Math.min(5, t.box + 1); } else if (r.verdict === "wrong") { t.wrong++; t.box = 1; if (r.note) t.notes = [...t.notes, { at: now(), text: clean(r.note, 160) }].slice(-MAX_NOTES); }
      t.lastAt = now();
      t.nextDue = plan.addDays(today(), r.verdict === "partly" ? 1 : BOX_DAYS[t.box - 1]);
      c.topics[id] = t;
    }
    let understood = false;
    if (target.type === "lecture" && plan.isIsoDate(target.date) && total >= MIN_QUESTIONS) {
      const l = c.lectures[target.date] || { date: target.date, material: [], topic: "", assumed: false, checks: [], understood: false, taught: 0 };
      understood = score >= PASS_SCORE;
      l.checks = [...l.checks, { at: now(), total, score: Number(score.toFixed(2)) }].slice(-10);
      if (understood) l.understood = true;
      c.lectures[target.date] = l;
    }
    save(c);
    markActivity();
    return { total, score, understood };
  }
  function markTaught(ref, date) {
    const c = course(ref);
    const l = c.lectures[date] || { date, material: [], topic: "", assumed: false, checks: [], understood: false, taught: 0 };
    l.taught = now();
    c.lectures[date] = l;
    save(c);
    markActivity();
  }
  function markActivity() { const s = state(); s.lastActivity = now(); s.activity = [...s.activity, now()].slice(-100); saveState(s); } // a study moment: a tutor turn, a graded check

  // ---- the tutor session (one per course, kept between messages) ----
  const getSession = (ref) => course(ref).session;
  function setSession(ref, session) { const c = course(ref); c.session = session; save(c); if (session) markActivity(); }

  // ---- progress: the numbers, all from code ----
  function progress(ref) {
    const c = course(ref);
    const all = slots(ref.key);
    const held = all.filter((s) => plan.isHeld(s, now(), timezone));
    const lecture = (s) => c.lectures[s.date] || null;
    const withMaterial = held.filter((s) => lecture(s) && lecture(s).material.length);
    const understood = held.filter((s) => lecture(s) && lecture(s).understood);
    const behind = held.filter((s) => !(lecture(s) && lecture(s).understood) && plan.daysBetween(s.date, today()) > GRACE_DAYS);
    const due = Object.values(c.topics).filter((t) => t.nextDue && t.nextDue <= today());
    const assignments = c.assignments.filter((a) => a.status !== "done").sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
    return {
      key: ref.key, name: c.name, courseId: c.courseId, tracked: all.length > 0,
      held: held.length, upcomingTotal: all.length, withMaterial: withMaterial.length, understood: understood.length,
      behind: behind.map((s) => ({ date: s.date, n: s.n, hasMaterial: !!(lecture(s) && lecture(s).material.length), topic: lecture(s) ? lecture(s).topic : "" })),
      position: c.position, positionKnown: c.position.known, topicsDue: due.length, assignments,
    };
  }

  return { timetable, state, saveState, addSkip, removeSkip, skipWeek, course, save, refsFor, slots, slotOn, setPosition, attachMaterial, alignNotebook, suggestSlot, slotsToAskAbout, goodTimeToAsk, markAsked, addAssignment, setAssignment, recordCheck, markTaught, markActivity, getSession, setSession, progress, today };
}

module.exports = { createTracker, BOX_DAYS, MIN_QUESTIONS, PASS_SCORE, GRACE_DAYS, clean };
