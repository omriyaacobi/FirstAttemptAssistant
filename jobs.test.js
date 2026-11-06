// jobs.test.js
// Tests the background jobs (jobs.js) with fake models, plus how server.js exposes them.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobs, describeProgress, JOB_ID_PATTERN } = require("./jobs");
const { createServer } = require("./server");
const { createStore } = require("./store");

const answer = { mode: "single", answer: "ok", used: { provider: "p", model: "m" } };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const tempStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), "bot-jobs-")));
const gate = () => { let release; const wait = new Promise((r) => (release = r)); return { wait, release }; };

test("describeProgress turns log lines into plain words", () => {
  assert.match(describeProgress([]), /Starting/);
  assert.match(describeProgress(["[frontdesk] asking gemini/gemini-3.8-flash-high"]), /front desk/i);
  assert.match(describeProgress(["[frontdesk] asking x", "[frontdesk] decision: delegate -> claude-sonnet (r)", "[router] trying claude/sonnet"]), /Asking sonnet/);
  assert.match(describeProgress(["[router] trying claude/sonnet", "[router] claude/sonnet failed: boom"]), /sonnet did not answer/);
  assert.match(describeProgress(["[quota] low: x"]), /Starting/); // unknown lines change nothing
});

test("describeProgress counts planner steps", () => {
  const plan = ["[planner] 3 step(s), planned by gemini/flash"];
  assert.match(describeProgress(plan), /3 steps/);
  const one = [...plan, "[planner] step 1 (quick) starting: gemini/flash"];
  assert.strictEqual(describeProgress(one), "Working on step 1 of 3 (asking flash)");
  const all = [...one, "[planner] step 2 (code) starting: claude/sonnet", "[planner] step 3 (hard) starting: gemini/argon"];
  assert.match(describeProgress(all), /3 steps at once \(0 of 3 done\)/);
  const some = [...all, "[planner] step 1 done by gemini/flash", "[planner] step 2 FAILED: x"];
  assert.match(describeProgress(some), /step 3 of 3/);
  assert.match(describeProgress([...some, "[planner] step 3 done by x", "[planner] all steps finished"]), /All steps finished/);
});

test("a job runs in the background and the answer is saved without anyone watching", async () => {
  const store = tempStore();
  const g = gate();
  const finished = [];
  const jobs = createJobs({ handle: async (t, { log }) => { log("[frontdesk] asking x"); await g.wait; return answer; }, store, onFinish: (f) => finished.push(f) });
  const job = jobs.start({ task: "hello" });
  assert.match(job.id, JOB_ID_PATTERN);
  assert.strictEqual(jobs.running(), 1);
  assert.deepStrictEqual(store.get(job.conversationId).messages.map((m) => m.role), ["user"]);
  g.release();
  await tick(30);
  assert.strictEqual(jobs.get(job.id).status, "done");
  assert.strictEqual(jobs.running(), 0);
  assert.deepStrictEqual(store.get(job.conversationId).messages.map((m) => m.role), ["user", "assistant"]);
  assert.strictEqual(finished.length, 1);
  assert.strictEqual(finished[0].title, "hello");
  assert.strictEqual(finished[0].watched, false);
});

test("a page that was looking just now counts as watching", async () => {
  const g = gate();
  const finished = [];
  const jobs = createJobs({ handle: async () => { await g.wait; return answer; }, store: tempStore(), onFinish: (f) => finished.push(f) });
  const job = jobs.start({ task: "x" });
  jobs.get(job.id, { watching: true });
  g.release();
  await tick(30);
  assert.strictEqual(finished[0].watched, true);
});

test("watching a different chat does not count", async () => {
  const g = gate();
  const finished = [];
  const store = tempStore();
  const jobs = createJobs({ handle: async () => { await g.wait; return answer; }, store, onFinish: (f) => finished.push(f) });
  const job = jobs.start({ task: "x" });
  jobs.list({ watching: "0123456789abcdef" });
  g.release();
  await tick(30);
  assert.strictEqual(finished[0].watched, false);
});

test("a second message in a chat whose job is still running is refused clearly, not lost silently", async () => {
  const g = gate();
  const store = tempStore();
  const jobs = createJobs({ handle: async () => { await g.wait; return answer; }, store });
  const first = jobs.start({ task: "one" });
  assert.throws(() => jobs.start({ task: "two", conversationId: first.conversationId }), (e) => e.status === 409 && /still working/.test(e.message));
  assert.strictEqual(store.get(first.conversationId).messages.length, 1); // "two" was not saved
  g.release();
  await tick(30);
  assert.doesNotThrow(() => jobs.start({ task: "two", conversationId: first.conversationId }));
});

test("other chats can run at the same time, up to the limit", async () => {
  const g = gate();
  const jobs = createJobs({ handle: async () => { await g.wait; return answer; }, store: tempStore(), maxRunning: 2 });
  jobs.start({ task: "a" });
  jobs.start({ task: "b" });
  assert.throws(() => jobs.start({ task: "c" }), (e) => e.status === 429);
  g.release();
});

test("a failing handler becomes an error job and releases its slot", async () => {
  const jobs = createJobs({ handle: async () => { throw new Error("boom"); }, store: tempStore(), maxRunning: 1 });
  const job = jobs.start({ task: "x" });
  await tick(30);
  assert.strictEqual(jobs.get(job.id).status, "error");
  assert.strictEqual(jobs.running(), 0);
});

