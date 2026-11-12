// thread.js
// Moves Bot's OLD chats into the thread (and back out). Used from the command line, by you:
//
//   node thread.js import                  copy every old chat (data/conversations/) into the thread. Safe to run twice.
//   node thread.js verify-import           check the copy is complete (counts, a hash of all texts, a search test)
//   node thread.js export-conversations <new empty folder>
//                                          write the messages made AFTER the switch as ordinary chat files into a NEW
//                                          folder (a plain copy of the old chats)
//   add  --data <folder>  to work on another data folder (tests use a temporary copy)
//
// Rules: the old chats are only READ, never changed. Nothing is ever written over data/conversations. Before the first
// real import, run  node backup.js run  so an encrypted copy exists.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createThreadStore, dayOf, ID_PATTERN } = require("./thread-store");
const { createIndex, search } = require("./search");

const CHAT_FILE = /^[a-f0-9]{16}\.json$/;
const MAX_CHAT_MESSAGES = 200; // what the old store keeps per file; export splits longer days into parts
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

// The id of an imported message is made from the chat id and its place in the chat, so the same message always gets the
// same id. That is what makes a second import add nothing.
const importedId = (conversationId, index) => "m_" + sha(`${conversationId}:${index}`).slice(0, 16);

// Reads the old chats (read-only). Returns [{ id, title, courseId, created, updated, messages: [valid ones with their original index] }].
function readOldChats(conversationsDir) {
  let names = [];
  try { names = fs.readdirSync(conversationsDir).filter((n) => CHAT_FILE.test(n)); } catch (error) { return []; }
  const chats = [];
  for (const name of names) {
    let chat;
    try { chat = JSON.parse(fs.readFileSync(path.join(conversationsDir, name), "utf8")); } catch (error) { continue; }
    if (!chat || typeof chat.id !== "string" || chat.id !== name.slice(0, -5) || !Array.isArray(chat.messages)) continue;
    const messages = [];
    chat.messages.forEach((m, index) => {
      if (m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string") messages.push({ ...m, index });
    });
    chats.push({ id: chat.id, title: String(chat.title || ""), courseId: typeof chat.courseId === "string" ? chat.courseId : null, created: Number(chat.created) || 0, updated: Number(chat.updated) || 0, messages });
  }
  return chats.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}

// One old chat as thread messages. An assistant message points (replyTo) at the user message just before it.
function toThreadMessages(chat) {
  const topic = chat.courseId ? `course:${chat.courseId}` : "general";
  let lastUser = null;
  const out = [];
  for (const m of chat.messages) {
    const id = importedId(chat.id, m.index);
    const at = Number.isFinite(m.at) && m.at > 0 ? m.at : chat.updated || chat.created || Date.now();
    const message = { id, at, role: m.role, text: m.text, topic, imported: { conversationId: chat.id, title: chat.title, index: m.index } };
    if (m.role === "assistant" && lastUser) message.replyTo = lastUser;
    if (m.result && typeof m.result === "object") message.result = m.result;
    if (Array.isArray(m.log)) message.log = m.log;
    if (m.error === true) message.error = true;
    if (m.role === "user") lastUser = id;
    out.push(message);
  }
  return out;
}

function importChats({ conversationsDir, threadDir }) {
  const store = createThreadStore(threadDir);
  const chats = readOldChats(conversationsDir);
  let added = 0, skipped = 0;
  const marker = new Map(store.importedFrom().map((e) => [e.conversationId, e]));
  for (const chat of chats) {
    const r = store.appendMany(toThreadMessages(chat));
    added += r.added;
    skipped += r.skipped;
    marker.set(chat.id, { conversationId: chat.id, title: chat.title.slice(0, 60), messages: chat.messages.length });
  }
  store.setImportedFrom([...marker.values()]);
  return { chats: chats.length, added, skipped };
}

// The way to know the copy is complete. Returns { ok, checks: [{ name, ok, detail }] }. Prints nothing itself.
function verifyImport({ conversationsDir, threadDir }) {
  const store = createThreadStore(threadDir);
  const chats = readOldChats(conversationsDir);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  const byChat = new Map();
  for (const m of store.all()) {
    if (!m.imported) continue;
    if (!byChat.has(m.imported.conversationId)) byChat.set(m.imported.conversationId, []);
    byChat.get(m.imported.conversationId).push(m);
  }

  const wanted = chats.reduce((a, c) => a + c.messages.length, 0);
  const got = chats.reduce((a, c) => a + (byChat.get(c.id) || []).length, 0);
  check("messages in = messages out", wanted === got, `${wanted} in the old chats, ${got} in the thread`);

  const missing = chats.filter((c) => c.messages.length && !byChat.has(c.id));
  check("every old chat appears", missing.length === 0, missing.length ? `${missing.length} chat(s) missing` : `${chats.length} chats found`);

  // One hash over every text, in chat order and message order, from both sides.
  const hashOld = sha(chats.map((c) => c.messages.map((m) => m.text).join("\u0001")).join("\u0002"));
  const hashNew = sha(chats.map((c) => (byChat.get(c.id) || []).sort((a, b) => a.imported.index - b.imported.index).map((m) => m.text).join("\u0001")).join("\u0002"));
  check("hash of all texts matches", hashOld === hashNew, hashOld === hashNew ? "identical" : "the texts differ");

  // The marker in index.json lists what was imported.
  const marked = new Map(store.importedFrom().map((e) => [e.conversationId, e.messages]));
  const badMarks = chats.filter((c) => marked.get(c.id) !== c.messages.length);
  check("the index marker matches", badMarks.length === 0, badMarks.length ? `${badMarks.length} chat(s) not marked` : "all marked");

  // Search: a few opening words of old messages must find the same message again (BM25, like recall).
  const all = [...store.all()];
  const sample = chats.flatMap((c) => c.messages.filter((m) => m.text.trim().length > 40).slice(0, 2)).slice(0, 20);
  if (sample.length && all.length) {
    const index = createIndex(all.map((m) => ({ text: m.text })));
    let found = 0;
    for (const m of sample) {
      const query = m.text.split(/\s+/).slice(0, 8).join(" ");
      const hits = search(index, query, 3);
      if (hits.some((h) => all[h.index].text === m.text)) found++;
    }
    check("search finds old sentences", found === sample.length, `${found} of ${sample.length} found`);
  } else {
    check("search finds old sentences", true, "nothing to sample");
  }
  return { ok: checks.every((c) => c.ok), checks };
}

const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Writes messages that are NOT imported (made after the switch) as ordinary chat files, into a NEW folder.
// One chat per day and topic (a course gets its own chats with its courseId). `all: true` also writes the imported ones.
function exportConversations({ threadDir, outDir, conversationsDir = null, all = false }) {
  const out = path.resolve(outDir);
  if (conversationsDir && isInside(out, conversationsDir)) throw new Error("the export folder must be a NEW folder, not data/conversations or inside it");
  if (isInside(out, threadDir)) throw new Error("the export folder must not be inside the thread folder");
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error("the export folder is not empty: choose a new empty folder");
  fs.mkdirSync(out, { recursive: true });
  const store = createThreadStore(threadDir);
  const groups = new Map();
  for (const m of store.all()) {
    if (m.imported && !all) continue;
    const key = `${dayOf(m.at)}|${m.topic && m.topic.startsWith("course:") ? m.topic : "general"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  let files = 0, messages = 0;
  for (const [key, list] of [...groups].sort()) {
    const [day, topic] = key.split("|");
    for (let part = 0; part * MAX_CHAT_MESSAGES < list.length; part++) {
      const slice = list.slice(part * MAX_CHAT_MESSAGES, (part + 1) * MAX_CHAT_MESSAGES);
      const id = sha(`export:${key}:${part}`).slice(0, 16);
      const chat = {
        id,
        title: `Thread ${day}${part ? ` (part ${part + 1})` : ""}`,
        created: slice[0].at,
        updated: slice[slice.length - 1].at,
        messages: slice.map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.result ? { result: m.result } : {}), ...(m.log ? { log: m.log } : {}), ...(m.error ? { error: true } : {}) })),
      };
      if (topic.startsWith("course:")) chat.courseId = topic.slice(7);
      fs.writeFileSync(path.join(out, id + ".json"), JSON.stringify(chat));
      files++;
      messages += slice.length;
    }
  }
  return { files, messages };
}

// ---- command line ----
function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const dataDir = path.resolve(flag("--data") || path.join(__dirname, "data"));
  const wantAll = args.includes("--all") ? (args.splice(args.indexOf("--all"), 1), true) : false;
  const [command, target] = args;
  const paths = { conversationsDir: path.join(dataDir, "conversations"), threadDir: path.join(dataDir, "thread") };
  if (command === "import") {
    console.log(`Importing the old chats from ${paths.conversationsDir} into ${paths.threadDir} (the old chats are only read).`);
    console.log("Tip: run  node backup.js run  first, so an encrypted backup exists.");
    const r = importChats(paths);
    console.log(`Done: ${r.chats} chats, ${r.added} messages added, ${r.skipped} already there.`);
    console.log("Now run:  node thread.js verify-import");
  } else if (command === "verify-import") {
    const r = verifyImport(paths);
    for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    console.log(r.ok ? "\nPASS: the thread holds every old message." : "\nFAIL: the thread does not hold every old message.");
    process.exitCode = r.ok ? 0 : 1;
  } else if (command === "export-conversations" && target) {
    const r = exportConversations({ ...paths, outDir: target, all: wantAll });
    console.log(`Wrote ${r.messages} messages as ${r.files} chat file(s) into ${path.resolve(target)}. Copy them into data/conversations by hand if you want them back in the old list.`);
  } else {
    console.log("Usage: node thread.js import | verify-import | export-conversations <new empty folder>   [--data <folder>] [--all]");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try { main(process.argv); } catch (error) { console.error("Error:", error.message); process.exit(1); }
}

module.exports = { importChats, verifyImport, exportConversations, readOldChats, importedId, ID_PATTERN };
