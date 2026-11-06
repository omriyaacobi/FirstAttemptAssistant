// thread-context.js
// Builds the SMALL memory a message carries in the one-conversation thread (BOT_THREAD=on).
//
// Why small? The thread never ends, but a model that gets the whole history answers slower and, past about 200,000 characters,
// answers NOTHING (measured, experiments/2026-11-06-one-conversation-in-bot.md section 5). So code decides what goes in, with a
// fixed cap, and a test fails if any part can exceed it:
//   - the most recent turns, newest first, until RECENT_CHARS is used (each message cut to MAX_MESSAGE_CHARS),
//   - the NEWEST calendar card's note, always (even when it is older than the recent turns; see pinnedCard below),
//   - one line per message that is still being worked on ("Bot is still working on: ..."),
// and nothing else. Failed answers are never memory. The result is a list of { role, text, label?, note?, noteShort?, cardId? },
// the same shape jobs.js has always given core.js, so core.js's historyBlock (which has its own cap) can print it.

const RECENT_CHARS = 6000; // the recent turns (the course path already uses 6,000)
const MAX_MESSAGE_CHARS = 1500; // one long message is cut to this here (core.js cuts again at 3,000)
const SCAN_MESSAGES = 80; // how far back to look for the recent turns (a page of the store, never the whole thread)
const PENDING_CHARS = 60; // "still working on: <first 60 characters>"
const MAX_PENDING = 5;
const CARD_SCAN_DAYS = 14; // how far back the newest calendar card is looked for

// The most that buildHistory can ever return, in characters of text and notes (used by the tests). Roughly: the recent turns,
// one pinned card with its full note (core.js refuses a note that does not fit its own cap), and the pending lines.
const MAX_CONTEXT_CHARS = RECENT_CHARS + 6000 + MAX_PENDING * (PENDING_CHARS + 80);

const clip = (text, max) => { const t = String(text); return t.length > max ? t.slice(0, max) : t; };

// "course answer: Calculus 2" for an answer that came from a course (written by code, never by a model).
function labelOf(message, courseName) {
  const r = message.result;
  if (message.role !== "assistant" || !r || r.mode !== "course") return undefined;
  const name = r.courseName || (courseName && courseName(r.courseId)) || "";
  return name ? `course answer: ${name}` : "course answer";
}

// store: the thread store. entryOf(message): how jobs.js turns a message into a history entry (adds the calendar card note).
// busy: ids of the user messages that are still being answered (they are shown as pending lines, not as turns).
function buildHistory(store, { entryOf, courseName = null, busy = [], pending = [], maxChars = RECENT_CHARS } = {}) {
  const hide = new Set(busy);
  const usable = (m) => !m.error && typeof m.text === "string" && m.text.trim() && !hide.has(m.id);
  const recent = store.page({ limit: SCAN_MESSAGES }).messages.filter(usable);

  const entries = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) { // newest to oldest, so the newest survive
    const m = recent[i];
    const cost = Math.min(m.text.length, MAX_MESSAGE_CHARS);
    if (entries.length && used + cost > maxChars) break;
    entries.unshift(m);
    used += cost;
  }
  const out = entries.map((m) => {
    const entry = { ...entryOf(m), text: clip(m.text, MAX_MESSAGE_CHARS) };
    const label = labelOf(m, courseName);
    if (label) entry.label = label;
    return entry;
  });

  // The newest calendar card note stays in the context even when a busy hour pushed its message out of the recent turns.
  const pinned = pinnedCard(store, { entryOf, hide, already: entries });
  if (pinned) out.unshift(pinned);

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

module.exports = { buildHistory, labelOf, RECENT_CHARS, MAX_MESSAGE_CHARS, MAX_CONTEXT_CHARS, PENDING_CHARS };
