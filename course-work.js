// course-work.js
// "Already worked on in this course": a short list, made by CODE from the thread, of the exercises and formulas Bot showed in one
// course over the last 2 days. Why (2026-11-16, 19:31-19:36): in a long tutoring evening on Calculus 2, Bot offered x e^x (done at
// 15:02) and the sin^2 trick (done at 16:11) again as "the next part of lecture 4", and Omri had to say "we already did this" three
// times. The recent talk the brain sees is only about 5,000 characters, so the work of the afternoon was out of its sight, and
// nothing in the study records keeps what was practised inside a lecture.
// The list is only Bot's own display formulas ($$...$$) from its answers in that course, with the time; nothing is written by a
// model and nothing is stored: it is read fresh from the thread for every message.

const WINDOW_MS = 48 * 3600 * 1000;
const MAX_ITEMS = 25; // the newest ones are kept (14 was too few: on 2026-11-16 the evening's first exercise fell out)
const MAX_MATH = 140; // one formula is cut to this
const MAX_CHARS = 2000; // the whole list

const norm = (tex) => String(tex).replace(/\\[,;:! ]|\\quad|\s+/g, "").toLowerCase();

// messages: thread messages, oldest first ({ role, at, text, result }). Returns "" when nothing was worked on.
function workDone(messages, courseId, { now = Date.now(), timeZone } = {}) {
  if (!courseId || !Array.isArray(messages)) return "";
  const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const timeOf = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  const today = dayOf(now), yesterday = dayOf(now - 24 * 3600 * 1000);
  const seen = new Set();
  const items = [];
  for (const m of messages) {
    if (!m || m.role !== "assistant" || m.error || typeof m.text !== "string" || m.copyOf) continue; // a copy was already counted as its original
    // workCourseId (2026-11-27): a side question in another course's tab is that other course's work
    if (!m.result || (m.result.workCourseId || m.result.courseId) !== courseId || !Number.isFinite(m.at) || now - m.at > WINDOW_MS || m.at > now) continue;
    // display formulas ($$...$$), and an exercise given inside a sentence: an inline formula that holds an integral, a sum or a
    // limit ("what would you choose in $\int \ln(x)\,dx$?" on 2026-11-16 was an exercise and was not in the list)
    for (const match of m.text.matchAll(/\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^$\n]{3,200}?)\$(?!\$)/g)) {
      if (match[1] === undefined && !/\\(?:int|sum|lim)(?![a-z])/.test(match[2])) continue;
      const tex = (match[1] !== undefined ? match[1] : match[2]).replace(/\s+/g, " ").trim();
      if (!tex || seen.has(norm(tex))) continue;
      seen.add(norm(tex));
      const day = dayOf(m.at);
      const when = day === today ? "today" : day === yesterday ? "yesterday" : day;
      items.push(`- ${when} ${timeOf(m.at)}: $${tex.length > MAX_MATH ? tex.slice(0, MAX_MATH) + " ..." : tex}$`);
    }
  }
  const kept = [];
  let used = 0;
  for (const line of items.slice(-MAX_ITEMS).reverse()) { // newest first, so the newest fit
    if (used + line.length + 1 > MAX_CHARS) break;
    kept.unshift(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}

module.exports = { workDone, WINDOW_MS, MAX_ITEMS, MAX_CHARS };
