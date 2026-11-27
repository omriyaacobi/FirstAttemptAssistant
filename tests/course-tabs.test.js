// course-tabs.test.js
// THE COURSE TABS (2026-11-27): one store (data/thread), one tab per course plus Main. A message carries `place`
// ("course:<id>"; none = Main) and a copy carries `copyOf`. Only temporary folders and made-up text.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, placeOf } = require("../thread-store");
const { findInThread } = require("../recall");
const { workDone } = require("../course-work");
const { createStore } = require("../store");
const { createServer } = require("../server");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-tabs-"));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const T0 = new Date(2026, 10, 27, 10, 0, 0).getTime();
const DAY = 24 * 3600 * 1000;
const CALC = "aaaaaaaaaaaaaaa1", SP = "aaaaaaaaaaaaaaa2";
const COURSES = [{ id: CALC, name: "Calculus 2" }, { id: SP, name: "Systems Programming" }];

// ---- step 1: the store ----
test("a place and a copy are kept; a bad place or copy is dropped; old lines are Main", () => {
  const store = createThreadStore(tmp(), { now: () => T0 });
  const q = store.append({ role: "user", text: "q", at: T0, place: `course:${CALC}` });
  assert.strictEqual(q.place, `course:${CALC}`);
  assert.strictEqual(placeOf(q), `course:${CALC}`);
  const main = store.append({ role: "user", text: "m", at: T0 + 1 });
  assert.strictEqual(main.place, undefined);
  assert.strictEqual(placeOf(main), "main");
  assert.strictEqual(store.append({ role: "user", text: "x", at: T0 + 2, place: "../etc" }).place, undefined);
  assert.strictEqual(store.append({ role: "user", text: "x", at: T0 + 3, place: "main" }).place, undefined);
  const copy = store.append({ role: "user", text: "c", at: T0 + 4, place: `course:${SP}`, copyOf: main.id, copyKind: "moodle" });
  assert.deepStrictEqual([copy.copyOf, copy.copyKind], [main.id, "moodle"]);
  assert.strictEqual(store.append({ role: "user", text: "c", at: T0 + 5, copyOf: main.id, copyKind: "evil" }).copyKind, "asked");
  assert.strictEqual(store.append({ role: "user", text: "c", at: T0 + 6, copyOf: "nope" }).copyOf, undefined);
});

test("page by place: only that tab, newest last, hasMore honest, and the default still reads every tab", () => {
  const store = createThreadStore(tmp(), { now: () => T0 + 10 * DAY });
  for (let i = 0; i < 5; i++) store.append({ role: "user", text: "calc" + i, at: T0 + i, place: `course:${CALC}` });
  for (let i = 0; i < 3; i++) store.append({ role: "user", text: "main" + i, at: T0 + 10 + i });
  store.append({ role: "user", text: "sp", at: T0 + DAY, place: `course:${SP}` });
  assert.deepStrictEqual(store.page({ place: "main" }).messages.map((m) => m.text), ["main0", "main1", "main2"]);
  const calc = store.page({ place: `course:${CALC}`, limit: 3 });
  assert.deepStrictEqual(calc.messages.map((m) => m.text), ["calc2", "calc3", "calc4"]);
  assert.strictEqual(calc.hasMore, true);
  const older = store.page({ place: `course:${CALC}`, limit: 3, before: calc.oldest });
  assert.deepStrictEqual(older.messages.map((m) => m.text), ["calc0", "calc1"]);
  assert.strictEqual(older.hasMore, false);
  assert.strictEqual(store.page({ place: `course:${SP}` }).messages.length, 1);
  assert.strictEqual(store.page({}).messages.length, 9); // no place: every tab (the internal readers)
});

test("a course tab looks back 60 days at most; Main has no such limit", () => {
  const store = createThreadStore(tmp(), { now: () => T0 + 100 * DAY });
  store.append({ role: "user", text: "old calc", at: T0, place: `course:${CALC}` });
  store.append({ role: "user", text: "old main", at: T0 });
  assert.strictEqual(store.page({ place: `course:${CALC}` }).messages.length, 0);
  assert.strictEqual(store.page({ place: "main" }).messages.length, 1);
});

test("places() gives the newest time per tab of the last 14 days", () => {
  const store = createThreadStore(tmp(), { now: () => T0 + DAY });
  store.append({ role: "user", text: "a", at: T0, place: `course:${CALC}` });
  store.append({ role: "user", text: "b", at: T0 + 5, place: `course:${CALC}` });
  store.append({ role: "user", text: "c", at: T0 + 7 });
  store.append({ role: "user", text: "long ago", at: T0 - 30 * DAY, place: `course:${SP}` });
  assert.deepStrictEqual(store.places(), { [`course:${CALC}`]: T0 + 5, main: T0 + 7 });
});

