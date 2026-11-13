// quote.js
// Replying to a marked part of a message (2026-11-13), like Claude's "quote". Omri selects text in one message on the page and taps
// "Reply to this"; the page sends { messageId, text } with Omri's message. CODE checks it here before it may reach a model:
//   - the message exists in the thread (thread-store.js find, so a deleted one is not found)
//   - the quote is really a part of that message: its words appear in that message, in the same order. Words, not characters,
//     because the page draws answers from Markdown (bold, lists, math), so the selected text never matches the saved text exactly.
//   - it has at least one word and at most MAX_QUOTE_CHARS characters
// The brain then gets it in a marked block as DATA (brain.js quoteBlock). The quote is kept in its OWN field on Omri's message, never
// inside the message text, so a link inside a quoted Bot answer never counts as "a link Omri wrote" (brain.js allowedUrl reads only Omri's text).

const MAX_QUOTE_CHARS = 1500;
const { ID_PATTERN } = require("./thread-store"); // m_ + hex: the same rule the store uses

// Letters and digits in any language (Hebrew too), lower-cased; everything else (Markdown marks, spaces, math symbols) separates words.
const words = (text) => String(text || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// Every string that may have been drawn for a message: its text, and for an answer the strings inside its result (a card's fields).
function shownText(message) {
  const out = [String(message.text || "")];
  const walk = (value, depth) => {
    if (depth > 5 || out.length > 2000) return;
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (value && typeof value === "object") Object.values(value).forEach((v) => walk(v, depth + 1));
  };
  if (message.result) walk(message.result, 0);
  return out.join("\n");
}

// Are the quote's words a subsequence of the message's words (same order, gaps allowed for skipped math or symbols)?
function isPartOf(quoteText, message) {
  const q = words(quoteText);
  if (!q.length) return false;
  const m = words(shownText(message));
  let i = 0;
  for (const w of m) { if (w === q[i]) i++; if (i === q.length) return true; }
  return false;
}

// Returns { id, text, role, at } for a good quote, or throws an Error with .status 400 and a plain reason.
function checkQuote(thread, input) {
  const fail = (reason) => { throw Object.assign(new Error(reason), { status: 400 }); };
  if (!input || typeof input !== "object") fail("the quote must be { messageId, text }");
  const id = typeof input.messageId === "string" ? input.messageId : "";
  const text = typeof input.text === "string" ? input.text.replace(/\r\n/g, "\n").trim() : "";
  if (!ID_PATTERN.test(id)) fail("the quote does not name a message");
  if (!text) fail("the quote is empty");
  if (text.length > MAX_QUOTE_CHARS) fail(`the quote is too long (the most is ${MAX_QUOTE_CHARS} characters). Mark a shorter part.`);
  const message = thread && thread.find ? thread.find(id) : null;
  if (!message) fail("the quoted message is not in the conversation (was it deleted?)");
  if (message.role !== "user" && message.role !== "assistant") fail("that message cannot be quoted");
  if (!isPartOf(text, message)) fail("the marked text was not found in that message. Mark text inside one message only.");
  return { id: message.id, text, role: message.role, at: message.at };
}

module.exports = { checkQuote, isPartOf, words, MAX_QUOTE_CHARS };
