// pwa.test.js
// Option A (2026-11-13, experiments/2026-11-13-bot-access-options.md): Bot as a better phone app without a new app.
//   - the page, the app files and the JSON answers are sent gzipped; the page and app files carry an ETag (an unchanged file costs a 304)
//   - Android's Share menu: the manifest's share_target, the service worker that catches the share ON THE PHONE, and the page that puts
//     it in the message box (nothing is sent until Send; the file then takes the normal upload road)
//   - the "Bot isn't reachable" page when opening Bot fails, and the "New message" shortcut
// A real server starts on a random port; sw.js runs in a sandbox with a fake cache and a fake network.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const { createServer, sendBody } = require("../server");
const { createStore } = require("../store");
const { createReminders } = require("../reminders");

const PUBLIC = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8").replace(/\r\n/g, "\n");
const swCode = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
const serverCode = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-pwa-"));
  const reminders = createReminders({ file: path.join(dir, "reminders.json"), now: () => Date.UTC(2026, 10, 1, 12) });
  const server = createServer({ store: createStore(path.join(dir, "c")), reminders, usage: async () => [] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = (method, url, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  const close = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  return { request, close };
}

test("the page is sent gzipped only to a browser that asks for it, and the unpacked bytes are the real file", async () => {
  const { request, close } = await start();
  const file = fs.readFileSync(path.join(PUBLIC, "index.html"));
  const packed = await request("GET", "/", { headers: { "Accept-Encoding": "gzip, deflate, br" } });
  assert.strictEqual(packed.status, 200);
  assert.strictEqual(packed.headers["content-encoding"], "gzip");
  assert.strictEqual(packed.headers.vary, "Accept-Encoding");
  assert.ok(packed.buffer.length < file.length / 2, `gzipped page is ${packed.buffer.length} bytes`);
  assert.deepStrictEqual(zlib.gunzipSync(packed.buffer), file);
  const plain = await request("GET", "/");
  assert.strictEqual(plain.headers["content-encoding"], undefined);
  assert.deepStrictEqual(plain.buffer, file);
  await close();
});

test("an unchanged page costs a 304 with no body; a wrong or missing ETag gets the whole page", async () => {
  const { request, close } = await start();
  const first = await request("GET", "/", { headers: { "Accept-Encoding": "gzip" } });
  const etag = first.headers.etag;
  assert.match(etag, /^"[A-Za-z0-9_-]{22}"$/);
  assert.strictEqual(first.headers["cache-control"], "no-cache"); // kept, but asked about every time
  const again = await request("GET", "/", { headers: { "Accept-Encoding": "gzip", "If-None-Match": etag } });
  assert.strictEqual(again.status, 304);
  assert.strictEqual(again.buffer.length, 0);
  assert.strictEqual(again.headers.etag, etag);
  assert.strictEqual((await request("GET", "/", { headers: { "If-None-Match": '"not-it"' } })).status, 200);
  for (const name of ["/study.js", "/manifest.webmanifest", "/icon-192.png"]) {
    const res = await request("GET", name);
    assert.ok(res.headers.etag, name);
    assert.strictEqual((await request("GET", name, { headers: { "If-None-Match": res.headers.etag } })).status, 304, name);
  }
  await close();
});

test("pictures are never gzipped, sw.js stays no-store, and small JSON is sent as it is", async () => {
  const { request, close } = await start();
  const icon = await request("GET", "/icon-512.png", { headers: { "Accept-Encoding": "gzip" } });
  assert.strictEqual(icon.headers["content-encoding"], undefined);
  assert.deepStrictEqual([...icon.buffer.subarray(0, 4)], [137, 80, 78, 71]);
  const sw = await request("GET", "/sw.js", { headers: { "Accept-Encoding": "gzip" } });
  assert.strictEqual(sw.headers["cache-control"], "no-store");
  assert.strictEqual(sw.headers.etag, undefined);
  assert.strictEqual(zlib.gunzipSync(sw.buffer).toString(), swCode);
  const small = await request("GET", "/api/reminders", { headers: { "Accept-Encoding": "gzip" } });
  assert.strictEqual(small.headers["content-encoding"], undefined);
  assert.ok(JSON.parse(small.buffer.toString()));
  await close();
});

test("sendBody gzips a big JSON answer only when the request accepts gzip", () => {
  const fakeRes = (acceptEncoding) => {
    const out = { req: { headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} } };
    out.writeHead = (status, headers) => { out.status = status; out.headers = headers; };
    out.end = (body) => { out.body = body; };
    return out;
  };
  const big = JSON.stringify({ messages: Array.from({ length: 200 }, (_, i) => ({ id: i, text: "hello ".repeat(10) })) });
  const a = fakeRes("gzip");
  sendBody(a, 200, { "Content-Type": "application/json" }, big);
  assert.strictEqual(a.headers["Content-Encoding"], "gzip");
  assert.strictEqual(zlib.gunzipSync(a.body).toString(), big);
  assert.strictEqual(a.headers["Content-Length"], a.body.length);
  const b = fakeRes("identity");
  sendBody(b, 200, { "Content-Type": "application/json" }, big);
  assert.strictEqual(b.headers["Content-Encoding"], undefined);
  assert.strictEqual(b.body.toString(), big);
  const c = fakeRes("gzip");
  sendBody(c, 200, { "Content-Type": "image/png" }, Buffer.alloc(5000), { compress: false });
  assert.strictEqual(c.headers["Content-Encoding"], undefined);
});

test("SECURITY: a share that reaches the PC is only a redirect; Bot reads none of it, and the Host check still runs first", async () => {
  const { request, close } = await start();
  const res = await request("POST", "/share-target", { headers: { "Content-Type": "multipart/form-data; boundary=x" }, body: "--x\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nhello\r\n--x--\r\n" });
  assert.strictEqual(res.status, 303);
  assert.strictEqual(res.headers.location, "/?shared=1");
  assert.strictEqual(res.buffer.length, 0);
  assert.strictEqual((await request("POST", "/share-target", { headers: { Host: "evil.example.com" }, body: "x" })).status, 403);
  // the page shown afterwards finds nothing in the share box and says so; files only enter Bot through /api/thread/upload
  assert.match(html, /Nothing was shared, or it waited too long/);
  await close();
});

test("the manifest puts Bot in the Share menu for the files Bot can read, and has a New message shortcut", () => {
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8"));
  assert.strictEqual(m.share_target.action, "/share-target");
  assert.strictEqual(m.share_target.method, "POST");
  assert.strictEqual(m.share_target.enctype, "multipart/form-data");
  assert.deepStrictEqual(Object.keys(m.share_target.params).sort(), ["files", "text", "title", "url"]);
  const accept = m.share_target.params.files[0].accept;
  assert.strictEqual(m.share_target.params.files[0].name, "file");
  for (const t of ["image/*", ".pdf", ".zip", ".pptx", ".docx", ".txt", ".md"]) assert.ok(accept.includes(t), t);
  assert.ok(!accept.some((t) => /exe|script|apk|octet|\*\/\*/.test(t)), "no programs and no 'anything'");
  assert.deepStrictEqual(m.shortcuts.map((s) => s.url), ["/?new=1"]);
  assert.strictEqual(m.id, "/");
});

// ---- sw.js in a sandbox ----
function loadSw({ network }) {
  const listeners = {};
  const store = new Map(); // cache name -> Map(key -> Response)
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return {
        async put(key, res) { c.set(String(key), res); },
        async match(key) { const r = c.get(String(key)); return r ? r.clone() : undefined; },
        async delete(key) { return c.delete(String(key)); },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
  const sandbox = {
    self: { addEventListener: (type, fn) => { listeners[type] = fn; }, location: { origin: "https://bot.test" }, skipWaiting() {}, clients: { claim: async () => {} }, registration: {} },
    caches, fetch: network, Response, Request, FormData, File, Blob, URL, JSON, Promise, Date, encodeURIComponent, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(swCode, sandbox);
  const fire = (request) => {
    let answered = null;
    listeners.fetch({ request, respondWith: (p) => { answered = Promise.resolve(p); } });
    return answered;
  };
  return { fire, store, listeners };
}

test("sw.js: a share is kept on the phone (words and the FIRST file only) and Bot opens with ?shared=1; nothing goes to the PC", async () => {
  let netCalls = 0;
  const { fire, store } = loadSw({ network: async () => { netCalls++; return new Response("x"); } });
  const form = new FormData();
  form.append("title", "Lecture 5");
  form.append("text", "look at this https://example.com/a");
  form.append("file", new File(["%PDF-1.7 first"], "הרצאה 5.pdf", { type: "application/pdf" }));
  form.append("file", new File(["second"], "b.txt", { type: "text/plain" }));
  const res = await fire(new Request("https://bot.test/share-target", { method: "POST", body: form }));
  assert.strictEqual(res.status, 303);
  assert.match(res.headers.get("location"), /\/\?shared=1$/);
  assert.strictEqual(netCalls, 0);
  const box = store.get("bot-share");
  const meta = await box.get("/shared/meta").clone().json();
  assert.strictEqual(meta.words, "Lecture 5\nlook at this https://example.com/a");
  assert.strictEqual(meta.note, "many");
  const file = box.get("/shared/file");
  assert.strictEqual(await file.clone().text(), "%PDF-1.7 first");
  assert.strictEqual(decodeURIComponent(file.headers.get("X-Bot-Name")), "הרצאה 5.pdf");
  assert.deepStrictEqual([...store.keys()], ["bot-share"]); // the only thing it ever stores
});

test("sw.js: a share with only words keeps no file, and a new share replaces an old file", async () => {
  const { fire, store } = loadSw({ network: async () => new Response("x") });
  const one = new FormData();
  one.append("file", new File(["old"], "old.pdf", { type: "application/pdf" }));
  await fire(new Request("https://bot.test/share-target", { method: "POST", body: one }));
  const two = new FormData();
  two.append("text", "x".repeat(9000));
  await fire(new Request("https://bot.test/share-target", { method: "POST", body: two }));
  const box = store.get("bot-share");
  assert.strictEqual(box.has("/shared/file"), false);
  const meta = await box.get("/shared/meta").clone().json();
  assert.strictEqual(meta.words.length, 8000); // cut to the message limit
  assert.strictEqual(meta.note, "");
});

test("sw.js: opening Bot goes to the PC; only when that fails comes the 'not reachable' page; other requests are not touched", async () => {
  let up = true;
  const real = new Response("the real page", { status: 200 });
  const { fire, store } = loadSw({ network: async () => { if (!up) throw new TypeError("Failed to fetch"); return real; } });
  const nav = { url: "https://bot.test/", method: "GET", mode: "navigate" };
  assert.strictEqual(await fire(nav), real);
  up = false;
  const offline = await fire(nav);
  assert.strictEqual(offline.status, 503);
  assert.match(await offline.text(), /Bot isn't reachable right now/);
  assert.strictEqual(fire({ url: "https://bot.test/api/thread?limit=50", method: "GET", mode: "cors" }), null); // the browser sends it as before
  assert.strictEqual(fire({ url: "https://bot.test/api/thread/upload?name=a.pdf", method: "POST", mode: "cors" }), null);
  assert.strictEqual(fire({ url: "https://other.example/", method: "GET", mode: "navigate" }), null);
  assert.strictEqual(store.size, 0); // opening Bot stored nothing
});

test("the page takes a share into the message box and the paperclip's own input, and never sends it by itself", () => {
  const fn = html.match(/async function takeShared\(\) \{[\s\S]*?\n {4}\}\n/)[0];
  assert.match(fn, /caches\.delete\("bot-share"\)/); // taken out and deleted at once (and a leftover is cleared on any open)
  assert.match(fn, /\$\("photoInput"\)\.files = transfer\.files;\s*\$\("photoInput"\)\.dispatchEvent\(new Event\("change"\)\)/);
  assert.doesNotMatch(fn, /fetch\(|XMLHttpRequest|upload|send\(|threadSend/);
  assert.match(fn, /10 \* 60000/); // an old share is not used
  assert.match(html, /notice\(\); takeShared\(\); newMessageShortcut\(\);/);
  assert.match(html, /function newMessageShortcut\(\) \{[\s\S]*?get\("new"\) !== "1"[\s\S]*?\$\("task"\)\.focus\(\);/);
});

test("the page says so when the PC stops answering, and stops saying it at the next answer", () => {
  const fn = html.match(/function reachable\(ok\) \{[\s\S]*?\n {4}\}\n/)[0];
  const made = [];
  const toasts = { prepend: (n) => { made.push(n); n.remove = () => made.splice(made.indexOf(n), 1); } };
  const T = {};
  const sandbox = { T, $: (id) => (id === "toasts" ? toasts : made.find((n) => n.id === id) || null), el: (tag, cls, text) => ({ tag, cls, text, kids: [], appendChild(k) { this.kids.push(k); } }) };
  vm.createContext(sandbox);
  vm.runInContext(fn + "\nthis.reachable = reachable;", sandbox);
  sandbox.reachable(false);
  assert.strictEqual(made.length, 0); // one lost request: nothing
  sandbox.reachable(false);
  assert.strictEqual(made.length, 1);
  assert.match(made[0].kids[0].text, /isn't reachable/);
  sandbox.reachable(false);
  assert.strictEqual(made.length, 1); // never twice
  sandbox.reachable(true);
  assert.strictEqual(made.length, 0);
  assert.match(html, /reachable\(true\);\n\s*\} catch \(error\) \{ reachable\(false\);/);
});

test("Bot also listens on ::1 (this computer's IPv6 name), with the same handler", () => {
  assert.match(serverCode, /const v6 = http\.createServer\(\(req, res\) => server\.emit\("request", req, res\)\);/);
  assert.match(serverCode, /v6\.listen\(PORT, "::1"\);/);
  assert.match(serverCode, /v6\.on\("error"/); // a PC without IPv6 still starts Bot
});
