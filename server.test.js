// server.test.js
// Tests the web server's behavior and, above all, its security checks.
// A real server starts on a random free port; the model calls are fakes, so no quota is used.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, parseUsage, MAX_BODY, MAX_RUNNING } = require("./server");
const { createStore } = require("./store");

// Starts a server with fake models and returns a small helper for sending requests to it.
// Conversations are saved in a temporary folder, never in your real data/ folder.
async function start(handle = async () => ({ mode: "single", answer: "hello", used: { provider: "p", model: "m" } }), { supervised = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-server-"));
  const store = createStore(dir);
  // A fake self-edit manager: it records the calls so the tests can check the routes without any git or models.
  const calls = [];
  const selfEdit = {
    start: async (request, opts) => { calls.push(["start", request, opts.model]); if (request === "busy") throw new Error("another proposal is still running"); return { record: { id: "0123456789abcdef", status: "running" } }; },
    get: (id) => (id === "0123456789abcdef" ? { id, status: "ready" } : null),
    list: () => [{ id: "0123456789abcdef", status: "ready" }],
    approve: async (id) => { calls.push(["approve", id]); if (id === "ffffffffffffffff") throw new Error("proposal not found"); return { id, status: "approved" }; },
    reject: async (id) => { calls.push(["reject", id]); return { id, status: "rejected" }; },
    isActive: () => false,
  };
  // Fake GitHub operations and a fake restart (a real restart would end the test run).
  const gitOps = {
    status: async () => ({ branch: "main", upstream: "origin/main", clean: true, ahead: 1, commits: [{ hash: "abc1234", subject: "a change" }] }),
    push: async () => { calls.push(["push"]); return { pushed: [{ hash: "abc1234", subject: "a change" }], output: "ok" }; },
  };
  const restarts = [];
  const server = createServer({
    handle, store, selfEdit, gitOps, supervised,
    restart: () => restarts.push(Date.now()),
    usage: async () => [{ pool: "P", window: "W", remaining: 50, resets: "x" }],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const request = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });

  const ask = (task, headers = {}, extra = {}) =>
    request("POST", "/api/ask", { headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ task, ...extra }) });

  const close = async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  };

  const post = (path, body, headers = {}) =>
    request("POST", path, { headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  return { server, port, request, ask, post, calls, restarts, store, close };
}

test("serves the page", async () => {
  const s = await start();
  const res = await s.request("GET", "/");
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /<title>Bot<\/title>/);
  await s.close();
});

test("a valid task streams log lines then a result", async () => {
  const s = await start(async (task, { log }) => {
    log("[router] working");
    return { mode: "single", answer: "hello " + task, used: { provider: "p", model: "m" } };
  });
  const res = await s.ask("hi");
  const lines = res.body.trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(lines[0], { type: "log", text: "[router] working" });
  assert.strictEqual(lines[1].type, "result");
  assert.strictEqual(lines[1].result.answer, "hello hi");
  await s.close();
});

test("an error inside the engine becomes an error line, not a crash", async () => {
  const s = await start(async () => { throw new Error("all models failed"); });
  const res = await s.ask("hi");
  assert.deepStrictEqual(JSON.parse(res.body.trim()), { type: "error", message: "all models failed" });
  await s.close();
});

test("SECURITY: a wrong Host header is refused (DNS rebinding)", async () => {
  const s = await start();
  const res = await s.request("GET", "/", { headers: { Host: "evil.example.com" } });
  assert.strictEqual(res.status, 403);
  await s.close();
});

test("SECURITY: a request from another website's origin is refused", async () => {
  const s = await start();
  const res = await s.ask("hi", { Origin: "https://evil.example.com" });
  assert.strictEqual(res.status, 403);
  await s.close();
});

test("SECURITY: a cross-site fetch is refused", async () => {
  const s = await start();
  const res = await s.ask("hi", { "Sec-Fetch-Site": "cross-site" });
  assert.strictEqual(res.status, 403);
  await s.close();
});

test("SECURITY: a request from this page's own origin is allowed", async () => {
  const s = await start();
  const res = await s.ask("hi", { Origin: `http://localhost:${s.port}`, "Sec-Fetch-Site": "same-origin" });
  assert.strictEqual(res.status, 200);
  await s.close();
});

test("SECURITY: non-JSON content type is refused", async () => {
  const s = await start();
  const res = await s.request("POST", "/api/ask", { headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ task: "hi" }) });
  assert.strictEqual(res.status, 415);
  await s.close();
});

test("rejects empty tasks, bad JSON and non-string tasks", async () => {
  const s = await start();
  assert.strictEqual((await s.ask("   ")).status, 400);
  const bad = await s.request("POST", "/api/ask", { headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.strictEqual(bad.status, 400);
  const notString = await s.request("POST", "/api/ask", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: 42 }) });
  assert.strictEqual(notString.status, 400);
  await s.close();
});

