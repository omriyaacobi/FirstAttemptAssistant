// tests/one-conversation.test.js
// Bot is ONE conversation: the old list of chats, its routes and its own way of starting a job were removed on 2026-11-13.
// These tests keep what the removed chat tests used to check and still matters, now through the only entrance there is
// (jobs.startThread and POST /api/ask): a failure is an honest error, the growing answer, the photo, "is the page looking",
// forgetting finished jobs, the push notification, the limit, restart, other-site requests, and that the old routes are gone.
// Fake models only; every folder is a temp folder; all text is invented.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobs, KEEP_FINISHED_MS, MAX_THREAD_JOBS } = require("../jobs");
const { createThreadStore } = require("../thread-store");
const { createStore } = require("../store");
const { createServer } = require("../server");
const { createAuth } = require("../auth");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), "bot-one-" + name + "-"));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let release; const wait = new Promise((r) => (release = r)); return { wait, release }; };
const single = (answer) => ({ mode: "single", answer, used: { provider: "p", model: "m" } });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
async function done(jobs, id) { for (let i = 0; i < 300; i++) { const j = jobs.get(id); if (j && j.status !== "running") return j; await tick(5); } throw new Error("job did not finish"); }

function setup(options = {}) {
  const thread = createThreadStore(tmp("thread"));
  return { thread, jobs: createJobs({ thread, ...options }) };
}

// ---- jobs.js ----

test("there is one way in: startThread. The old start() is gone", () => {
  const { jobs } = setup({ handle: async () => single("x") });
  assert.strictEqual(jobs.start, undefined);
  assert.strictEqual(typeof jobs.startThread, "function");
});

test("a failing handler becomes an error job, the question is kept, and the next message is answered", async () => {
  let calls = 0;
  const { thread, jobs } = setup({ handle: async () => { if (++calls === 1) throw new Error("boom"); return single("fine"); } });
  const bad = jobs.startThread({ task: "first question" });
  const ended = await done(jobs, bad.id);
  assert.strictEqual(ended.status, "error");
  assert.match(ended.error, /boom/);
  assert.strictEqual(thread.find(bad.messageId).text, "first question");
  assert.strictEqual(jobs.running(), 0);
  const good = jobs.startThread({ task: "second question" });
  assert.strictEqual((await done(jobs, good.id)).status, "done");
});

test("the growing answer is on the running job, and gone once it is done", async () => {
  const g = gate();
  const { jobs } = setup({ handle: async (task, { onPartial }) => { onPartial("Hello wor"); await g.wait; return single("Hello world"); } });
  const job = jobs.startThread({ task: "hi" });
  await tick();
  assert.strictEqual(jobs.get(job.id).partial, "Hello wor");
  g.release();
  assert.strictEqual((await done(jobs, job.id)).partial, undefined);
});

test("a photo reaches the handler while it runs and is deleted afterwards, also when the handler fails", async () => {
  for (const fails of [false, true]) {
    const file = path.join(tmp("photo"), "p.jpg");
    fs.writeFileSync(file, JPEG);
    let existed = null;
    const { thread, jobs } = setup({ handle: async (task, { image }) => { existed = fs.existsSync(image.path); if (fails) throw new Error("no"); return single("a schedule"); } });
    const job = jobs.startThread({ task: "what is on it", image: { path: file, ext: ".jpg" } });
    await done(jobs, job.id);
    assert.strictEqual(existed, true);
    assert.strictEqual(fs.existsSync(file), false, "the photo is private: it is not kept");
    assert.strictEqual(thread.find(job.messageId).text, "(photo attached) what is on it");
  }
});

test("a page that asked just now counts as looking; a page that never asked does not", async () => {
  for (const looks of [true, false]) {
    const finished = [];
    const g = gate();
    const { jobs } = setup({ handle: async () => { await g.wait; return single("ok"); }, onFinish: (f) => finished.push(f) });
    const job = jobs.startThread({ task: "x" });
    if (looks) jobs.list({ watching: "thread" });
    g.release();
    await done(jobs, job.id);
    await tick();
    assert.strictEqual(finished.length, 1);
    assert.strictEqual(finished[0].watched, looks);
  }
});

test("finished jobs are forgotten after a while; running ones never are", async () => {
  let clock = 1000000;
  const g = gate();
  const { jobs } = setup({ handle: async (task) => { if (task === "slow") await g.wait; return single("ok"); }, now: () => clock });
  const fast = jobs.startThread({ task: "fast" });
  const slow = jobs.startThread({ task: "slow" });
  await done(jobs, fast.id);
  clock += KEEP_FINISHED_MS + 1;
  const ids = jobs.list().map((j) => j.id);
  assert.ok(!ids.includes(fast.id));
  assert.ok(ids.includes(slow.id));
  g.release();
  await done(jobs, slow.id);
});

// ---- server.js ----

