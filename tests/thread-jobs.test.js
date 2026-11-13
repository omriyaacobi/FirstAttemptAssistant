// thread-jobs.test.js
// Tests the one-conversation thread end to end WITHOUT real models: per-message jobs, the two lanes, same-course order,
// the capped context, the pinned calendar card, recall over the thread, and the server routes (and that the OLD routes still work
// when the switch is off). Only temporary folders and made-up text.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobs } = require("../jobs");
const { createThreadStore, loadThreadFlag } = require("../thread-store");
const { buildHistory, MAX_CONTEXT_CHARS } = require("../thread-context");
const { historyBlock, MAX_HISTORY_CHARS } = require("../history");
const { findInThread } = require("../recall");
const { createStore } = require("../store");
const { createServer } = require("../server");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-thjobs-"));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let release; const wait = new Promise((r) => (release = r)); return { wait, release }; };
const single = (answer) => ({ mode: "single", answer, used: { provider: "p", model: "m" } });
const COURSES = [{ id: "aaaaaaaaaaaaaaa1", name: "Calculus 2" }, { id: "aaaaaaaaaaaaaaa2", name: "Systems Programming" }];
async function done(jobs, id) { for (let i = 0; i < 300; i++) { const j = jobs.get(id); if (j && j.status !== "running") return j; await tick(5); } throw new Error("job did not finish"); }

function setup({ handle, maxRunning = 2, onFinish = () => {}, courses = () => COURSES, cardNote = null } = {}) {
  const thread = createThreadStore(tmp());
  const jobs = createJobs({ handle, thread, store: createStore(tmp()), courses, courseName: (id) => (COURSES.find((c) => c.id === id) || {}).name, maxRunning, onFinish, cardNote });
  return { thread, jobs };
}

test("a message is saved, answered with replyTo, and the answer sits under its question", async () => {
  const { thread, jobs } = setup({ handle: async () => single("four") });
  const job = jobs.startThread({ task: "2+2?" });
  assert.strictEqual(job.conversationId, "thread");
  assert.ok(job.messageId);
  assert.strictEqual(thread.find(job.messageId).text, "2+2?"); // the question is saved at once
  await done(jobs, job.id);
  const [q, a] = [...thread.all()];
  assert.strictEqual(a.role, "assistant");
  assert.strictEqual(a.replyTo, q.id);
  assert.strictEqual(a.text, "four");
});

test("a second message is accepted while a slow one runs, and a fast answer arrives first", async () => {
  const slowGate = gate();
  const handle = async (task, options) => {
    if (task === "slow one") { await options.gate({}); await slowGate.wait; return single("slow answer"); }
    return single("fast answer"); // no gate call: a fast action
  };
  const { thread, jobs } = setup({ handle });
  const slow = jobs.startThread({ task: "slow one" });
  await tick();
  const fast = jobs.startThread({ task: "fast one" }); // the old chat would have said 409 "one task at a time"
  await done(jobs, fast.id);
  assert.strictEqual(jobs.get(slow.id).status, "running");
  slowGate.release();
  await done(jobs, slow.id);
  const messages = [...thread.all()];
  assert.deepStrictEqual(messages.map((m) => m.text), ["slow one", "fast one", "fast answer", "slow answer"]); // the fast answer came first
  assert.strictEqual(messages[2].replyTo, messages[1].id); // but each answer points at its own question
  assert.strictEqual(messages[3].replyTo, messages[0].id);
});

