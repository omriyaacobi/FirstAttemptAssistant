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
const { buildOutline } = require("./outline");

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

  // ---- progress ----
  function courseLines(ref) {
    const p = tracker.progress(ref);
    const removed = tracker.state().skips.some((s) => s.course === ref.key || s.course === "*");
    if (!tracked(ref)) { // no timetable for this course: no counts, only what was told
      const lines = [T(`${ref.name}: I have no timetable for this course, so I cannot count lectures.`, `${ref.name}: אין לי מערכת שעות לקורס הזה, אז אי אפשר לספור הרצאות.`)];
      if (!p.positionKnown) lines.push(T("  I do not know where you are in this course yet.", "  עדיין לא ידוע לי איפה עומדים בקורס הזה."));
      else if (p.position.note) lines.push(`  ${T("You told me you are up to", "עדכנת אותי שהמיקום הוא עד")} ${clean(noteText(p.position.note), 60)}.`);
      else lines.push(`  ${T("You told me", "כתבת לי")}: "${clean(p.position.said, 140)}".`);
      for (const a of p.assignments.slice(0, 3)) lines.push(T(`  Assignment "${clean(a.title, 60)}": ${a.status}${a.due ? `, due ${niceDate(a.due)}` : ", no due date saved"}.`, `  מטלה "${clean(a.title, 60)}": ${STATUS_HE[a.status] || a.status}${a.due ? `, להגשה עד ${niceDate(a.due)}` : ", בלי תאריך הגשה שמור"}.`));
      return lines.join("\n");
    }
    const lines = [T(`${ref.name}: ${p.held} lecture${p.held === 1 ? "" : "s"} held so far by the timetable${removed ? " (cancelled ones removed)" : ""}.`, `${ref.name}: ${p.held === 1 ? "הרצאה אחת" : `${p.held} הרצאות`} עד עכשיו לפי המערכת${removed ? " (בלי אלה שבוטלו)" : ""}.`)];
    lines.push(T(`  Material in Bot for ${p.withMaterial} of them. Checked as understood (3+ questions, 70%+): ${p.understood}.`, `  יש ב-Bot חומר ל-${p.withMaterial} מהן. נבדקו כמובנות (3 שאלות ומעלה, 70% ומעלה): ${p.understood}.`));
    if (p.behind.length) lines.push(`  ${T(`Behind on ${p.behind.length}`, `פיגור ב-${p.behind.length}`)}: ${p.behind.slice(0, 4).map((b) => `${T("lecture", "הרצאה")} ${b.n} (${niceDate(b.date)})${b.hasMaterial || b.topic ? "" : T(", no material yet", ", עדיין בלי חומר")}`).join("; ")}${p.behind.length > 4 ? "; ..." : ""}.`);
    else if (p.held) lines.push(T("  Nothing behind by the timetable.", "  אין פיגור לפי המערכת."));
    if (!p.positionKnown) lines.push(T("  I do not know where you are in this course yet.", "  עדיין לא ידוע לי איפה עומדים בקורס הזה."));
    else if (!p.position.seenThrough && !p.position.note && p.position.said) lines.push(`  ${T("You told me", "כתבת לי")}: "${clean(p.position.said, 140)}".`);
    else lines.push(`  ${T("You told me you are up to", "עדכנת אותי שהמיקום הוא עד")} ${p.position.seenThrough ? niceDate(p.position.seenThrough) : p.position.note ? clean(noteText(p.position.note), 60) : T("a topic", "נושא מסוים")}${p.position.seenThrough && p.position.note ? ` (${clean(noteText(p.position.note), 60)})` : ""}.`);
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
  const CAUGHT = /\bcaught\s+up\b|\bbut\b[^.\n]*\b(?:rest|everything|else)\b|השלמתי|אבל/i;
  const UNDO_MS = 2 * 3600 * 1000;
  const V2_KEYS = ["mode", "where", "pace", "behindBy", "gaps", "depth", "goal", "focus"];
  let lastUndo = null; // { ref, position, pending, at, proposalId } (memory only: it lives for 2 hours)

  function undoReading() {
    const u = lastUndo;
    lastUndo = null;
    tracker.restoreStanding(u.ref, u.position, u.pending);
    if (u.proposalId) proposals.delete(u.proposalId); // the exam card of that reading goes too
    return T(`Undone. ${u.ref.name} is back to how it was before. Tell me again in your own words when you want.`, `בוטל. ${u.ref.name} חזר למצב שהיה קודם. אפשר לכתוב שוב במילים שלך מתי שנוח.`);
  }
  const heldSlots = (ref) => tracker.slots(ref.key).filter((s) => plan.isHeld(s, now(), timezone));
  function standingContext(ref) {
    const next = tracker.slots(ref.key).find((s) => !plan.isHeld(s, now(), timezone)) || null;
    return standing.contextFor({ held: heldSlots(ref).map((s) => ({ n: s.n, date: s.date })), nextSlot: next ? { n: next.n, date: next.date } : null, outline: buildOutline(ref.courseId ? courses.allPages(ref.courseId) : []), today: today(), lang: curLang, tracked: tracked(ref) });
  }

  // Returns { answer, proposal? } when the words were read and stored (or kept with reasons), or null when this path does not apply (the plain rules then try).
  async function maybeReadStanding({ text, courseId, courseName }) {
    const pieces = String(text).split(/\n|(?<=[.!?])\s+/);
    const low = String(text).toLowerCase();
    const named = new Set([...pieces.map((p) => refInText(p)).filter(Boolean).map((r) => r.key), ...refs().filter((r) => r.name && low.includes(r.name.toLowerCase())).map((r) => r.key)]);
    if (named.size >= 2) return null; // several courses: the several-course reader
    const target = targetFor(text, courseId, courseName, text);
    if (!target) return null;
    const pending = pendingRefs().some((r) => r.key === target.key);
    const plainFact = (askedLectures(text).length || parseDay(text, "past")) && !standing.isStateStatement(text);
    if (!standing.shouldRead({ text, pending }) || (pending && plainFact)) return null;

    const ctx = standingContext(target);
    const lost = standing.isLost(text);
    let raw = null;
    try { raw = await standing.readStanding({ askChain, text: clean(text, standing.MAX_READ_CHARS), courseName: target.name, ctx, log }); } catch (error) { log(`[standing] reader failed: ${error.message}`); }
    const res = standing.checkStanding(raw, ctx);
    if (!res.any && !res.dropped.length && !res.exam && !lost) return null; // nothing usable: the plain rules keep the words and say so
    const words = wordsFor(target, text);
    const before = { position: tracker.course(target).position, pending: tracker.pendingQuestion(target) };
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
    lastUndo = { ref: target, position: before.position, pending: before.pending, at: now(), proposalId: null };

    let proposal;
    if (res.exam && old.examDate !== res.exam.date) {
      const p = addProposal({ kind: "exam", ref: target, date: res.exam.date });
      lastUndo.proposalId = p.id;
      proposal = card(p);
    }
    if (lost && !res.any) {
      tracker.markAsked(target, { where: true }); tracker.save({ ...tracker.course(target), pendingQuestion: null }); // counts as asked for 7 days, and nothing stays open
      return { answer: T(`${target.name}: I kept your words. Not knowing where you are is fine. If you like, say "quiz me on ${target.name}" for a short quiz and we will see what you already know; I will not ask where you are again for a week. This only tells me where to start: it does not count as understood.`, `${target.name}: שמרתי את מה שכתבת. זה בסדר לא לדעת איפה עומדים. אם בא לך, אפשר לכתוב "תבחן אותי ${bet(target.name)}" ונראה מה כבר ידוע; לא אשאל שוב איפה עומדים במשך שבוע. זה רק אומר לי מאיפה להתחיל, ולא נחשב להבנה.`) };
    }
    let answer = standing.readback({ courseName: target.name, fields: res.fields, notes: res.notes, dropped: res.dropped, exam: res.exam, lang: curLang });
    const askedAt = tracker.course(target).askedStanding || 0;
    if (!askedAt || now() - askedAt >= NO_REPEAT_MS || WHERE_Q.test(text)) {
      const question = standing.adaptiveQuestion({ fields: merged, notes: res.notes, dropped: res.dropped, ctx, lang: curLang });
      if (question) { tracker.markAsked(target, { where: true }); answer += `\n\n${question}`; }
    }
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
      const free = !w || (lastUndo.proposalId && w.id === lastUndo.proposalId);
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

    if ((intent === "update" || intent === "progress") && MISSED.test(text) && !SKIP_WORDS.test(text) && !(CAUGHT.test(text) && !/\?/.test(text))) return done({ answer: missedAnswer(text) });

    if (intent === "update") {
      if (!SKIP_WORDS.test(text) && !UNDO_WORDS.test(text)) {
        const reading = await maybeReadStanding({ text, courseId, courseName });
        if (reading) return done(reading);
        const many = await interpretPositions(text); if (many) return done({ answer: many }); }
      const { lines, unclear } = interpretUpdate(text, { courseId, courseName });
      if (lines.length || SKIP_WORDS.test(text) || UNDO_WORDS.test(text)) {
        const out = [...lines];
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
    const r = await tutor.turn({ tracker, ref, intent, message: text, pages: ref.courseId ? courses.allPages(ref.courseId) : [], courseName: ref.name, askChain, now: now(), log, onText });
    return done({ ...r, mode: "study", answer: r.answer + (intent !== "answer" ? align : "") + (r.needs ? "" : ""), study: { course: ref.name, mode: r.mode, done: r.done } });
  }

  return { studyLine, questionLine, answerStudy, morningBlock: () => nudges.morningBlock(), onUpload, confirmProposal, cancelProposal, pendingProposal: () => { const p = latestProposal(); return p ? card(p) : null; }, interpretUpdate, tracker, nudges, INTENTS };
}

module.exports = { createStudyCoach, INTENTS };
