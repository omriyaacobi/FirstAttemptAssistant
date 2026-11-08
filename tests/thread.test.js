// thread.test.js
// Tests the thread store (thread-store.js) and the import / verify / export tools (thread.js).
// Only temporary folders and made-up messages: never data/.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, dayOf } = require("../thread-store");
const { importChats, verifyImport, exportConversations, importedId } = require("../thread");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-thread-"));
const T0 = new Date(2026, 10, 5, 10, 0, 0).getTime(); // local time, so the day is stable
const DAY = 24 * 3600 * 1000;

test("messages are appended to one file per day, with no cap", () => {
  const dir = tmp();
  const store = createThreadStore(dir);
  for (let i = 0; i < 450; i++) store.append({ role: i % 2 ? "assistant" : "user", text: "m" + i, at: T0 + i * 1000 });
  store.append({ role: "user", text: "next day", at: T0 + DAY });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort(), [dayOf(T0) + ".jsonl", dayOf(T0 + DAY) + ".jsonl"]);
  const days = store.days();
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].messages, 450); // the old store would have cut this at 200
  assert.strictEqual(store.readDay(dayOf(T0))[0].text, "m0");
});

test("a message gets an id, a topic and only the allowed fields; bad input is refused", () => {
  const store = createThreadStore(tmp());
  const m = store.append({ role: "user", text: "hi", at: T0, evil: "x", topic: "../../etc" });
  assert.match(m.id, /^m_[a-f0-9]{16}$/);
  assert.strictEqual(m.topic, "general");
  assert.strictEqual(m.evil, undefined);
  assert.throws(() => store.append({ role: "system", text: "x" }), /role/);
  assert.throws(() => store.append({ role: "user", text: 5 }), /text/);
  assert.strictEqual(store.append({ role: "assistant", text: "a", replyTo: m.id, topic: "course:abc123" }).replyTo, m.id);
  assert.strictEqual(store.append({ role: "assistant", text: "a", replyTo: "nope" }).replyTo, undefined);
});

test("paging gives the newest messages first and walks back with before=", () => {
  const store = createThreadStore(tmp());
  for (let i = 0; i < 130; i++) store.append({ role: "user", text: "m" + i, at: T0 + i * 3600 * 1000 }); // spans several days
  const p1 = store.page({ limit: 50 });
  assert.strictEqual(p1.messages.length, 50);
  assert.strictEqual(p1.messages[49].text, "m129");
  assert.strictEqual(p1.messages[0].text, "m80");
  assert.strictEqual(p1.hasMore, true);
  const p2 = store.page({ before: p1.oldest, limit: 50 });
  assert.strictEqual(p2.messages[49].text, "m79");
  assert.strictEqual(p2.messages[0].text, "m30");
  const p3 = store.page({ before: p2.oldest, limit: 50 });
  assert.strictEqual(p3.messages.length, 30);
  assert.strictEqual(p3.hasMore, false);
  assert.deepStrictEqual(store.page({ before: 1 }).messages, []);
});

test("an old message written later still sorts into its place", () => {
  const store = createThreadStore(tmp());
  store.append({ role: "user", text: "second", at: T0 + 5000 });
  store.append({ role: "user", text: "first", at: T0 });
  assert.deepStrictEqual(store.readDay(dayOf(T0)).map((m) => m.text), ["first", "second"]);
});

test("trash hides a message, restore brings it back, and only the 30-day purge removes it", () => {
  const dir = tmp();
  let clock = T0;
  const store = createThreadStore(dir, { now: () => clock });
  const a = store.append({ role: "user", text: "keep", at: T0 });
  const b = store.append({ role: "user", text: "delete me", at: T0 + 1 });
  assert.strictEqual(store.trash(b.id), true);
  assert.deepStrictEqual(store.readDay(dayOf(T0)).map((m) => m.text), ["keep"]);
  assert.strictEqual(store.find(b.id), null);
  assert.strictEqual(store.trashList().length, 1);
  assert.strictEqual(store.days()[0].messages, 1);
  // the line is still in the file (nothing was rewritten)
  assert.match(fs.readFileSync(path.join(dir, dayOf(T0) + ".jsonl"), "utf8"), /delete me/);
  assert.strictEqual(store.restore(b.id), true);
  assert.strictEqual(store.readDay(dayOf(T0)).length, 2);
  store.trash(b.id);
  clock += 29 * DAY;
  assert.strictEqual(store.purgeTrash(), 0);
  clock += 2 * DAY;
  assert.strictEqual(store.purgeTrash(), 1);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, dayOf(T0) + ".jsonl"), "utf8"), /delete me/);
  assert.strictEqual(store.trashList().length, 0);
  assert.strictEqual(store.find(a.id).text, "keep");
  assert.strictEqual(store.trash("m_bad"), false);
});

