// due-date.js
// "Due next Sunday" -> a real calendar date, computed by CODE from today's date (models never invent dates).
// Only clear phrases are read: "due [on|by] [next|this] <weekday>", "due tomorrow", "due in N days/weeks" and the Hebrew
// "להגשה / עד [יום] <weekday>". The weekday is always the first such day AFTER today (never today itself, never in the past).
// Same rule as the calendar: "next Tuesday" said on Saturday 7 Nov is Tuesday 10 Nov. Returns an ISO date, or null.
const plan = require("./study-plan");

const EN_DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const HE_DAYS = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6 };
const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, a: 1 };

function dueFromWords(text, now = Date.now(), timezone = plan.TIMEZONE) {
  const low = String(text || "").toLowerCase().slice(0, 20000);
  const today = plan.parts(now, timezone).date;
  const nextWeekday = (wd) => { for (let i = 1; i <= 7; i++) { const d = plan.addDays(today, i); if (plan.weekdayOf(d) === wd) return d; } return null; };
  let m = /\b(?:due|deadline|submit(?:ted)?|hand(?:ed)?\s+in)\b[^.\n\d]{0,25}?\b(?:next\s+|this\s+|coming\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(low);
  if (m) return nextWeekday(EN_DAYS[m[1]]);
  if (/\bdue\b[^.\n\d]{0,12}\btomorrow\b/.test(low)) return plan.addDays(today, 1);
  m = /\bdue\s+in\s+(\d{1,2}|one|two|three|four|five|six|seven|a)\s+(day|week)s?\b/.exec(low);
  if (m) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : WORD[m[1]];
    return n >= 1 && n <= 12 ? plan.addDays(today, n * (m[2] === "week" ? 7 : 1)) : null;
  }
  m = /(?:להגשה|הגשה|עד)\s+(?:ב)?(?:יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/.exec(String(text || ""));
  if (m) return nextWeekday(HE_DAYS[m[1]]);
  return null;
}

module.exports = { dueFromWords };
