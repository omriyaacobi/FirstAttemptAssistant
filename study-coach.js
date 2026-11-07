// study-coach.js
// The one door to the study coach. Three things are meant to be connected from outside (see PROGRESS.md, "Study coach"):
//
//   coach.studyLine()                one short code-written line for the front desk prompt ("" when there is nothing to say)
//   coach.answerStudy({...})         answers a message the front desk marked with a studyIntent
//   coach.morningBlock()             the study line of the morning brief (also given to createMorning as `study`)
//   coach.onUpload({...})            material or an assignment arrived: returns a PROPOSAL (nothing is saved until confirmed)
//   coach.confirmProposal(id) / cancelProposal(id)
//
// Everything that decides or counts is code (study-plan.js, study-tracker.js). Models (Argon only) are used for teaching, writing
// questions, grading and reading an assignment, always through tutor.js and always checked by code.

const plan = require("./study-plan");
// The language of the reply being written (Hebrew when the student wrote Hebrew); only the DATES change with it (study-plan.niceDate).
let curLang = "en";
const niceDate = (iso) => plan.niceDate(iso, curLang);
const { createTracker, clean } = require("./study-tracker");
const { checkPositions, proposePositions } = require("./study-positions");
const { createNudges } = require("./study-nudges");
const tutor = require("./tutor");
const { lectureIndex, askedLectures } = require("./study");

const INTENTS = ["teach", "start", "quiz", "answer", "progress", "plan", "update", "assignment", "motivate", "pause", "resume", "confirm", "cancel"];
const PROPOSAL_MS = 12 * 3600 * 1000; // proposals live in memory for 12 hours
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYWORDS = { sunday: 0, sun: 0, "ראשון": 0, monday: 1, mon: 1, "שני": 1, tuesday: 2, tue: 2, "שלישי": 2, wednesday: 3, wed: 3, "רביעי": 3, thursday: 4, thu: 4, "חמישי": 4, friday: 5, fri: 5, "שישי": 5 };
const SKIP_WORDS = /\bno\b[^.\n]{0,40}\b(?:lecture|class(?:es)?|lesson|university|school)|(?:lecture|class(?:es)?|lesson)s?\s+(?:is\s+|was\s+|were\s+|got\s+)?(?:cancel+ed)|cancel+ed|אין\s+(?:הרצאה|שיעור|לימודים)|בוטל/i;
const UNDO_WORDS = /\bthere\s+(?:was|is)\b[^.\n]{0,40}\b(?:lecture|class)|הייתה\s+הרצאה/i;
const POSITION_WORDS = /\b(?:last|latest)\s+(?:lecture|class)|\b(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:at|up\s+to|on)\b|\bup\s+to\s+lecture|\bthrough\s+lecture|\bi\s+(?:have\s+)?(?:watched|attended|finished|studied)|הרצאה\s+אחרונה|אני\s+ב/i;