test("rejects a task that is too long", async () => {
  const s = await start();
  assert.strictEqual((await s.ask("x".repeat(9000))).status, 413);
  await s.close();
});

test("rejects an oversized request body", async () => {
  const s = await start();
  const body = JSON.stringify({ task: "x".repeat(MAX_BODY + 10) });
  let status;
  try {
    status = (await s.request("POST", "/api/ask", { headers: { "Content-Type": "application/json" }, body })).status;
  } catch (error) {
    status = "connection closed"; // the server hangs up on oversized bodies, which is also fine
  }
  assert.ok(status === 413 || status === "connection closed");
  await s.close();
});

test("limits how many tasks run at once", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const s = await start(async () => { await gate; return { mode: "single", answer: "ok", used: { provider: "p", model: "m" } }; });
  const running = Array.from({ length: MAX_RUNNING }, () => s.ask("slow"));
  await new Promise((r) => setTimeout(r, 100)); // let them start
  const extra = await s.ask("one too many");
  assert.strictEqual(extra.status, 429);
  release();
  await Promise.all(running);
  await s.close();
});

test("usage endpoint returns rows; unknown routes are 404", async () => {
  const s = await start();
  const usage = await s.request("GET", "/api/usage");
  assert.deepStrictEqual(JSON.parse(usage.body).rows[0].remaining, 50);
  assert.strictEqual((await s.request("GET", "/nope")).status, 404);
  await s.close();
});

test("a new conversation is created and saved, and its id is returned", async () => {
  const s = await start();
  const res = await s.ask("first question");
  const result = JSON.parse(res.body.trim().split("\n").pop());
  assert.strictEqual(result.type, "result");
  const saved = s.store.get(result.conversationId);
  assert.strictEqual(saved.title, "first question");
  assert.deepStrictEqual(saved.messages.map((m) => m.role), ["user", "assistant"]);
  assert.strictEqual(saved.messages[1].text, "hello");
  await s.close();
});

test("a follow-up in the same conversation gets the earlier messages as history", async () => {
  let seenHistory = null;
  const s = await start(async (task, { history }) => {
    seenHistory = history;
    return { mode: "single", answer: "reply to " + task, used: { provider: "p", model: "m" } };
  });
  const first = JSON.parse((await s.ask("my name is Omri")).body.trim().split("\n").pop());
  assert.deepStrictEqual(seenHistory, []); // first message: no history yet
  await s.ask("what is my name?", {}, { conversationId: first.conversationId });
  assert.deepStrictEqual(seenHistory, [
    { role: "user", text: "my name is Omri" },
    { role: "assistant", text: "reply to my name is Omri" },
  ]);
  assert.strictEqual(s.store.get(first.conversationId).messages.length, 4);
  await s.close();
});

test("an unknown or malformed conversation id is refused", async () => {
  const s = await start();
  assert.strictEqual((await s.ask("hi", {}, { conversationId: "0123456789abcdef" })).status, 404);
  assert.strictEqual((await s.ask("hi", {}, { conversationId: "../../etc/passwd" })).status, 404);
  assert.strictEqual((await s.ask("hi", {}, { conversationId: 42 })).status, 404);
  await s.close();
});

test("a failed task is not saved", async () => {
  const s = await start(async () => { throw new Error("all models failed"); });
  await s.ask("this will fail");
  assert.deepStrictEqual(s.store.list(), []);
  await s.close();
});

test("list, open and delete conversations over HTTP", async () => {
  const s = await start();
  const made = JSON.parse((await s.ask("hello there")).body.trim().split("\n").pop());
  const list = JSON.parse((await s.request("GET", "/api/conversations")).body);
  assert.strictEqual(list.conversations[0].title, "hello there");
  const one = await s.request("GET", "/api/conversations/" + made.conversationId);
  assert.strictEqual(JSON.parse(one.body).messages.length, 2);
  assert.strictEqual((await s.request("DELETE", "/api/conversations/" + made.conversationId)).status, 200);
  assert.strictEqual((await s.request("GET", "/api/conversations/" + made.conversationId)).status, 404);
  await s.close();
});

test("SECURITY: a path-traversal id cannot read or delete other files", async () => {
  const s = await start();
  assert.strictEqual((await s.request("GET", "/api/conversations/..%2F..%2Fpackage")).status, 404);
  assert.strictEqual((await s.request("DELETE", "/api/conversations/..%2F..%2Fpackage")).status, 404);
  await s.close();
});

test("SECURITY: deleting from another website is refused", async () => {
  const s = await start();
  const made = JSON.parse((await s.ask("keep me")).body.trim().split("\n").pop());
  const res = await s.request("DELETE", "/api/conversations/" + made.conversationId, { headers: { Origin: "https://evil.example.com", "Sec-Fetch-Site": "cross-site" } });
  assert.strictEqual(res.status, 403);
  assert.ok(s.store.get(made.conversationId)); // still there
  await s.close();
});

