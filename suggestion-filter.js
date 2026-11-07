// suggestion-filter.js
// Facts and tasks the daily summary proposes must not repeat what Bot already has. Simple code matching, no model:
// a suggestion is hidden when its words are (nearly) all inside an existing reminder, saved fact, assignment or calendar card,
// or when it is a place in a course ("lecture 5", "not started": the study tracker owns those, not the memory).
// Hidden suggestions are not deleted; they just do not show.

const STOP = new Set("the a an user users is are was were has have had to of in on at for and or my me i he she it this that with their his her will would be been do does did not no just also so your you our we".split(" "));
const words = (text) => (String(text).toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !STOP.has(w));

// A place in a course is the tracker's business ("I'm at lecture 5", "has not started algorithms", "up to date").
const PLACE = /\b(?:lecture|lec|class)\s*\d+|\b(?:up\s+to\s+date|not\s+(?:yet\s+)?started|has\s+not\s+started|finished\s+lecture)|הרצאה\s*\d+|עוד\s+לא\s+התחל|עדכני/i;

function similar(a, b) {
  const x = new Set(words(a)), y = new Set(words(b));
  if (x.size < 1 || y.size < 1) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  const smaller = Math.min(x.size, y.size);
  return (smaller >= 2 && shared / smaller >= 0.75) || (smaller === 1 && shared === 1 && Math.max(x.size, y.size) <= 2) || shared / (x.size + y.size - shared) >= 0.6;
}

// existing: { facts: [text], reminders: [text], assignments: [title], calendar: [summary] }
function isDuplicate(item, existing) {
  const text = String(item.text || "");
  if (item.kind === "fact" && PLACE.test(text)) return true;
  const pools = item.kind === "task" ? [existing.reminders, existing.assignments, existing.calendar] : [existing.facts];
  return pools.some((list) => (list || []).some((e) => similar(text, e)));
}

const visibleProposals = (proposals, existing) => proposals.filter((p) => !isDuplicate(p, existing));

module.exports = { visibleProposals, isDuplicate, similar };
