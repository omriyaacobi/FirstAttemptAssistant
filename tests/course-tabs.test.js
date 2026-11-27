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

// ---- step 2: jobs and brain ----
const { createJobs } = require("../jobs");
async function finished(jobs, id) { for (let i = 0; i < 300; i++) { const j = jobs.get(id); if (j && j.status !== "running") return j; await tick(5); } throw new Error("job did not finish"); }

test("JOBS: a tab's question, answer and history stay in the tab; Main's history has no tab talk", async () => {
  const thread = createThreadStore(tmp());
  thread.append({ role: "user", text: "main talk", at: Date.now() - 5000 });
  thread.append({ role: "user", text: "calc talk", at: Date.now() - 4000, place: `course:${CALC}` });
  const seen = [];
  const handle = async (task, options) => { seen.push({ task, place: options.place, history: options.history.map((h) => h.text) }); return { mode: "single", answer: "ok " + task, used: { provider: "p", model: "m" } }; };
  const jobs = createJobs({ handle, thread, store: createStore(tmp()), courses: () => COURSES, courseName: () => "", maxRunning: 2, onFinish: () => {} });
  const a = jobs.startThread({ task: "in the tab", place: `course:${CALC}` });
  assert.strictEqual(a.place, `course:${CALC}`);
  await finished(jobs, a.id);
  const b = jobs.startThread({ task: "in main" });
  assert.strictEqual(b.place, "main");
  await finished(jobs, b.id);
  assert.strictEqual(seen[0].place, `course:${CALC}`);
  assert.deepStrictEqual(seen[0].history, ["calc talk"]);
  assert.ok(seen[1].history.includes("main talk") && !seen[1].history.some((t) => /calc|tab/.test(t)), seen[1].history.join("|"));
  const tab = thread.page({ place: `course:${CALC}` }).messages.map((m) => m.text);
  assert.deepStrictEqual(tab, ["calc talk", "in the tab", "ok in the tab"]);
  // a made-up place is ignored by jobs too (server.js refuses it first)
  const c = jobs.startThread({ task: "x", place: "course:../../" });
  assert.strictEqual(c.place, "main");
  await finished(jobs, c.id);
});

