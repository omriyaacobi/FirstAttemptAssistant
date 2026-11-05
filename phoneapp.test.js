// phoneapp.test.js
// Tests the "Bot as a phone app" groundwork: the fixed static files, the reminder routes and the page.
// A real server starts on a random port with a temporary reminders file, never your real data folder.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("./server");
const { createStore } = require("./store");
const { createReminders } = require("./reminders");

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-phone-"));
  const clock = { t: Date.UTC(2026, 10, 1, 12, 0, 0) };
  const reminders = createReminders({ file: path.join(dir, "reminders.json"), now: () => clock.t });
  const server = createServer({ store: createStore(path.join(dir, "c")), reminders, usage: async () => [] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = (method, url, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks), body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  const close = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  return { request, close, reminders, clock };
}

const json = { "Content-Type": "application/json" };

test("the manifest, service worker and icons are served from a fixed list", async () => {
  const { request, close } = await start();
  const manifest = await request("GET", "/manifest.webmanifest");
  assert.strictEqual(manifest.status, 200);
  assert.match(manifest.headers["content-type"], /manifest\+json/);
  const m = JSON.parse(manifest.body);
  assert.strictEqual(m.name, "Bot");
  assert.strictEqual(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));

  const sw = await request("GET", "/sw.js");
  assert.strictEqual(sw.status, 200);
  assert.match(sw.headers["content-type"], /javascript/);
  assert.strictEqual(sw.headers["cache-control"], "no-store");

  for (const icon of ["/icon-192.png", "/icon-512.png"]) {
    const res = await request("GET", icon);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "image/png");
    assert.deepStrictEqual([...res.buffer.subarray(0, 4)], [137, 80, 78, 71], "PNG signature");
  }
  await close();
});

test("SECURITY: only the fixed names are served; paths from the request never reach the disk", async () => {
  const { request, close } = await start();
  for (const url of ["/server.js", "/public/sw.js", "/../server.js", "/%2e%2e/server.js", "/sw.js/../server.js", "/.env", "/data/reminders.json", "/__proto__", "/constructor", "/toString"]) {
    const res = await request("GET", url);
    assert.strictEqual(res.status, 404, url);
    assert.ok(!/require\(|reminders/.test(res.body.replace(/not found/, "")), url);
  }
  await close();
});

test("SECURITY: the static files keep the Host and Origin checks", async () => {
  const { request, close } = await start();
  assert.strictEqual((await request("GET", "/sw.js", { headers: { Host: "evil.example.com" } })).status, 403);
  assert.strictEqual((await request("GET", "/manifest.webmanifest", { headers: { Host: "evil.example.com" } })).status, 403);
  assert.strictEqual((await request("GET", "/api/reminders", { headers: { Host: "evil.example.com" } })).status, 403);
  assert.strictEqual((await request("GET", "/api/reminders", { headers: { Origin: "http://evil.example.com" } })).status, 403);
  assert.strictEqual((await request("DELETE", "/api/reminders/0123456789abcdef", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  await close();
});

test("reminder routes: list, show once (ack), cancel", async () => {
  const { request, close, reminders, clock } = await start();
  const a = reminders.create({ text: "call the bank", at: "2026-11-02T09:00", timezone: "Asia/Jerusalem" });
  const b = reminders.create({ text: "buy milk", at: "2026-11-01T13:00", timezone: "UTC" });

  let list = JSON.parse((await request("GET", "/api/reminders")).body);
  assert.deepStrictEqual(list.reminders.map((r) => r.text), ["buy milk", "call the bank"]);
  assert.deepStrictEqual(list.due, []);

  clock.t = Date.UTC(2026, 10, 1, 13, 1, 0);
  reminders.tick();
  list = JSON.parse((await request("GET", "/api/reminders")).body);
  assert.deepStrictEqual(list.due.map((r) => r.id), [b.id]);

  assert.strictEqual((await request("POST", `/api/reminders/${b.id}/ack`, { headers: json, body: "{}" })).status, 200);
  assert.strictEqual((await request("POST", `/api/reminders/${b.id}/ack`, { headers: json, body: "{}" })).status, 404, "only once");
  assert.deepStrictEqual(JSON.parse((await request("GET", "/api/reminders")).body).due, []);

  assert.strictEqual((await request("DELETE", `/api/reminders/${a.id}`)).status, 200);
  assert.strictEqual((await request("DELETE", `/api/reminders/${a.id}`)).status, 404);
  assert.deepStrictEqual(JSON.parse((await request("GET", "/api/reminders")).body).reminders, []);
  await close();
});

test("reminder routes refuse bad ids and non-JSON posts", async () => {
  const { request, close } = await start();
  for (const id of ["..", "%2e%2e", "abc", "ZZZZZZZZZZZZZZZZ", "0123456789abcdef0"]) {
    assert.strictEqual((await request("DELETE", `/api/reminders/${id}`)).status, 404, id);
  }
  assert.strictEqual((await request("POST", "/api/reminders/0123456789abcdef/ack", { body: "x" })).status, 415);
  await close();
});

// ---- the page ----
const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");

test("the page is installable: manifest, theme colour and an icon are linked", () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icon-192\.png"/);
  assert.match(html, /serviceWorker\.register\("\/sw\.js"\)/);
});

test("the page has a reminders list, a notifications button and a push-to-talk mic button", () => {
  assert.match(html, /id="reminders"/);
  assert.match(html, /id="notifyBtn"/);
  assert.match(html, /id="mic"/);
  assert.match(html, /webkitSpeechRecognition/);
  assert.match(html, /\/api\/reminders/);
});

test("the page script still parses, and still never uses innerHTML", () => {
  // the inline script is the only <script> without src; public/study.js (the course tabs) is checked the same way
  const inline = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  const study = fs.readFileSync(path.join(__dirname, "public", "study.js"), "utf8");
  for (const script of [inline, study]) {
    assert.doesNotThrow(() => new Function(script));
    assert.ok(!/\.innerHTML|insertAdjacentHTML|document\.write/.test(script));
  }
});

test("the service worker caches nothing", () => {
  const sw = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/caches\.|\.addAll|cache\.put|addEventListener\("fetch"/.test(sw));
});

test("the manifest file in public/ is valid JSON that points at icons that exist", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "manifest.webmanifest"), "utf8"));
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(__dirname, "public", icon.src.slice(1))), icon.src);
});