test("self-edit: list, start, open, approve and reject go through to the manager", async () => {
  const s = await start();
  assert.strictEqual(JSON.parse((await s.request("GET", "/api/selfedit")).body).proposals[0].status, "ready");
  const started = await s.post("/api/selfedit", { request: "make it blue" });
  assert.strictEqual(started.status, 202);
  assert.deepStrictEqual(s.calls[0], ["start", "make it blue", "sonnet"]); // sonnet is the default model
  assert.strictEqual((await s.request("GET", "/api/selfedit/0123456789abcdef")).status, 200);
  assert.strictEqual((await s.post("/api/selfedit/0123456789abcdef/approve", {})).status, 200);
  assert.strictEqual((await s.post("/api/selfedit/0123456789abcdef/reject", {})).status, 200);
  assert.deepStrictEqual(s.calls.slice(1), [["approve", "0123456789abcdef"], ["reject", "0123456789abcdef"]]);
  await s.close();
});

test("self-edit: errors become the right HTTP status", async () => {
  const s = await start();
  assert.strictEqual((await s.post("/api/selfedit", { request: "busy" })).status, 409); // another one is running
  assert.strictEqual((await s.request("GET", "/api/selfedit/ffffffffffffffff")).status, 404);
  assert.strictEqual((await s.post("/api/selfedit/ffffffffffffffff/approve", {})).status, 404);
  assert.strictEqual((await s.post("/api/selfedit", { request: "x", model: "gpt-9" })).status, 400);
  assert.strictEqual((await s.post("/api/selfedit", { request: "x", model: "opus" })).status, 202); // opus is allowed
  await s.close();
});

test("SECURITY: self-edit routes refuse other websites, non-JSON and a wrong Host", async () => {
  const s = await start();
  for (const path of ["/api/selfedit", "/api/selfedit/0123456789abcdef/approve", "/api/selfedit/0123456789abcdef/reject"]) {
    assert.strictEqual((await s.post(path, { request: "x" }, { Origin: "https://evil.example.com" })).status, 403, path);
    assert.strictEqual((await s.post(path, { request: "x" }, { "Sec-Fetch-Site": "cross-site" })).status, 403, path);
    assert.strictEqual((await s.request("POST", path, { headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 415, path);
  }
  assert.strictEqual((await s.request("GET", "/api/selfedit", { headers: { Host: "evil.example.com" } })).status, 403);
  assert.strictEqual(s.calls.length, 0); // nothing reached the manager
  await s.close();
});

test("restart: refused unless start-web.cmd started the server", async () => {
  const s = await start();
  const res = await s.post("/api/restart", {});
  assert.strictEqual(res.status, 409);
  assert.match(JSON.parse(res.body).error, /start-web\.cmd/);
  assert.strictEqual(s.restarts.length, 0);
  await s.close();
});

test("restart: works when supervised", async () => {
  const s = await start(undefined, { supervised: true });
  const res = await s.post("/api/restart", {});
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(JSON.parse(res.body), { restarting: true });
  assert.strictEqual(s.restarts.length, 1);
  await s.close();
});

test("restart: refused while a task is running", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const s = await start(async () => { await gate; return { mode: "single", answer: "ok", used: { provider: "p", model: "m" } }; }, { supervised: true });
  const slow = s.ask("slow");
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual((await s.post("/api/restart", {})).status, 409);
  assert.strictEqual(s.restarts.length, 0);
  release();
  await slow;
  await s.close();
});

test("git: status and push go through to gitops", async () => {
  const s = await start();
  const status = JSON.parse((await s.request("GET", "/api/git")).body);
  assert.strictEqual(status.ahead, 1);
  const pushed = await s.post("/api/git/push", {});
  assert.strictEqual(pushed.status, 200);
  assert.deepStrictEqual(s.calls, [["push"]]);
  await s.close();
});

test("SECURITY: restart and push refuse other websites and non-JSON", async () => {
  const s = await start(undefined, { supervised: true });
  for (const path of ["/api/restart", "/api/git/push"]) {
    assert.strictEqual((await s.post(path, {}, { Origin: "https://evil.example.com" })).status, 403, path);
    assert.strictEqual((await s.post(path, {}, { "Sec-Fetch-Site": "cross-site" })).status, 403, path);
    assert.strictEqual((await s.request("POST", path, { headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 415, path);
  }
  assert.strictEqual(s.restarts.length, 0);
  assert.deepStrictEqual(s.calls, []);
  await s.close();
});

test("parseUsage reads agy's tab-separated output", () => {
  const rows = parseUsage("Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-28T01:41:40Z\n\nnoise\n");
  assert.deepStrictEqual(rows, [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 99, resets: "2026-10-28T01:41:40Z" }]);
});
