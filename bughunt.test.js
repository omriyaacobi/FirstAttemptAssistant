// bughunt.test.js
// Regression tests for bugs found by reading the one-conversation code (night of 2026-11-07). Each test failed before its fix.
// Temporary folders and fakes only.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, dayOf } = require("./thread-store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-bughunt-"));
const T = new Date("2026-11-07T12:00:00").getTime();

test("a half-written last line (a crash while saving) does not swallow the NEXT message", () => {
  const dir = tmp();
  const store = createThreadStore(dir);
  store.append({ role: "user", text: "one", at: T });
  fs.appendFileSync(path.join(dir, dayOf(T) + ".jsonl"), '{"id":"m_abcdef012345","at":1,"role":"us'); // power cut: no newline at the end
  const two = store.append({ role: "user", text: "two", at: T + 1 });
  assert.deepStrictEqual(store.readDay(dayOf(T)).map((m) => m.text), ["one", "two"]);
  assert.strictEqual(store.find(two.id).text, "two");
  // and a trash tombstone after the damage is not swallowed either
  assert.strictEqual(store.trash(two.id), true);
  assert.deepStrictEqual(store.readDay(dayOf(T)).map((m) => m.text), ["one"]);
});

test("the index is only a cache: when it cannot be written (a file lock on Windows) messages are still saved and read", () => {
  const dir = tmp();
  const store = createThreadStore(dir);
  store.append({ role: "user", text: "before", at: T });
  fs.rmSync(path.join(dir, "index.json"));
  fs.mkdirSync(path.join(dir, "index.json")); // writing a file over a folder fails, like a locked file does
  const m = store.append({ role: "user", text: "after", at: T + 1 }); // used to throw after the message was already on disk
  assert.strictEqual(m.text, "after");
  assert.deepStrictEqual(store.page({}).messages.map((x) => x.text), ["before", "after"]);
  assert.strictEqual(store.trash(m.id), true);
  assert.deepStrictEqual([...store.all()].map((x) => x.text), ["before"]);
});

// ---- files ----
const { createThreadFiles } = require("./thread-files");
const { createStudyCoach } = require("./study-coach");
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const COURSES = [{ id: "a".repeat(16), name: "Systems Programming" }, { id: "b".repeat(16), name: "Calculus 2" }];
function filesSetup(addUpload) {
  const thread = createThreadStore(tmp());
  const coach = createStudyCoach({ dir: tmp(), courses: { list: () => COURSES, allPages: () => [] }, askChain: async () => ({ answer: "?", used: {} }), now: () => T });
  const routes = { list: () => COURSES, addUpload, fileInfo: () => null };
  return { thread, files: createThreadFiles({ thread, courseRoutes: routes, coach, now: () => T }) };
}

test("a refused file (the same bytes twice) gets a reply under its message, so it is not left unanswered", () => {
  const { thread, files } = filesSetup(() => { throw Object.assign(new Error('this file is already in the course, as "notes.pdf"'), { status: 409 }); });
  assert.throws(() => files.receive({ bytes: PDF, name: "Systems Programming notes.pdf", text: "" }), (e) => e.status === 409);
  const all = [...thread.all()];
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[1].role, "assistant");
  assert.strictEqual(all[1].replyTo, all[0].id);
  assert.match(all[1].text, /already in the course/);
  assert.strictEqual(all[1].error, true);
});

// ---- the server must not die from one failing route ----
const http = require("node:http");
const { createServer } = require("./server");
const { createStore } = require("./store");

test("a route that throws (a thread file that cannot be read) answers 500 instead of crashing Bot with an unhandled rejection", async () => {
  const real = createThreadStore(tmp());
  const broken = { ...real, page: () => { throw new Error("EBUSY: resource busy or locked"); }, trash: () => { throw new Error("EPERM: operation not permitted"); } };
  const server = createServer({ handle: async () => ({ mode: "single", answer: "x", used: {} }), store: createStore(tmp()), thread: broken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const unhandled = [];
  const onRejection = (e) => unhandled.push(e);
  process.on("unhandledRejection", onRejection);
  const get = (method, p) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}` }, timeout: 2000 }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    req.on("timeout", () => { req.destroy(new Error("no answer")); });
    req.on("error", reject);
    req.end();
  });
  try {
    const r = await get("GET", "/api/thread");
    assert.strictEqual(r.status, 500);
    assert.match(r.body, /error/);
    assert.doesNotMatch(r.body, /EBUSY/); // the page gets a plain error, not file-system details
    const d = await get("DELETE", "/api/thread/m_" + "a".repeat(16));
    assert.strictEqual(d.status, 500);
    assert.strictEqual((await get("GET", "/api/jobs")).status, 200); // and the server is still alive
  } finally {
    process.off("unhandledRejection", onRejection);
    await new Promise((r) => server.close(r));
  }
  assert.deepStrictEqual(unhandled.map((e) => e.message), []);
});

// ---- the file reader queue ----
const { createCourses } = require("./courses");
const { createCourseRoutes } = require("./course-routes");

test("one file whose reading throws does not stop the queue or end Bot (an unhandled rejection)", async () => {
  const courses = createCourses(tmp());
  const course = courses.create("Any");
  const seen = [];
  const ready = [];
  const routes = createCourseRoutes({
    courses, store: createStore(tmp()), askCourse: async () => ({}), askFile: async () => ({}), askChain: async () => ({}),
    ingestFile: async ({ fileId }) => { seen.push(fileId); if (seen.length === 1) throw new Error("the course was deleted while the file was being read"); },
    onFileReady: async ({ fileId }) => { ready.push(fileId); },
  });
  const unhandled = [];
  const onRejection = (e) => unhandled.push(e.message);
  process.on("unhandledRejection", onRejection);
  try {
    const mk = (n) => Buffer.concat([PDF, Buffer.from("%" + n)]);
    routes.addUpload(course.id, mk("one"), "one.pdf");
    routes.addUpload(course.id, mk("two"), "two.pdf");
    for (let i = 0; i < 100 && !routes.idle(); i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  assert.deepStrictEqual(unhandled, []);
  assert.strictEqual(seen.length, 2, "the second file was still read");
  assert.strictEqual(routes.idle(), true, "the reader is free again");
});