test("a damaged line and a missing index do not lose the rest", () => {
  const dir = tmp();
  const store = createThreadStore(dir);
  store.append({ role: "user", text: "one", at: T0 });
  fs.appendFileSync(path.join(dir, dayOf(T0) + ".jsonl"), "{broken json\n");
  store.append({ role: "user", text: "two", at: T0 + 10 });
  fs.rmSync(path.join(dir, "index.json"));
  const again = createThreadStore(dir);
  assert.deepStrictEqual(again.readDay(dayOf(T0)).map((m) => m.text), ["one", "two"]);
  assert.strictEqual(again.days()[0].messages, 2);
});

// ---- import ----
function oldChats(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const chat = (id, title, messages, extra = {}) => fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify({ id, title, created: messages[0].at, updated: messages[messages.length - 1].at, messages, ...extra }));
  chat("aaaaaaaaaaaaaaaa", "Laptop", [
    { role: "user", text: "Which laptop should I buy for studying computer science at university?", at: T0 },
    { role: "assistant", text: "A light laptop with 16 GB memory is a good choice for a student of computer science.", at: T0 + 5000, result: { mode: "single", rule: "x" } },
    { role: "user", text: "and the battery?", at: T0 + 9000 },
    { role: "assistant", text: "Something around ten hours of battery is realistic.", at: T0 + 12000 },
  ]);
  chat("bbbbbbbbbbbbbbbb", "Calculus", [
    { role: "user", text: "Explain integration by parts with an example please, step by step.", at: T0 + DAY },
    { role: "assistant", text: "Integration by parts says the integral of u dv equals u v minus the integral of v du.", at: T0 + DAY + 3000, result: { mode: "course", courseId: "c1", sources: [] } },
  ], { courseId: "c1" });
  fs.writeFileSync(path.join(dir, "not-a-chat.json"), "{}");
}

test("import copies every old message, keeps the order and the course, and is safe to run twice", () => {
  const root = tmp();
  const conv = path.join(root, "conversations");
  oldChats(conv);
  const before = fs.readFileSync(path.join(conv, "aaaaaaaaaaaaaaaa.json"), "utf8");
  const paths = { conversationsDir: conv, threadDir: path.join(root, "thread") };
  const r1 = importChats(paths);
  assert.deepStrictEqual([r1.chats, r1.added, r1.skipped], [2, 6, 0]);
  const r2 = importChats(paths);
  assert.deepStrictEqual([r2.added, r2.skipped], [0, 6]);
  const store = createThreadStore(paths.threadDir);
  const all = [...store.all()];
  assert.strictEqual(all.length, 6);
  const calc = all.find((m) => m.text.startsWith("Integration"));
  assert.strictEqual(calc.topic, "course:c1");
  assert.strictEqual(calc.result.mode, "course");
  const q = all.find((m) => m.text.startsWith("and the battery"));
  const a = all.find((m) => m.text.startsWith("Something around"));
  assert.strictEqual(a.replyTo, q.id);
  assert.strictEqual(q.id, importedId("aaaaaaaaaaaaaaaa", 2));
  assert.strictEqual(store.importedFrom().length, 2);
  assert.strictEqual(fs.readFileSync(path.join(conv, "aaaaaaaaaaaaaaaa.json"), "utf8"), before); // the old chat was only read
});

test("a new chat added later is imported on the next run, the old ones are not doubled", () => {
  const root = tmp();
  const conv = path.join(root, "conversations");
  oldChats(conv);
  const paths = { conversationsDir: conv, threadDir: path.join(root, "thread") };
  importChats(paths);
  const grown = JSON.parse(fs.readFileSync(path.join(conv, "aaaaaaaaaaaaaaaa.json"), "utf8"));
  grown.messages.push({ role: "user", text: "one more question about the laptop", at: T0 + 20000 });
  fs.writeFileSync(path.join(conv, "aaaaaaaaaaaaaaaa.json"), JSON.stringify(grown));
  const r = importChats(paths);
  assert.deepStrictEqual([r.added, r.skipped], [1, 6]);
});

