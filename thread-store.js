// thread-store.js
// The storage of Bot's ONE continuous conversation (the "thread"), used only when BOT_THREAD=on.
//
// Why a new store instead of store.js? store.js keeps one file per chat and silently drops everything past 200
// messages. A thread never ends, so it must never drop anything. Here:
//   data/thread/YYYY-MM-DD.jsonl   one file per local DAY, one JSON object per line, APPENDED (a line is never edited)
//   data/thread/index.json         a small list of the days (message count, characters) and what was imported
//   data/thread/trash/<id>.json    a copy of a message the user deleted; kept 30 days, then Bot removes it
//
// A message is: { id, at, role: "user"|"assistant", text, replyTo?, topic?, result?, log?, error?, imported? }
//   replyTo   an assistant message points at the question it answers (a fast answer can arrive before a slow one)
//   topic     "general" | "calendar" | "study" | "course:<courseId>", written by CODE from the front desk's decision
//   imported  { conversationId, title, index } only for messages copied from the old chats (see thread.js)
//
// A line that is NOT a message is a "tombstone": {type:"trash", id, at} hides a message, {type:"restore", id} brings it
// back. So deleting never rewrites a day, and the only time a day file is rewritten is when the 30-day trash is emptied.
// A model can never call trash/purge: they are only reachable from the user's own page action and from Bot's own timer.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^m_[a-f0-9]{12,32}$/;
const TOPIC_PATTERN = /^(general|calendar|study|course:[A-Za-z0-9_-]{1,64})$/;
const TRASH_KEEP_MS = 30 * 24 * 3600 * 1000;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