function tabBrain({ replies, prompts }) {
  const { createStudyCoach } = require("../study-coach");
  const { createBrain } = require("../brain");
  const NOW = new Date("2026-11-27T12:00:00+02:00").getTime();
  const courses = { list: () => COURSES, allPages: () => [] };
  const coach = createStudyCoach({ dir: tmp(), courses, askChain: async () => ({ answer: "x", used: { model: "f" } }), now: () => NOW });
  let n = 0;
  const askOne = async (provider, model, prompt) => { prompts.push(String(prompt)); return replies[Math.min(n++, replies.length - 1)]; };
  return createBrain({
    courses, coach,
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({}), askOne,
    chain: [{ provider: "agy", model: "one" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
}

test("BRAIN: in a course tab the course is the tab's, even when the message names another course", async () => {
  const prompts = [];
  const brain = tabBrain({ replies: ["An answer."], prompts });
  const r = await brain.handle("a quick Systems Programming question", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.strictEqual(r.courseId, CALC);
  assert.match(prompts[0], /## Omri is writing in the Calculus 2 tab/);
  assert.match(prompts[0], /## The course this talk is in: Calculus 2/);
  // in Main the same words name SP (the guess is unchanged there), and no tab line is shown
  const main = [];
  const r2 = await tabBrain({ replies: ["An answer."], prompts: main }).handle("a quick Systems Programming question", { history: [], courses: COURSES });
  assert.strictEqual(r2.courseId, SP);
  assert.doesNotMatch(main[0], /Omri is writing in the/);
});

test("BRAIN: talk_course changes nothing in a tab; a tool on another course sets workCourseId", async () => {
  const prompts = [];
  const brain = tabBrain({ replies: ['CALL {"tool":"talk_course","course":"none"}\nOK.'], prompts });
  const r = await brain.handle("thanks", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.strictEqual(r.courseId, CALC);
  assert.ok(!r.noCourse);
  const side = tabBrain({ replies: ['CALL {"tool":"course_files","course":"Systems Programming"}', "SP has no files yet."], prompts: [] });
  const r2 = await side.handle("which files does SP have?", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.strictEqual(r2.courseId, CALC);
  assert.strictEqual(r2.workCourseId, SP);
});

test("course-work.js lists a side question's formulas under the course it really was about", () => {
  const now = Date.now();
  const msgs = [{ role: "assistant", at: now - 1000, text: "$$\int_0^1 x\,dx$$", result: { courseId: CALC, workCourseId: SP } }];
  assert.strictEqual(workDone(msgs, CALC, { now, timeZone: "Asia/Jerusalem" }), "");
  assert.match(workDone(msgs, SP, { now, timeZone: "Asia/Jerusalem" }), /int_0\^1/);
});

// ---- step 3: the page (checked as text; the look was checked in a browser with the preview's sample data) ----
test("PAGE: the tab row exists, every read and send carries the open tab, and a job of another tab does not force a reload", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  for (const s of ["function renderTabs()", "function switchTab(", "function renderHeader()", "async function loadPlaces(",
    "/api/thread?limit=${T_PAGE}${placeQs()}", "&before=${T.oldest}${placeQs()}", "...(T.place !== \"main\" ? { place: T.place } : {})",
    "encodeURIComponent(text.slice(0, 500)) : \"\") + placeQs()", "(j.place || \"main\") === T.place", "/api/thread/places"]) {
    assert.ok(html.includes(s), `the page has: ${s}`);
  }
  // per-viewer conveniences are wrapped (a private window must still work)
  assert.match(html, /get\(key, fallback\) \{ try \{ const v = localStorage\.getItem/);
  const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  assert.match(sw, /open-place/);
  assert.match(sw, /\^\(main\|course:\[A-Za-z0-9_-\]\{1,64\}\)\$/);
});

// ---- step 5: the "add to course?" card ----
test("BRAIN: Main's card is offered only with evidence from the message, never from the carry-over or in a tab", async () => {
  // named in the message
  const r1 = await tabBrain({ replies: ["An answer."], prompts: [] }).handle("a Calculus 2 question", { history: [], courses: COURSES });
  assert.deepStrictEqual(r1.courseCard, { courseId: CALC, courseName: "Calculus 2" });
  // carried over from an earlier answer only: filed under the course, but no card
  const history = [{ role: "assistant", text: "earlier", courseId: CALC, at: new Date("2026-11-27T11:50:00+02:00").getTime() }];
  const r2 = await tabBrain({ replies: ["An answer."], prompts: [] }).handle("and what about that?", { history, courses: COURSES });
  assert.strictEqual(r2.courseId, CALC);
  assert.strictEqual(r2.courseCard, undefined);
  // a course tool really ran
  const r3 = await tabBrain({ replies: ['CALL {"tool":"course_files","course":"Systems Programming"}', "Here."], prompts: [] }).handle("which files are there?", { history: [], courses: COURSES });
  assert.strictEqual(r3.courseCard.courseId, SP);
  // never in a course tab
  const r4 = await tabBrain({ replies: ["An answer."], prompts: [] }).handle("a Calculus 2 question", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.strictEqual(r4.courseCard, undefined);
  // the carry-over ends after 90 minutes in Main
  const old = [{ role: "assistant", text: "earlier", courseId: CALC, at: new Date("2026-11-27T10:00:00+02:00").getTime() }];
  const r5 = await tabBrain({ replies: ["An answer."], prompts: [] }).handle("and what about that?", { history: old, courses: COURSES });
  assert.strictEqual(r5.courseId, undefined);
});

test("SERVER: Add to course copies the question and the answer once, only for a recent Main answer and a real course", async () => {
  const thread = createThreadStore(tmp());
  const q = thread.append({ role: "user", text: "what is a series?" });
  const a = thread.append({ role: "assistant", text: "A sum of terms.", replyTo: q.id, result: { mode: "single", brain: true, answer: "A sum of terms.", courseId: CALC, courseCard: { courseId: CALC } } });
  const inTab = thread.append({ role: "assistant", text: "tab answer", replyTo: q.id, place: `course:${SP}` });
  const old = thread.append({ role: "assistant", text: "old", replyTo: q.id, at: Date.now() - 8 * DAY });
  const s = await startServer({ thread });
  try {
    const post = (id, courseId) => s.request("POST", `/api/thread/${id}/to-course`, { body: { courseId } });
    const foundBefore = findInThread(thread, "series").length;
    assert.strictEqual((await post(a.id, "nothere")).status, 400);
    assert.strictEqual((await post(q.id, CALC)).status, 404, "a question is not an answer");
    assert.strictEqual((await post(inTab.id, CALC)).status, 404, "only Main answers");
    assert.strictEqual((await post(old.id, CALC)).status, 410);
    const ok = await post(a.id, CALC);
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.json.courseName, "Calculus 2");
    assert.strictEqual((await post(a.id, CALC)).status, 409, "only once per course");
    const tab = thread.page({ place: `course:${CALC}` }).messages;
    assert.deepStrictEqual(tab.map((m) => [m.role, m.text, m.copyOf, m.copyKind]), [["user", "what is a series?", q.id, "asked"], ["assistant", "A sum of terms.", a.id, "asked"]]);
    assert.strictEqual(tab[1].replyTo, tab[0].id);
    assert.strictEqual(tab[1].result.courseCard, undefined, "the copy carries no card of its own");
    assert.strictEqual(thread.page({ place: "main" }).messages.length, 3, "Main is unchanged");
    assert.strictEqual(findInThread(thread, "series").length, foundBefore, "the copies add nothing to the search");
    assert.strictEqual((await post(a.id, SP)).status, 201, "another course is allowed");
  } finally { s.close(); }
});

// ---- step 4: "today in the course tabs" for Main ----
const { todayText, activeMinutes } = require("../tab-today");
test("TODAY: one code-made line per tab used today, with active time, parts, quiz, lessons and plan ticks; copies and other days are skipped", () => {
  const TZ = "Asia/Jerusalem";
  const at = (h, m) => new Date(`2026-11-27T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+02:00`).getTime();
  const now = at(21, 0);
  const messages = [
    { place: `course:${CALC}`, role: "user", at: at(18, 10) },
    { place: `course:${CALC}`, role: "assistant", at: at(18, 20), result: { tools: ["teach_next"] } },
    { place: `course:${CALC}`, role: "user", at: at(18, 35) },
    { place: `course:${CALC}`, role: "assistant", at: at(19, 5), log: ["[brain] tool teach_next (Calculus 2)"] }, // a 30 min gap: a break, not counted
    { place: `course:${CALC}`, role: "user", at: at(20, 30), copyOf: "m_aaaaaaaaaaaaaaaa" }, // a copy: not counted
    { place: `course:${SP}`, role: "user", at: at(9, 0) - 24 * 3600 * 1000 }, // yesterday
    { role: "user", at: at(12, 0) }, // Main
  ];
  const records = {
    [CALC]: {
      worked: { 5: [{ page: 3, topic: "the arctan example", at: at(18, 30) }, { page: 4, topic: "ratio test", at: at(18, 50) }], 4: [{ page: 1, topic: "old part", at: at(10, 0) - 2 * 24 * 3600 * 1000 }] },
      session: { startedAt: at(18, 40), questions: [{ state: "done", verdict: "right" }, { state: "done", verdict: "wrong" }, { state: "done", verdict: "right" }] },
      planItems: [{ done: true, doneAt: at(19, 0) }, { done: true, doneAt: at(9, 0) - 24 * 3600 * 1000 }, { done: false }],
    },
  };
  const t = todayText({ messages, courses: COURSES, recordOf: (id) => records[id] || null, now, timeZone: TZ });
  assert.strictEqual(t, "Calculus 2 tab: 18:10-19:05 (25 min active); worked on: the arctan example, ratio test; quiz 2/3; 2 lessons; 1 exam-plan item ticked.");
  assert.strictEqual(todayText({ messages: [{ role: "user", at: now - 1000 }], courses: COURSES, now, timeZone: TZ }), "", "no tab used today: nothing");
  const paused = todayText({ messages, courses: COURSES, recordOf: () => ({ session: { startedAt: at(18, 40), paused: true, questions: [{ state: "open" }] } }), now, timeZone: TZ });
  assert.match(paused, /quiz paused/);
  assert.strictEqual(activeMinutes([0, 60000]), 1);
});

test("TODAY: the block never passes its cap", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, name: "A very long course name number " + i + " ".repeat(5) + "x".repeat(60) }));
  const now = Date.now();
  const messages = many.map((c) => ({ place: `course:${c.id}`, role: "user", at: now - 1000 }));
  const t = todayText({ messages, courses: many, now, timeZone: "Asia/Jerusalem" });
  assert.ok(t.length <= 800, `length ${t.length}`);
  assert.ok(t.split("\n").length >= 3);
});

test("BRAIN: the today line is in Main's prompt only", async () => {
  const { createBrain } = require("../brain");
  const make = (prompts) => createBrain({
    courses: { list: () => COURSES, allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({}), askOne: async (p, m, prompt) => { prompts.push(String(prompt)); return "Ok."; },
    chain: [{ provider: "agy", model: "one" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    tabsToday: () => "Calculus 2 tab: 18:10-19:05 (40 min active).",
  });
  const main = [];
  await make(main).handle("hi", { history: [], courses: COURSES });
  assert.match(main[0], /## Today in the course tabs \(made by code from Bot's records\)/);
  assert.match(main[0], /40 min active/);
  const tab = [];
  await make(tab).handle("hi", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.doesNotMatch(tab[0], /## Today in the course tabs/);
});

// ---- step 7: the daily summary with tabs ----
test("SUMMARY: tab messages are labelled, copies skipped, and a busy day keeps every user message whole", () => {
  const { transcriptOf, promptFor } = require("../thread-summary");
  const placeName = (id) => (COURSES.find((c) => c.id === id) || {}).name;
  const msgs = [
    { id: "m_a000000000000001", role: "user", text: "main question", at: 1 },
    { id: "m_a000000000000002", role: "user", text: "calc question", at: 2, place: `course:${CALC}` },
    { id: "m_a000000000000003", role: "assistant", text: "calc answer", at: 3, place: `course:${CALC}` },
    { id: "m_a000000000000004", role: "user", text: "copied", at: 4, place: `course:${SP}`, copyOf: "m_a000000000000001" },
  ];
  const t = transcriptOf(msgs, { placeName });
  assert.deepStrictEqual(t.text.split("\n"), ["[1] USER: main question", "[2] USER [Calculus 2 tab]: calc question", "[3] BOT [Calculus 2 tab]: calc answer"]);
  assert.match(promptFor("2026-11-27", t.text), /\[Calculus 2 tab\] after USER or BOT/);
  // a 40,000-character day: under the cap, every user message whole (1,200 each), the answers share the rest
  const big = [];
  for (let i = 0; i < 20; i++) {
    big.push({ id: "m_b" + String(i).padStart(15, "0"), role: "user", text: "u".repeat(1200), at: i * 2 });
    big.push({ id: "m_c" + String(i).padStart(15, "0"), role: "assistant", text: "b".repeat(5000), at: i * 2 + 1 });
  }
  const b = transcriptOf(big);
  assert.ok(b.text.length <= 36000 + 40 * 20, `length ${b.text.length}`);
  for (const line of b.text.split("\n").filter((l) => / USER: /.test(l))) assert.strictEqual(line.split(": ")[1].length, 1200);
});

// ---- step 8: the quiz pause ----
test("QUIZ: a full quiz with no answer for 24 h is paused (not open, not graded); a lesson's check keeps its 6 h rule", () => {
  const { pausedQuiz, openQuestion } = require("../tutor");
  const t0 = Date.parse("2026-11-20T10:00:00Z");
  const quiz = { mode: "quiz", startedAt: t0, questions: [{ q: "Q1?", state: "done", verdict: "right" }, { q: "Q2?", state: "open", verdict: null }] };
  assert.strictEqual(openQuestion(quiz, t0 + 23 * 3600e3), "Q2?");
  assert.strictEqual(pausedQuiz(quiz, t0 + 25 * 3600e3), true);
  assert.strictEqual(openQuestion(quiz, t0 + 25 * 3600e3), null);
  assert.strictEqual(quiz.questions[1].verdict, null, "the pause grades nothing");
  assert.strictEqual(pausedQuiz({ ...quiz, lastAt: t0 + 20 * 3600e3 }, t0 + 25 * 3600e3), false, "counted from the last answer");
  const check = { mode: "quiz", fromTeach: true, startedAt: t0, questions: [{ q: "C?", state: "open" }] };
  assert.strictEqual(pausedQuiz(check, t0 + 25 * 3600e3), false);
  assert.strictEqual(openQuestion(check, t0 + 5 * 3600e3), "C?");
  assert.strictEqual(openQuestion(check, t0 + 7 * 3600e3), null);
});

test("QUIZ: asking for a quiz again picks the paused one up with the same questions", async () => {
  const { turn } = require("../tutor");
  const t0 = Date.parse("2026-11-20T10:00:00Z");
  let saved = { mode: "quiz", lang: "en", target: { type: "lecture", date: null, n: 4 }, startedAt: t0, questions: [{ id: "q1", q: "Q1?", state: "done", verdict: "right" }, { id: "q2", q: "Q2?", state: "open", verdict: null }] };
  const tracker = { getSession: () => saved, setSession: (ref, s) => { saved = s; }, course: () => ({ lectures: {}, assignments: [] }), slots: () => [] };
  const r = await turn({ tracker, ref: { key: "k" }, intent: "quiz", message: "let's continue that quiz", courseName: "Calculus 2", askChain: async () => { throw new Error("no model is needed"); }, now: t0 + 30 * 3600e3 });
  assert.match(r.answer, /Back to the quiz that was paused/);
  assert.match(r.answer, /Q2\?/);
  assert.strictEqual(saved.questions[0].verdict, "right", "the grades are kept");
  assert.strictEqual(saved.lastAt, t0 + 30 * 3600e3);
});

test("BRAIN: only the course in focus shows its open quiz question word for word", async () => {
  const { createBrain } = require("../brain");
  const NOW = Date.parse("2026-11-27T10:00:00Z");
  const sessions = { [CALC]: { mode: "quiz", startedAt: NOW - 3600e3, questions: [{ q: "What is the ratio test?", state: "open" }] }, [SP]: { mode: "quiz", startedAt: NOW - 3 * 24 * 3600e3, questions: [{ q: "What is a pointer?", state: "open" }] } };
  const coach = { tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), course: () => ({ assignments: [], position: {} }), getSession: (ref) => sessions[ref.key] || null, timetable: () => ({ courses: [] }) }, pendingProposal: () => null };
  const make = (prompts) => createBrain({
    courses: { list: () => COURSES, allPages: () => [] }, coach,
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({}), askOne: async (p, m, prompt) => { prompts.push(String(prompt)); return "Ok."; },
    chain: [{ provider: "agy", model: "one" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {}, now: () => NOW,
  });
  const inSp = [];
  await make(inSp).handle("hello", { history: [], courses: COURSES, place: `course:${SP}` });
  assert.doesNotMatch(inSp[0], /What is the ratio test\?/, "Calculus's question does not follow Omri into the SP tab");
  assert.match(inSp[0], /A quiz of this course is open \(not the course of this message\)/);
  assert.match(inSp[0], /The quiz of this course is paused/, "SP's 3-day-old quiz is paused");
  assert.doesNotMatch(inSp[0], /What is a pointer\?/);
  const inCalc = [];
  await make(inCalc).handle("hello", { history: [], courses: COURSES, place: `course:${CALC}` });
  assert.match(inCalc[0], /A QUIZ QUESTION IS OPEN in this course: "What is the ratio test\?"/);
});
