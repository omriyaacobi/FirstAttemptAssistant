// history.js
// The conversation memory as text. The models have no memory of their own (every call starts from nothing), and different models
// answer different messages. So code gives them the memory: the recent conversation is pasted in front of each message (the brain's
// "Conversation so far"). Only the newest messages are kept, so the prompt cannot grow without limit.
// (These helpers lived in core.js, the old path, until the brain became the only way Bot works.)

const MAX_HISTORY_CHARS = 12000; // total size of the pasted history
const MAX_MESSAGE_CHARS = 3000; // a single long message is cut to this

// A calendar card note (see jobs.js) is never cut: the NEWEST card keeps its full note, because a correction must copy every event, and cutting
// the JSON would silently lose the last classes. Older cards only keep a short status line. If even the full note cannot fit, the model is told
// to ask the user instead of guessing.
const CARD_TOO_LONG = "[A calendar card was shown here, but its event list is too long to repeat. For a correction, ask the user which events to change; do not guess.]";

function historyBlock(history = []) {
  const lines = [];
  let total = 0;
  let newestCard = true;
  for (let i = history.length - 1; i >= 0; i--) { // walk from newest to oldest, so the newest survive
    const message = history[i];
    // `label` is written by CODE (jobs.js): an answer that came from a course says so, e.g. "Assistant [course answer: Calculus 2]".
    const who = message.role === "user" ? "User" : message.label ? `Assistant [${String(message.label).replace(/[\[\]\n]/g, " ").slice(0, 80)}]` : "Assistant";
    let line = `${who}: ${String(message.text).slice(0, MAX_MESSAGE_CHARS)}`;
    if (message.note) {
      const full = "\n" + message.note;
      line += newestCard ? (total + line.length + full.length <= MAX_HISTORY_CHARS ? full : "\n" + CARD_TOO_LONG) : "\n" + (message.noteShort || "");
      newestCard = false;
    }
    if (total + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    total += line.length;
  }
  return lines.length ? "Conversation so far (oldest first), for context only:\n" + lines.join("\n\n") : "";
}

// A plain-text version of a result, used when the answer is saved in the thread.
function resultText(result) {
  if (result.mode === "single") return result.answer;
  if (result.mode === "split") {
    return result.steps.map((s) => `Step ${s.id}: ${s.task}\n${s.error ? "(failed)" : s.answer}`).join("\n\n");
  }
  return "";
}

module.exports = { historyBlock, resultText, MAX_HISTORY_CHARS, MAX_MESSAGE_CHARS };
