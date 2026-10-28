// server.test.js
// Tests the web server's behavior and, above all, its security checks.
// A real server starts on a random free port; the model calls are fakes, so no quota is used.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createServer, parseUsage, MAX_BODY, MAX_RUNNING } = require("./server");

// Starts a server with fake models and returns a small helper for sending requests to it.
async function start(handle = async () => ({ mode: "single", answer: "hello", used: { provider: "p", model: "m" } })) {
  const server = createServer({ handle, usage: async () => [{ pool: "P", window: "W", remaining: 50, resets: "x" }] });
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

  const ask = (task, headers = {}) =>
    request("POST", "/api/ask", { headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ task }) });

  return { server, port, request, ask, close: () => new Promise((r) => server.close(r)) };
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

test("parseUsage reads agy's tab-separated output", () => {
  const rows = parseUsage("Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-28T01:41:40Z\n\nnoise\n");
  assert.deepStrictEqual(rows, [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 99, resets: "2026-10-28T01:41:40Z" }]);
});
