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
const { checkPositions, proposePositions } = require("./study-positions");
const { createNudges } = require("./study-nudges");
const tutor = require("./tutor");
const { lectureIndex, askedLectures } = require("./study");
const standing = require("./standing");
const outlineLib = require("./outline");
const { buildOutline } = outlineLib;
const catchup = require("./catchup");
const { MODELS } = require("./router");

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
  // The course Bot itself just asked about (within a day): an open position question, or a file card that asks "which date was it". It is the NEWEST one,
  // and, when `strict`, only when that is clear (two questions asked at the same moment, like one report that asks about three courses, are not a clear
  // answer for free text; the older plain "last lecture" facts keep taking the first of them).
  function lastAsked(strict = true) {
    const found = refs().map((r) => ({ r, at: (tracker.pendingQuestion(r) || {}).at || 0 })).filter((x) => x.at && now() - x.at < PENDING_MS);
    for (const p of proposals.values()) if (p.kind === "material" && p.question && p.expiresAt >= now() && now() - p.createdAt < PENDING_MS) found.push({ r: p.ref, at: p.createdAt });
    found.sort((a, b) => b.at - a.at);
    if (!found.length || (strict && found[1] && found[1].at === found[0].at && found[1].r.key !== found[0].r.key)) return null;
    return found[0].r;
  }
  // The course Bot itself just asked about, else the only course there is.
  function askedCourse() {
    const asked = lastAsked(false);
    if (asked) return asked;
    const all = refs();
    return all.length === 1 ? all[0] : null;
  }
  // One line for the front desk prompt (code-written data): the answer to Bot's own question belongs to THAT course, not to the course of the last chat.
  function questionLine() {
    try { const r = lastAsked(); return r ? `Bot just asked the user a question about the course ${r.name}: the user's next message is probably the answer and belongs to ${r.name} (studyIntent update, course ${r.name}).` : ""; } catch (error) { return ""; }
  }
  const courseNames = () => refs().map((r) => r.name).join(", ");
  const DUE_WORDS = /\b(?:homework|assignment|exercise|hw|due|submit|submission|deadline|exam|test|quiz)\b|מטלה|תרגיל|הגשה|מבחן|בוחן/i;
  const MISSED = /\b(?:skipp?ed|missed|bunked)\b[^.\n]{0,30}\b(?:class|classes|lecture|lectures|lesson|university|school)\b|דילגתי|פספסתי|לא\s+הלכתי/i;
  const IS_QUESTION = /\?|^\s*(?:which|what|when|where|how\s+many|do\s+i|did\s+i|is\s+there|are\s+there|any)\b|^\s*(?:איזה|איזו|מה|מתי|כמה|יש\s+לי|האם)/i;

  // ---- the student's own description of their state ("I'm at page 40, only reading the notes") ----
  // A rough code test, used only to decide whether words are KEPT. It never places anything and never sets "understood".
  const FIRST_PERSON = /\b(?:i|i['’]m|i['’]ve|i['’]d|we|we['’]re|we['’]ve)\b|אני|אנחנו|הייתי|קראתי|התחלתי|דילגתי|עברתי|למדתי/i;
  const STATE_WORDS = /\b(?:page|pages|chapter|section|behind|ahead|caught\s+up|revis\w+|reading|read|studied|studying|started|haven['’]t|hasn['’]t|nothing|skipped|missed|lost|slides|notes|(?:in|at|on|through|finished|after)\s+(?:the\s+)?(?:lecture|lesson|class)\s*\d+)\b|עמוד|פרק|מאחור|בפיגור|קורא|חוזר|חזרתי|התחלתי|סיכומים|שקפים|אבוד|הרצאה\s*\d+|שבוע(?:יים|ות)?\s+(?:מאחור|בפיגור)/i;
  const WHERE_Q = /\bwhere\s+(?:am\s+i|i\s+am|do\s+i\s+stand)\b|\bhow\s+am\s+i\s+doing\b|\b(?:my|the)\s+(?:status|progress)\b|איפה\s+אני|מה\s+המצב|איפה\s+אני\s+עומד/i;
  const looksLikeState = (t) => FIRST_PERSON.test(t) && STATE_WORDS.test(t);
  const SAID_MAX = 300;
  const PENDING_MS = 24 * 3600 * 1000, NO_REPEAT_MS = 7 * 24 * 3600 * 1000;
  // Courses Bot asked "where are you" about in the last day and has no answer for yet, newest first.
  function pendingRefs() {
    return refs().map((r) => ({ r, at: (tracker.pendingQuestion(r) || {}).at || 0 })).filter((x) => x.at && now() - x.at < PENDING_MS).sort((a, b) => b.at - a.at).map((x) => x.r);
  }
  const askedRecently = (ref) => { const at = tracker.course(ref).askedPosition || 0; return !!at && now() - at < NO_REPEAT_MS; };
  // Which course do the student's words belong to? Named in the words, else the course the front desk chose, else the ONE course Bot asked about,
  // else the only course there is. Never a guess between several.
  function targetFor(seg, courseId, courseName, text) {
    const named = refInText(seg);
    if (named) return named;
    const asked = lastAsked(); // an answer to Bot's own question belongs to the course Bot ASKED about, whatever the last chat was about
    if (asked) return asked;
    const desk = resolveRef(text, courseId, courseName);
    if (desk) return desk;
    const all = refs();
    return all.length === 1 ? all[0] : null;
  }
  // Keep the words, say so, and say honestly what code could and could not place. `placeNote` is already a sentence (or "").
  function keptLine(target, said, placeNote = "") {
    const w = clean(said, 140);
    return T(`${target.name}: I kept your words: "${w}". ${placeNote}That tells me where you are, not what you understood: that only comes from my questions. If it is off, write it again.`, `${target.name}: שמרתי את מה שכתבת: "${w}". ${placeNote}זה אומר לי איפה עומדים, לא מה הובן: את זה בודקים רק בשאלות. אם זה לא מדויק, אפשר לכתוב שוב.`);
  }
  // The words kept for a course: the whole message, unless it talks about several courses (then only the sentences that name this one).
  const wordsFor = (ref, text) => {
    const parts = String(text).split(/\n|(?<=[.!?])\s+/);
    const named = new Set(parts.map((p) => refInText(p)).filter(Boolean).map((r) => r.key));
    if (named.size <= 1) return clean(text, SAID_MAX);
    return clean(parts.filter((p) => { const r = refInText(p); return r && r.key === ref.key; }).join(" ") || text, SAID_MAX);
  };

  // ---- the line for the front desk ----
  function studyLine() {
    try {
      const out = [];
      for (const ref of refs().filter(tracked)) {
        const p = tracker.progress(ref);
        const due = p.assignments.filter((a) => a.due && plan.daysBetween(today(), a.due) >= 0 && plan.daysBetween(today(), a.due) <= 7);
        const modeBit = p.position.mode ? `, student says: ${p.position.mode}${p.position.pace ? "/" + p.position.pace : ""}` : "";
        out.push(`${ref.name}: ${p.held} lectures held, ${p.understood} checked as understood, ${!p.position.mode || p.position.mode === "attending" ? p.behind.length + " behind" : "catch-up count not used"}${modeBit}${p.positionKnown ? "" : ", student's position unknown"}${due.length ? `, due soon: ${due.map((a) => `${clean(a.title, 40)} ${a.due}`).join(", ")}` : ""}`);
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
  const THROUGH = /teach|explain|through|concept|walk\s+me|learn|from\s+scratch|prerequisite|תלמד|תסביר|דרך|מושג|רעיונות|מאפס/i;
  function notesView(ref) {
    const pages = ref.courseId ? courses.allPages(ref.courseId) : [];
    const outline = buildOutline(pages);
    return { pages, outline, chunks: catchup.chunksOf(outline, pages) };
  }
  // A course whose teaching comes from its notes: it has a big notes file (one file, or one file holding at least half of the text) and
  // the student did not name a lecture of a timetable that has lecture material.
  function notesCourse(ref, v = notesView(ref)) {
    if (!v.chunks.length) return false;
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
  // "Teach me through the assignment": the next idea the assignment needs, with pieces of the notes about it. null when there is no assignment with ideas saved.
  function throughArgs(ref, text) {
    if (!THROUGH.test(text)) return null;
    const a = tutor.pickAssignment({ tracker, ref, message: text });
    if (!a || !a.needs.length) return null;
    const idx = Math.max(0, Number(((tracker.course(ref).pathIdx || {})[a.id]) || 0));
    const concept = a.needs[idx];
    let extra;
    if (concept) { const v = notesView(ref); const units = catchup.matchSections(v.outline, concept, undefined, v.pages); const titles = new Set(units.map((u) => u.title)); const cs = v.chunks.filter((c) => titles.has(c.title)).slice(0, 2); if (cs.length) extra = cs.map(piece); }
    return { assignment: a, concept, index: idx, total: a.needs.length, concepts: a.needs, extra, onTaught: () => { const c = tracker.course(ref); tracker.save({ ...c, pathIdx: { ...(c.pathIdx || {}), [a.id]: idx + 1 } }); } };
  }

  // ---- the catch-up plan across all courses ----
  const ALL_BEHIND = /\b(?:behind|lost|drowning|nothing)\b[^.\n]{0,30}\b(?:everything|all\s+(?:of\s+)?(?:my\s+)?(?:courses|classes)|every\s+(?:course|class))\b|\beverything\b[^.\n]{0,20}\bbehind\b|(?:בפיגור|מאחור|אבוד|אבודה)\s+(?:ב)?(?:הכל|כל\s+הקורסים)|בהכל\s+(?:מאחור|בפיגור|אבוד)|בכל\s+הקורסים/i;
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
      let rest = v.chunks.slice(at + 1).filter((c) => !state.taught.includes(c.key));
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
    for (const a of p.assignments) out.push({ ...base, kind: "assignment", deadline: a.due || null, label: `${ref.name}: ${T("assignment", "מטלה")} "${clean(a.title, 40)}"`, minutes: catchup.MINUTES.assignment, say: T("teach me through the assignment", "תלמד אותי דרך המטלה") });
    if (exam && plan.daysBetween(today(), exam) <= 14) out.push({ ...base, kind: "review", label: `${ref.name}: ${T("review before the exam", "חזרה לפני המבחן")}`, minutes: catchup.MINUTES.review, say: T(`quiz me on ${ref.name}`, `תבחן אותי ${bet(ref.name)}`) });
    return out;
  }
  function catchupPlan(text, list = refs()) {
    const budget = catchup.parseBudget(text) || catchup.DEFAULT_BUDGET;
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
    const onlyToday = TODAY_WORDS.test(text) && !WEEK_WORDS.test(text);
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
  function nextStep(ref) {
    const p = tracker.progress(ref);
    const a = p.assignments.find((x) => x.due && plan.daysBetween(today(), x.due) >= 0 && plan.daysBetween(today(), x.due) <= 7);
    if (a) return T(`The next step with a real date: "${clean(a.title, 60)}" is due ${niceDate(a.due)}. Say "help me start" and I check what it needs.`, `הצעד הבא עם תאריך אמיתי: "${clean(a.title, 60)}" להגשה עד ${niceDate(a.due)}. אפשר לכתוב "תעזור לי להתחיל" ואבדוק מה צריך בשביל זה.`);
    // What the student said about how they study decides the kind of step (their record, not a guess).
    const mode = p.position.mode;
    if (mode === "paused") return T(`${ref.name}: you said you are not studying it for now, so I suggest nothing. Tell me when that changes.`, `${ref.name}: נכתב שלא לומדים את זה כרגע, אז אני לא מציע כלום. אפשר לעדכן אותי כשזה משתנה.`);
    if (mode === "revising") return T(`${ref.name}: you are revising, so the smallest step is a short quiz on what you already covered${p.position.depth === "shaky" ? ", starting with the parts you say sit badly" : ""}. Say "quiz me".`, `${ref.name}: חוזרים על החומר, אז הצעד הקטן הוא חידון קצר על מה שכבר נלמד${p.position.depth === "shaky" ? ", מתחילים בחלקים שלא יושבים טוב" : ""}. אפשר לכתוב "תבחן אותי".`);
    if (mode === "selfStudy" || mode === "notStarted" || (!tracked(ref) && notesOf(ref).files)) {
      const c = nextChunk(ref, p.position);
      if (c) return T(`The next piece of ${ref.name} in your notes: "${clean(c.title, 60)}"${c.pages ? ` (about ${c.pages} page${c.pages === 1 ? "" : "s"})` : ""}. Ask me to explain it, or say "quiz me" after you read it.`, `החלק הבא ${bet(ref.name)} בסיכומים: "${clean(c.title, 60)}"${c.pages ? ` (בערך ${c.pages === 1 ? "עמוד אחד" : `${c.pages} עמודים`})` : ""}. אפשר לבקש שאסביר אותו, או לכתוב "תבחן אותי" אחרי הקריאה.`);
    }
    const b = p.behind.find((x) => x.hasMaterial || x.topic);
    if (b) return T(`The smallest next step: lecture ${b.n} (${niceDate(b.date)}) of ${ref.name}. "Teach me" and I explain it, or "quiz me" and you try first.`, `הצעד הקטן הבא: הרצאה ${b.n} (${niceDate(b.date)}) ${bet(ref.name)}. "תלמד אותי" ואסביר אותה, או "תבחן אותי" כדי לנסות קודם לבד.`);
    const empty = p.behind.find((x) => !x.hasMaterial && !x.topic);
    if (empty) return T(`Lecture ${empty.n} of ${ref.name} (${niceDate(empty.date)}) has nothing in Bot yet. Send the slides or tell me its topic, and we can start.`, `להרצאה ${empty.n} ${bet(ref.name)} (${niceDate(empty.date)}) עדיין אין חומר ב-Bot. אפשר לשלוח את השקפים או לכתוב לי את הנושא, ונתחיל.`);
    return p.held ? T(`${ref.name} is on track by the timetable. A 3-question review keeps it that way: "quiz me".`, `${ref.name} בקצב לפי המערכת. חזרה של 3 שאלות תשמור על זה: "תבחן אותי".`) : T(`${ref.name} has no lectures held yet.`, `${bet(ref.name)} עדיין לא היו הרצאות.`);
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
  function interpretUpdate(text, { courseId = null, courseName = null } = {}) {
    const all = refs();
    const t = tracker.timetable();
    const lines = [];
    const unclear = [];
    const segments = String(text).split(/\n|;|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const ref = refInText(seg);
      const undo = UNDO_WORDS.test(seg);
      if (SKIP_WORDS.test(seg) || undo) {
        const day = parseDay(seg, "week");
        const course = ref ? ref.key : /classes|university|school|לימודים/i.test(seg) ? "*" : null;
        if (!day || !course) { unclear.push(seg); continue; }
        if (ref && !tracked(ref)) { lines.push(T(`I have no timetable for ${ref.name}, so there is no lecture of it to remove and I changed nothing. Tell me when a lecture happened ("my last ${ref.name} lecture was Monday") and I note where you are.`, `אין לי מערכת שעות ${bet(ref.name)}, אז אין הרצאה להסיר ולא שיניתי כלום. אפשר לספר לי מתי הייתה הרצאה ואני רושם איפה עומדים.`)); continue; }
        if (undo) { const d = day.date || null; if (!d) { unclear.push(seg); continue; } tracker.removeSkip({ date: d, course }); lines.push(T(`Put the ${ref ? ref.name + " " : ""}lecture on ${niceDate(d)} back in the count.`, `החזרתי לספירה את ההרצאה${ref ? ` ${bet(ref.name)}` : ""} מ${niceDate(d)}.`)); continue; }
        if (day.date && ref && !tracker.slots(ref.key).some((x) => x.date === day.date)) { lines.push(T(`${ref.name} has no lecture on ${niceDate(day.date)} by the timetable, so nothing changed.`, `לפי המערכת אין הרצאה ${bet(ref.name)} ב${niceDate(day.date)}, אז לא שיניתי כלום.`)); continue; }
        const dates = day.week ? (course === "*" ? all.filter(tracked).flatMap((r) => tracker.skipWeek(r.key)) : tracker.skipWeek(course)) : [tracker.addSkip({ date: day.date, course }) && day.date];
        const removedDays = [...new Set(dates)].sort().map((d) => niceDate(d)).join(", ");
        lines.push(dates.length ? T(`Removed ${ref ? ref.name : "every course"}: ${removedDays}. The lecture numbers after it moved up. (Say "there was a lecture on <day>" to undo.)`, `הסרתי ${ref ? `את ${ref.name}` : "את כל הקורסים"}: ${removedDays}. מספרי ההרצאות שאחריה זזו. (כדי לבטל: "הייתה הרצאה ב<יום>".)`) : T(`${ref ? ref.name : "That"} has no lecture that day, so nothing changed.`, `${ref ? `${bet(ref.name)} ` : ""}אין הרצאה ביום הזה, אז לא שיניתי כלום.`));
        continue;
      }
      const hasFact = askedLectures(seg).length || (parseDay(seg, "past") || {}).date;
      if (!DUE_WORDS.test(seg) && (POSITION_WORDS.test(seg) || hasFact) && (hasFact || !looksLikeState(seg))) {
        // No course in the message: the one Bot just asked about. But "my last Biology lecture ..." names a course Bot does not have: never reassign it.
        const namesOther = /\b(?:last|latest)\s+(?!lecture|class)[\p{L}\s.-]{2,40}?\s+(?:lecture|class)\b/iu.test(seg);
        const target = ref || (namesOther ? null : askedCourse());
        if (!target) { unclear.push(seg); continue; }
        const n = askedLectures(seg)[0];
        const day = n ? null : parseDay(seg, "past");
        try {
          // A course with no timetable cannot count lectures: store exactly what the student said as the position (their words are the source).
          const loose = !tracked(target);
          const said = n ? T(`lecture ${n}`, `הרצאה ${n}`) : day && day.date ? niceDate(day.date) : clean(seg, 60);
          const words = wordsFor(target, text);
          const pos = loose ? tracker.setPosition(target, { note: said, said: words }) : n ? tracker.setPosition(target, { n, said: words }) : day && day.date ? tracker.setPosition(target, { date: day.date, said: words }) : tracker.setPosition(target, { note: seg, said: words });
          const upTo = pos.seenThrough ? niceDate(pos.seenThrough) : clean(pos.note, 60);
          lines.push(T(`${target.name}: noted that you are up to ${upTo}.${loose ? " I have no timetable for this course, so I cannot count lectures by date." : ""} Your words are kept: "${clean(words, 100)}". That tells me where you are, not what you understood: that comes from questions.`, `${target.name}: רשמתי שהמיקום הוא עד ${upTo}.${loose ? " אין לי מערכת שעות לקורס הזה, אז אי אפשר לספור הרצאות לפי תאריך." : ""} המילים שלך נשמרו: "${clean(words, 100)}". זה אומר לי איפה עומדים, לא מה הובן: את זה בודקים בשאלות.`));
        } catch (error) {
          // Code could not place it (for example "lecture 99" when the timetable holds 6): the student's words are still kept, and Bot says so.
          const held = tracker.progress(target).held;
          try {
            const words = wordsFor(target, text);
            tracker.setPosition(target, { said: words });
            lines.push(keptLine(target, words, n ? T(`The timetable shows ${held} held so far, so I could not place lecture ${n} on it. `, `לפי המערכת עד עכשיו היו ${held} הרצאות, אז לא הצלחתי למקם הרצאה ${n} עליה. `) : T("I could not place it on a lecture or a date. ", "לא הצלחתי למקם את זה על הרצאה או תאריך. ")));
          } catch (e2) { lines.push(T(`${target.name}: I could not keep that.`, `${target.name}: לא הצלחתי לשמור את זה.`)); }
        }
        continue;
      }
      // A description of their own state that code cannot place ("page 40, only reading the notes"): the words are kept, never dropped.
      if (!DUE_WORDS.test(seg) || STATE_WORDS.test(seg)) {
        if (looksLikeState(seg)) {
          const target = targetFor(seg, courseId, courseName, text);
          if (target) {
            try { const words = wordsFor(target, text); tracker.setPosition(target, { said: words }); lines.push(keptLine(target, words, "")); continue; } catch (error) { /* falls to unclear */ }
          } else { lines.push(T(`I did not keep "${clean(seg, 100)}" yet because I do not know which course it is about. Which one? ${courseNames()}.`, `עדיין לא שמרתי את "${clean(seg, 100)}" כי לא ברור לי על איזה קורס מדובר. איזה קורס? ${courseNames()}.`)); continue; }
        }
      }
      unclear.push(seg);
    }
    return { lines, unclear };
  }

  // The "I did not catch" help: examples use the student's REAL course names (never invented ones).
  function helpLine(unclear) {
    const all = refs();
    const a = all[0] ? all[0].name : null, b = all[1] ? all[1].name : a;
    const bits = [a && `"no ${a} lecture this week"`, '"no classes on 24 Dec"', a && `"my last ${a} lecture was Monday"`, b && `"lecture 4 in ${b}"`].filter(Boolean);
    const heBits = [a && `"אין הרצאה ${bet(a)} השבוע"`, '"אין לימודים ב-24/12"', a && `"ההרצאה האחרונה שלי ${bet(a)} הייתה ביום שני"`, b && `"הרצאה 4 ${bet(b)}"`].filter(Boolean);
    return T(`I did not catch: "${clean(unclear.join(" / "), 160)}". ${all.length ? `Your courses: ${courseNames()}. ` : ""}Tell me for example: ${bits.join(", ")}.`, `לא הבנתי: "${clean(unclear.join(" / "), 160)}". ${all.length ? `הקורסים שלך: ${courseNames()}. ` : ""}אפשר לכתוב למשל: ${heBits.join(", ")}.`);
  }

  // "I skipped class today, what did I miss?": the lectures of that day by the timetable, in a few lines. Code only.
  function missedAnswer(text) {
    const day = (parseDay(text, "past") || {}).date || today();
    const named = refInText(text);
    const list = named ? [named] : refs();
    const rows = list.filter(tracked).flatMap((r) => tracker.slots(r.key).filter((s) => s.date === day).map((s) => ({ r, s })));
    if (!rows.length) {
      return refs().some(tracked)
        ? T(`By the timetable there was no lecture on ${niceDate(day)}${named ? ` in ${named.name}` : ""}, so nothing was missed. Say "where am I" to see your whole status.`, `לפי המערכת לא הייתה הרצאה ב${niceDate(day)}, אז לא פספסת כלום. אפשר לשאול "מה המצב שלי" לתמונה מלאה.`)
        : T(`I have no timetable for ${named ? named.name : "your courses"}, so I cannot know what was missed. Tell me the topic or send the slides and I can teach it; "quiz me on lecture 1" works when a lecture file is uploaded.`, `אין לי מערכת שעות ${named ? bet(named.name) : "לקורסים שלך"}, אז אני לא יודע מה פספסת. אפשר לכתוב לי את הנושא או לשלוח את השקפים, ואלמד אותו.`);
    }
    const lines = rows.map(({ r, s }) => { const l = tracker.course(r).lectures[s.date]; return T(`${r.name} lecture ${s.n} (${niceDate(s.date)}, ${s.start})${l && (l.material.length || l.topic) ? " - I have material for it" : " - nothing in Bot for it yet"}.`, `${r.name} הרצאה ${s.n} (${niceDate(s.date)}, ${s.start})${l && (l.material.length || l.topic) ? " - יש לי חומר עליה" : " - עדיין אין עליה כלום ב-Bot"}.`); });
    return `${T("By the timetable you missed:", "לפי המערכת פספסת:")}\n${lines.join("\n")}\n${T('Say "teach me <course> lecture <n>" or send the slides.', 'אפשר לכתוב "תלמד אותי הרצאה <מספר>" או לשלוח את השקפים.')}`;
  }

  // "Which course do I have a homework for?": the saved assignments, never a new proposal.
  function assignmentList(ref) {
    const list = ref ? [ref] : refs();
    const rows = list.flatMap((r) => tracker.course(r).assignments.filter((a) => a.status !== "done").map((a) => T(`"${clean(a.title, 60)}" in ${r.name} (${a.status}${a.due ? `, due ${niceDate(a.due)}` : ", no due date saved"})`, `"${clean(a.title, 60)}" ${bet(r.name)} (${STATUS_HE[a.status] || a.status}${a.due ? `, להגשה עד ${niceDate(a.due)}` : ", בלי תאריך הגשה שמור"})`)));
    const w = latestProposal();
    const waiting = w && w.kind === "assignment" ? T(`\nWaiting for your Confirm (not saved yet): "${clean(w.fields.title, 60)}" in ${w.ref.name}${w.fields.due ? `, due ${niceDate(w.fields.due)}` : ""}. Tap Confirm on its card to save it.`, `\nמחכה לאישור שלך (עוד לא נשמרה): "${clean(w.fields.title, 60)}" ${bet(w.ref.name)}${w.fields.due ? `, להגשה עד ${niceDate(w.fields.due)}` : ""}. אפשר ללחוץ על Confirm בכרטיס שלה כדי לשמור.`) : "";
    return rows.length ? `${T("Saved assignments:", "המטלות השמורות:")}\n- ${rows.join("\n- ")}${waiting}` : waiting ? waiting.trim() : T("I have no assignment saved yet. Send me the file or paste the text of the assignment, and I will propose it for you to confirm.", "עדיין אין לי מטלה שמורה. אפשר לשלוח את הקובץ או להדביק את הטקסט של המטלה, ואציע אותה לאישור.");
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
    const { items, problems } = checkPositions(raw, list, heldOf, today(), curLang);
    if (!items.length && !problems.length) return null;
    const stored = new Map();
    for (const it of items) {
      try {
        if (it.kind === "notStarted") { const c = tracker.course(it.ref); c.position = { known: true, seenThrough: null, note: "not started yet", at: now() }; tracker.save(c); stored.set(it.ref.key, T("not started yet", "עוד לא התחיל")); }
        else { tracker.setPosition(it.ref, { n: it.slot.n }); stored.set(it.ref.key, T(`up to lecture ${it.slot.n} (${niceDate(it.slot.date)})${it.kind === "upToDate" ? ", the latest one held" : ""}`, `עד הרצאה ${it.slot.n} (${niceDate(it.slot.date)})${it.kind === "upToDate" ? ", האחרונה שהייתה" : ""}`)); }
        const c = tracker.course(it.ref); c.position = { ...c.position, said: wordsFor(it.ref, text) }; tracker.save(c); // their own words, next to what code placed
      } catch (error) { problems.push(`${it.ref.name}: ${error.message}.`); }
    }
    const lines = list.map((r) => {
      if (stored.has(r.key)) return `${r.name}: ${stored.get(r.key)}.`;
      const p = tracker.progress(r);
      return p.positionKnown ? T(`${r.name}: you did not mention it, so it stays as it was (${p.position.seenThrough ? "up to " + niceDate(p.position.seenThrough) : p.position.note || "set"}).`, `${r.name}: לא הוזכר, אז נשאר כמו שהיה (${p.position.seenThrough ? "עד " + niceDate(p.position.seenThrough) : noteText(p.position.note) || "שמור"}).`) : T(`${r.name}: you did not say, so I still do not know where you are.`, `${r.name}: לא נאמר, אז עדיין לא ידוע לי איפה עומדים.`);
    });
    return [T(`Here is exactly what I stored (today is ${niceDate(today())}):`, `הנה בדיוק מה ששמרתי (היום ${niceDate(today())}):`), ...lines, ...problems, T("If one is wrong, tell me that course again, for example \"Calculus lecture 5\". This only says where you are, not what you understood.", "אם משהו לא נכון, אפשר לכתוב לי שוב על הקורס הזה, למשל \"חדו\"א הרצאה 5\". זה רק אומר איפה עומדים, לא מה הובן.")].join("\n");
  }

  // ---- the student's free description of their state (standing.js) ----
  // A model PROPOSES a reading, code checks it against the timetable and the notes, Bot reads back what it stored, and "no" / "undo" puts the old record back.
  // At most ONE adaptive question follows, never twice within 7 days (unless asked "where am I"). An exam date is never stored without a Confirm card.
  const UNDO_ONLY = /^\s*(?:undo(?:\s+that)?|בטל|ביטול|תבטל)[.!\s]*$/i;
  const NO_ONLY = /^\s*(?:no|nope|no\s+thanks|wrong|that['’]?s\s+(?:not\s+right|wrong)|לא|לא\s+נכון|זה\s+לא\s+נכון)[.!\s]*$/i;
  const DURATION = /\bweeks?\b|\bmonths?\b|\b\d+\s+days\b|שבוע(?:יים|ות)?|חודש/i; // "I skipped two weeks" describes the student's state, it does not ask what was missed today
  const CAUGHT =/\bcaught\s+up\b|\bbut\b[^.\n]*\b(?:rest|everything|else)\b|השלמתי|אבל/i;
  const UNDO_MS = 2 * 3600 * 1000;
  const V2_KEYS = ["mode", "where", "pace", "behindBy", "gaps", "depth", "goal", "focus"];
  let lastUndo = null; // { items: [{ ref, position, pending }], proposalIds: [], at } (memory only: it lives for 2 hours)

  function undoReading() {
    const u = lastUndo;
    lastUndo = null;
    for (const it of u.items) tracker.restoreStanding(it.ref, it.position, it.pending);
    for (const id of u.proposalIds) proposals.delete(id); // the exam card of that reading goes too
    const names = u.items.map((it) => it.ref.name).join(", ");
    return T(`Undone. ${names} ${u.items.length === 1 ? "is" : "are"} back to how ${u.items.length === 1 ? "it was" : "they were"} before. Tell me again in your own words when you want.`, `בוטל. ${names} חזרו למצב שהיה קודם. אפשר לכתוב שוב במילים שלך מתי שנוח.`);
  }
  const heldSlots = (ref) => tracker.slots(ref.key).filter((s) => plan.isHeld(s, now(), timezone));
  function standingContext(ref) {
    const next = tracker.slots(ref.key).find((s) => !plan.isHeld(s, now(), timezone)) || null;
    return standing.contextFor({ held: heldSlots(ref).map((s) => ({ n: s.n, date: s.date })), nextSlot: next ? { n: next.n, date: next.date } : null, outline: buildOutline(ref.courseId ? courses.allPages(ref.courseId) : []), today: today(), lang: curLang, tracked: tracked(ref) });
  }

  // Reads the words for ONE course and stores the result. Returns null when nothing usable came out (the plain rules then keep the words), else
  // { answer, question, proposal?, undo }. It does not ask anything itself: the caller picks the one question of the message.
  async function readOne(target, text) {
    const ctx = standingContext(target);
    const lost = standing.isLost(text);
    let raw = null;
    try { raw = await standing.readStanding({ askChain, text: clean(text, standing.MAX_READ_CHARS), courseName: target.name, ctx, log }); } catch (error) { log(`[standing] reader failed: ${error.message}`); }
    const res = standing.checkStanding(raw, ctx);
    // A written exam date ("the exam is on 22 December"): the reader only knows "in N days", so code reads the date itself (a real date, in the future, within a year).
    if (!res.exam && /\bexam\b|\btest\b|מבחן/i.test(text) && /\d/.test(text)) {
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
    if (!askedAt || now() - askedAt >= NO_REPEAT_MS || WHERE_Q.test(text)) out.question = standing.adaptiveQuestion({ fields: merged, notes: res.notes, dropped: res.dropped, ctx, lang: curLang });
    return out;
  }

  // After a break: where to restart from. For a course with lectures a number or a day, for notes a part or a page.
  function breakQuestion(target) {
    return tracked(target)
      ? T(`One question so that I start from the right place in ${target.name}: what is the last lecture you went through properly? A number ("lecture 3"), a day, or "none".`, `שאלה אחת כדי להתחיל מהמקום הנכון ${bet(target.name)}: מה ההרצאה האחרונה שעברו עליה כמו שצריך? מספר ("הרצאה 3"), יום, או "אף אחת".`)
      : T(`One question so that I start from the right place in ${target.name}: what is the last part of the notes you went through properly? A section name, a page, or "none".`, `שאלה אחת כדי להתחיל מהמקום הנכון ${bet(target.name)}: מה החלק האחרון בסיכומים שעברו עליו כמו שצריך? שם של סעיף, עמוד, או "אף אחד".`);
  }

  // The free description of one course's state, or (multi) of several courses in one message, each read on its own sentences.
  // Returns { answer, proposal? } or null when this path does not apply (the plain rules then try). Exactly ONE question is asked per message.
  async function maybeReadStanding({ text, courseId, courseName, multi = false }) {
    const namesIn = (s) => { const low = String(s).toLowerCase(); const m = new Map(); for (const r of refs()) if (r.name && low.includes(r.name.toLowerCase())) m.set(r.key, r); const x = refInText(s); if (x) m.set(x.key, x); return m; };
    // sentences first; a sentence that names several courses is cut at commas / "and", and a piece with no course name stays with the piece before it
    const pieces = [];
    for (const sentence of String(text).split(/\n|;|(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)) {
      if (namesIn(sentence).size < 2) { pieces.push(sentence); continue; }
      let prev = null;
      for (const frag of sentence.split(/,|\s+and\s+/).map((p) => p.trim()).filter(Boolean)) {
        if (!namesIn(frag).size && prev !== null) pieces[prev] += `, ${frag}`;
        else { pieces.push(frag); prev = pieces.length - 1; }
      }
    }
    const named = namesIn(text);
    for (const p of pieces) for (const [k, r] of namesIn(p)) named.set(k, r);
    if ((named.size >= 2) !== multi) return null; // several courses: the several-course reader first, then each course on its own words
    const jobs = [];
    if (multi) {
      for (const r of named.values()) {
        const mine = pieces.filter((p) => { const x = refInText(p); return (x && x.key === r.key) || (r.name && p.toLowerCase().includes(r.name.toLowerCase())); });
        const seg = mine.join(". ");
        if (seg && standing.shouldRead({ text: seg, declared: true })) jobs.push({ target: r, seg });
      }
    } else {
      const target = targetFor(text, courseId, courseName, text);
      if (!target) return null;
      const pending = pendingRefs().some((r) => r.key === target.key);
      const plainFact = (askedLectures(text).length || parseDay(text, "past")) && !standing.isStateStatement(text);
      if (plainFact || !standing.shouldRead({ text, pending, declared: true })) return null;
      jobs.push({ target, seg: text });
    }
    const done = [];
    for (const j of jobs) { const r = await readOne(j.target, j.seg); if (r) done.push({ ...j, ...r }); }
    if (!done.length) return null;
    lastUndo = { items: done.map((d) => d.undo), proposalIds: done.map((d) => d.proposalId).filter(Boolean), at: now() };
    const first = done.find((d) => d.question);
    let answer = done.map((d) => d.answer).join("\n\n");
    if (first) { tracker.markAsked(first.target, { where: true }); answer += `\n\n${first.question}`; }
    const proposal = (done.find((d) => d.proposal) || {}).proposal;
    return { answer, ...(proposal ? { proposal } : {}) };
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
      return { answer: T(`I read this as an assignment for ${ref.name}: "${p.fields.title}", ${p.fields.due ? `due ${niceDate(p.fields.due)}` : "no due date found"}${p.fields.needs.length ? `, needing: ${p.fields.needs.join(", ")}` : ""}. Is that right? Confirm and I save it; nothing is saved before.`, `הבנתי שזו מטלה ${bet(ref.name)}: "${p.fields.title}", ${p.fields.due ? `להגשה עד ${niceDate(p.fields.due)}` : "לא מצאתי תאריך הגשה"}${p.fields.needs.length ? `, צריך בשבילה: ${p.fields.needs.join(", ")}` : ""}. זה נכון? אחרי אישור אשמור; לפני כן שום דבר לא נשמר.`), proposal: card(p) };
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

  // ---- the answer to a message the front desk marked with a studyIntent ----
  async function answerStudy({ studyIntent, text = "", courseId = null, courseName = null, onText = null }) {
    const t0 = Date.now();
    curLang = langOf(text); // this reply reads in the language the student wrote in
    const done = (r) => ({ mode: "study", answer: "", sources: [], outside: false, model: null, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), ...r });
    let intent = INTENTS.includes(studyIntent) ? studyIntent : "progress"; // an unknown intent is the safest one: only shows numbers

    if (intent === "pause") {
      const day = parseDay(text, "week");
      try { nudges.pause(day && day.date && day.date >= today() ? day.date : null); } catch (error) { return done({ answer: T(`I could not pause: ${error.message}.`, `לא הצלחתי להשהות: ${error.message}.`) }); }
      const s = nudges.settings();
      return done({ answer: T(`Study reminders are paused${s.pausedUntil ? ` until ${niceDate(s.pausedUntil)}` : " until you say resume"}. Your progress is kept. Nothing is lost while you are away.`, `תזכורות הלימוד מושהות${s.pausedUntil ? ` עד ${niceDate(s.pausedUntil)}` : " עד שיתקבל ממך אישור להמשיך"}. ההתקדמות נשמרת, ושום דבר לא הולך לאיבוד בינתיים.`) });
    }
    if (intent === "resume") { nudges.resume(); return done({ answer: T("Study reminders are on again. Welcome back: say \"where am I\" and I will show the real numbers, with no guilt.", "תזכורות הלימוד חזרו לפעול. טוב שחזרת: אפשר לשאול \"מה המצב שלי\" ואראה את המספרים האמיתיים, בלי רגשות אשם.") }); }
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

    // Bot just asked "where are you": the next message ANSWERS it, whatever label the front desk gave it, unless it is clearly another question.
    if (intent === "progress" && pendingRefs().length && !WHERE_Q.test(text) && !(IS_QUESTION.test(text) && !FIRST_PERSON.test(text))) intent = "update";

    // "I'm behind in everything" or "what should I do today/this week" with no course named: one realistic plan across ALL courses (code only).
    if (intent === "plan" && !refInText(text) && !(courseId && refs().some((r) => r.courseId === courseId) && refs().length > 1 && !ALL_BEHIND.test(text))) return done({ answer: catchupPlan(text) });
    if ((intent === "update" || intent === "progress" || intent === "motivate") && ALL_BEHIND.test(text) && !refInText(text)) return done({ answer: catchupPlan(text) });

    if ((intent === "update" || intent === "progress") && MISSED.test(text) && !SKIP_WORDS.test(text) && !(CAUGHT.test(text) && !/\?/.test(text)) && !(DURATION.test(text) && !/\?/.test(text))) return done({ answer: missedAnswer(text) });

    if (intent === "update") {
      if (!SKIP_WORDS.test(text) && !UNDO_WORDS.test(text)) {
        const reading = await maybeReadStanding({ text, courseId, courseName });
        if (reading) return done(reading);
        const many = await interpretPositions(text); if (many) return done({ answer: many });
        const each = await maybeReadStanding({ text, courseId, courseName, multi: true }); // several courses, but the several-course reader had nothing: each on its own words
        if (each) return done(each); }
      const { lines, unclear } = interpretUpdate(text, { courseId, courseName });
      if (lines.length || SKIP_WORDS.test(text) || UNDO_WORDS.test(text)) {
        const out = [...lines];
        // "I skipped two weeks and came back": the words are kept above; ONE useful question follows (what is the last part gone through properly).
        if (MISSED.test(text) && DURATION.test(text) && lines.length && !SKIP_WORDS.test(text)) {
          const target = targetFor(text, courseId, courseName, text);
          if (target && !askedRecently(target)) { out.push(breakQuestion(target)); tracker.markAsked(target, { position: true }); }
        }
        const left = unclear.filter((u) => !(IS_QUESTION.test(u) && lines.length)); // "Is that okay?" after kept words needs no help text
        if (left.length) out.push(helpLine(left));
        return done({ answer: out.join("\n") || T("Tell me what changed.", "מה השתנה?") });
      }
      // No schedule fact in the message (for example "I skip class, help me catch up"): do not dead-end; show where they stand and ask.
      intent = "progress";
    }

    const ref = resolveRef(text, courseId, courseName);

    if (intent === "progress" && IS_QUESTION.test(text) && /homework|assignment|\bhw\b|מטלה|שיעורי\s+בית/i.test(text)) return done({ answer: assignmentList(ref) });

    if (intent === "progress" || intent === "plan" || intent === "motivate") {
      const trackedRefs = refs().filter(tracked);
      const list = ref ? [ref] : trackedRefs.length ? trackedRefs : refs(); // with no timetable at all, still show what is known (positions, assignments)
      if (!list.length) return done({ answer: T("I do not have the timetable for these courses yet.", "עדיין אין לי מערכת שעות לקורסים האלה.") });
      for (const r of list) maybeAlign(r);
      if (intent === "motivate") {
        const r = list[0];
        const p = tracker.progress(r);
        const good = p.understood ? T(`You have already checked ${p.understood} lecture${p.understood === 1 ? "" : "s"} of ${r.name}. `, `כבר נבדקו ${p.understood === 1 ? "הרצאה אחת" : `${p.understood} הרצאות`} ${bet(r.name)}. `) : "";
        return done({ answer: `${good}${nextStep(r)} ${T("Fifteen minutes is enough to start.", "רבע שעה מספיקה כדי להתחיל.")}` });
      }
      const body = list.map(courseLines).join("\n\n");
      const next = intent === "plan" ? `\n\n${list.map(nextStep).join("\n")}` : "";
      // The same question is not asked again within 7 days, unless the student asks "where am I" (then the answer is the report again, with the question).
      const asked = list.filter((r) => !tracker.progress(r).positionKnown && (WHERE_Q.test(text) || !askedRecently(r)));
      const first = positionQuestion(asked);
      if (first) for (const r of asked) tracker.markAsked(r, { position: true });
      return done({ answer: `${T(`Where you should be (timetable, ${niceDate(today())}) and where you are:`, `איפה צריך להיות (לפי המערכת, ${niceDate(today())}) ואיפה עומדים בפועל:`)}\n\n${body}${next}${first}`, study: { courses: list.map((r) => tracker.progress(r)) } });
    }

    if (intent === "assignment") {
      if (IS_QUESTION.test(text)) return done({ answer: assignmentList(ref) }); // a question never makes a proposal card
      if (!ref) return done({ answer: whichCourse() });
      const r = await onUpload({ courseId: ref.courseId, text, kind: "assignment" });
      return done(r);
    }

    // teach / quiz / start / answer: the tutor
    if (!ref) return done({ answer: whichCourse() });
    const align = maybeAlign(ref);
    let notes = null, through = null;
    if (intent === "teach") {
      const pick = await notesPick(ref, text);
      if (pick && pick.say) return done({ answer: pick.say });
      notes = pick;
    }
    if (intent === "start") through = throughArgs(ref, text);
    const r = await tutor.turn({ tracker, ref, intent, message: text, pages: ref.courseId ? courses.allPages(ref.courseId) : [], courseName: ref.name, askChain, now: now(), log, onText, range: intent === "quiz" ? rangeFor(ref, text) : null, notes, through });
    return done({ ...r, mode: "study", answer: r.answer + (intent !== "answer" ? align : "") + (r.needs ? "" : ""), study: { course: ref.name, mode: r.mode, done: r.done } });
  }

  return { studyLine, questionLine, answerStudy, morningBlock: () => nudges.morningBlock(), onUpload, confirmProposal, cancelProposal, pendingProposal: () => { const p = latestProposal(); return p ? card(p) : null; }, interpretUpdate, tracker, nudges, INTENTS };
}

module.exports = { createStudyCoach, INTENTS };
