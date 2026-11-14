// recall.js
// "What did we decide about the laptop last week?": finds the place in your EARLIER chats, so a new chat does not start blind.
// Plain BM25 search (search.js), no model and no index on disk: it only runs when the front desk says the user asks about
// the past, so it costs nothing on a normal message.
//
// What stays out of the search:
//   - chats inside a course: they have their own memory.
//   - calendar replies and morning briefs: only code may read event titles (see calendar-chat.js), and the excerpts found
//     here are given to a model to answer from.
//   - failed answers.
// The excerpts are old text, some of it from web pages, so they go to the model as data, and nothing here can save a fact.

const { createIndex, search } = require("./search");
const { withTopics } = require("./profile");

const MAX_CHATS = 200; // newest first; a chat holds at most 200 messages (store.js)
const MAX_FOUND = 4;
const MAX_EXCERPT_CHARS = 500;
const MATCH_FLOOR = 0.4; // at least this share of the best match
const PRIVATE_RULES = new Set(["calendar (read-only)", "morning brief", "news alert", "moodle watch"]);

const cut = (text, max) => { const t = String(text).replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max - 1) + "…" : t; };

// One conversation as question + answer pairs.
function exchanges(conversation) {
  const out = [];
  const messages = conversation.messages || [];
  for (let i = 0; i + 1 < messages.length; i++) {
    const [q, a] = [messages[i], messages[i + 1]];
    if (q.role !== "user" || a.role !== "assistant" || a.error) continue;
    if (a.result && PRIVATE_RULES.has(a.result.rule)) continue;
    out.push({ conversationId: conversation.id, title: conversation.title, at: Number(q.at) || 0, question: cut(q.text, MAX_EXCERPT_CHARS), answer: cut(a.text, MAX_EXCERPT_CHARS) });
  }
  return out;
}

// The best exchanges for a query, best first. A chat appears at most twice, so one long chat cannot fill the list.
function findInChats(store, query, { limit = MAX_FOUND } = {}) {
  const pages = store.list().filter((c) => !c.courseId).slice(0, MAX_CHATS).flatMap((c) => {
    const conversation = store.get(c.id);
    return conversation ? exchanges(conversation) : [];
  });
  return rank(pages, query, limit);
}

// The best pages for a query, best first. A chat appears at most twice, so one long chat cannot fill the list.
function rank(pages, query, limit) {
  if (!pages.length) return [];
  const hits = search(createIndex(pages.map((p) => ({ text: `${p.title} ${p.question} ${p.answer}` }))), withTopics(query), pages.length);
  const perChat = new Map();
  const out = [];
  for (const hit of hits) {
    if (hit.score < hits[0].score * MATCH_FLOOR || out.length >= limit) break;
    const page = pages[hit.index];
    const seen = perChat.get(page.conversationId) || 0;
    if (seen >= 2) continue;
    perChat.set(page.conversationId, seen + 1);
    out.push(page);
  }
  return out;
}

const dayOf = (at) => (at ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(at)) : "some time ago");
const stripMarkers = (text) => text.replace(/<\/?\s*past-chats[^>]*>/gi, " ");

// What the user sees when no model is available: the excerpts themselves, written by code.
const listFound = (found) => found.map((f) => `${dayOf(f.at)}, in "${f.title}":\nYou: ${f.question}\nBot: ${f.answer}`).join("\n\n");

// ---- the thread ----
// In one thread a fast answer can arrive before a slow one, so "the next message" is NOT the answer. An answer is paired with its
// question by replyTo. A message without replyTo (an old one) is paired with the user message right before it, as before.
// Course turns are included now (they are part of the one conversation). Calendar replies and morning briefs stay out, as always.
const MAX_THREAD_PAIRS = 3000; // the newest pairs; a longer history is still on disk, just not searched in one go

function threadExchanges(thread) {
  const byId = new Map();
  const list = [];
  for (const m of thread.all()) { byId.set(m.id, m); list.push(m); }
  const out = [];
  let previous = null;
  for (const m of list) {
    const before = previous;
    previous = m;
    if (m.role !== "assistant" || m.error) continue;
    if (m.result && PRIVATE_RULES.has(m.result.rule)) continue;
    const q = (m.replyTo && byId.get(m.replyTo)) || (before && before.role === "user" ? before : null);
    if (!q || q.role !== "user") continue;
    const imported = m.imported || q.imported || null;
    const day = new Intl.DateTimeFormat("en-CA").format(new Date(q.at));
    out.push({
      conversationId: imported ? imported.conversationId : `thread:${day}`,
      title: imported && imported.title ? imported.title : `the conversation, ${day}`,
      at: Number(q.at) || 0,
      question: cut(q.text, MAX_EXCERPT_CHARS),
      answer: cut(m.text, MAX_EXCERPT_CHARS),
      topic: m.topic || "general",
    });
  }
  return out.slice(-MAX_THREAD_PAIRS);
}

// Like findInChats, but over the thread, and (oldChats, a store.js store) over old chats that were never copied into it.
function findInThread(thread, query, { oldChats = null, limit = MAX_FOUND } = {}) {
  let pages = threadExchanges(thread);
  if (oldChats) {
    const copied = new Set(thread.importedFrom().map((e) => e.conversationId));
    for (const c of oldChats.list().filter((c) => !c.courseId && !copied.has(c.id)).slice(0, MAX_CHATS)) {
      const conversation = oldChats.get(c.id);
      if (conversation) pages = pages.concat(exchanges(conversation));
    }
  }
  return rank(pages, query, limit);
}

module.exports = { findInThread, threadExchanges, findInChats, listFound, exchanges, MAX_FOUND };
