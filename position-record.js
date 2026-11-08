// position-record.js
// The shape of "where the student is in a course" (position v2). Pure code: no files, no models.
//
// Old records (before v2) hold only { known, seenThrough, note, at }. They still load unchanged: every v2 field is OPTIONAL and is present
// only when it holds a valid value. Anything invalid is dropped, never repaired by guessing. The closed lists below are the only values accepted.
//
//   said        the student's own words, control characters removed, 300 characters at most. The source of truth; no model rewrites it.
//   mode        attending | selfStudy | revising | notStarted | paused
//   where       ONE of { type: "lecture", n } | { type: "date", date } | { type: "section", name } | { type: "pages", from, to }
//               | { type: "fraction", value (0..1) } | { type: "none" }. Whether a section or a page really exists is checked against the
//               course outline by the validator (a later step); here only the SHAPE and ranges are checked.
//   pace        ahead | onTrack | behind, and behindBy { unit: "weeks" | "lectures", amount }
//   gaps        lectures or sections the student said they missed (a short list)
//   depth       solid | shaky | unknown: the student's OWN opinion. It is never "understood" and never changes a grade.
//   goal        concepts | exam | assignment | full, and focus (a short phrase used only to look things up in the notes)
//   examDate    a real date; only with confirmed: true (the student confirmed it)
//   v           2 once a v2 field was written by code

const plan = require("./study-plan");

const MODES = ["attending", "selfStudy", "revising", "notStarted", "paused"];
const PACES = ["ahead", "onTrack", "behind"];
const DEPTHS = ["solid", "shaky", "unknown"];
const GOALS = ["concepts", "exam", "assignment", "full"];
const WHERE_TYPES = ["lecture", "date", "section", "pages", "fraction", "none"];
const BEHIND_MAX = { weeks: 40, lectures: 60 };
const SAID_MAX = 300, NOTE_MAX = 200, NAME_MAX = 80, GAPS_MAX = 20, MAX_LECTURE = 500, MAX_PAGE = 100000;

const clean = (s, n = 200) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

// A "where" from anywhere (a file, a model proposal): the checked copy, or null when it is not one of the shapes above.
function cleanWhere(w) {
  if (!w || typeof w !== "object" || !WHERE_TYPES.includes(w.type)) return null;
  if (w.type === "none") return { type: "none" };
  if (w.type === "lecture") return isInt(w.n, 1, MAX_LECTURE) ? { type: "lecture", n: w.n } : null;
  if (w.type === "date") return plan.isIsoDate(w.date) ? { type: "date", date: w.date } : null;
  if (w.type === "section") { const name = clean(w.name, NAME_MAX); return name ? { type: "section", name } : null; }
  if (w.type === "pages") return isInt(w.from, 1, MAX_PAGE) && isInt(w.to, w.from, MAX_PAGE) ? { type: "pages", from: w.from, to: w.to } : null;
  if (w.type === "fraction") return typeof w.value === "number" && w.value >= 0 && w.value <= 1 ? { type: "fraction", value: Number(w.value.toFixed(3)) } : null;
  return null;
}

function cleanGaps(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    if (g.kind === "lecture" && isInt(g.n, 1, MAX_LECTURE)) out.push({ kind: "lecture", n: g.n });
    else if (g.kind === "section" && clean(g.name, NAME_MAX)) out.push({ kind: "section", name: clean(g.name, NAME_MAX) });
    if (out.length >= GAPS_MAX) break;
  }
  return out;
}

// Any stored or proposed position -> the checked position. Old fields keep their old meaning (known is never changed here).
function normalizePosition(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { known: r.known === true, seenThrough: plan.isIsoDate(r.seenThrough) ? r.seenThrough : null, note: clean(r.note, NOTE_MAX), at: Number.isFinite(r.at) ? r.at : 0 };
  const said = clean(r.said, SAID_MAX);
  if (said) out.said = said;
  if (MODES.includes(r.mode)) out.mode = r.mode;
  const where = cleanWhere(r.where);
  if (where) out.where = where;
  if (PACES.includes(r.pace)) out.pace = r.pace;
  const b = r.behindBy;
  if (b && typeof b === "object" && Object.hasOwn(BEHIND_MAX, b.unit) && isInt(b.amount, 0, BEHIND_MAX[b.unit])) out.behindBy = { unit: b.unit, amount: b.amount };
  const gaps = cleanGaps(r.gaps);
  if (gaps.length) out.gaps = gaps;
  if (DEPTHS.includes(r.depth)) out.depth = r.depth;
  if (GOALS.includes(r.goal)) out.goal = r.goal;
  const focus = clean(r.focus, NAME_MAX);
  if (focus) out.focus = focus;
  if (plan.isIsoDate(r.examDate) && r.confirmed === true) { out.examDate = r.examDate; out.confirmed = true; } // an exam date drives dates: only a confirmed one is kept
  if (out.said || out.mode || out.where || out.pace || out.behindBy || out.gaps || out.depth || out.goal || out.focus || out.examDate) out.v = 2;
  return out;
}

// A question Bot asked and has no answer for yet: { kind: "position", at } or null. Old records only had askedPosition (a time).
function normalizePending(saved, position) {
  const p = saved && saved.pendingQuestion;
  const known = position && position.known;
  if (known) return null;
  if (p && typeof p === "object" && p.kind === "position" && Number.isFinite(p.at) && p.at > 0) return { kind: "position", at: p.at };
  const at = saved && Number(saved.askedPosition);
  return at > 0 ? { kind: "position", at } : null;
}

module.exports = { MODES, PACES, DEPTHS, GOALS, WHERE_TYPES, BEHIND_MAX, SAID_MAX, cleanWhere, cleanGaps, normalizePosition, normalizePending };
