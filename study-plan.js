// study-plan.js
// Where the semester says Omri SHOULD be. Pure code, no model, no files: the timetable and the skips come in as arguments.
//
// A "slot" is one weekly lecture on one day. Slot numbers count the lectures actually held: a skipped date (cancelled class,
// holiday, "no lecture this week") is removed and the numbers after it move up. Bot cannot know about cancellations by itself,
// so the ONLY way a date disappears is a skip that the user told Bot about.

const SEMESTER = { start: "2026-10-18", end: "2027-01-15" };
const TIMEZONE = "Asia/Jerusalem";

// weekday: 0 = Sunday. attends:false = the lecture exists (the notebook has it) but Omri does not go.
// match: how to recognise the course among the ones in courses.js (name, any language). Order matters: the first match wins.
const DEFAULT_TIMETABLE = {
  courses: [
    { key: "hpsp", match: "high.?performance|hpsp|ביצועים", short: "High-Performance Systems Programming" },
    { key: "sp", match: "systems? programming|תכנות מערכות", short: "Systems Programming" },
    { key: "calculus", match: "calculus|חדו", short: "Calculus 2" },
    { key: "algo", match: "algorithm|אלגוריתמ", short: "Algorithms Planning" },
  ],
  slots: [
    { course: "sp", kind: "lecture", weekday: 0, start: "12:00", end: "14:00" },
    { course: "hpsp", kind: "exercise", weekday: 0, start: "15:00", end: "16:00" },
    { course: "algo", kind: "lecture", weekday: 0, start: "16:00", end: "18:00" },
    { course: "calculus", kind: "exercise", weekday: 1, start: "12:00", end: "14:00" },
    { course: "calculus", kind: "lecture", weekday: 1, start: "14:00", end: "16:00" },
    { course: "calculus", kind: "lecture", weekday: 3, start: "08:00", end: "10:00", attends: false },
    { course: "sp", kind: "exercise", weekday: 3, start: "16:00", end: "18:00" },
    { course: "algo", kind: "lecture", weekday: 3, start: "18:00", end: "20:00" },
    { course: "hpsp", kind: "lecture", weekday: 4, start: "10:00", end: "12:00" },
    { course: "sp", kind: "lecture", weekday: 4, start: "14:00", end: "16:00" },
  ],
};

// ---- dates in the local time zone (built-in Intl, so the machine's own zone never matters) ----
function parts(ms, tz = TIMEZONE) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const weekStart = (iso) => addDays(iso, -weekdayOf(iso)); // the Sunday of that week
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDate = (iso) => `${DAY_NAMES[weekdayOf(iso)]} ${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

// Checks a timetable that came from a file. Returns a clean copy, or null when it is not usable.
function cleanTimetable(t) {
  if (!t || !Array.isArray(t.courses) || !Array.isArray(t.slots)) return null;
  const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const courses = t.courses.filter((c) => c && /^[a-z0-9]{1,20}$/.test(c.key) && typeof c.match === "string" && c.match.length < 200).map((c) => ({ key: c.key, match: c.match, short: String(c.short || c.key).slice(0, 80) }));
  const keys = new Set(courses.map((c) => c.key));
  const slots = t.slots.filter((s) => s && keys.has(s.course) && (s.kind === "lecture" || s.kind === "exercise") && Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && hhmm.test(s.start) && hhmm.test(s.end) && s.start < s.end)
    .map((s) => ({ course: s.course, kind: s.kind, weekday: s.weekday, start: s.start, end: s.end, ...(s.attends === false ? { attends: false } : {}) }));
  return courses.length ? { courses, slots } : null;
}

// Which timetable course is this course name? null when none matches.
function courseKeyFor(timetable, name) {
  for (const c of timetable.courses) {
    try { if (new RegExp(c.match, "i").test(String(name))) return c.key; } catch (error) { /* a bad pattern never matches */ }
  }
  return null;
}

// skips: [{ date, course }]  course = a key, or "*" for every course. Returns the slots of one course, in time order, numbered.
// Only lectures are numbered; exercises can be listed too (kind: "exercise") for the assignment side.
function slotsOf(timetable, key, skips = [], { kind = "lecture", semester = SEMESTER } = {}) {
  const skipped = new Set(skips.filter((s) => s.course === key || s.course === "*").map((s) => s.date));
  const mine = timetable.slots.filter((s) => s.course === key && s.kind === kind);
  const out = [];
  for (let d = semester.start; d <= semester.end; d = addDays(d, 1)) {
    if (skipped.has(d)) continue;
    for (const s of mine.filter((x) => x.weekday === weekdayOf(d)).sort((a, b) => a.start.localeCompare(b.start))) {
      out.push({ date: d, start: s.start, end: s.end, kind, attends: s.attends !== false, n: out.length + 1 });
    }
  }
  return out;
}

// A slot is "held" once its end time has passed.
function isHeld(slot, nowMs, tz = TIMEZONE) {
  const p = parts(nowMs, tz);
  return slot.date < p.date || (slot.date === p.date && p.minutes >= minutesOf(slot.end));
}
const heldSlots = (timetable, key, skips, nowMs, tz) => slotsOf(timetable, key, skips).filter((s) => isHeld(s, nowMs, tz));

// Is any class (any course) going on at this moment? Used to never ask a question in the middle of one.
function inClass(timetable, nowMs, tz = TIMEZONE) {
  const p = parts(nowMs, tz);
  return timetable.slots.some((s) => s.weekday === p.weekday && p.minutes >= minutesOf(s.start) && p.minutes < minutesOf(s.end));
}

// Quiet hours like { from: "22:00", to: "08:00" } (may cross midnight).
const DEFAULT_QUIET = { from: "22:00", to: "08:00" };
function inQuietHours(nowMs, quiet = DEFAULT_QUIET, tz = TIMEZONE) {
  const m = parts(nowMs, tz).minutes, a = minutesOf(quiet.from), b = minutesOf(quiet.to);
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

// An explicit date written in a message: 2026-10-29, 29/10, 29.10, "29 Oct", "Oct 29". The year is the semester's (months before July are 2027).
const MONTH_NUMBERS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function explicitDate(text) {
  const low = String(text).toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(low);
  if (iso) return isIsoDate(iso[1]) ? iso[1] : null;
  const make = (month, day) => { const d = `${month < 7 ? 2027 : 2026}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; return isIsoDate(d) ? d : null; };
  const dm = /\b(\d{1,2})[/.](\d{1,2})\b(?![/.]\d)/.exec(low);
  if (dm) { const r = make(Number(dm[2]), Number(dm[1])); if (r) return r; }
  const mn = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/.exec(low);
  return mn ? make(MONTH_NUMBERS[mn[2] || mn[3]], Number(mn[1] || mn[4])) : null;
}

module.exports = { explicitDate, SEMESTER, TIMEZONE, DEFAULT_TIMETABLE, DEFAULT_QUIET, parts, isIsoDate, addDays, weekdayOf, weekStart, daysBetween, niceDate, DAY_NAMES, minutesOf, cleanTimetable, courseKeyFor, slotsOf, isHeld, heldSlots, inClass, inQuietHours };