test("verify-import passes after an import and fails when a message is missing", () => {
  const root = tmp();
  const conv = path.join(root, "conversations");
  oldChats(conv);
  const paths = { conversationsDir: conv, threadDir: path.join(root, "thread") };
  assert.strictEqual(verifyImport(paths).ok, false); // nothing imported yet
  importChats(paths);
  const good = verifyImport(paths);
  assert.strictEqual(good.ok, true, JSON.stringify(good.checks));
  assert.ok(good.checks.length >= 5);
  // lose one line from the thread
  const file = path.join(paths.threadDir, dayOf(T0) + ".jsonl");
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  fs.writeFileSync(file, lines.slice(1).join("\n") + "\n");
  assert.strictEqual(verifyImport(paths).ok, false);
});

test("export writes only messages made after the switch, into a new empty folder", () => {
  const root = tmp();
  const conv = path.join(root, "conversations");
  oldChats(conv);
  const threadDir = path.join(root, "thread");
  importChats({ conversationsDir: conv, threadDir });
  const store = createThreadStore(threadDir);
  const q = store.append({ role: "user", text: "new question", at: T0 + 3 * DAY, topic: "general" });
  store.append({ role: "assistant", text: "new answer", at: T0 + 3 * DAY + 1000, replyTo: q.id, topic: "general" });
  store.append({ role: "user", text: "course question", at: T0 + 3 * DAY + 2000, topic: "course:c1" });
  const out = path.join(root, "export");
  const r = exportConversations({ threadDir, outDir: out, conversationsDir: conv });
  assert.deepStrictEqual([r.files, r.messages], [2, 3]);
  const chats = fs.readdirSync(out).map((n) => JSON.parse(fs.readFileSync(path.join(out, n), "utf8")));
  assert.ok(chats.every((c) => /^[a-f0-9]{16}$/.test(c.id) && Array.isArray(c.messages)));
  assert.ok(chats.some((c) => c.courseId === "c1"));
  assert.throws(() => exportConversations({ threadDir, outDir: out, conversationsDir: conv }), /not empty/); // never over something
  assert.throws(() => exportConversations({ threadDir, outDir: path.join(conv, "sub"), conversationsDir: conv }), /NEW folder/);
  const all = exportConversations({ threadDir, outDir: path.join(root, "export-all"), conversationsDir: conv, all: true });
  assert.strictEqual(all.messages, 9);
});

test("after a restart, a recent question with no answer gets one plain reply; answered, old, imported and deleted-answer ones do not", () => {
  const dir = tmp();
  let clock = T0 + 3600 * 1000;
  const store = createThreadStore(dir, { now: () => clock });
  const q1 = store.append({ role: "user", text: "cut off by a restart", at: T0 });
  const q2 = store.append({ role: "user", text: "answered", at: T0 + 1000 });
  store.append({ role: "assistant", text: "yes", replyTo: q2.id, at: T0 + 2000 });
  const q3 = store.append({ role: "user", text: "answer deleted by the user", at: T0 + 3000 });
  const a3 = store.append({ role: "assistant", text: "gone", replyTo: q3.id, at: T0 + 4000 });
  store.trash(a3.id);
  store.append({ role: "user", text: "imported and unanswered", at: T0 + 5000, imported: { conversationId: "c", title: "t", index: 0 } });
  const old = store.append({ role: "user", text: "two days ago", at: T0 - 2 * DAY });
  assert.strictEqual(store.markUnanswered(), 1);
  const replies = store.page({ limit: 50 }).messages.filter((m) => m.replyTo === q1.id);
  assert.strictEqual(replies.length, 1);
  assert.strictEqual(replies[0].error, true);
  assert.match(replies[0].text, /restarted \(or stopped\)/);
  assert.strictEqual(store.page({ limit: 50 }).messages.some((m) => m.replyTo === old.id), false);
  assert.strictEqual(store.markUnanswered(), 0); // a second run adds nothing
});