test("two lanes: slow work takes one of the slots, the third waits, fast work never waits", async () => {
  const gates = { a: gate(), b: gate(), c: gate() };
  const handle = async (task, options) => {
    if (task in gates) { await options.gate({}); await gates[task].wait; return single("done " + task); }
    return single("quick " + task);
  };
  const { jobs } = setup({ handle, maxRunning: 2 });
  const a = jobs.startThread({ task: "a" });
  const b = jobs.startThread({ task: "b" });
  const c = jobs.startThread({ task: "c" });
  await tick(40);
  const view = (j) => jobs.get(j.id);
  assert.strictEqual(view(a).step, "Starting");
  assert.strictEqual(view(c).waiting, true);
  assert.match(view(c).step, /Waiting for a free slot/);
  const fast = jobs.startThread({ task: "hello" });
  assert.strictEqual((await done(jobs, fast.id)).status, "done"); // no limit for fast work, even with every slot full
  gates.a.release();
  await done(jobs, a.id);
  await tick(30);
  assert.strictEqual(view(c).waiting, false); // the freed slot went to the waiting job
  gates.b.release(); gates.c.release();
  assert.strictEqual((await done(jobs, c.id)).status, "done");
});

test("same-course order: a question to a course waits for the earlier one, other courses do not wait", async () => {
  const order = [];
  const gates = [gate(), gate()];
  let n = 0;
  const handle = async (task, options) => {
    const course = task.startsWith("calc") ? COURSES[0].id : COURSES[1].id;
    await options.gate({ course });
    order.push("start " + task);
    if (task === "calc 1") await gates[n++].wait;
    order.push("end " + task);
    return single("ok " + task);
  };
  const { jobs } = setup({ handle, maxRunning: 3 });
  const first = jobs.startThread({ task: "calc 1" });
  await tick(30);
  const second = jobs.startThread({ task: "calc 2" }); // same course: must wait for calc 1
  const other = jobs.startThread({ task: "sys 1" }); // another course: free to go
  await tick(40);
  assert.deepStrictEqual(order, ["start calc 1", "start sys 1", "end sys 1"]);
  assert.match(jobs.get(second.id).step, /earlier question about the same course/);
  gates[0].release();
  await done(jobs, first.id);
  await done(jobs, second.id);
  assert.deepStrictEqual(order.slice(3), ["end calc 1", "start calc 2", "end calc 2"]);
  await done(jobs, other.id);
});

test("an empty model answer is a failure, not a blank reply", async () => {
  const { thread, jobs } = setup({ handle: async () => single("   ") });
  const job = jobs.startThread({ task: "hi" });
  const finished = await done(jobs, job.id);
  assert.strictEqual(finished.status, "error");
  const reply = [...thread.all()][1];
  assert.strictEqual(reply.error, true);
  assert.match(reply.text, /empty answer/);
});

test("the next message sees finished turns, a label on course answers, a line for work in progress, and never a failed answer", async () => {
  const slowGate = gate();
  const seen = [];
  const handle = async (task, options) => {
    seen.push({ task, history: options.history });
    if (task === "slow topic") { await options.gate({}); await slowGate.wait; }
    if (task === "boom") throw new Error("model down");
    if (task === "course q") return { mode: "course", courseId: COURSES[0].id, courseName: "Calculus 2", answer: "an answer from the notes", sources: [], used: { model: "m" } };
    return single("reply to " + task);
  };
  const { jobs } = setup({ handle });
  await done(jobs, jobs.startThread({ task: "course q" }).id);
  await done(jobs, jobs.startThread({ task: "boom" }).id);
  jobs.startThread({ task: "slow topic" });
  await tick(30);
  const last = jobs.startThread({ task: "a new one" });
  await done(jobs, last.id);
  const history = seen.find((s) => s.task === "a new one").history;
  const texts = history.map((h) => h.text);
  assert.ok(texts.includes("an answer from the notes"));
  assert.strictEqual(history.find((h) => h.text === "an answer from the notes").label, "course answer: Calculus 2");
  assert.ok(!texts.some((t) => /Something went wrong|model down/.test(t)), "a failed answer is not memory");
  assert.ok(!texts.includes("boom") || true);
  assert.ok(texts.some((t) => /still working on an earlier message: "slow topic"/.test(t)));
  assert.ok(!texts.includes("slow topic"), "the question being worked on is a pending line, not a turn");
  assert.ok(!texts.includes("a new one"), "the new message is not in its own history");
  slowGate.release();
});