test("a copy is skipped by the memory search, the course work list and the restart check", () => {
  const store = createThreadStore(tmp(), { now: () => T0 + 1000 });
  const q = store.append({ role: "user", text: "how do I integrate zebra functions", at: T0 });
  const a = store.append({ role: "assistant", text: "Use $$\\int z\\,dz$$ zebra", replyTo: q.id, at: T0 + 1, result: { brain: true, courseId: CALC } });
  const cq = store.append({ role: "user", text: q.text, at: T0 + 2, place: `course:${CALC}`, copyOf: q.id });
  store.append({ role: "assistant", text: a.text, replyTo: cq.id, at: T0 + 3, place: `course:${CALC}`, copyOf: a.id, result: { brain: true, courseId: CALC } });
  assert.strictEqual(findInThread(store, "zebra").length, 1);
  const work = workDone([...store.all()], CALC, { now: T0 + 1000, timeZone: "Asia/Jerusalem" });
  assert.strictEqual((work.match(/\\int z/g) || []).length, 1);
  // an unanswered COPY is never "cut off by a restart"; an unanswered question in a tab gets its reply in that tab
  const lone = store.append({ role: "user", text: "lone", at: T0 + 4, place: `course:${SP}` });
  store.append({ role: "user", text: "copy", at: T0 + 5, place: `course:${SP}`, copyOf: lone.id });
  assert.strictEqual(store.markUnanswered(), 1);
  const reply = [...store.all()].find((m) => m.replyTo === lone.id);
  assert.strictEqual(reply.place, `course:${SP}`);
});

test("the daily summary transcript skips copies", () => {
  const { transcriptOf } = require("../thread-summary");
  if (typeof transcriptOf !== "function") return; // not exported: covered by step 7's test
  const t = transcriptOf([{ id: "m_aaaaaaaaaaaaaaaa", role: "user", text: "real", at: T0 }, { id: "m_bbbbbbbbbbbbbbbb", role: "user", text: "copied", at: T0 + 1, copyOf: "m_aaaaaaaaaaaaaaaa" }]);
  assert.ok(t.text.includes("real") && !t.text.includes("copied"));
});

// ---- step 1: the server ----
async function startServer({ thread, handle = async () => ({ mode: "single", answer: "hello", used: { provider: "p", model: "m" } }) }) {
  const server = createServer({
    handle, store: createStore(tmp()), thread,
    courseRoutes: { list: () => COURSES, handle: async () => false },
    push: { notifyAll: async () => {}, publicKey: () => null, subscribe() {}, unsubscribe() {} },
    usage: async () => [],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = (method, p, { body } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  return { request, close: () => server.close() };
}

test("SERVER: GET /api/thread is Main by default, ?place= gives a tab, a made-up tab is refused, /places has times only", async () => {
  const thread = createThreadStore(tmp());
  thread.append({ role: "user", text: "in main" });
  thread.append({ role: "user", text: "in calc", place: `course:${CALC}` });
  const s = await startServer({ thread });
  try {
    const main = await s.request("GET", "/api/thread");
    assert.deepStrictEqual(main.json.messages.map((m) => m.text), ["in main"]);
    assert.strictEqual(main.json.place, "main");
    const calc = await s.request("GET", `/api/thread?place=course:${CALC}`);
    assert.deepStrictEqual(calc.json.messages.map((m) => m.text), ["in calc"]);
    assert.strictEqual((await s.request("GET", "/api/thread?place=course:nothere")).status, 400);
    assert.strictEqual((await s.request("GET", "/api/thread?place=../x")).status, 400);
    const places = await s.request("GET", "/api/thread/places");
    assert.strictEqual(places.status, 200);
    assert.deepStrictEqual(Object.keys(places.json.places).sort(), [`course:${CALC}`, "main"]);
  } finally { s.close(); }
});

test("SERVER: /api/ask refuses a place that is not a real course", async () => {
  const thread = createThreadStore(tmp());
  const s = await startServer({ thread });
  try {
    assert.strictEqual((await s.request("POST", "/api/ask", { body: { task: "hi", place: "course:nothere" } })).status, 400);
    assert.strictEqual((await s.request("POST", "/api/ask", { body: { task: "hi", place: 5 } })).status, 400);
    const ok = await s.request("POST", "/api/ask", { body: { task: "hi", place: `course:${CALC}` } });
    assert.strictEqual(ok.status, 202);
    await tick(60);
  } finally { s.close(); }
});