function createStudyCoach({ dir, courses, askChain, now = () => Date.now(), timezone = plan.TIMEZONE, log = () => {} }) {
  const tracker = createTracker({ dir, now, timezone });
  const nudges = createNudges({ tracker, courseList: () => courses.list(), now, timezone });
  const proposals = new Map();
  let proposalCounter = 0;
  const today = () => plan.parts(now(), timezone).date;
  const refs = () => tracker.refsFor(courses.list());
  const tracked = (ref) => tracker.slots(ref.key).length > 0;

  // ---- the line for the front desk ----
  function studyLine() {
    try {
      const out = [];
      for (const ref of refs().filter(tracked)) {
        const p = tracker.progress(ref);
        const due = p.assignments.filter((a) => a.due && plan.daysBetween(today(), a.due) >= 0 && plan.daysBetween(today(), a.due) <= 7);
        out.push(`${ref.name}: ${p.held} lectures held, ${p.understood} checked as understood, ${p.behind.length} behind${p.positionKnown ? "" : ", student's position unknown"}${due.length ? `, due soon: ${due.map((a) => `${clean(a.title, 40)} ${a.due}`).join(", ")}` : ""}`);
      }
      return out.length ? `Study (from the tracker, today ${today()}): ${out.join(" | ")}` : "";
    } catch (error) {
      log(`[study] study line failed: ${error.message}`);
      return ""; // the front desk must never fail because of this
    }
  }

  // ---- finding the course of a message ----
  function resolveRef(text, courseId, courseName) {
    const all = refs();
    if (courseId) { const r = all.find((x) => x.courseId === courseId); if (r) return r; }
    const t = tracker.timetable();
    const probe = [courseName, text].filter(Boolean).join(" ");
    const key = plan.courseKeyFor(t, probe);
    const byKey = key && all.find((r) => r.key === key);
    if (byKey) return byKey;
    const byName = all.find((r) => r.name && probe.toLowerCase().includes(r.name.toLowerCase()));
    if (byName) return byName;
    const withSession = all.filter((r) => tracker.getSession(r));
    return withSession.length === 1 ? withSession[0] : null;
  }
  const whichCourse = () => `Which course do you mean? ${refs().map((r) => r.name).join(", ")}.`;

  // Course with all its lectures already uploaded (Calculus 2): notebook lecture k is ASSUMED to be the k-th class. Once, and it says so.
  function maybeAlign(ref) {
    const c = tracker.course(ref);
    if (c.aligned || !ref.courseId) return "";
    const index = lectureIndex(courses.allPages(ref.courseId));
    const held = tracker.progress(ref).held;
    if (!index.length || index.length <= held) return ""; // fewer notebook lectures than classes held: material arrives week by week
    const placed = tracker.alignNotebook(ref, index);
    tracker.save({ ...tracker.course(ref), aligned: true });
    return placed ? `\n\n(Note: all ${ref.name} lectures are uploaded, so I assumed notebook lecture k is the k-th class by the timetable. If a class was cancelled or the numbers do not match, tell me.)` : "";
  }

  // ---- progress ----
  function courseLines(ref) {
    const p = tracker.progress(ref);
    const lines = [`${ref.name}: ${p.held} lecture${p.held === 1 ? "" : "s"} held so far by the timetable${tracker.state().skips.some((s) => s.course === ref.key || s.course === "*") ? " (cancelled ones removed)" : ""}.`];
    lines.push(`  Material in Bot for ${p.withMaterial} of them. Checked as understood (3+ questions, 70%+): ${p.understood}.`);
    if (p.behind.length) lines.push(`  Behind on ${p.behind.length}: ${p.behind.slice(0, 4).map((b) => `lecture ${b.n} (${niceDate(b.date)})${b.hasMaterial || b.topic ? "" : ", no material yet"}`).join("; ")}${p.behind.length > 4 ? "; ..." : ""}.`);
    else if (p.held) lines.push("  Nothing behind by the timetable.");
    if (!p.positionKnown) lines.push("  I do not know where you are in this course yet.");
    else lines.push(`  You told me you are up to ${p.position.seenThrough ? niceDate(p.position.seenThrough) : "a topic"}${p.position.note ? ` (${clean(p.position.note, 60)})` : ""}.`);
    for (const a of p.assignments.slice(0, 3)) lines.push(`  Assignment "${clean(a.title, 60)}": ${a.status}${a.due ? `, due ${niceDate(a.due)}` : ", no due date saved"}.`);
    return lines.join("\n");
  }
  function positionQuestion(list) {
    const unknown = list.filter((r) => !tracker.progress(r).positionKnown);
    if (!unknown.length) return "";
    return `\n\nSo that I do not guess: ${unknown.length === 1 ? "where are you in " + unknown[0].name : "where are you in " + unknown.map((r) => r.name).join(", ")}? Tell me the last lecture you went through: a date ("Thursday"), a number ("lecture 4") or a topic. I will not mark anything as understood from this: that only happens when you answer my questions.`;
  }
  function nextStep(ref) {
    const p = tracker.progress(ref);
    const a = p.assignments.find((x) => x.due && plan.daysBetween(today(), x.due) >= 0 && plan.daysBetween(today(), x.due) <= 7);
    if (a) return `The next step with a real date: "${clean(a.title, 60)}" is due ${niceDate(a.due)}. Say "help me start" and I check what it needs.`;
    const b = p.behind.find((x) => x.hasMaterial || x.topic);
    if (b) return `The smallest next step: lecture ${b.n} (${niceDate(b.date)}) of ${ref.name}. "Teach me" and I explain it, or "quiz me" and you try first.`;
    const empty = p.behind.find((x) => !x.hasMaterial && !x.topic);
    if (empty) return `Lecture ${empty.n} of ${ref.name} (${niceDate(empty.date)}) has nothing in Bot yet. Send the slides or tell me its topic, and we can start.`;
    return p.held ? `${ref.name} is on track by the timetable. A 3-question review keeps it that way: "quiz me".` : `${ref.name} has no lectures held yet.`;
  }

  // ---- chat corrections: dates, skips, positions (code only; a model is never asked to write a date) ----
  function parseDay(seg, mode) {
    const t = today();
    const low = seg.toLowerCase();
    const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(low);
    if (iso && plan.isIsoDate(iso[1])) return { date: iso[1] };
    const dm = /\b(\d{1,2})[/.](\d{1,2})\b(?![/.]\d)/.exec(low);
    const mk = (month, day) => { const y = month < 7 ? 2027 : 2026; const d = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; return plan.isIsoDate(d) ? { date: d } : null; };
    if (dm) { const r = mk(Number(dm[2]), Number(dm[1])); if (r) return r; }
    const mn = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/.exec(low);
    if (mn) { const r = mk(MONTHS[mn[2] || mn[3]], Number(mn[1] || mn[4])); if (r) return r; }
    if (/\btoday\b|היום/.test(low)) return { date: t };
    if (/\byesterday\b|אתמול/.test(low)) return { date: plan.addDays(t, -1) };
    if (/this\s+week|השבוע/.test(low)) return { week: true };
    for (const m of low.matchAll(/[\p{L}]+/gu)) {
      if (!Object.hasOwn(DAYWORDS, m[0])) continue;
      const wd = DAYWORDS[m[0]];
      if (mode === "past") { for (let i = 0; i < 7; i++) { const d = plan.addDays(t, -i); if (plan.weekdayOf(d) === wd) return { date: d }; } } else return { date: plan.addDays(plan.weekStart(t), wd) };
    }
    return null;
  }
  function interpretUpdate(text) {
    const all = refs();
    const t = tracker.timetable();
    const lines = [];
    const unclear = [];
    const segments = String(text).split(/\n|;|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const key = plan.courseKeyFor(t, seg);
      const ref = key && all.find((r) => r.key === key);
      const undo = UNDO_WORDS.test(seg);
      if (SKIP_WORDS.test(seg) || undo) {
        const day = parseDay(seg, "week");
        const course = ref ? ref.key : /classes|university|school|לימודים/i.test(seg) ? "*" : null;
        if (!day || !course) { unclear.push(seg); continue; }
        if (undo) { const d = day.date || null; if (!d) { unclear.push(seg); continue; } tracker.removeSkip({ date: d, course }); lines.push(`Put the ${ref ? ref.name + " " : ""}lecture on ${niceDate(d)} back in the count.`); continue; }
        if (day.date && ref && !tracker.slots(ref.key).some((x) => x.date === day.date)) { lines.push(`${ref.name} has no lecture on ${niceDate(day.date)} by the timetable, so nothing changed.`); continue; }
        const dates = day.week ? (course === "*" ? all.filter(tracked).flatMap((r) => tracker.skipWeek(r.key)) : tracker.skipWeek(course)) : [tracker.addSkip({ date: day.date, course }) && day.date];
        lines.push(dates.length ? `Removed ${ref ? ref.name : "every course"}: ${[...new Set(dates)].sort().map((d) => niceDate(d)).join(", ")}. The lecture numbers after it moved up. (Say "there was a lecture on <day>" to undo.)` : `${ref ? ref.name : "That"} has no lecture that day, so nothing changed.`);
        continue;
      }
      if (POSITION_WORDS.test(seg) || (ref && (askedLectures(seg).length || parseDay(seg, "past")))) {
        if (!ref) { unclear.push(seg); continue; }
        const n = askedLectures(seg)[0];
        const day = n ? null : parseDay(seg, "past");
        try {
          const pos = n ? tracker.setPosition(ref, { n }) : day && day.date ? tracker.setPosition(ref, { date: day.date }) : tracker.setPosition(ref, { note: seg });
          lines.push(`${ref.name}: noted that you are up to ${pos.seenThrough ? niceDate(pos.seenThrough) : clean(pos.note, 60)}. That tells me where you are, not what you understood: that comes from questions.`);
        } catch (error) { lines.push(`${ref.name}: ${error.message}.`); }
        continue;
      }
      unclear.push(seg);
    }
    return { lines, unclear };
  }

  // ---- several courses in one message ("calc lecture 4, algo I'm up to date, systems I haven't started") ----
  // The model proposes one entry per course it sees; code checks each (study-positions.js) and writes it. The answer lists EVERY tracked course with what
  // is stored now, so a misreading is easy to spot. Returns null when the model gave nothing usable (the plain rules then try the message).
  async function interpretPositions(text) {
    const list = refs().filter(tracked);
    if (list.length < 2) return null;
    let raw = null;
    try { raw = await proposePositions({ askChain, text, refs: list, today: today(), log }); } catch (error) { log(`[positions] failed: ${error.message}`); return null; }
    const heldOf = (ref) => tracker.slots(ref.key).filter((x) => plan.isHeld(x, now(), timezone));
    const { items, problems } = checkPositions(raw, list, heldOf, today());
    if (!items.length && !problems.length) return null;
    const stored = new Map();
    for (const it of items) {
      try {
        if (it.kind === "notStarted") { const c = tracker.course(it.ref); c.position = { known: true, seenThrough: null, note: "not started yet", at: now() }; tracker.save(c); stored.set(it.ref.key, "not started yet"); }
        else { tracker.setPosition(it.ref, { n: it.slot.n }); stored.set(it.ref.key, `up to lecture ${it.slot.n} (${niceDate(it.slot.date)})${it.kind === "upToDate" ? ", the latest one held" : ""}`); }
      } catch (error) { problems.push(`${it.ref.name}: ${error.message}.`); }
    }
    const lines = list.map((r) => {
      if (stored.has(r.key)) return `${r.name}: ${stored.get(r.key)}.`;
      const p = tracker.progress(r);
      return p.positionKnown ? `${r.name}: you did not mention it, so it stays as it was (${p.position.seenThrough ? "up to " + niceDate(p.position.seenThrough) : p.position.note || "set"}).` : `${r.name}: you did not say, so I still do not know where you are.`;
    });
    return [`Here is exactly what I stored (today is ${niceDate(today())}):`, ...lines, ...problems, "If one is wrong, tell me that course again, for example \"Calculus lecture 5\". This only says where you are, not what you understood."].join("\n");
  }

  // ---- proposals (model proposes, code checks, the student confirms) ----
  function addProposal(p) {
    const id = `p${++proposalCounter}${now().toString(36)}`;
    const item = { id, createdAt: now(), expiresAt: now() + PROPOSAL_MS, ...p };
    proposals.set(id, item);
    for (const [k, v] of proposals) if (v.expiresAt < now()) proposals.delete(k);
    return item;
  }
  const latestProposal = () => [...proposals.values()].filter((p) => p.expiresAt >= now()).pop() || null;
  function confirmProposal(id) {
    const p = proposals.get(id);
    if (!p || p.expiresAt < now()) { proposals.delete(id); return { ok: false, answer: "That proposal expired or was already used. Send the file or message again." }; }
    proposals.delete(id); // single use
    try {
      if (p.kind === "assignment") {
        const a = tracker.addAssignment(p.ref, p.fields);
        return { ok: true, answer: `Saved "${a.title}" for ${p.ref.name}${a.due ? `, due ${niceDate(a.due)}` : " (no due date)"}. ${a.needs.length ? `It needs: ${a.needs.join(", ")}.` : ""} Say "help me start" when you want to begin.` };
      }
      if (p.kind === "material") {
        tracker.attachMaterial(p.ref, p.date, p.refs, { topic: p.topic || "" });
        return { ok: true, answer: `Attached it to the ${p.ref.name} lecture of ${niceDate(p.date)}. Say "teach me" or "quiz me" when you are ready.` };
      }
    } catch (error) { return { ok: false, answer: `I could not save it: ${error.message}.` }; }
    return { ok: false, answer: "Unknown proposal." };
  }
  function cancelProposal(id) { return { ok: proposals.delete(id), answer: "Dropped. Nothing was saved." }; }
  const card = (p) => ({ id: p.id, kind: p.kind, course: p.ref.name, expiresAt: p.expiresAt, ...(p.kind === "assignment" ? { title: p.fields.title, due: p.fields.due, needs: p.fields.needs } : { date: p.date, files: p.refs.map((r) => r.fileName || r.fileId), question: p.question }) });

  // A file arrived. files: [{ fileId, fileName, pages }]; text: the file text or message (for assignments); dateText: what the student wrote about the date.
  async function onUpload({ courseId, files = [], text = "", dateText = "", kind = "auto" }) {
    const ref = refs().find((r) => r.courseId === courseId);
    if (!ref) return { answer: whichCourse() };
    const asAssignment = kind === "assignment" || (kind === "auto" && /assignment|exercise|homework|\bhw\b|due\b|submit|תרגיל|מטלה|הגשה|עבודה\s+להגשה/i.test(`${dateText} ${text.slice(0, 2000)}`));
    if (asAssignment) {
      const r = await tutor.proposeAssignment({ askChain, courseName: ref.name, text: `${dateText}\n${text}`, now: now(), log });
      if (!r.ok) return { answer: r.answer };
      const p = addProposal({ kind: "assignment", ref, fields: r.proposal });
      return { answer: `I read this as an assignment for ${ref.name}: "${p.fields.title}", ${p.fields.due ? `due ${niceDate(p.fields.due)}` : "no due date found"}${p.fields.needs.length ? `, needing: ${p.fields.needs.join(", ")}` : ""}. Is that right? Confirm and I save it; nothing is saved before.`, proposal: card(p) };
    }
    const refsList = files.filter((f) => f && f.fileId && f.pages >= 1).map((f) => ({ fileId: f.fileId, from: 1, to: f.pages, fileName: f.fileName }));
    if (!refsList.length) return { answer: "I could not find readable pages in that file yet." };
    const named = parseDay(dateText || "", "past");
    let slot = null, how = "";
    if (named && named.date) {
      slot = [...tracker.slots(ref.key)].reverse().find((s) => s.date <= named.date); // the lecture on that day, or the one before it
      how = "from the date you gave";
    }
    if (!slot) { slot = tracker.suggestSlot(ref); how = "the most recent lecture that has no material yet"; }
    if (!slot) return { answer: `I cannot tell which ${ref.name} lecture this belongs to. Which date was it?` };
    const q = `Is this the ${ref.name} lecture of ${niceDate(slot.date)} (${how})? Confirm, or tell me the right date.`;
    const p = addProposal({ kind: "material", ref, date: slot.date, refs: refsList, question: q });
    return { answer: q, proposal: card(p) };
  }

  // ---- the answer to a message the front desk marked with a studyIntent ----
  async function answerStudy({ studyIntent, text = "", courseId = null, courseName = null, onText = null }) {
    const t0 = Date.now();
    curLang = /[֐-׿]/.test(String(text)) ? "he" : "en"; // the dates in this reply read in the language the student wrote in
    const done = (r) => ({ mode: "study", answer: "", sources: [], outside: false, model: null, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), ...r });
    const intent = INTENTS.includes(studyIntent) ? studyIntent : "progress"; // an unknown intent is the safest one: only shows numbers

    if (intent === "pause") {
      const day = parseDay(text, "week");
      try { nudges.pause(day && day.date && day.date >= today() ? day.date : null); } catch (error) { return done({ answer: `I could not pause: ${error.message}.` }); }
      const s = nudges.settings();
      return done({ answer: `Study reminders are paused${s.pausedUntil ? ` until ${niceDate(s.pausedUntil)}` : " until you say resume"}. Your progress is kept. Nothing is lost while you are away.` });
    }
    if (intent === "resume") { nudges.resume(); return done({ answer: "Study reminders are on again. Welcome back: say \"where am I\" and I will show the real numbers, with no guilt." }); }
    if (intent === "confirm" || intent === "cancel") {
      const p = latestProposal();
      if (!p) return done({ answer: "There is nothing waiting for confirmation." });
      const r = intent === "confirm" ? confirmProposal(p.id) : cancelProposal(p.id);
      return done({ answer: r.answer });
    }

    if (intent === "update") {
      if (!SKIP_WORDS.test(text) && !UNDO_WORDS.test(text)) { const many = await interpretPositions(text); if (many) return done({ answer: many }); }
      const { lines, unclear } = interpretUpdate(text);
      const out = [...lines];
      if (unclear.length) out.push(`I did not catch: "${clean(unclear.join(" / "), 160)}". Tell me for example: "no Systems Programming lecture this week", "no classes on 24 Dec", "my last Calculus lecture was Monday", or "lecture 4 in Algorithms".`);
      return done({ answer: out.join("\n") || "Tell me what changed." });
    }

    const ref = resolveRef(text, courseId, courseName);

    if (intent === "progress" || intent === "plan" || intent === "motivate") {
      const list = ref ? [ref] : refs().filter(tracked);
      if (!list.length) return done({ answer: "I do not have the timetable for these courses yet." });
      for (const r of list) maybeAlign(r);
      if (intent === "motivate") {
        const r = list[0];
        const p = tracker.progress(r);
        const good = p.understood ? `You have already checked ${p.understood} lecture${p.understood === 1 ? "" : "s"} of ${r.name}. ` : "";
        return done({ answer: `${good}${nextStep(r)} Fifteen minutes is enough to start.` });
      }
      const body = list.map(courseLines).join("\n\n");
      const next = intent === "plan" ? `\n\n${list.map(nextStep).join("\n")}` : "";
      const asked = list.filter((r) => !tracker.progress(r).positionKnown);
      const first = positionQuestion(list);
      if (first) tracker.markAsked(asked[0], { position: true });
      return done({ answer: `Where you should be (timetable, ${niceDate(today())}) and where you are:\n\n${body}${next}${first}`, study: { courses: list.map((r) => tracker.progress(r)) } });
    }

    if (intent === "assignment") {
      if (!ref) return done({ answer: whichCourse() });
      const r = await onUpload({ courseId: ref.courseId, text, kind: "assignment" });
      return done(r);
    }

    // teach / quiz / start / answer: the tutor
    if (!ref) return done({ answer: whichCourse() });
    const align = maybeAlign(ref);
    const r = await tutor.turn({ tracker, ref, intent, message: text, pages: ref.courseId ? courses.allPages(ref.courseId) : [], courseName: ref.name, askChain, now: now(), log, onText });
    return done({ ...r, mode: "study", answer: r.answer + (intent !== "answer" ? align : "") + (r.needs ? "" : ""), study: { course: ref.name, mode: r.mode, done: r.done } });
  }

  return { studyLine, answerStudy, morningBlock: () => nudges.morningBlock(), onUpload, confirmProposal, cancelProposal, pendingProposal: () => { const p = latestProposal(); return p ? card(p) : null; }, interpretUpdate, tracker, nudges, INTENTS };
}

module.exports = { createStudyCoach, INTENTS };
