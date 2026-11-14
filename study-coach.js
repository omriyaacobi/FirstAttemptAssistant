// study-coach.js
// The one door to the study coach. What is connected from outside:
//
//   coach.brainTools.*               the brain's checked study tools (pause, resume, plan, teach, exam, position, classCancelled, undo; brain.js)
//   coach.answerStudy({...})         the brain's study_status, quiz, quiz_answer and card_reply (progress, quiz, answer, confirm, cancel)
//   coach.morningBlock()             the study line of the morning brief (also given to createMorning as `study`)
//   coach.onUpload({...})            material or an assignment arrived: returns a PROPOSAL (nothing is saved until confirmed)
//   coach.confirmProposal(id) / cancelProposal(id), coach.pendingProposal()
//
// The old front desk's intents and the word lists that sorted Omri's words between them were removed on 2026-11-13 (the brain
// understands the message and calls a tool instead).
//
// Everything that decides or counts is code (study-plan.js, study-tracker.js). Models (Argon only) are used for teaching, writing
// questions, grading and reading an assignment, always through tutor.js and always checked by code.

const fs = require("node:fs");
const path = require("node:path");
const plan = require("./study-plan");
// The language of the reply being written (Hebrew when the student wrote Hebrew). The Hebrew sentences avoid "you" and "I" verbs that
// show a gender. T(english, hebrew) picks one.
let curLang = "en";
const T = (en, he) => say(curLang, en, he);
const { langOf, say, bet } = require("./lang");
const STATUS_HE = { todo: "עוד לא התחיל", started: "בעבודה", done: "הושלם" };
const NOTE_HE = { "not started yet": "עוד לא התחיל" };
const noteText = (note) => (curLang === "he" && NOTE_HE[note]) || note;
const niceDate = (iso) => plan.niceDate(iso, curLang);
const { createTracker, clean } = require("./study-tracker");
const { createProgressLog } = require("./progress-log");
const { createNudges } = require("./study-nudges");
const tutor = require("./tutor");
const { lectureIndex, askedLectures } = require("./study");
const standing = require("./standing");
const outlineLib = require("./outline");
const { buildOutline } = outlineLib;
const catchup = require("./catchup");
const { MODELS } = require("./router");

const INTENTS = ["progress", "quiz", "answer", "confirm", "cancel"]; // what the brain hands in (see answerStudy)
const PROPOSAL_MS = 12 * 3600 * 1000; // proposals live in memory for 12 hours
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYWORDS = { sunday: 0, sun: 0, "ראשון": 0, monday: 1, mon: 1, "שני": 1, tuesday: 2, tue: 2, "שלישי": 2, wednesday: 3, wed: 3, "רביעי": 3, thursday: 4, thu: 4, "חמישי": 4, friday: 5, fri: 5, "שישי": 5 };

