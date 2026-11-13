// thread-context.js
// Builds the SMALL memory a message carries in the one-conversation thread.
//
// Why small? The thread never ends, but a model that gets the whole history answers slower and, past about 200,000 characters,
// answers NOTHING (measured, experiments/2026-11-06-one-conversation-in-bot.md section 5). So code decides what goes in, with a
// fixed cap, and a test fails if any part can exceed it:
//   - the most recent turns, newest first, until RECENT_CHARS is used (each message cut to MAX_MESSAGE_CHARS; an OLDER answer of
//     Bot keeps only its first OLD_ANSWER_CHARS, see below),
//   - the NEWEST calendar card's note, always (even when it is older than the recent turns; see pinnedCard below),
//   - one line per message that is still being worked on ("Bot is still working on: ..."),
// and nothing else. Failed answers are never memory. The result is a list of { role, text, label?, note?, noteShort?, cardId? },
// the same shape jobs.js has always given the answering code, so history.js's historyBlock (which has its own cap) can print it.

// The recent talk is sent again with EVERY model call, and Hebrew costs about one token per letter, so it is one of the biggest
// parts of the bill (27% of the prompt, experiments/2026-11-12-quota-max.md). Since 2026-11-12: the newest FULL_TURNS messages
// stay whole (a follow-up like "explain that again" needs the last answer word for word); an OLDER answer of Bot keeps only its
// start, which is enough to know what was talked about (Omri's own messages are never shortened this way). The search_memory
// tool still finds the full text of anything older.
const RECENT_CHARS = 5000; // the recent turns (9,000 until 2026-11-12)
const FULL_TURNS = 3; // the last answer, the message before it, and the answer before that
const OLD_ANSWER_CHARS = 500;
const CUT_MARK = " [... the rest of this earlier answer is left out]";
const MAX_MESSAGE_CHARS = 2000; // one long message is cut to this here (history.js cuts again at 3,000)
const SCAN_MESSAGES = 80; // how far back to look for the recent turns (a page of the store, never the whole thread)
const PENDING_CHARS = 60; // "still working on: <first 60 characters>"
const MAX_PENDING = 5;
const CARD_SCAN_DAYS = 14; // how far back the newest calendar card is looked for

// The most that buildHistory can ever return, in characters of text and notes (used by the tests). Roughly: the recent turns,
// one pinned card with its full note (history.js refuses a note that does not fit its own cap), and the pending lines.
const NOTES_CHARS = 2400; // the last 3 daily notes (thread-summary.js), already capped there
const MAX_CONTEXT_CHARS = RECENT_CHARS + 6000 + NOTES_CHARS + MAX_PENDING * (PENDING_CHARS + 80) + SCAN_MESSAGES * CUT_MARK.length;

const clip = (text, max) => { const t = String(text); return t.length > max ? t.slice(0, max) : t; };
// A long RECENT message keeps its start AND its end (2026-11-13). A teaching answer usually ENDS with the check question or the
// next step ("run it and tell me what valgrind says"); cutting only the end lost exactly that, so the reply "done, what now?" was
// answered without the question Bot had asked. The result is never longer than max.
const MIDDLE_MARK = "\n[... the middle of this message is left out ...]\n";
function keepEnds(text, max) {
  const t = String(text);
  if (t.length <= max) return t;
  const room = Math.max(0, max - MIDDLE_MARK.length);
  const head = Math.ceil(room * 0.55);
  return t.slice(0, head) + MIDDLE_MARK + t.slice(t.length - (room - head));
}

// "course answer: Calculus 2" for an answer that came from a course (written by code, never by a model).
function labelOf(message, courseName) {
  const r = message.result;
  if (message.role !== "assistant" || !r) return undefined;
  if (r.brain && r.mode !== "study") return r.courseName ? `about ${r.courseName}` : undefined; // the brain's answers (brain.js)
  if (r.mode !== "course" && r.mode !== "study") return undefined;
  const name = r.courseName || (courseName && r.courseId && courseName(r.courseId)) || "";
  const kind = r.mode === "study" ? "study coach" : "course answer";
  return name ? `${kind}: ${name}` : kind;
}

// store: the thread store. entryOf(message): how jobs.js turns a message into a history entry (adds the calendar card note).
// busy: ids of the user messages that are still being answered (they are shown as pending lines, not as turns).
function buildHistory(store, { entryOf, courseName = null, busy = [], pending = [], notes = "", maxChars = RECENT_CHARS } = {}) {
  const hide = new Set(busy);
  const usable = (m) => !m.error && !m.ack &&typeof m.text === "string" && m.text.trim() && !hide.has(m.id);
  const recent = store.page({ limit: SCAN_MESSAGES }).messages.filter(usable);

  const entries = [];
  const limits = new Map(); // message -> how many of its characters are kept
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) { // newest to oldest, so the newest survive
    const m = recent[i];
    const old = entries.length >= FULL_TURNS && m.role === "assistant";
    const limit = old ? OLD_ANSWER_CHARS : MAX_MESSAGE_CHARS;
    const cost = Math.min(m.text.length, limit);
    if (entries.length && used + cost > maxChars) break;
    entries.unshift(m);
    limits.set(m, limit);
    used += cost;
  }
  const out = entries.map((m) => {
    const limit = limits.get(m);
    const entry = { ...entryOf(m), text: m.text.length > limit && limit === OLD_ANSWER_CHARS ? clip(m.text, limit) + CUT_MARK : keepEnds(m.text, limit) };
    const label = labelOf(m, courseName);
    if (label) entry.label = label;
    if (m.result && typeof m.result.courseId === "string") entry.courseId = m.result.courseId; // which course this turn was about
    entry.at = m.at;
    return entry;
  });

  // The newest calendar card note stays in the context even when a busy hour pushed its message out of the recent turns.
  const pinned = pinnedCard(store, { entryOf, hide, already: entries });
  if (pinned) out.unshift(pinned);
  // The notes about the last days come first (oldest context), inside their own marker, as data that may be wrong.
  if (notes) out.unshift({ role: "assistant", text: clip(notes, NOTES_CHARS), label: "notes" });

  for (const task of pending.slice(0, MAX_PENDING)) {
    out.push({ role: "assistant", text: `(Bot is still working on an earlier message: "${clip(String(task).replace(/\s+/g, " ").trim(), PENDING_CHARS)}")` });
  }
  return out;
}

// The newest message that carries a calendar card, if it is not already among `already`.
function pinnedCard(store, { entryOf, hide, already }) {
  const have = new Set(already.map((m) => m.id));
  let found = null;
  for (const m of [...store.page({ limit: 400 }).messages].reverse()) {
    const add = m.result && m.result.calendarAdd;
    if (m.role === "assistant" && add && Array.isArray(add.events) && !m.error) { found = m; break; }
  }
  if (!found || have.has(found.id) || hide.has(found.id)) return null;
  if (Date.now() - found.at > CARD_SCAN_DAYS * 24 * 3600 * 1000) return null; // a card that old has expired long ago
  const entry = entryOf(found);
  if (!entry.note) return null;
  return { ...entry, text: clip(found.text, MAX_MESSAGE_CHARS) };
}

module.exports = { keepEnds, buildHistory, labelOf, RECENT_CHARS, MAX_MESSAGE_CHARS, MAX_CONTEXT_CHARS, PENDING_CHARS, FULL_TURNS, OLD_ANSWER_CHARS, CUT_MARK };