// The local calendar day of a time (the user's day, not UTC's), as YYYY-MM-DD.
const dayOf = (at) => {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const newId = () => "m_" + crypto.randomBytes(8).toString("hex");

// Only these fields are ever stored, whatever an object carries.
function clean(raw, { now }) {
  if (!raw || typeof raw !== "object") throw new Error("not a message");
  if (raw.role !== "user" && raw.role !== "assistant") throw new Error("role must be user or assistant");
  if (typeof raw.text !== "string") throw new Error("text must be a string");
  const at = Number.isFinite(raw.at) && raw.at > 0 ? Math.floor(raw.at) : now();
  const message = { id: typeof raw.id === "string" && ID_PATTERN.test(raw.id) ? raw.id : newId(), at, role: raw.role, text: raw.text };
  if (typeof raw.replyTo === "string" && ID_PATTERN.test(raw.replyTo)) message.replyTo = raw.replyTo;
  message.topic = typeof raw.topic === "string" && TOPIC_PATTERN.test(raw.topic) ? raw.topic : "general";
  if (raw.result && typeof raw.result === "object") message.result = raw.result;
  if (Array.isArray(raw.log)) message.log = raw.log.map(String);
  if (raw.error === true) message.error = true;
  if (raw.imported && typeof raw.imported === "object") message.imported = raw.imported;
  return message;
}

function createThreadStore(dir, { now = Date.now } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const trashDir = path.join(dir, "trash");
  const indexFile = path.join(dir, "index.json");
  const fileFor = (day) => path.join(dir, day + ".jsonl");
  const dayOfId = new Map(); // id -> day, filled as days are read (a cache only; the files are the truth)

  // Write to a temporary file and rename it into place, so a stop halfway never leaves half a file.
  function writeAtomic(file, text) {
    fs.writeFileSync(file + ".tmp", text);
    fs.renameSync(file + ".tmp", file);
  }

  // The raw lines of a day (bad lines are skipped, never fatal).
  function lines(day) {
    let text;
    try { text = fs.readFileSync(fileFor(day), "utf8"); } catch (error) { return []; }
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (error) { /* a damaged line only loses itself */ }
    }
    return out;
  }

  // The visible messages of a day, oldest first (trash tombstones applied).
  function readDay(day) {
    if (!DAY_PATTERN.test(day)) return [];
    const hidden = new Set();
    const messages = [];
    for (const entry of lines(day)) {
      if (entry.type === "trash") hidden.add(entry.id);
      else if (entry.type === "restore") hidden.delete(entry.id);
      else if (entry.id && entry.role) messages.push(entry);
    }
    const seen = new Set();
    return messages
      .filter((m) => !hidden.has(m.id) && !seen.has(m.id) && seen.add(m.id))
      .map((m, i) => ({ m, i }))
      .sort((a, b) => a.m.at - b.m.at || a.i - b.i) // an imported message can be older than the line before it
      .map(({ m }) => { dayOfId.set(m.id, day); return m; });
  }

  // ---- the index ----
  function readIndex() {
    try {
      const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (index && Array.isArray(index.days)) return { days: index.days, importedFrom: Array.isArray(index.importedFrom) ? index.importedFrom : [] };
    } catch (error) { /* missing or damaged: rebuilt below */ }
    return rebuildIndex();
  }
  function writeIndex(index) { writeAtomic(indexFile, JSON.stringify(index)); }

  function entryFor(day) {
    const messages = readDay(day);
    return { day, messages: messages.length, chars: messages.reduce((a, m) => a + m.text.length, 0) };
  }

  // The day files are the truth; this makes a fresh index from them (keeps the "imported" marker if it can).
  function rebuildIndex(importedFrom = null) {
    let old = [];
    if (importedFrom === null) { try { old = JSON.parse(fs.readFileSync(indexFile, "utf8")).importedFrom || []; } catch (error) { /* none */ } }
    const days = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).map((n) => n.slice(0, 10)).sort().map(entryFor);
    const index = { days: days.filter((d) => d.messages > 0 || lines(d.day).length > 0), importedFrom: importedFrom || old };
    writeIndex(index);
    return index;
  }

  function refreshDay(day) {
    const index = readIndex();
    const entry = entryFor(day);
    const rest = index.days.filter((d) => d.day !== day);
    index.days = [...rest, entry].sort((a, b) => (a.day < b.day ? -1 : 1));
    writeIndex(index);
  }

  // ---- writing ----
  function append(raw) {
    const message = clean(raw, { now });
    const day = dayOf(message.at);
    fs.appendFileSync(fileFor(day), JSON.stringify(message) + "\n");
    dayOfId.set(message.id, day);
    refreshDay(day);
    return message;
  }

  // Many messages at once (the import). A message whose id is already stored is skipped, so running it twice adds nothing.
  function appendMany(rawMessages) {
    const byDay = new Map();
    for (const raw of rawMessages) {
      const message = clean(raw, { now });
      const day = dayOf(message.at);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(message);
    }
    let added = 0, skipped = 0;
    for (const [day, messages] of byDay) {
      const have = new Set(lines(day).filter((e) => e.id && e.role).map((e) => e.id)); // includes trashed ones: they must not come back
      const fresh = messages.filter((m) => !have.has(m.id) && have.add(m.id));
      skipped += messages.length - fresh.length;
      if (fresh.length) {
        fs.appendFileSync(fileFor(day), fresh.map((m) => JSON.stringify(m)).join("\n") + "\n");
        fresh.forEach((m) => dayOfId.set(m.id, day));
        added += fresh.length;
        refreshDay(day);
      }
    }
    return { added, skipped };
  }

  // ---- reading ----
  const days = () => readIndex().days.map((d) => ({ ...d }));

  function find(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    const look = (day) => readDay(day).find((m) => m.id === id) || null;
    if (dayOfId.has(id)) { const hit = look(dayOfId.get(id)); if (hit) return hit; }
    for (const { day } of [...readIndex().days].reverse()) { const hit = look(day); if (hit) return hit; }
    return null;
  }

  // The newest `limit` messages older than `before` (a time in ms), returned oldest first, plus whether more exist.
  // This is the paging behind GET /api/thread?before=<time>: the page loads the newest 50, then "load older".
  function page({ before = null, limit = DEFAULT_PAGE } = {}) {
    const n = Math.min(Math.max(1, Math.floor(Number(limit)) || DEFAULT_PAGE), MAX_PAGE);
    const limitAt = Number.isFinite(before) && before > 0 ? before : Infinity;
    const index = readIndex().days;
    let got = [];
    let i = index.length - 1;
    for (; i >= 0 && got.length < n; i--) {
      if (index[i].messages === 0) continue;
      got = [...readDay(index[i].day).filter((m) => m.at < limitAt), ...got];
    }
    const messages = got.slice(-n);
    // more exists if we cut some off, or an older day with messages is left.
    const hasMore = got.length > n || index.slice(0, i + 1).some((d) => d.messages > 0);
    return { messages, hasMore, oldest: messages.length ? messages[0].at : null };
  }

  // Every visible message, oldest first (the search in recall.js reads these). A generator, so a long thread is not held twice.
  function* all() {
    for (const { day } of readIndex().days) yield* readDay(day);
  }

  // The newest messages (for building the context of a new message).
  const recent = (limit = 30) => page({ limit }).messages;

  // After a restart no job is running any more. A question of the last 24 hours that has no answer was cut off by that restart (or a crash):
  // it gets one plain reply saying so, so nothing is lost silently and the page shows an answer under it. Imported messages are never touched.
  function markUnanswered({ since = 24 * 3600 * 1000, text = "Bot was restarted (or stopped) before it finished this message, so there is no answer. Please send it again." } = {}) {
    const recentMessages = page({ limit: 200 }).messages;
    const answered = new Set(recentMessages.filter((m) => m.role === "assistant" && m.replyTo).map((m) => m.replyTo));
    for (const t of trashList()) if (t.message && t.message.replyTo) answered.add(t.message.replyTo); // an answer you deleted was still an answer
    const marked = [];
    for (const m of recentMessages) {
      if (m.role !== "user" || m.imported || answered.has(m.id) || now() - m.at > since) continue;
      marked.push(append({ role: "assistant", text, replyTo: m.id, topic: "general", error: true, at: Math.max(now(), m.at + 1) }));
    }
    return marked.length;
  }


  // ---- the imported marker (thread.js) ----
  const importedFrom = () => readIndex().importedFrom;
  function setImportedFrom(list) {
    const index = readIndex();
    index.importedFrom = list;
    writeIndex(index);
  }

  // ---- trash (30 days) ----
  function trash(id) {
    const message = find(id);
    if (!message) return false;
    const day = dayOf(message.at);
    fs.mkdirSync(trashDir, { recursive: true });
    writeAtomic(path.join(trashDir, id + ".json"), JSON.stringify({ message, day, trashedAt: now() }));
    fs.appendFileSync(fileFor(day), JSON.stringify({ type: "trash", id, at: now() }) + "\n");
    refreshDay(day);
    return true;
  }

  function trashList() {
    let names = [];
    try { names = fs.readdirSync(trashDir).filter((n) => /^m_[a-f0-9]+\.json$/.test(n)); } catch (error) { return []; }
    return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(trashDir, n), "utf8")); } catch (error) { return null; } }).filter(Boolean).sort((a, b) => b.trashedAt - a.trashedAt);
  }

  function restore(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
    const file = path.join(trashDir, id + ".json");
    let item;
    try { item = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return false; }
    fs.appendFileSync(fileFor(item.day), JSON.stringify({ type: "restore", id, at: now() }) + "\n");
    fs.rmSync(file, { force: true });
    refreshDay(item.day);
    return true;
  }

  // Bot's own timer calls this: messages trashed more than 30 days ago are removed for good (the day file is rewritten
  // without the message and its tombstones). Returns how many were removed.
  function purgeTrash({ maxAgeMs = TRASH_KEEP_MS } = {}) {
    let removed = 0;
    for (const item of trashList()) {
      if (now() - item.trashedAt < maxAgeMs) continue;
      const id = item.message.id;
      const kept = lines(item.day).filter((e) => e.id !== id);
      writeAtomic(fileFor(item.day), kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
      fs.rmSync(path.join(trashDir, id + ".json"), { force: true });
      dayOfId.delete(id);
      refreshDay(item.day);
      removed++;
    }
    return removed;
  }

  return { markUnanswered, append, appendMany, days, find, page, all, recent, trash, trashList, restore, purgeTrash, importedFrom, setImportedFrom, rebuildIndex: () => rebuildIndex(), readDay };
}

// BOT_THREAD in the environment or in .env: "on", "1", "true" or "yes" turns the thread on; anything else (or nothing) is off.
function loadThreadFlag(envFile, env = process.env) {
  let value = env.BOT_THREAD;
  if (value === undefined) {
    try { value = require("./auth").parseEnv(fs.readFileSync(envFile, "utf8")).BOT_THREAD; } catch (error) { /* no .env */ }
  }
  return /^(on|1|true|yes)$/i.test(String(value || "").trim());
}

module.exports = { loadThreadFlag, createThreadStore, dayOf, newId, ID_PATTERN, DAY_PATTERN, TOPIC_PATTERN, TRASH_KEEP_MS, DEFAULT_PAGE };
