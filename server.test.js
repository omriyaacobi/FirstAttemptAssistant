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
async function start(handle = async () => ({ mode: "single", answer: "hello", used: { provider: "p", model: "m" } })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-server-"));
  const store = createStore(dir);
  const server = createServer({ handle, store, usage: async () => [{ pool: "P", window: "W", remaining: 50, resets: "x" }] });
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

  return { server, port, request, ask, store, close };
}

test("serves the page", async () => {
  const s = await start();
  const res = await s.request("GET", "/");
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /<title>Orchestrator<\/title>/);
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

test("parseUsage reads agy's tab-separated output", () => {
  const rows = parseUsage("Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-28T01:41:40Z\n\nnoise\n");
  assert.deepStrictEqual(rows, [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 99, resets: "2026-10-28T01:41:40Z" }]);
});