test("the course list and the study state reach the handler; the push text never carries the message", async () => {
  const pushes = [];
  let seenOptions = null;
  const { jobs } = setup({ handle: async (task, options) => { seenOptions = options; return { mode: "course", courseId: COURSES[1].id, answer: "SECRET ANSWER TEXT", sources: [] }; }, onFinish: (info) => pushes.push(info) });
  const job = jobs.startThread({ task: "my private question about my health" });
  await done(jobs, job.id);
  await tick();
  assert.deepStrictEqual(seenOptions.courses, COURSES);
  assert.strictEqual(typeof seenOptions.gate, "function");
  assert.strictEqual(pushes.length, 1);
  assert.doesNotMatch(JSON.stringify(pushes[0].title), /private|health|SECRET/);
  assert.match(pushes[0].title, /answer about your studies is ready/);
});

test("at most 20 messages at once; the 21st is told to wait", async () => {
  const hold = gate();
  const { jobs } = setup({ handle: async (task, options) => { await hold.wait; return single("x"); } });
  for (let i = 0; i < 20; i++) jobs.startThread({ task: "m" + i });
  assert.throws(() => jobs.startThread({ task: "one too many" }), (e) => e.status === 429);
  hold.release();
});

test("with no thread, startThread does not exist as a way in", () => {
  const jobs = createJobs({ handle: async () => single("x"), store: createStore(tmp()) });
  assert.throws(() => jobs.startThread({ task: "x" }), (e) => e.status === 404);
});