function createStudyCoach({ dir, courses, askChain, now = () => Date.now(), timezone = plan.TIMEZONE, log = () => {} }) {
  // The progress log (progress-log.js): code writes one line per real study event, the morning brief reads yesterday's lines.
  const progressLog = createProgressLog({ dir: path.join(dir, "progress"), now, timezone });
  const tracker = createTracker({ dir, now, timezone, progressLog });
  const nudges = createNudges({ tracker, courseList: () => courses.list(), now, timezone });
  const proposals = new Map();
  let proposalCounter = 0;
  const today = () => plan.parts(now(), timezone).date;
  const refs = () => tracker.refsFor(courses.list());
  const tracked = (ref) => tracker.slots(ref.key).length > 0;
  // A course named in a message: through the timetable, else when every significant word of its name is there ("linear algebra" -> "Linear Algebra Demo").
  const GENERIC = new Set(["demo", "intro", "introduction", "course", "the", "and", "for"]);
  const sigWords = (name) => (String(name).toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter((w) => !GENERIC.has(w));
  function refInText(seg) {
    const all = refs();
    const key = plan.courseKeyFor(tracker.timetable(), seg);
    const byKey = key && all.find((r) => r.key === key);
    if (byKey) return byKey;
    const low = String(seg).toLowerCase();
    const hits = all.filter((r) => { const w = sigWords(r.name); return w.length && w.every((x) => low.includes(x)); });
    return hits.length === 1 ? hits[0] : null;
  }

  const WHERE_Q = /\bwhere\s+(?:am\s+i|i\s+am|do\s+i\s+stand)\b|\bhow\s+am\s+i\s+doing\b|\b(?:my|the)\s+(?:status|progress)\b|איפה\s+אני|מה\s+המצב|איפה\s+אני\s+עומד/i;
  const SAID_MAX = 300;
  const NO_REPEAT_MS = 7 * 24 * 3600 * 1000; // the same question is not asked again within a week
  const askedRecently = (ref) => { const at = tracker.course(ref).askedPosition || 0; return !!at && now() - at < NO_REPEAT_MS; };
  // The words kept for a course: the whole message, unless it talks about several courses (then only the sentences that name this one).
  const wordsFor = (ref, text) => {
    const parts = String(text).split(/\n|(?<=[.!?])\s+/);
    const named = new Set(parts.map((p) => refInText(p)).filter(Boolean).map((r) => r.key));
    if (named.size <= 1) return clean(text, SAID_MAX);
    return clean(parts.filter((p) => { const r = refInText(p); return r && r.key === ref.key; }).join(" ") || text, SAID_MAX);
  };

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
    if (withSession.length === 1) return withSession[0];
    return fitCourse(text);
  }
  // No course named and no open session: the ONE course that fits. The only course there is, or the only course whose notes have a section title
  // that shares words with the message (code only, never a guess between several).
  function fitCourse(text) {
    const all = refs();
    if (all.length === 1) return all[0];
    const hits = all.filter((r) => r.courseId && catchup.tokens(text).length && catchup.matchSections(buildOutline(courses.allPages(r.courseId)), text).length);
    return hits.length === 1 ? hits[0] : null;
  }
  const whichCourse = () => T(`Which course do you mean? ${refs().map((r) => r.name).join(", ")}.`, `לאיזה קורס הכוונה? ${refs().map((r) => r.name).join(", ")}.`);

  // Course with all its lectures already uploaded (Calculus 2): notebook lecture k is ASSUMED to be the k-th class. Once, and it says so.
  function maybeAlign(ref) {
    const c = tracker.course(ref);
    if (c.aligned || !ref.courseId) return "";
    const index = lectureIndex(courses.allPages(ref.courseId));
    const held = tracker.progress(ref).held;
    if (!index.length || index.length <= held) return ""; // fewer notebook lectures than classes held: material arrives week by week
    const placed = tracker.alignNotebook(ref, index);
    tracker.save({ ...tracker.course(ref), aligned: true });
    return placed ? T(`\n\n(Note: all ${ref.name} lectures are uploaded, so I assumed notebook lecture k is the k-th class by the timetable. If a class was cancelled or the numbers do not match, tell me.)`, `\n\n(הערה: כל ההרצאות של ${ref.name} כבר הועלו, אז הנחתי שהרצאה k במחברת היא השיעור ה-k לפי המערכת. אם שיעור בוטל או שהמספרים לא מתאימים, כדאי לכתוב לי.)`) : "";
  }

  // ---- what the notes hold, and what the student's own record says (position v2, see standing.js) ----
  const notesOf = (ref) => { const o = buildOutline(ref.courseId ? courses.allPages(ref.courseId) : []); return { outline: o, files: o.files.length, sections: o.files.reduce((n, f) => n + f.sections.length, 0) }; };
  const asRead = (p) => { const s = standing.standingLine(p.position, curLang); return s ? `  ${T("As I read it", "כך הבנתי")}: ${s}.` : ""; };
  // The covered range for a quiz, from the student's record: lectures up to the place (minus the ones they missed), or pieces of the notes up to it.
  // null when there is no v2 record or no place and the course is not being revised (then the quiz is chosen as before).
  function rangeFor(ref, text) {
    const byNotes = notesRange(ref, text);
    if (byNotes) return byNotes;
    const pos = tracker.course(ref).position;
    if (!pos || !pos.v || askedLectures(text).length) return null;
    const w = pos.where;
    if (!w && pos.mode !== "revising") return null;
    const gaps = pos.gaps || [];
    const skip = gaps.filter((g) => g.kind === "lecture").map((g) => g.n);
    const shaky = pos.depth === "shaky";
    if (!w || w.type === "lecture" || w.type === "date") {
      const slot = w ? (w.type === "lecture" ? tracker.slots(ref.key).find((s) => s.n === w.n) : [...tracker.slots(ref.key)].reverse().find((s) => s.date <= w.date && plan.isHeld(s, now(), timezone))) : null;
      const maxLecture = slot ? slot.n : null;
      return { maxLecture, skip, prefer: shaky && maxLecture ? [maxLecture, maxLecture - 1].filter((n) => n >= 1) : [] };
    }
    // a place in the notes: the sections from the start up to it, up to 4 pieces (the latest first when the student says it sits badly)
    const pages = ref.courseId ? courses.allPages(ref.courseId) : [];
    const o = buildOutline(pages);
    const f = o.files.slice().sort((a, b) => b.chars - a.chars)[0];
    if (!f) return null;
    const here = w.type === "section" ? outlineLib.sectionByName(o, w.name, f.fileId) : w.type === "pages" ? outlineLib.sectionAtPage(o, f.fileId, w.to) : null;
    const upto = here ? f.sections.findIndex((s) => s.id === here.id) : f.sections.length - 1;
    const skipNames = new Set(gaps.filter((g) => g.kind === "section").map((g) => g.name));
    let covered = f.sections.slice(0, upto + 1).filter((s) => !skipNames.has(s.title));
    if (!covered.length) return null;
    const pick = shaky ? covered.slice(-4).reverse() : (covered.length <= 4 ? covered : [0, 1, 2, 3].map((i) => covered[Math.round((i * (covered.length - 1)) / 3)]));
    const extra = pick.map((s, i) => ({ fileId: `${f.fileId}#${i}`, fileName: `${f.fileName} - ${clean(s.title, 60)}`, page: 1, text: outlineLib.sectionText(pages, f.fileId, s) })).filter((x) => x.text.trim());
    return extra.length ? { extra, label: covered.length === 1 ? clean(covered[0].title, 80) : T(`what you covered so far in ${ref.name}`, `מה שכבר נלמד ${bet(ref.name)}`) } : null;
  }
  // The next piece of the notes after the student's place (a section), or the first one when nothing is covered yet. null without notes.
  function nextChunk(ref, pos) {
    const o = notesOf(ref).outline;
    const f = o.files.slice().sort((a, b) => b.chars - a.chars)[0];
    if (!f || !f.sections.length) return null;
    const w = pos && pos.where;
    const here = w ? (w.type === "section" ? outlineLib.sectionByName(o, w.name, f.fileId) : w.type === "pages" ? outlineLib.sectionAtPage(o, f.fileId, w.to) : null) : null;
    const i = here ? f.sections.findIndex((s) => s.id === here.id) : -1;
    const next = f.sections.slice(i + 1).find((s) => !here || s.level <= here.level) || null;
    return next ? { title: next.title, pages: f.realPages ? next.toPage - next.fromPage + 1 : 0 } : null;
  }

  // ---- teaching from notes that are not split by lecture (catchup.js) ----
  const NEXT_WORDS = /\bnext\b|\bcontinue\b|keep\s+going|\bmore\b|הבא|המשך|תמשיך|עוד/i;
  function notesView(ref) {
    const pages = ref.courseId ? courses.allPages(ref.courseId) : [];
    const outline = buildOutline(pages);
    return { pages, outline, chunks: catchup.chunksOf(outline, pages) };
  }
  // A course whose teaching comes from its notes: it has a big notes file (one file, or one file holding at least half of the text) and
  // the student did not name a lecture of a timetable that has lecture material.
  function notesCourse(ref, v = notesView(ref)) {
    if (!v.chunks.length) return false;
    // notes made of "Lecture N" headings, for a course with a timetable, are taught by the lecture road (timetable lectures), not as free chunks
    if (tracked(ref) && v.outline.files.some((f) => f.sections.some((s) => s.kind === "lecture"))) return false;
    const files = v.outline.files, total = files.reduce((n, f) => n + f.chars, 0), big = Math.max(...files.map((f) => f.chars));
    return files.length === 1 || big * 2 >= total;
  }
  const withoutName = (ref, text) => { const own = new Set(catchup.tokens(ref.name)); return catchup.tokens(text).filter((w) => !own.has(w)); };
  const piece = (c, i = 0) => ({ fileId: `${c.fileId}#${c.key}`, fileName: `${c.fileName} - ${clean(c.title, 60)}`, page: c.realPages ? c.fromPage : 1, text: c.text });
  const nameList = (v, n = 8) => { const t = catchup.unitsOf(v.outline).map((u) => clean(u.title, 50)); return t.slice(0, n).join("; ") + (t.length > n ? "; ..." : ""); };
  // The units a message names: a number ("section 2.1"), else the title words, else (only when there are topic words) ONE Argon call that picks ids from the real list.
  async function namedUnits(ref, v, text, useModel = true) {
    const byNumber = catchup.sectionByNumber(v.outline, text);
    if (byNumber.length) return byNumber;
    const topic = withoutName(ref, text);
    if (!topic.length) return [];
    const byWords = catchup.matchSections(v.outline, topic.join(" "), undefined, v.pages);
    if (byWords.length || !useModel) return byWords;
    return catchup.chooseByModel({ askChain, chain: [MODELS.argonLow], outline: v.outline, pages: v.pages, text, log });
  }
  // The teaching turn from the notes: null when this is not a notes course (the lecture road is used), else an answer or { chunk }.
  async function notesPick(ref, text) {
    const v = notesView(ref);
    if (!notesCourse(ref, v)) return null;
    if (askedLectures(text).length && tracked(ref)) return null;
    if (tracked(ref) && tracker.progress(ref).withMaterial > 0 && !catchup.sectionByNumber(v.outline, text).length && !catchup.matchSections(v.outline, withoutName(ref, text).join(" ")).length) return null; // a timetable course with lecture material keeps the lecture road
    const state = catchup.notesState(tracker, ref);
    let from = [];
    const topic = withoutName(ref, text);
    if (catchup.sectionByNumber(v.outline, text).length || (topic.length && !(NEXT_WORDS.test(text) && !catchup.matchSections(v.outline, topic.join(" ")).length))) from = await namedUnits(ref, v, text, !NEXT_WORDS.test(text));
    const asked = catchup.sectionByNumber(v.outline, text).length > 0 || (topic.length > 0 && !NEXT_WORDS.test(text));
    if (!from.length && asked) {
      return { say: T(`I could not find that in the notes of ${ref.name}, and I will not guess. The parts I see: ${nameList(v)}. Which one? Or say "teach me the next part".`, `לא מצאתי את זה בסיכומים ${bet(ref.name)}, ולא אנחש. החלקים שאני רואה: ${nameList(v)}. איזה מהם? או לכתוב "תלמד אותי את החלק הבא".`) };
    }
    const chunk = catchup.nextChunk(v.chunks, state, from.length ? from : null);
    if (!chunk) return { say: T(`We went through all the parts of the ${ref.name} notes. Say "quiz me on what we covered" to check yourself, or name a part to go over again.`, `עברנו על כל חלקי הסיכומים ${bet(ref.name)}. אפשר לכתוב "תבחן אותי על מה שלמדנו", או לציין חלק לחזרה.`) };
    return { chunk, onTaught: (c) => catchup.markTaught(tracker, ref, c) };
  }
  // Pieces of the notes for a quiz: the part the student names, else what Bot has taught from the notes (the last four, the latest first).
  function notesRange(ref, text) {
    const v = notesView(ref);
    if (!notesCourse(ref, v)) return null;
    const named = catchup.sectionByNumber(v.outline, text).length ? catchup.sectionByNumber(v.outline, text) : catchup.matchSections(v.outline, withoutName(ref, text).join(" "), undefined, v.pages);
    let chunks;
    if (named.length) { const titles = new Set(named.map((u) => u.title)); chunks = v.chunks.filter((c) => titles.has(c.title)).slice(0, 4); }
    else chunks = catchup.taughtChunks(v.chunks, catchup.notesState(tracker, ref)).slice(-4).reverse();
    if (!chunks.length) return null;
    const titles = [...new Set(chunks.map((c) => clean(c.title, 60)))];
    return { extra: chunks.map(piece), label: titles.length === 1 ? titles[0] : T(`what we covered so far in ${ref.name}`, `מה שלמדנו עד עכשיו ${bet(ref.name)}`) };
  }

  const SOLUTION_ASK = /\b(?:full|whole|complete|entire)\s+(?:solution|code|answer)\b|\bsolution\s+(?:code|for)\b|\bsolve\s+(?:it|the\s+(?:assignment|exercise|homework))\s+for\s+me\b|פתרון\s+מלא|תפתור\s+(?:לי|את)/i;
  const WEEK_WORDS = /\bweek\b|שבוע/i, TODAY_WORDS = /\btoday\b|היום/i;
  const dayLabel = (iso) => plan.niceDate(iso, curLang);
  function planItems(ref) {
    const p = tracker.progress(ref), pos = p.position || {};
    const out = [];
    const exam = pos.confirmed && pos.examDate && pos.examDate >= today() ? pos.examDate : null;
    const dl = exam ? plan.addDays(exam, -1) : null;
    const concepts = pos.goal === "concepts";
    const base = { course: ref.name, deadline: dl, concepts, focus: false };
    const attending = !pos.mode || pos.mode === "attending";
    if (tracked(ref) && attending) for (const b of p.behind.filter((x) => x.hasMaterial || x.topic).slice(0, 5)) out.push({ ...base, kind: "lecture", label: `${ref.name} ${T("lecture", "הרצאה")} ${b.n}`, minutes: catchup.MINUTES.lecture, say: T(`teach me ${ref.name} lecture ${b.n}`, `תלמד אותי ${ref.name} הרצאה ${b.n}`) });
    const v = notesView(ref);
    if (notesCourse(ref, v) && !(tracked(ref) && p.withMaterial > 0)) {
      const state = catchup.notesState(tracker, ref);
      const at = state.cursor ? v.chunks.findIndex((c) => c.key === state.cursor) : -1;
      let rest = v.chunks.slice(at + 1).filter((c) => !state.taught.includes(c.key)).filter((c) => !(c.kind === "lecture" && tracked(ref) && c.lecture > p.held)); // a lecture that has not been held yet is not catch-up work
      // a student who goes to the lectures: only the part the lecturer has reached (their own place), the rest is not taught yet
      const w = pos.where;
      if (attending && w) {
        const f = v.outline.files.slice().sort((a, b) => b.chars - a.chars)[0];
        const here = w.type === "section" ? outlineLib.sectionByName(v.outline, w.name, f.fileId) : w.type === "pages" ? outlineLib.sectionAtPage(v.outline, f.fileId, w.to) : w.type === "fraction" ? outlineLib.sectionAtFraction(v.outline, w.value, f.fileId) : null;
        if (here) rest = rest.filter((c) => { const u = f.sections.find((s) => s.id === c.sectionId); return u && u.start < here.end; });
      }
      const focusTitles = pos.focus ? new Set(catchup.matchSections(v.outline, pos.focus, undefined, v.pages).map((u) => u.title)) : new Set();
      for (const c of rest.slice(0, 10)) out.push({ ...base, kind: "chunk", focus: focusTitles.has(c.title), label: `${ref.name}: "${clean(c.title, 50)}"${c.parts > 1 ? ` ${c.part}/${c.parts}` : ""}`, minutes: catchup.MINUTES.chunk, say: T(`teach me the next part of ${ref.name}`, `תלמד אותי את החלק הבא ${bet(ref.name)}`) });
    }
    for (const a of p.assignments) out.push({ ...base, kind: "assignment", deadline: a.due || null, label: `${ref.name}: ${T("assignment", "מטלה")} "${clean(a.title, 40)}"`, minutes: catchup.MINUTES.assignment, say: T("help me start the assignment", "תעזור לי להתחיל את המטלה") });
    if (exam && plan.daysBetween(today(), exam) <= 14) out.push({ ...base, kind: "review", label: `${ref.name}: ${T("review before the exam", "חזרה לפני המבחן")}`, minutes: catchup.MINUTES.review, say: T(`quiz me on ${ref.name}`, `תבחן אותי ${bet(ref.name)}`) });
    return out;
  }
  function catchupPlan(text, list = refs(), given = {}) {
    const budget = given.minutes || catchup.parseBudget(text) || catchup.DEFAULT_BUDGET;
    for (const r of list) maybeAlign(r); // notes of "Lecture N" headings are matched to the timetable lectures first
    const active = list.filter((r) => (tracker.progress(r).position || {}).mode !== "paused");
    const items = active.flatMap(planItems);
    const noExam = active.filter((r) => !(tracker.progress(r).position || {}).examDate);
    const lines = [];
    if (!items.length) {
      const empty = T("I do not have anything to plan from yet: no notes with sections, no lecture material and no assignment saved. Send the notes or the slides (a file or a zip) and I will plan around them.", "אין לי עדיין ממה לתכנן: אין סיכומים עם סעיפים, אין חומר להרצאות ואין מטלה שמורה. אפשר לשלוח את הסיכומים או את השקפים (קובץ או קובץ דחוס) ואתכנן לפיהם.");
      return empty + examQuestion(noExam);
    }
    const s = catchup.buildSchedule(items, { today: today(), budget });
    const first = s.grid[0].items[0];
    lines.push(T(`A realistic plan, about ${budget} minutes a day (today is ${dayLabel(today())}). It changes when you tell me more.`, `תוכנית ריאלית, בערך ${budget} דקות ביום (היום ${dayLabel(today())}). היא משתנה כשמספרים לי עוד.`));
    lines.push(T(`Start with: ${first.label} (${first.minutes} min). Say: "${first.say}".`, `מתחילים מ: ${first.label} (${first.minutes} דקות). לכתוב: "${first.say}".`));
    if (active.some((r) => (tracker.progress(r).position || {}).goal === "concepts")) lines.push(T("Concepts first, as you said: the exercises come after.", "קודם מושגים, כמו שנכתב: התרגילים אחר כך."));
    const onlyToday = typeof given.todayOnly === "boolean" ? given.todayOnly : TODAY_WORDS.test(text) && !WEEK_WORDS.test(text);
    const rows = (onlyToday ? s.grid.slice(0, 1) : s.grid).map((g) => `${g.date === today() ? T("Today", "היום") : dayLabel(g.date)} (${g.minutes} ${T("min", "דק'")}): ${g.items.map((i) => i.label).join(" + ")}`);
    lines.push(...rows);
    if (onlyToday && s.grid.length > 1) lines.push(T('For the whole week say "plan for the week".', 'לתוכנית של כל השבוע: "תוכנית לשבוע".'));
    const more = s.left.length;
    if (more) lines.push(T(`Not planned yet: ${more} more piece${more === 1 ? "" : "s"} (about ${Math.round(s.left.reduce((n, i) => n + i.minutes, 0) / 60 * 10) / 10} hours). I add them as days free up.`, `עוד לא מתוכננים: ${more} חלקים (בערך ${Math.round(s.left.reduce((n, i) => n + i.minutes, 0) / 60 * 10) / 10} שעות). אוסיף אותם כשיתפנו ימים.`));
    for (const l of s.late.slice(0, 2)) lines.push(T(`Tight: ${l.it.label} is due ${niceDate(l.it.deadline)}, and the plan only reaches it ${l.date ? "on " + niceDate(l.date) : "after this week"}. If you can do more minutes a day, tell me ("2 hours a day").`, `לחוץ: ${l.it.label} להגשה עד ${niceDate(l.it.deadline)}, והתוכנית מגיעה אליה רק ${l.date ? "ב" + niceDate(l.date) : "אחרי השבוע הזה"}. אם אפשר יותר דקות ביום, אפשר לכתוב ("שעתיים ביום").`));
    return lines.join("\n") + examQuestion(noExam);
  }
  // ONE question about what the plan lacks (exam dates), at most once a week. The answer goes through the usual reader and becomes a Confirm card.
  function examQuestion(noExam) {
    const ask = noExam.filter((r) => { const at = tracker.course(r).askedExam || 0; return !at || now() - at >= NO_REPEAT_MS; });
    if (!ask.length) return "";
    for (const r of ask) tracker.save({ ...tracker.course(r), askedExam: now() });
    const names = ask.map((r) => r.name).join(", ");
    return T(`\n\nOne thing I do not know: when are the exams (${names})? I plan only around dates I am told. Write one, for example "the exam in ${ask[0].name} is on 22 December", and I show it on a card to confirm before I use it.`, `\n\nדבר אחד שאני לא יודע: מתי המבחנים (${names})? אני מתכנן רק לפי תאריכים שנאמרו לי. אפשר לכתוב אחד, למשל "המבחן ${bet(ask[0].name)} ב-22 בדצמבר", ואציג אותו בכרטיס לאישור לפני שאשתמש בו.`);
  }

  // ---- progress ----
  function courseLines(ref) {
    const p = tracker.progress(ref);
    const removed = tracker.state().skips.some((s) => s.course === ref.key || s.course === "*");
    if (!tracked(ref)) { // no timetable for this course: no counts, only what was told
      const lines = [T(`${ref.name}: I have no timetable for this course, so I cannot count lectures.`, `${ref.name}: אין לי מערכת שעות לקורס הזה, אז אי אפשר לספור הרצאות.`)];
      if (!p.positionKnown) lines.push(T("  I do not know where you are in this course yet.", "  עדיין לא ידוע לי איפה עומדים בקורס הזה."));
      else if (p.position.note) lines.push(`  ${T("You told me you are up to", "עדכנת אותי שהמיקום הוא עד")} ${clean(noteText(p.position.note), 60)}.`);
      else lines.push(`  ${T("You told me", "כתבת לי")}: "${clean(p.position.said, 140)}".`);
      if (asRead(p)) lines.push(asRead(p));
      const n = notesOf(ref);
      if (n.files) lines.push(T(`  Notes in Bot: ${n.files} file${n.files === 1 ? "" : "s"}, ${n.sections} section${n.sections === 1 ? "" : "s"}.`, `  סיכומים ב-Bot: ${n.files === 1 ? "קובץ אחד" : `${n.files} קבצים`}, ${n.sections === 1 ? "סעיף אחד" : `${n.sections} סעיפים`}.`));
      for (const a of p.assignments.slice(0, 3)) lines.push(T(`  Assignment "${clean(a.title, 60)}": ${a.status}${a.due ? `, due ${niceDate(a.due)}` : ", no due date saved"}.`, `  מטלה "${clean(a.title, 60)}": ${STATUS_HE[a.status] || a.status}${a.due ? `, להגשה עד ${niceDate(a.due)}` : ", בלי תאריך הגשה שמור"}.`));
      return lines.join("\n");
    }
    const lines = [T(`${ref.name}: ${p.held} lecture${p.held === 1 ? "" : "s"} held so far by the timetable${removed ? " (cancelled ones removed)" : ""}.`, `${ref.name}: ${p.held === 1 ? "הרצאה אחת" : `${p.held} הרצאות`} עד עכשיו לפי המערכת${removed ? " (בלי אלה שבוטלו)" : ""}.`)];
    // Notes that are not split by lecture ("material for 0 of 6" would be wrong: the notes ARE uploaded) and a student who does not attend: no "behind" counts.
    const notes = notesOf(ref);
    const notesOnly = notes.files > 0 && p.withMaterial === 0;
    const attending = !p.position.mode || p.position.mode === "attending";
    if (notesOnly) lines.push(T(`  Notes in Bot: ${notes.files} file${notes.files === 1 ? "" : "s"}, ${notes.sections} section${notes.sections === 1 ? "" : "s"} (not split by lecture). Checked as understood (3+ questions, 70%+): ${p.understood}.`, `  סיכומים ב-Bot: ${notes.files === 1 ? "קובץ אחד" : `${notes.files} קבצים`}, ${notes.sections === 1 ? "סעיף אחד" : `${notes.sections} סעיפים`} (לא מחולקים לפי הרצאות). נבדקו כמובנות (3 שאלות ומעלה, 70% ומעלה): ${p.understood}.`));
    else lines.push(T(`  Material in Bot for ${p.withMaterial} of them. Checked as understood (3+ questions, 70%+): ${p.understood}.`, `  יש ב-Bot חומר ל-${p.withMaterial} מהן. נבדקו כמובנות (3 שאלות ומעלה, 70% ומעלה): ${p.understood}.`));
    if (!attending || notesOnly) { /* no catch-up count: it would not be true for how this student studies, or the notes cannot be counted by lecture */ }
    else if (p.behind.length) lines.push(`  ${T(`Behind on ${p.behind.length}`, `פיגור ב-${p.behind.length}`)}: ${p.behind.slice(0, 4).map((b) => `${T("lecture", "הרצאה")} ${b.n} (${niceDate(b.date)})${b.hasMaterial || b.topic ? "" : T(", no material yet", ", עדיין בלי חומר")}`).join("; ")}${p.behind.length > 4 ? "; ..." : ""}.`);
    else if (p.held) lines.push(T("  Nothing behind by the timetable.", "  אין פיגור לפי המערכת."));
    if (!p.positionKnown) lines.push(T("  I do not know where you are in this course yet.", "  עדיין לא ידוע לי איפה עומדים בקורס הזה."));
    else if (!p.position.seenThrough && !p.position.note && p.position.said) lines.push(`  ${T("You told me", "כתבת לי")}: "${clean(p.position.said, 140)}".`);
    else lines.push(`  ${T("You told me you are up to", "עדכנת אותי שהמיקום הוא עד")} ${p.position.seenThrough ? niceDate(p.position.seenThrough) : p.position.note ? clean(noteText(p.position.note), 60) : T("a topic", "נושא מסוים")}${p.position.seenThrough && p.position.note ? ` (${clean(noteText(p.position.note), 60)})` : ""}.`);
    if (asRead(p)) lines.push(asRead(p));
    for (const a of p.assignments.slice(0, 3)) lines.push(T(`  Assignment "${clean(a.title, 60)}": ${a.status}${a.due ? `, due ${niceDate(a.due)}` : ", no due date saved"}.`, `  מטלה "${clean(a.title, 60)}": ${STATUS_HE[a.status] || a.status}${a.due ? `, להגשה עד ${niceDate(a.due)}` : ", בלי תאריך הגשה שמור"}.`));
    return lines.join("\n");
  }
  function positionQuestion(list) {
    const unknown = list.filter((r) => !tracker.progress(r).positionKnown);
    if (!unknown.length) return "";
    if (unknown.every((r) => !tracked(r))) { // no lectures to point at: ask how far in the notes instead
      const names = unknown.map((r) => r.name).join(", ");
      return T(`\n\nSo that I do not guess: where are you in ${names}? I have no timetable for ${unknown.length === 1 ? "it" : "them"}, so tell me how far you are in the notes: a section name, a page, or about what part (a third, half...), or just describe it in your own words. I will not mark anything as understood from this: that only happens when you answer my questions.`, `\n\nכדי שלא אנחש: איפה עומדים ${bet(names)}? אין לי מערכת שעות, אז אפשר לכתוב עד איפה הגעת בסיכומים: שם של סעיף, עמוד, או בערך איזה חלק (שליש, חצי...), או פשוט לתאר במילים שלך. זה לא מסמן שום דבר כמובן: זה קורה רק אחרי תשובות לשאלות שלי.`);
    }
    return T(`\n\nSo that I do not guess: ${unknown.length === 1 ? "where are you in " + unknown[0].name : "where are you in " + unknown.map((r) => r.name).join(", ")}? Tell me the last lecture you went through: a date ("Thursday"), a number ("lecture 4") or a topic, or just describe it in your own words ("I'm at page 40, only reading the notes"). I will not mark anything as understood from this: that only happens when you answer my questions.`, `\n\nכדי שלא אנחש: איפה עומדים ${bet(unknown.map((r) => r.name).join(", "))}? אפשר לכתוב לי מה ההרצאה האחרונה שעברת עליה: תאריך ("יום חמישי"), מספר ("הרצאה 4") או נושא, או פשוט לתאר במילים שלך ("אני בעמוד 40, רק קורא את הסיכומים"). זה לא מסמן שום דבר כמובן: זה קורה רק אחרי תשובות לשאלות שלי.`);
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

  // ---- the student's free description of their state (standing.js) ----
  // A model PROPOSES a reading, code checks it against the timetable and the notes, Bot reads back what it stored, and "no" / "undo" puts the old record back.
  // At most ONE adaptive question follows, never twice within 7 days (unless asked "where am I"). An exam date is never stored without a Confirm card.
  const UNDO_ONLY = /^\s*(?:undo(?:\s+that)?|בטל|ביטול|תבטל)[.!\s]*$/i;
  const NO_ONLY = /^\s*(?:no|nope|no\s+thanks|wrong|that['’]?s\s+(?:not\s+right|wrong)|לא|לא\s+נכון|זה\s+לא\s+נכון)[.!\s]*$/i;
  const UNDO_MS = 2 * 3600 * 1000;
  const V2_KEYS = ["mode", "where", "pace", "behindBy", "gaps", "depth", "goal", "focus"];
  let lastUndo = null; // { items: [{ ref, position, pending }], proposalIds: [], at } or { skip: { ref, date }, at } (memory only: it lives for 2 hours)

  // The LAST change of each course (a stored position, a cancelled class) is ALSO kept on disk for 48 hours (undo.json), so a change
  // Bot made by itself at the end of the day can be taken back the next day, and after a restart. One entry per course and kind
  // (a cancelled class: per date). An entry: { kind: "position", key, position, pending, proposalIds, by, at } | { kind: "skip", key, date, at }.
  const UNDO_KEEP_MS = 48 * 3600 * 1000;
  const undoFile = path.join(dir, "undo.json");
  const readUndo = () => {
    try { const l = JSON.parse(fs.readFileSync(undoFile, "utf8")); return (Array.isArray(l) ? l : []).filter((e) => e && typeof e.key === "string" && Number.isFinite(e.at) && now() - e.at < UNDO_KEEP_MS); } catch (error) { return []; }
  };
  const writeUndo = (list) => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(undoFile + ".tmp", JSON.stringify(list.slice(-40))); fs.renameSync(undoFile + ".tmp", undoFile); } catch (error) { log(`[standing] could not save the undo list: ${error.message}`); }
  };
  const sameUndo = (a, b) => a.key === b.key && a.kind === b.kind && (a.kind !== "skip" || a.date === b.date);
  const keepUndo = (entry) => writeUndo([...readUndo().filter((e) => !sameUndo(e, entry)), { ...entry, at: now() }]);
  const dropUndo = (entry) => writeUndo(readUndo().filter((e) => !sameUndo(e, entry)));
  // Takes back one saved entry. The reply names the course, so Omri sees exactly what went back.
  function undoSaved(e) {
    dropUndo(e);
    const ref = refs().find((r) => r.key === e.key);
    if (!ref) throw new Error("that course is not in the study tracker any more");
    if (lastUndo && (lastUndo.skip ? lastUndo.skip.ref.key === e.key : lastUndo.items.some((it) => it.ref.key === e.key))) lastUndo = null;
    if (e.kind === "skip") {
      tracker.removeSkip({ date: e.date, course: ref.key });
      return T(`Undone. The ${ref.name} lecture on ${niceDate(e.date)} is back in the timetable.`, `בוטל. ההרצאה של ${ref.name} ב-${niceDate(e.date)} חזרה למערכת.`);
    }
    tracker.restoreStanding(ref, e.position, e.pending);
    for (const id of e.proposalIds || []) proposals.delete(id);
    return T(`Undone. ${ref.name} is back to how it was before. Tell me again in your own words when you want.`, `בוטל. ${ref.name} חזר למצב שהיה קודם. אפשר לכתוב שוב במילים שלך מתי שנוח.`);
  }

  function undoReading() {
    const u = lastUndo;
    lastUndo = null;
    if (u.skip) { // a cancelled class: the date goes back into the timetable
      dropUndo({ kind: "skip", key: u.skip.ref.key, date: u.skip.date });
      tracker.removeSkip({ date: u.skip.date, course: u.skip.ref.key });
      return T(`Undone. The ${u.skip.ref.name} lecture on ${niceDate(u.skip.date)} is back in the timetable.`, `בוטל. ההרצאה של ${u.skip.ref.name} ב-${niceDate(u.skip.date)} חזרה למערכת.`);
    }
    for (const it of u.items) { tracker.restoreStanding(it.ref, it.position, it.pending); dropUndo({ kind: "position", key: it.ref.key }); }
    for (const id of u.proposalIds) proposals.delete(id); // the exam card of that reading goes too
    const names = u.items.map((it) => it.ref.name).join(", ");
    return T(`Undone. ${names} ${u.items.length === 1 ? "is" : "are"} back to how ${u.items.length === 1 ? "it was" : "they were"} before. Tell me again in your own words when you want.`, `בוטל. ${names} חזרו למצב שהיה קודם. אפשר לכתוב שוב במילים שלך מתי שנוח.`);
  }
  const heldSlots = (ref) => tracker.slots(ref.key).filter((s) => plan.isHeld(s, now(), timezone));
  function standingContext(ref) {
    const next = tracker.slots(ref.key).find((s) => !plan.isHeld(s, now(), timezone)) || null;
    return standing.contextFor({ held: heldSlots(ref).map((s) => ({ n: s.n, date: s.date })), nextSlot: next ? { n: next.n, date: next.date } : null, outline: buildOutline(ref.courseId ? courses.allPages(ref.courseId) : []), today: today(), lang: curLang, tracked: tracked(ref) });
  }

  // Checks the proposed fields (standing.checkStanding: closed lists, the timetable, the outline) and stores what fits, keeping the old
  // record for undo. byBrain: the fields came from the brain's study_position tool, so no words are scanned here.
  function storeReading(target, text, raw, ctx, lost, { byBrain = false } = {}) {
    const res = standing.checkStanding(raw, ctx);
    // A written exam date ("the exam is on 22 December"): the reader only knows "in N days", so code reads the date itself (a real date, in the future, within a year).
    if (!byBrain && !res.exam && /\bexam\b|\btest\b|מבחן/i.test(text) && /\d/.test(text)) {
      const d = (parseDay(text, "week") || {}).date;
      if (d && d > today() && plan.daysBetween(today(), d) <= standing.EXAM_MAX_DAYS) res.exam = { date: d };
    }
    if (!res.any && !res.dropped.length && !res.exam && !lost) return null;
    const words = wordsFor(target, text);
    const before = { ref: target, position: tracker.course(target).position, pending: tracker.pendingQuestion(target) };
    const old = before.position;

    // A later reading adds to the earlier one; a new place replaces the old place AND what was said about being behind it.
    const merged = {};
    for (const k of V2_KEYS) if (old[k] !== undefined) merged[k] = old[k];
    if (res.fields.where) { delete merged.pace; delete merged.behindBy; }
    Object.assign(merged, res.fields);
    if (!merged.where && old.seenThrough) merged.where = { type: "date", date: old.seenThrough }; // the older lecture-based place stays
    if (old.note) merged.note = old.note;
    merged.said = words;
    try { tracker.setStanding(target, merged); } catch (error) {
      delete merged.where;
      try { tracker.setStanding(target, merged); } catch (e2) { log(`[standing] could not store: ${e2.message}`); return null; }
    }
    const out = { undo: before, question: "", proposal: undefined, proposalId: null };
    if (res.exam && old.examDate !== res.exam.date) {
      const p = addProposal({ kind: "exam", ref: target, date: res.exam.date });
      out.proposalId = p.id;
      out.proposal = card(p);
    }
    if (lost && !res.any) {
      tracker.markAsked(target, { where: true }); tracker.save({ ...tracker.course(target), pendingQuestion: null }); // counts as asked for 7 days, and nothing stays open
      out.answer = T(`${target.name}: I kept your words. Not knowing where you are is fine. If you like, say "quiz me on ${target.name}" for a short quiz and we will see what you already know; I will not ask where you are again for a week. This only tells me where to start: it does not count as understood.`, `${target.name}: שמרתי את מה שכתבת. זה בסדר לא לדעת איפה עומדים. אם בא לך, אפשר לכתוב "תבחן אותי ${bet(target.name)}" ונראה מה כבר ידוע; לא אשאל שוב איפה עומדים במשך שבוע. זה רק אומר לי מאיפה להתחיל, ולא נחשב להבנה.`);
      return out;
    }
    out.answer = standing.readback({ courseName: target.name, fields: res.fields, notes: res.notes, dropped: res.dropped, exam: res.exam, lang: curLang });
    const askedAt = tracker.course(target).askedStanding || 0;
    if (!byBrain && (!askedAt || now() - askedAt >= NO_REPEAT_MS || WHERE_Q.test(text))) out.question = standing.adaptiveQuestion({ fields: merged, notes: res.notes, dropped: res.dropped, ctx, lang: curLang });
    return out;
  }

  // ---- proposals (model proposes, code checks, the student confirms) ----
  function addProposal(p) {
    const id = `p${++proposalCounter}${now().toString(36)}`;
    const item = { id, createdAt: now(), expiresAt: now() + PROPOSAL_MS, lang: curLang, ...p };
    proposals.set(id, item);
    for (const [k, v] of proposals) if (v.expiresAt < now()) proposals.delete(k);
    return item;
  }
  const latestProposal = () => [...proposals.values()].filter((p) => p.expiresAt >= now()).pop() || null;
  function confirmProposal(id) {
    const p = proposals.get(id);
    if (p) curLang = p.lang || "en"; // a tap on the card has no text of its own: the card keeps the language it was asked in
    if (!p || p.expiresAt < now()) { proposals.delete(id); return { ok: false, answer: T("That proposal expired or was already used. Send the file or message again.", "ההצעה הזו פגה או שכבר נעשה בה שימוש. אפשר לשלוח שוב את הקובץ או ההודעה.") }; }
    proposals.delete(id); // single use
    try {
      if (p.kind === "assignment") {
        const a = tracker.addAssignment(p.ref, p.fields);
        return { ok: true, answer: T(`Saved "${a.title}" for ${p.ref.name}${a.due ? `, due ${niceDate(a.due)}` : " (no due date)"}. ${a.needs.length ? `It needs: ${a.needs.join(", ")}.` : ""} Say "help me start" when you want to begin.`, `שמרתי את "${a.title}" ${bet(p.ref.name)}${a.due ? `, להגשה עד ${niceDate(a.due)}` : " (בלי תאריך הגשה)"}. ${a.needs.length ? `צריך בשבילה: ${a.needs.join(", ")}.` : ""} כדי להתחיל אפשר לכתוב "תעזור לי להתחיל".`) };
      }
      if (p.kind === "exam") {
        tracker.setExamDate(p.ref, p.date);
        return { ok: true, answer: T(`Saved the ${p.ref.name} exam on ${niceDate(p.date)}. I only use it in the morning brief, when it is within a week (one note a day at most). It says nothing about what you understood.`, `שמרתי את המבחן ${bet(p.ref.name)} ב${niceDate(p.date)}. אני משתמש בו רק בסיכום הבוקר, כשהוא בתוך שבוע (הערה אחת ביום לכל היותר). זה לא אומר כלום על מה שהובן.`) };
      }
      if (p.kind === "material") {
        tracker.attachMaterial(p.ref, p.date, p.refs, { topic: p.topic || "" });
        return { ok: true, answer: T(`Attached it to the ${p.ref.name} lecture of ${niceDate(p.date)}. Say "teach me" or "quiz me" when you are ready.`, `צירפתי את זה להרצאה ${bet(p.ref.name)} מ${niceDate(p.date)}. כשיהיה נוח אפשר לכתוב "תלמד אותי" או "תבחן אותי".`) };
      }
    } catch (error) { return { ok: false, answer: T(`I could not save it: ${error.message}.`, `לא הצלחתי לשמור: ${error.message}.`) }; }
    return { ok: false, answer: T("Unknown proposal.", "הצעה לא מוכרת.") };
  }
  function cancelProposal(id) { const p = proposals.get(id); if (p) curLang = p.lang || "en"; return { ok: proposals.delete(id), answer: T("Dropped. Nothing was saved.", "בוטל. שום דבר לא נשמר.") }; }
  const card = (p) => ({ id: p.id, kind: p.kind, course: p.ref.name, expiresAt: p.expiresAt, ...(p.kind === "assignment" ? { title: p.fields.title, due: p.fields.due, needs: p.fields.needs } : p.kind === "exam" ? { date: p.date } : { date: p.date, files: p.refs.map((r) => r.fileName || r.fileId), question: p.question }) });

  // A file arrived. files: [{ fileId, fileName, pages }]; text: the file text or message (for assignments); dateText: what the student wrote about the date.
  async function onUpload({ courseId, files = [], text = "", dateText = "", kind = "auto", dueHint = null }) {
    curLang = langOf(`${dateText}`.replace(/\S+\.\w{2,4}\b/g, "")); // the words that came with the file, not its file name
    const ref = refs().find((r) => r.courseId === courseId);
    if (!ref) return { answer: whichCourse() };
    const asAssignment = kind === "assignment" || (kind === "auto" && /assignment|exercise|homework|\bhw\b|due\b|submit|תרגיל|מטלה|הגשה|עבודה\s+להגשה/i.test(`${dateText} ${text.slice(0, 2000)}`));
    if (asAssignment) {
      const r = await tutor.proposeAssignment({ askChain, courseName: ref.name, text: `${dateText}\n${text}`, now: now(), log, dueHint });
      if (!r.ok) return { answer: r.answer };
      const p = addProposal({ kind: "assignment", ref, fields: r.proposal });
      return { answer: T(`I read this as an assignment for ${ref.name}: "${p.fields.title}"${p.fields.due ? `, due ${niceDate(p.fields.due)}` : ""}${p.fields.needs.length ? `, needing: ${p.fields.needs.join(", ")}` : ""}. Is that right? Confirm and I save it; nothing is saved before.`, `הבנתי שזו מטלה ${bet(ref.name)}: "${p.fields.title}"${p.fields.due ? `, להגשה עד ${niceDate(p.fields.due)}` : ""}${p.fields.needs.length ? `, צריך בשבילה: ${p.fields.needs.join(", ")}` : ""}. זה נכון? אחרי אישור אשמור; לפני כן שום דבר לא נשמר.`), proposal: card(p) };
    }
    const refsList = files.filter((f) => f && f.fileId && f.pages >= 1).map((f) => ({ fileId: f.fileId, from: 1, to: f.pages, fileName: f.fileName }));
    if (!refsList.length) return { answer: T("I could not find readable pages in that file yet.", "עדיין לא מצאתי דפים קריאים בקובץ הזה.") };
    if (!tracked(ref)) { // no timetable: there is no lecture date to match, so no date question; say it is filed and how to start
      return { answer: T(`Filed in ${ref.name}. I have no timetable for this course, so I do not match it to a lecture date. To start, say "teach me" or "quiz me" and I use the files you uploaded.`, `הקובץ נשמר ב-${ref.name}. אין לי מערכת שעות לקורס הזה, אז אני לא משייך אותו לתאריך של הרצאה. כדי להתחיל אפשר לכתוב "תלמד אותי" או "תבחן אותי" ואשתמש בקבצים שהועלו.`) };
    }
    const named = parseDay(dateText || "", "past");
    let slot = null, how = "";
    if (named && named.date) {
      slot = [...tracker.slots(ref.key)].reverse().find((s) => s.date <= named.date); // the lecture on that day, or the one before it
      how = T("from the date you gave", "לפי התאריך שכתבת");
    }
    if (!slot) { slot = tracker.suggestSlot(ref); how = T("the most recent lecture that has no material yet", "ההרצאה האחרונה שעדיין אין לה חומר"); }
    if (!slot) return { answer: T(`I cannot tell which ${ref.name} lecture this belongs to. Which date was it?`, `לא ברור לי לאיזו הרצאה ${bet(ref.name)} זה שייך. באיזה תאריך היא הייתה?`) };
    const q = T(`Is this the ${ref.name} lecture of ${niceDate(slot.date)} (${how})? Confirm, or tell me the right date.`, `זו ההרצאה ${bet(ref.name)} מ${niceDate(slot.date)} (${how})? אפשר לאשר, או לכתוב לי את התאריך הנכון.`);
    const p = addProposal({ kind: "material", ref, date: slot.date, refs: refsList, question: q });
    return { answer: q, proposal: card(p) };
  }

  const looksLikeAssignmentName = (n) => /assign|exercis|homework|\bhw\b|(^|[^a-z])ex[ _-]?\d|תרגיל|מטלה|עבודה/i.test(n);
  // Files sent from the course page (Study tab) into THIS course, read, and named like an assignment: saved here by code, with no Confirm card (the student chose the course and the upload).
  // Chat uploads keep the card. A due date is not needed. Returns the titles saved now (usually none).
  async function autoSavePageAssignments(ref) {
    if (!ref.courseId || typeof courses.get !== "function" || typeof courses.setFile !== "function") return [];
    const c = courses.get(ref.courseId);
    if (!c || !Array.isArray(c.files)) return [];
    const saved = [];
    for (const f of c.files) {
      if (f.via !== "page" || f.asg || f.status !== "ready" || !looksLikeAssignmentName(f.name || "")) continue;
      const text = courses.allPages(ref.courseId).filter((p) => p && p.fileId === f.id).map((p) => String(p.text || "")).join("\n").slice(0, 8000);
      if (!text.trim()) continue;
      try {
        const r = await tutor.proposeAssignment({ askChain, courseName: ref.name, text: `${f.name}\n${text}`, now: now(), log });
        if (!r.ok) continue;
        const a = tracker.addAssignment(ref, { ...r.proposal, due: null, text });
        courses.setFile(ref.courseId, f.id, { asg: true });
        saved.push(a.title);
      } catch (error) { log(`[assignment-file] auto-save failed: ${error.message}`); }
    }
    return saved;
  }

  // ---- the answer to a study tool of the brain ----
  // The brain (brain.js) reaches the coach here with ONE of these intents, chosen by the model through a tool: progress (study_status,
  // always the fixed text "where am I"), quiz, answer (quiz_answer), confirm / cancel (card_reply). Until 2026-11-13 this function also
  // held the old front desk's intents (update, plan, teach, start, ...) and word lists that moved Omri's words between them; the brain
  // reaches those abilities through checked tools instead (brainTools below), so they were removed.
  async function answerStudy({ studyIntent, text = "", courseId = null, courseName = null, onText = null }) {
    const t0 = Date.now();
    curLang = langOf(text); // this reply reads in the language the student wrote in
    const done = (r) => ({ mode: "study", answer: "", sources: [], outside: false, model: null, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), ...r });
    const intent = INTENTS.includes(studyIntent) ? studyIntent : "progress"; // an unknown intent is the safest one: only shows numbers

    // "no" / "undo" right after Bot read back a description: the old record comes back (a plain "no" also drops that reading's own exam card).
    if (lastUndo && now() - lastUndo.at < UNDO_MS && intent !== "answer") {
      const w = latestProposal();
      const free = !w || lastUndo.proposalIds.includes(w.id);
      if (UNDO_ONLY.test(text) || (NO_ONLY.test(text) && free && !refs().some((r) => tracker.getSession(r)))) return done({ answer: undoReading() });
    }
    if (intent === "confirm" || intent === "cancel") {
      const p = latestProposal();
      if (!p) return done({ answer: T("There is nothing waiting for confirmation.", "אין כרגע שום דבר שמחכה לאישור.") });
      const r = intent === "confirm" ? confirmProposal(p.id) : cancelProposal(p.id);
      return done({ answer: r.answer });
    }

    const ref = resolveRef(text, courseId, courseName);

    if (intent === "progress") {
      const trackedRefs = refs().filter(tracked);
      const list = ref ? [ref] : trackedRefs.length ? trackedRefs : refs(); // with no timetable at all, still show what is known (positions, assignments)
      if (!list.length) return done({ answer: T("I do not have the timetable for these courses yet.", "עדיין אין לי מערכת שעות לקורסים האלה.") });
      for (const r of list) maybeAlign(r);
      const body = list.map(courseLines).join("\n\n");
      // The same question is not asked again within 7 days, unless the student asks "where am I" (then the answer is the report again, with the question).
      const asked = list.filter((r) => !tracker.progress(r).positionKnown && (WHERE_Q.test(text) || !askedRecently(r)));
      const first = positionQuestion(asked);
      if (first) for (const r of asked) tracker.markAsked(r, { position: true });
      return done({ answer: `${T(`Where you should be (timetable, ${niceDate(today())}) and where you are:`, `איפה צריך להיות (לפי המערכת, ${niceDate(today())}) ואיפה עומדים בפועל:`)}\n\n${body}${first}`, study: { courses: list.map((r) => tracker.progress(r)) } });
    }

    // quiz / answer: the tutor
    if (!ref) return done({ answer: whichCourse() });
    const align = maybeAlign(ref);
    const noSolution = SOLUTION_ASK.test(text) ? T("I will not write the full solution of an assignment: that is the part that teaches the most. I can guide step by step, so here is how.\n\n", "פתרון מלא של מטלה אני לא כותב: זה החלק שהכי מלמד. אפשר ללוות צעד אחר צעד, אז הנה איך.\n\n") : "";
    const savedNow = await autoSavePageAssignments(ref).catch(() => []);
    const r = await tutor.turn({ tracker, ref, intent, message: text, pages: ref.courseId ? courses.allPages(ref.courseId) : [], courseName: ref.name, askChain, now: now(), log, onText, range: intent === "quiz" ? rangeFor(ref, text) : null, notes: null });
    if (savedNow.length) r.answer = T(`I saved "${savedNow.join('", "')}" from the file you uploaded to ${ref.name}.\n\n`, `שמרתי את "${savedNow.join('", "')}" מהקובץ שהעלית ${bet(ref.name)}.\n\n`) + r.answer;
    return done({ ...r, mode: "study", answer: noSolution + r.answer + (intent !== "answer" ? align : ""), study: { course: ref.name, mode: r.mode, done: r.done } });
  }

  // ---- THE BRAIN'S STUDY TOOLS (brain.js) ----
  // The model understood Omri's message and hands in CHECKED VALUES (a date, minutes, a part name, closed fields); nothing here scans
  // Omri's words. Each function checks its values in code and returns text written by code.
  const refOfCourse = (courseId) => refs().find((r) => r.courseId === courseId) || null;
  const brainTools = {
    // Reserve duty or a break: the study nudges stop until a date, or until resume.
    pause({ until = "", lang = "en" } = {}) {
      curLang = lang;
      if (until && (!plan.isIsoDate(until) || until < today())) throw new Error("until must be a real date (YYYY-MM-DD), today or later; leave it empty for 'until Omri says resume'");
      nudges.pause(until || null);
      const s = nudges.settings();
      return T(`Study reminders are PAUSED${s.pausedUntil ? ` until ${niceDate(s.pausedUntil)}` : " until Omri says to resume"}. Progress is kept.`, `תזכורות הלימוד מושהות${s.pausedUntil ? ` עד ${niceDate(s.pausedUntil)}` : " עד שיתבקש לחדש אותן"}. ההתקדמות נשמרת.`);
    },
    resume({ lang = "en" } = {}) { curLang = lang; nudges.resume(); return T("Study reminders are ON again.", "תזכורות הלימוד חזרו לפעול."); },
    // One realistic plan across all courses (code only): deadlines first, then the courses in turns.
    plan({ minutes = null, todayOnly = false, lang = "en" } = {}) {
      curLang = lang;
      const m = Number(minutes);
      return { mode: "study", answer: catchupPlan("", refs(), { minutes: Number.isInteger(m) && m >= 15 && m <= 600 ? m : null, todayOnly: todayOnly === true }) };
    },
    // Teaches the next part of a course (or the part named), one chunk, from the real notes; the part is matched by code against the outline.
    async teach({ courseId, part = "", lang = "en", onText = null } = {}) {
      curLang = lang;
      const ref = refOfCourse(courseId);
      if (!ref) return { mode: "study", answer: whichCourse() };
      const text = clean(part, 200);
      const align = maybeAlign(ref);
      const pick = await notesPick(ref, text);
      if (pick && pick.say) return { mode: "study", answer: pick.say };
      const r = await tutor.turn({ tracker, ref, intent: "teach", message: text || "the next part", pages: ref.courseId ? courses.allPages(ref.courseId) : [], courseName: ref.name, askChain, now: now(), log, onText, range: null, notes: pick, lang }); // the brain knows the language; the part name alone does not say it
      return { ...r, mode: "study", answer: r.answer + align, study: { course: ref.name, mode: r.mode, done: r.done } };
    },
    // An exam date becomes a Confirm card; it is stored only when Omri confirms.
    exam({ courseId, date, lang = "en" } = {}) {
      curLang = lang;
      const ref = refOfCourse(courseId);
      if (!ref) throw new Error("that course is not in the study tracker");
      if (!plan.isIsoDate(date) || date <= today() || plan.daysBetween(today(), date) > standing.EXAM_MAX_DAYS) throw new Error("the exam date must be a real date (YYYY-MM-DD) after today and within a year");
      return { proposal: card(addProposal({ kind: "exam", ref, date })), date: niceDate(date) };
    },
    // Where Omri stands in a course, as closed fields the model proposes; code keeps only what fits the timetable and the notes.
    position({ courseId, fields, said = "", lang = "en" } = {}) {
      curLang = lang;
      const ref = refOfCourse(courseId);
      if (!ref) throw new Error("that course is not in the study tracker");
      const out = storeReading(ref, String(said), fields && typeof fields === "object" ? fields : {}, standingContext(ref), false, { byBrain: true });
      if (!out) throw new Error("none of the fields could be used (they must be values from the closed lists, and a place must exist in the timetable or the notes)");
      lastUndo = { items: [out.undo], proposalIds: [out.proposalId].filter(Boolean), at: now() };
      keepUndo({ kind: "position", key: ref.key, position: out.undo.position, pending: out.undo.pending, proposalIds: lastUndo.proposalIds, by: "brain" });
      return { text: out.answer, ...(out.proposal ? { proposal: out.proposal } : {}) };
    },
    // A class that was cancelled (Bot cannot know by itself): the date must be a real lecture of that course in the timetable.
    // It is removed from the timetable's count, so the lecture numbers after it move up and Bot does not call that class "behind".
    classCancelled({ courseId, date, lang = "en" } = {}) {
      curLang = lang;
      const ref = refOfCourse(courseId);
      if (!ref) throw new Error("that course is not in the study tracker");
      const all = tracker.timetableDates(ref.key);
      if (!all.length) throw new Error(`${ref.name} has no lectures in the timetable, so there is no class to cancel`);
      if (!plan.isIsoDate(date)) throw new Error("date must be a real date (YYYY-MM-DD)");
      if (!all.includes(date)) {
        const near = [...all.filter((d) => d < date).slice(-2), ...all.filter((d) => d > date).slice(0, 2)];
        throw new Error(`${ref.name} has no lecture on ${date} in the timetable. Its lectures around that date: ${near.join(", ")}. Ask Omri which one if it is not clear`);
      }
      if (!tracker.slotOn(ref.key, date)) return T(`That was already noted: no ${ref.name} lecture on ${niceDate(date)}.`, `זה כבר רשום: אין הרצאה של ${ref.name} ב-${niceDate(date)}.`);
      tracker.addSkip({ date, course: ref.key });
      lastUndo = { skip: { ref, date }, at: now() };
      keepUndo({ kind: "skip", key: ref.key, date });
      return T(`Noted: no ${ref.name} lecture on ${niceDate(date)}. It is out of the count, so the lecture numbers after it move up by one.`, `נרשם: אין הרצאה של ${ref.name} ב-${niceDate(date)}. היא ירדה מהספירה, ולכן מספרי ההרצאות שאחריה זזים באחד.`);
    },
    // Takes back the last position() or classCancelled(): the old record returns. With a course: the last change of THAT course
    // (also one the end-of-day review made), kept for 48 hours. Without one: the change just made, else the newest kept one.
    undo({ lang = "en", courseId = null } = {}) {
      curLang = lang;
      const wanted = courseId ? refOfCourse(courseId) : null;
      if (courseId && !wanted) throw new Error("that course is not in the study tracker");
      const lastKeys = !lastUndo ? [] : lastUndo.skip ? [lastUndo.skip.ref.key] : lastUndo.items.map((it) => it.ref.key);
      if (lastUndo && now() - lastUndo.at < UNDO_MS && (!wanted || lastKeys.includes(wanted.key))) return undoReading();
      const saved = readUndo().filter((e) => !wanted || e.key === wanted.key).sort((a, b) => b.at - a.at)[0];
      if (!saved) throw new Error(`there is nothing to undo${wanted ? ` for ${wanted.name}` : ""} (only the last stored position or cancelled class of a course, within 48 hours)`);
      return undoSaved(saved);
    },
  };


  // THE END-OF-DAY REVIEW (thread-summary.js, Omri 2026-11-14): Bot keeps track of where Omri is by itself. The review model PROPOSED
  // these from the day's talk; each item already carries a word-for-word quote of one of OMRI'S OWN messages (checked there).
  // Here they pass the same checks as study_position (standing.checkStanding: closed lists, the timetable, the notes' outline):
  //   - a course that is not one of Omri's, fields that do not fit, or nothing new -> skipped, silently (nothing is invented);
  //   - a record that is NEWER than the quoted message (Omri told Bot something later, or the brain stored it live) -> skipped;
  //   - what is stored: the old record is kept for undo (48 hours, "undo <course>"), and Omri is told in one line per course.
  // It never touches "understood" (only a graded quiz does) and never makes an exam card.
  // items: [{ course (exact name), fields, quote, at }]. Returns { lines: [{ course, text, quote }], text } (text "" = nothing changed).
  function reviewPositions(items = [], { lang = "en", day = "" } = {}) {
    curLang = lang;
    const lines = [];
    const firstBefore = new Map();
    for (const it of [...(Array.isArray(items) ? items : [])].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0)).slice(0, 12)) {
      const ref = it && refs().find((r) => r.name === it.course);
      if (!ref || !it.fields || typeof it.fields !== "object") continue;
      const old = tracker.course(ref).position;
      if (!firstBefore.has(ref.key) && Number(old.at) >= Number(it.at)) continue;
      const raw = {};
      for (const k of V2_KEYS) if (it.fields[k] !== undefined) raw[k] = it.fields[k];
      const ctx = standingContext(ref);
      const res = standing.checkStanding(raw, ctx);
      if (!res.any) continue;
      if (Object.keys(res.fields).every((k) => JSON.stringify(res.fields[k]) === JSON.stringify(old[k]))) continue; // already known
      const before = { position: old, pending: tracker.pendingQuestion(ref) };
      const out = storeReading(ref, String(it.quote || ""), raw, ctx, false, { byBrain: true });
      if (!out) continue;
      if (out.proposalId) proposals.delete(out.proposalId);
      if (!firstBefore.has(ref.key)) firstBefore.set(ref.key, before);
      lines.push({ course: ref.name, text: standing.describe(res.fields, res.notes, lang).join("; "), quote: clean(it.quote, 120) });
    }
    for (const [key, b] of firstBefore) keepUndo({ kind: "position", key, position: b.position, pending: b.pending, proposalIds: [], by: "review" });
    if (!lines.length) return { lines, text: "" };
    const when = !plan.isIsoDate(day) || day === today() ? T("today", "היום") : T(`on ${niceDate(day)}`, `ב-${niceDate(day)}`);
    const list = lines.map((l) => T(`- ${l.course}: ${l.text} (you wrote: "${l.quote}")`, `- ${l.course}: ${l.text} (נכתב: "${l.quote}")`)).join("\n");
    const first = lines[0].course;
    const text = T(
      `From what you wrote ${when} I updated where you are:\n${list}\nIf one is wrong, tell me "undo ${first}" (it works for 48 hours). This is only where you are: "understood" still comes only from my quiz.`,
      `לפי מה שנכתב ${when} עודכן המצב בקורסים:\n${list}\nאם משהו לא נכון, אפשר לכתוב "בטל ${first}" (אפשרי במשך 48 שעות). זה רק המקום בקורס: "הובן" נקבע רק לפי הבוחן.`);
    return { lines, text };
  }

  return { brainTools, reviewPositions, answerStudy, morningBlock: () => nudges.morningBlock(), progressLog, onUpload, confirmProposal, cancelProposal, pendingProposal: () => { const p = latestProposal(); return p ? card(p) : null; }, tracker, nudges, INTENTS };
}

module.exports = { createStudyCoach, INTENTS };