test("get() refuses ids that are not 32 hex characters", () => {
  const jobs = createJobs({ handle: async () => answer, store: tempStore() });
  for (const id of ["", "abc", "../../x", "A".repeat(32), "a".repeat(31), 42, null]) assert.strictEqual(jobs.get(id), null);
});

test("a chat deleted while its task runs does not crash anything", async () => {
  const g = gate();
  const store = tempStore();
  const jobs = createJobs({ handle: async () => { await g.wait; return answer; }, store });
  const job = jobs.start({ task: "x" });
  store.remove(job.conversationId);
  g.release();
  await tick(30);
  assert.strictEqual(jobs.get(job.id).status, "error");
  assert.strictEqual(jobs.running(), 0);
});

test("finished jobs are forgotten after a while", async () => {
  let clock = 1000;
  const jobs = createJobs({ handle: async () => answer, store: tempStore(), now: () => clock });
  const job = jobs.start({ task: "x" });
  await tick(30);
  assert.strictEqual(jobs.list().length, 1);
  clock += 31 * 60 * 1000;
  assert.strictEqual(jobs.list().length, 0);
  assert.strictEqual(jobs.get(job.id), null);
});

// ---- through the real server ----
async function startServer(handle, pushes) {
  const store = tempStore();
  const server = createServer({
    handle, store,
    push: { publicKey: () => null, notifyAll: async (m) => { pushes.push(m); return {}; } },
    usage: async () => [],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, body) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
      });
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  return { store, request, close: () => new Promise((r) => server.close(r)) };
}

test("server: a finished job nobody watches sends a push notification with the chat title", async () => {
  const pushes = [];
  const g = gate();
  const s = await startServer(async () => { await g.wait; return answer; }, pushes);
  const { job } = (await s.request("POST", "/api/ask", { task: "remember the milk" })).json();
  g.release();
  await tick(50);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].title, "Bot finished");
  assert.strictEqual(pushes[0].body, "remember the milk");
  assert.strictEqual(pushes[0].tag, "job-" + job.id);
  await s.close();
});

test("server: no push when the page is watching that chat", async () => {
  const pushes = [];
  const g = gate();
  const s = await startServer(async () => { await g.wait; return answer; }, pushes);
  const { job } = (await s.request("POST", "/api/ask", { task: "hi" })).json();
  await s.request("GET", `/api/jobs?watching=${job.conversationId}`);
  g.release();
  await tick(50);
  assert.strictEqual(pushes.length, 0);
  await s.close();
});

test("server: a failed job pushes 'could not finish'", async () => {
  const pushes = [];
  const s = await startServer(async () => { throw new Error("nope"); }, pushes);
  await s.request("POST", "/api/ask", { task: "hi" });
  await tick(50);
  assert.strictEqual(pushes[0].title, "Bot could not finish");
  await s.close();
});

test("server: job routes list running jobs, reject bad ids, and a same-chat second message gets 409", async () => {
  const g = gate();
  const s = await startServer(async () => { await g.wait; return answer; }, []);
  const { job } = (await s.request("POST", "/api/ask", { task: "one" })).json();
  const list = (await s.request("GET", "/api/jobs")).json().jobs;
  assert.strictEqual(list[0].id, job.id);
  assert.strictEqual(list[0].status, "running");
  assert.strictEqual((await s.request("GET", "/api/jobs/not-an-id")).status, 404);
  assert.strictEqual((await s.request("GET", "/api/jobs/" + "0".repeat(32))).status, 404);
  const again = await s.request("POST", "/api/ask", { task: "two", conversationId: job.conversationId });
  assert.strictEqual(again.status, 409);
  assert.match(again.json().error, /still working/);
  g.release();
  await s.close();
});

test("a message in a course chat goes to the course handler (not the front desk), the chat remembers its course, and a photo goes along (and is deleted afterwards)", async () => {
  const store = tempStore();
  const calls = [];
  const jobs = createJobs({
    handle: async () => { throw new Error("the regular handler must not answer a course chat"); },
    handleCourse: async (task, o) => { calls.push({ task, courseId: o.courseId, deeper: o.deeper, history: o.history, image: o.image }); o.onPartial("so far"); return { mode: "course", courseId: o.courseId, answer: "from the course", sources: [] }; },
    store,
  });
  const course = "0123456789abcdef";
  const first = jobs.start({ task: "hello", courseId: course, deeper: true });
  await tick(30);
  const chat = store.get(first.conversationId);
  assert.strictEqual(chat.courseId, course);
  assert.strictEqual(chat.messages[1].text, "from the course");
  assert.strictEqual(chat.messages[1].result.mode, "course");
  jobs.start({ task: "next", conversationId: chat.id }); // no courseId sent: the chat itself knows
  await tick(30);
  assert.deepStrictEqual(calls.map((c) => [c.task, c.courseId, c.deeper]), [["hello", course, true], ["next", course, false]]);
  assert.deepStrictEqual(calls[1].history.map((m) => m.text), ["hello", "from the course"]);
  const photoFile = require("node:path").join(require("node:os").tmpdir(), "course-photo-" + process.pid + ".png");
  require("node:fs").writeFileSync(photoFile, "x");
  jobs.start({ task: "what is this", conversationId: chat.id, image: { path: photoFile, ext: ".png" } });
  await tick(30);
  assert.strictEqual(calls[2].image.path, photoFile); // the course handler gets the photo...
  assert.ok(!require("node:fs").existsSync(photoFile)); // ...and the job deletes it afterwards, as in the regular chat
  assert.throws(() => createJobs({ handle: async () => answer, store }).start({ task: "x", courseId: course }), (e) => e.status === 404); // notebooks are off
});