async function startServer({ handle = async () => single("hello"), withThread = true, supervised = false } = {}) {
  const dir = tmp("srv");
  const pushes = [];
  const restarts = [];
  const server = createServer({
    handle, supervised,
    store: createStore(path.join(dir, "chats")),
    thread: withThread ? createThreadStore(path.join(dir, "thread")) : null,
    uploadDir: path.join(dir, "uploads"),
    auth: createAuth({ config: { enabled: false } }),
    push: { publicKey: () => "K", notifyAll: async (note) => { pushes.push(note); return {}; } },
    selfEdit: { list: () => [], isActive: () => false },
    gitOps: { status: async () => ({}) },
    usage: async () => [],
    restart: () => restarts.push(1),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, json: () => JSON.parse(data) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  const ask = (payload, headers) => request("POST", "/api/ask", { body: payload, headers });
  const finish = async (res) => { let job = res.json().job; while (job.status === "running") { await tick(10); job = (await request("GET", "/api/jobs/" + job.id)).json().job; } return job; };
  return { port, request, ask, finish, pushes, restarts, uploads: () => (fs.existsSync(path.join(dir, "uploads")) ? fs.readdirSync(path.join(dir, "uploads")) : []), close: () => new Promise((r) => server.close(r)) };
}

test("SERVER: a message starts a job at once and its answer lands in the conversation; a chat id in the request is ignored", async () => {
  const s = await startServer();
  const res = await s.ask({ task: "hi", conversationId: "0123456789abcdef" });
  assert.strictEqual(res.status, 202);
  assert.strictEqual(res.json().job.conversationId, "thread");
  assert.strictEqual((await s.finish(res)).status, "done");
  const { messages } = (await s.request("GET", "/api/thread")).json();
  assert.deepStrictEqual(messages.map((m) => m.text), ["hi", "hello"]);
  await s.close();
});

test("SERVER: the old chat routes are gone, and a server without the conversation refuses a message plainly", async () => {
  const s = await startServer();
  assert.strictEqual((await s.request("GET", "/api/conversations")).status, 404);
  assert.strictEqual((await s.request("GET", "/api/conversations/0123456789abcdef")).status, 404);
  assert.strictEqual((await s.request("DELETE", "/api/conversations/0123456789abcdef")).status, 404);
  await s.close();
  const bare = await startServer({ withThread: false });
  const res = await bare.ask({ task: "hi" });
  assert.strictEqual(res.status, 503);
  assert.match(res.json().error, /conversation is not set up/);
  await bare.close();
});

test("SERVER SECURITY: this page's own origin may send a message; another website may not send or delete", async () => {
  const s = await startServer();
  assert.strictEqual((await s.ask({ task: "hi" }, { Origin: `http://localhost:${s.port}`, "Sec-Fetch-Site": "same-origin" })).status, 202);
  assert.strictEqual((await s.ask({ task: "hi" }, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.strictEqual((await s.request("DELETE", "/api/thread/0123456789abcdef", { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } })).status, 403);
  await s.close();
});

test("SERVER: an error inside the handler is a failed job and a push that says so, never a crash", async () => {
  const s = await startServer({ handle: async () => { throw new Error("nope"); } });
  const job = await s.finish(await s.ask({ task: "hi" }));
  assert.strictEqual(job.status, "error");
  await tick(30);
  assert.strictEqual(s.pushes.length, 1);
  assert.strictEqual(s.pushes[0].title, "Bot could not finish");
  assert.strictEqual((await s.ask({ task: "again" })).status, 202, "Bot keeps running");
  await s.close();
});

test("SERVER: a finished answer nobody watches is pushed without its text; no push while the page is looking", async () => {
  const s = await startServer({ handle: async () => single("PRIVATE ANSWER") });
  await s.finish(await s.ask({ task: "my private question" }));
  await tick(30);
  assert.strictEqual(s.pushes.length, 1);
  assert.doesNotMatch(JSON.stringify(s.pushes[0]), /PRIVATE|private question/);
  await s.close();

  const g = gate();
  const w = await startServer({ handle: async () => { await g.wait; return single("ok"); } });
  const res = await w.ask({ task: "hi" });
  await w.request("GET", "/api/jobs?watching=thread");
  g.release();
  await w.finish(res);
  await tick(30);
  assert.strictEqual(w.pushes.length, 0);
  await w.close();
});

test("SERVER: a photo travels with the message and leaves no file behind; a broken photo starts nothing", async () => {
  let seen = null;
  const s = await startServer({ handle: async (task, { image }) => { seen = { ext: image && image.ext, existed: !!image && fs.existsSync(image.path) }; return single("a schedule"); } });
  const res = await s.ask({ task: "what is this", image: "data:image/jpeg;base64," + JPEG.toString("base64") });
  assert.strictEqual(res.status, 202);
  await s.finish(res);
  assert.deepStrictEqual(seen, { ext: ".jpg", existed: true });
  assert.deepStrictEqual(s.uploads(), []);
  const bad = await s.ask({ task: "what is this", image: "data:image/jpeg;base64," + Buffer.from("not a picture at all, just words").toString("base64") });
  assert.ok(bad.status >= 400 && bad.status < 500);
  assert.deepStrictEqual(s.uploads(), []);
  await s.close();
});

test("SERVER: at most " + MAX_THREAD_JOBS + " messages at once, and restart is refused while one is being answered", async () => {
  const g = gate();
  const s = await startServer({ handle: async () => { await g.wait; return single("ok"); }, supervised: true });
  for (let i = 0; i < MAX_THREAD_JOBS; i++) assert.strictEqual((await s.ask({ task: "m" + i })).status, 202);
  assert.strictEqual((await s.ask({ task: "one too many" })).status, 429);
  assert.strictEqual((await s.request("POST", "/api/restart", { body: {} })).status, 409);
  assert.strictEqual(s.restarts.length, 0);
  g.release();
  await s.close();
});