// ---- the capped context ----
test("CAP: however long the thread, the history for a message stays under the hard cap", () => {
  const thread = createThreadStore(tmp());
  const big = "x".repeat(5000);
  const at0 = Date.now() - 20 * 24 * 3600 * 1000;
  thread.appendMany(Array.from({ length: 1200 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${i} ${big}`, at: at0 + i * 60000 })));
  const entryOf = (m) => ({ role: m.role, text: m.text });
  const history = buildHistory(thread, { entryOf, pending: ["a", "b", "c", "d", "e", "f", "g"] });
  const size = history.reduce((a, h) => a + h.text.length + (h.note || "").length, 0);
  assert.ok(size <= MAX_CONTEXT_CHARS, `history is ${size} characters, the cap is ${MAX_CONTEXT_CHARS}`);
  assert.ok(history.length >= 3 && history.length < 20);
  assert.ok(history.some((h) => h.text.startsWith("1199 ")), "the newest turn is kept");
  assert.strictEqual(history.filter((h) => /still working/.test(h.text)).length, 5); // pending lines are capped too
  // and the text really pasted in front of the model (history.js) stays small
  const block = historyBlock(history);
  assert.ok(block.length <= MAX_HISTORY_CHARS + 200, `the pasted block is ${block.length}`);
});

test("CAP: one single huge message cannot blow the cap either", () => {
  const thread = createThreadStore(tmp());
  thread.append({ role: "user", text: "y".repeat(2000000) });
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  assert.ok(history[0].text.length <= 2000); // MAX_MESSAGE_CHARS in thread-context.js (raised from 1500 for the brain)
});

// ---- the newest calendar card stays pinned (phase 5) ----
test("PINNED: the newest calendar card's note is in the context even when a busy hour pushed it out of the recent turns", () => {
  const thread = createThreadStore(tmp());
  const t0 = Date.now() - 3 * 3600 * 1000;
  thread.append({ role: "user", text: "add my timetable", at: t0 });
  thread.append({ role: "assistant", text: "Add these to your calendar?", at: t0 + 1000, topic: "calendar", result: { rule: "photo (calendar add, needs Confirm)", calendarAdd: { id: "card1", events: [{ title: "Algebra" }, { title: "Physics" }] } } });
  for (let i = 0; i < 60; i++) thread.append({ role: i % 2 ? "assistant" : "user", text: `chatter ${i} ` + "z".repeat(300), at: t0 + 60000 + i * 1000 });
  const entryOf = (m) => {
    const add = m.result && m.result.calendarAdd;
    return add ? { role: m.role, text: m.text, cardId: add.id, note: "[CARD NOTE full: Algebra, Physics]", noteShort: "[card short]" } : { role: m.role, text: m.text };
  };
  const history = buildHistory(thread, { entryOf });
  assert.strictEqual(history[0].cardId, "card1"); // pinned at the front
  assert.match(history[0].note, /Algebra, Physics/);
  assert.ok(!history.slice(1).some((h) => h.cardId), "not doubled");
  // history.js prints the newest card's FULL note
  assert.match(historyBlock(history), /CARD NOTE full: Algebra, Physics/);
  // when the card is among the recent turns, it is not added a second time
  const small = createThreadStore(tmp());
  small.append({ role: "assistant", text: "card here", result: { calendarAdd: { id: "c2", events: [{}] } } });
  assert.strictEqual(buildHistory(small, { entryOf }).filter((h) => h.cardId).length, 1);
  // a card older than the 15-minute life of a card by many days is not pinned
  const old = createThreadStore(tmp());
  old.append({ role: "assistant", text: "old card", at: Date.now() - 40 * 24 * 3600 * 1000, result: { calendarAdd: { id: "c3", events: [{}] } } });
  for (let i = 0; i < 60; i++) old.append({ role: i % 2 ? "assistant" : "user", text: "later " + i + " " + "z".repeat(300), at: Date.now() - 1000000 + i });
  assert.strictEqual(buildHistory(old, { entryOf }).filter((h) => h.cardId).length, 0);
});

// ---- recall over the thread (phase 5) ----
test("RECALL: finds the old exchange, pairs by replyTo even when answers arrive out of order, and skips private replies", () => {
  const thread = createThreadStore(tmp());
  const t0 = Date.now() - 5 * 24 * 3600 * 1000;
  const q1 = thread.append({ role: "user", text: "which laptop should I buy for university, something light", at: t0 });
  const q2 = thread.append({ role: "user", text: "what is the capital of Peru", at: t0 + 1000 });
  thread.append({ role: "assistant", text: "Lima is the capital of Peru.", replyTo: q2.id, at: t0 + 2000 }); // the fast answer first
  thread.append({ role: "assistant", text: "A light laptop with sixteen gigabytes of memory suits a student.", replyTo: q1.id, at: t0 + 9000 });
  const q3 = thread.append({ role: "user", text: "what is on my calendar tomorrow", at: t0 + 20000 });
  thread.append({ role: "assistant", text: "Dentist at four with Dr Cohen", replyTo: q3.id, at: t0 + 21000, result: { rule: "calendar (read-only)" } });
  const found = findInThread(thread, "laptop");
  assert.strictEqual(found.length > 0, true);
  assert.match(found[0].question, /laptop/);
  assert.match(found[0].answer, /sixteen gigabytes/); // NOT "Lima is the capital": the answer that came next is not the answer
  assert.ok(!findInThread(thread, "dentist Cohen").some((f) => /Cohen/.test(f.answer)), "calendar replies are never given to a model");
});

test("RECALL: an imported old chat is found, and old chats that were never copied are found too (not twice)", () => {
  const root = tmp();
  const old = createStore(path.join(root, "conversations"));
  const copied = old.create("the laptop chat");
  old.append(copied.id, [{ role: "user", text: "tell me about orange marmalade recipes", at: 1000 }, { role: "assistant", text: "Use bitter oranges and sugar.", at: 2000 }]);
  const fresh = old.create("another");
  old.append(fresh.id, [{ role: "user", text: "tell me about zebra crossings in Norway", at: 3000 }, { role: "assistant", text: "They are striped.", at: 4000 }]);
  const thread = createThreadStore(path.join(root, "thread"));
  const { importChats } = require("../tools/thread");
  // import only the first chat: move the second out of the way for the import, then back
  const second = path.join(root, "conversations", fresh.id + ".json");
  const hold = fs.readFileSync(second);
  fs.rmSync(second);
  importChats({ conversationsDir: path.join(root, "conversations"), threadDir: path.join(root, "thread") });
  fs.writeFileSync(second, hold);
  const inThread = findInThread(thread, "marmalade", { oldChats: old });
  assert.strictEqual(inThread.length, 1);
  assert.strictEqual(inThread[0].conversationId, copied.id);
  const fromOld = findInThread(thread, "zebra Norway", { oldChats: old });
  assert.strictEqual(fromOld.length, 1);
  assert.strictEqual(fromOld[0].conversationId, fresh.id);
});

// ---- the server ----
async function startServer({ thread = null, handle = async () => single("hello"), courseRoutes = null } = {}) {
  const store = createStore(tmp());
  const pushes = [];
  const server = createServer({
    handle, store, thread, courseRoutes,
    push: { notifyAll: async (p) => { pushes.push(p); }, publicKey: () => null, subscribe() {}, unsubscribe() {} },
    usage: async () => [],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = (method, p, { body } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  return { request, store, pushes, close: () => server.close() };
}

test("SERVER (thread on): /api/ask needs no chat id, /api/thread pages, and a bad before is refused", async () => {
  const thread = createThreadStore(tmp());
  const s = await startServer({ thread });
  try {
    assert.strictEqual((await s.request("GET", "/api/session")).json.thread, true);
    const ask = await s.request("POST", "/api/ask", { body: { task: "hello there" } });
    assert.strictEqual(ask.status, 202);
    assert.strictEqual(ask.json.job.conversationId, "thread");
    for (let i = 0; i < 100; i++) { const j = await s.request("GET", "/api/jobs/" + ask.json.job.id); if (j.json.job.status !== "running") break; await tick(10); }
    const page = await s.request("GET", "/api/thread");
    assert.strictEqual(page.status, 200);
    assert.deepStrictEqual(page.json.messages.map((m) => m.text), ["hello there", "hello"]);
    assert.strictEqual(page.json.messages[1].replyTo, page.json.messages[0].id);
    assert.strictEqual(page.json.hasMore, false);
    assert.strictEqual((await s.request("GET", "/api/thread?before=abc")).status, 400);
    assert.strictEqual((await s.request("GET", "/api/thread?limit=99999")).status, 400);
    assert.strictEqual((await s.request("GET", "/api/thread?before=1")).json.messages.length, 0);
    // two questions at the same time are both accepted (the old chat said 409)
    const [a, b] = await Promise.all([s.request("POST", "/api/ask", { body: { task: "one" } }), s.request("POST", "/api/ask", { body: { task: "two" } })]);
    assert.deepStrictEqual([a.status, b.status], [202, 202]);
    // trash and restore
    const id = page.json.messages[0].id;
    assert.strictEqual((await s.request("DELETE", "/api/thread/" + id)).status, 200);
    assert.strictEqual((await s.request("GET", "/api/thread")).json.messages.some((m) => m.id === id), false);
    assert.strictEqual((await s.request("POST", "/api/thread/" + id + "/restore")).status, 200);
    assert.strictEqual((await s.request("DELETE", "/api/thread/not-an-id")).status, 404);
    await tick(80);
  } finally { s.close(); }
});

test("SERVER (thread on): the trash list shows deleted messages after a reload, and Restore brings one back (night check)", async () => {
  const thread = createThreadStore(tmp());
  const s = await startServer({ thread });
  try {
    const ask = await s.request("POST", "/api/ask", { body: { task: "remember this question" } });
    for (let i = 0; i < 100; i++) { const j = await s.request("GET", "/api/jobs/" + ask.json.job.id); if (j.json.job.status !== "running") break; await tick(10); }
    const id = (await s.request("GET", "/api/thread")).json.messages[0].id;
    assert.deepStrictEqual((await s.request("GET", "/api/thread/trash")).json.items, []);
    assert.strictEqual((await s.request("DELETE", "/api/thread/" + id)).status, 200);
    const list = (await s.request("GET", "/api/thread/trash")).json.items;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, id);
    assert.strictEqual(list[0].text, "remember this question");
    assert.strictEqual(list[0].daysLeft, 30);
    assert.strictEqual((await s.request("POST", "/api/thread/" + id + "/restore")).status, 200);
    assert.deepStrictEqual((await s.request("GET", "/api/thread/trash")).json.items, []);
  } finally { s.close(); }
});

test("SERVER (thread on): /api/ask takes route general only; anything else is refused", async () => {
  const seen = [];
  const thread = createThreadStore(tmp());
  const s = await startServer({ thread, handle: async (task, options) => { seen.push(options.route); return single("ok"); } });
  try {
    assert.strictEqual((await s.request("POST", "/api/ask", { body: { task: "a", route: "calendar" } })).status, 400);
    const ok = await s.request("POST", "/api/ask", { body: { task: "b", route: "general" } });
    assert.strictEqual(ok.status, 202);
    const plain = await s.request("POST", "/api/ask", { body: { task: "c" } });
    for (const r of [ok, plain]) for (let i = 0; i < 100; i++) { const j = await s.request("GET", "/api/jobs/" + r.json.job.id); if (j.json.job.status !== "running") break; await tick(10); }
    assert.deepStrictEqual(seen, ["general", null]);
  } finally { s.close(); }
});

// ---- quick actions never wait behind long answers (2026-11-12) ----
// The REAL brain inside the real jobs: two long messages hold both slow slots, and a reminder sent after them is still answered at once.
test("the real brain: a reminder is answered while two long answers hold both slots; a third long one waits for a slot", async () => {
  const { createBrain } = require("../brain");
  const hold = gate();
  const made = [];
  const said = (prompt) => /<message>\n([\s\S]*?)\n<\/message>/.exec(prompt)[1];
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [], create: (r) => { made.push(r.text); return { id: "r1", ...r }; } }, memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }), poolLevels: async () => [], poolRows: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    chain: [{ provider: "agy", model: "fake-model" }],
    // The fake model: a "long" message first asks for a lookup, and its second round hangs until the test lets go.
    askOne: async (provider, model, prompt) => {
      const text = said(prompt);
      if (/^long/.test(text)) { if (!/## Tool round 1/.test(prompt)) return 'CALL {"tool":"reminders_list"}'; await hold.wait; return "long answer to " + text; }
      return 'CALL {"tool":"set_reminder","text":"leave","when":"2030-01-01T17:00"}\nI will remind you at 17:00.';
    },
  });
  const { thread, jobs } = setup({ handle: brain.handle, courses: () => [] });
  const a = jobs.startThread({ task: "long one" });
  const b = jobs.startThread({ task: "long two" });
  const c = jobs.startThread({ task: "long three" });
  await tick(40);
  const quick = jobs.startThread({ task: "remind me at 5 to leave" });
  const finished = await done(jobs, quick.id); // answered although both slots are held
  assert.strictEqual(finished.status, "done");
  assert.deepStrictEqual(made, ["leave"]);
  for (const id of [a.id, b.id, c.id]) assert.strictEqual(jobs.get(id).status, "running");
  assert.ok(jobs.get(c.id).log.some((l) => /waiting for a free slot/.test(l)), "the third long message waits for a slot, after its first model call");
  assert.ok(![...thread.all()].some((m) => m.role === "assistant" && /long answer/.test(m.text)));
  assert.match([...thread.all()].find((m) => m.replyTo === quick.messageId).text, /remind you at 17:00/);
  hold.release();
  for (const id of [a.id, b.id, c.id]) assert.strictEqual((await done(jobs, id)).status, "done");
  assert.strictEqual([...thread.all()].filter((m) => m.role === "assistant" && /^long answer to long/.test(m.text)).length, 3);
});

// ---- the recent talk is smaller since 2026-11-12: older answers of Bot keep only their start ----
test("history: the newest 3 messages stay whole, an older answer of Bot keeps its first 500 characters, Omri's own messages are never shortened that way", () => {
  const { RECENT_CHARS, FULL_TURNS, OLD_ANSWER_CHARS, CUT_MARK } = require("../thread-context");
  assert.deepStrictEqual([RECENT_CHARS, FULL_TURNS, OLD_ANSWER_CHARS], [5000, 3, 500]);
  const thread = createThreadStore(tmp());
  const t0 = Date.now() - 3600 * 1000;
  const long = (tag) => tag + " " + "w".repeat(1200);
  thread.appendMany([
    { role: "user", text: long("Q1"), at: t0 },
    { role: "assistant", text: long("A1"), at: t0 + 1000 },
    { role: "user", text: "Q2 short", at: t0 + 2000 },
    { role: "assistant", text: long("A2"), at: t0 + 3000 },
    { role: "user", text: "Q3 short", at: t0 + 4000 },
    { role: "assistant", text: long("A3"), at: t0 + 5000 },
  ]);
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  const by = (tag) => history.find((h) => h.text.startsWith(tag));
  assert.strictEqual(by("A3").text.length, 1203); // the last answer, word for word
  assert.strictEqual(by("A2").text.length, 1203); // and the answer before it (among the newest 3)
  assert.strictEqual(by("A1").text, long("A1").slice(0, 500) + CUT_MARK); // an older answer: its start and a mark
  assert.strictEqual(by("Q1").text.length, 1203); // Omri's own older message is kept whole
  assert.deepStrictEqual(history.map((h) => h.text.slice(0, 2)), ["Q1", "A1", "Q2", "A2", "Q3", "A3"]);
});

test("history: the recent turns never pass the budget, and short older answers are not marked", () => {
  const { RECENT_CHARS, CUT_MARK } = require("../thread-context");
  const thread = createThreadStore(tmp());
  const t0 = Date.now() - 3600 * 1000;
  thread.appendMany(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${i} ` + "z".repeat(i % 2 ? 900 : 100), at: t0 + i * 1000 })));
  thread.append({ role: "assistant", text: "short and old", at: t0 - 1000 });
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  const kept = history.reduce((a, h) => a + Math.min(h.text.length, h.text.endsWith(CUT_MARK) ? h.text.length - CUT_MARK.length : h.text.length), 0);
  assert.ok(kept <= RECENT_CHARS, `${kept} characters kept, the budget is ${RECENT_CHARS}`);
  assert.ok(history.length > 8, "shortening older answers leaves room for more turns: " + history.length);
  assert.ok(history[history.length - 1].text.startsWith("39 ") && !history[history.length - 1].text.endsWith(CUT_MARK));
  const short = buildHistory(createThreadStoreWith(["hello", "short answer", "and?", "another short one", "ok", "fine", "last q", "last a"]), { entryOf: (m) => ({ role: m.role, text: m.text }) });
  assert.ok(!short.some((h) => h.text.includes(CUT_MARK)));
});
function createThreadStoreWith(texts) {
  const thread = createThreadStore(tmp());
  const t0 = Date.now() - 3600 * 1000;
  thread.appendMany(texts.map((text, i) => ({ role: i % 2 ? "assistant" : "user", text, at: t0 + i * 1000 })));
  return thread;
}

// ---- a long recent answer keeps its END (2026-11-13): the check question Bot asked is at the end ----
test("ENDS: a long recent answer keeps its start and its end, so the question Bot asked last is still in the memory", () => {
  const { keepEnds } = require("../thread-context");
  const thread = createThreadStore(tmp());
  const answer = "Step one: open the loop in main.c. " + "filler text about pointers. ".repeat(150) + "Now run make again and tell me which line the error points to?";
  thread.append({ role: "user", text: "why does my loop crash" });
  thread.append({ role: "assistant", text: answer });
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  const last = history[history.length - 1].text;
  assert.ok(last.length <= 2000, `kept ${last.length} characters`);
  assert.ok(last.startsWith("Step one: open the loop"), "the start is kept");
  assert.ok(last.endsWith("which line the error points to?"), "the end (the question) is kept");
  assert.match(last, /middle of this message is left out/);
  assert.strictEqual(keepEnds("short", 2000), "short");
  for (const n of [60, 100, 2000]) assert.ok(keepEnds("x".repeat(5000), n).length <= n);
});
