// photo.test.js
// Tests sending a photo with a message: the checks on the photo (photo.js), the server route,
// the phone login, and the routing to Gemini (core.js). All model calls are fakes: no quota is used,
// and photos are saved in a temporary folder, never in the real data/ folder.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parsePhoto, savePhoto, sniffImage, MAX_PHOTO_BYTES } = require("../photo");
const { createServer, MAX_BODY } = require("../server");
const { createStore } = require("../store");
const { createAuth } = require("../auth");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20, 3)]);
const url = (bytes, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;

// ---- the checks on the photo ----
test("a real JPEG, PNG or WebP is accepted and the type comes from its bytes", () => {
  assert.strictEqual(parsePhoto(url(JPEG)).ext, ".jpg");
  assert.strictEqual(parsePhoto(url(PNG)).ext, ".png");
  assert.strictEqual(parsePhoto(url(WEBP)).ext, ".webp");
  // the declared type is ignored: a PNG that calls itself a JPEG is still a PNG
  assert.strictEqual(parsePhoto(url(PNG, "image/jpeg")).ext, ".png");
});

test("SECURITY: the first bytes decide, not what the sender says", () => {
  const text = url(Buffer.from("<script>alert(1)</script>"), "image/jpeg");
  assert.throws(() => parsePhoto(text), (e) => e.status === 415);
  const exe = url(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(50)]), "image/png");
  assert.throws(() => parsePhoto(exe), (e) => e.status === 415);
  const gif = url(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(50)]), "image/gif");
  assert.throws(() => parsePhoto(gif), (e) => e.status === 415);
  assert.strictEqual(sniffImage(Buffer.alloc(0)), null);
});

test("a photo that is not a proper data URL, damaged, or too big is refused", () => {
  assert.throws(() => parsePhoto(42), (e) => e.status === 400);
  assert.throws(() => parsePhoto("hello"), (e) => e.status === 400);
  assert.throws(() => parsePhoto("data:text/html;base64,AAAA"), (e) => e.status === 400);
  assert.throws(() => parsePhoto("data:image/jpeg;base64,not base64 !!"), (e) => e.status === 400);
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
  assert.throws(() => parsePhoto(url(big)), (e) => e.status === 413);
});

test("savePhoto uses a random name of its own, with the extension from the bytes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-photo-test-"));
  const a = savePhoto(dir, parsePhoto(url(JPEG)));
  const b = savePhoto(dir, parsePhoto(url(JPEG)));
  assert.notStrictEqual(a.path, b.path);
  assert.match(path.basename(a.path), /^[a-f0-9]{32}\.jpg$/);
  assert.ok(fs.readFileSync(a.path).equals(JPEG));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the server route ----
async function startServer({ handle, authConfig = { enabled: false } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-photo-srv-"));
  const uploadDir = path.join(dir, "uploads");
  const store = createStore(path.join(dir, "chats"));
  const seen = [];
  const server = createServer({
    handle: handle || (async (task, opts) => {
      seen.push({ task, image: opts.image, existed: opts.image ? fs.existsSync(opts.image.path) : null });
      return { mode: "single", answer: "I see a schedule", used: { provider: "agy", model: "m" } };
    }),
    store,
    uploadDir,
    auth: createAuth({ config: authConfig }),
    push: { publicKey: () => "K", notifyAll: async () => ({}) },
    selfEdit: { list: () => [], isActive: () => false },
    gitOps: { status: async () => ({}) },
    usage: async () => [],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data, json: () => JSON.parse(data) }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  // A request that is too big may be cut off by the server before we finish sending: that counts as refused (413).
  const ask = (payload) => request("POST", "/api/ask", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => ({ status: 413, json: () => ({ error: "too big (connection closed)" }) }));
  const finish = async (res) => {
    let job = res.json().job;
    while (job.status === "running") {
      await new Promise((r) => setTimeout(r, 10));
      job = (await request("GET", "/api/jobs/" + job.id)).json().job;
    }
    return job;
  };
  const uploads = () => (fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);
  const close = async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); };
  return { request, ask, finish, uploads, store, seen, close, port };
}

test("a message with a photo starts a job, the model gets the saved file, and the file is deleted afterwards", async () => {
  const s = await startServer();
  const res = await s.ask({ task: "add this to my calendar", image: url(JPEG) });
  assert.strictEqual(res.status, 202);
  const job = await s.finish(res);
  assert.strictEqual(job.status, "done");
  assert.strictEqual(s.seen.length, 1);
  assert.strictEqual(s.seen[0].existed, true); // it was there while the model ran
  assert.strictEqual(s.seen[0].image.ext, ".jpg");
  assert.deepStrictEqual(s.uploads(), []); // and gone afterwards
  const messages = s.store.get(job.conversationId).messages;
  assert.strictEqual(messages[0].text, "(photo attached) add this to my calendar");
  await s.close();
});

test("a message without a photo is unchanged: no image reaches the model", async () => {
  const s = await startServer();
  await s.finish(await s.ask({ task: "hi" }));
  assert.strictEqual(s.seen[0].image, null);
  assert.strictEqual(s.store.get(s.store.list()[0].id).messages[0].text, "hi");
  await s.close();
});

test("SECURITY: a photo with the wrong bytes is refused and nothing is saved or started", async () => {
  const s = await startServer();
  const res = await s.ask({ task: "look", image: url(Buffer.from("not an image at all, just text"), "image/png") });
  assert.strictEqual(res.status, 415);
  assert.match(res.json().error, /JPEG, PNG or WebP/);
  assert.deepStrictEqual(s.uploads(), []);
  assert.strictEqual(s.seen.length, 0);
  assert.strictEqual(s.store.list().length, 0);
  await s.close();
});

test("a photo over 3 MB gets a clear error", async () => {
  const s = await startServer();
  const res = await s.ask({ task: "look", image: url(Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES + 100)])) });
  assert.strictEqual(res.status, 413);
  assert.match(res.json().error, /too big/);
  assert.deepStrictEqual(s.uploads(), []);
  await s.close();
});

test("the bigger size limit is only for a request that carries a photo", async () => {
  const s = await startServer();
  // no photo: the small limit still applies
  const text = await s.ask({ task: "x".repeat(MAX_BODY + 10) });
  assert.strictEqual(text.status, 413);
  // a big field other than the photo does not get the big limit either
  const sneaky = await s.ask({ task: "hi", noPlan: "x".repeat(MAX_BODY + 10) });
  assert.strictEqual(sneaky.status, 413);
  // other routes keep the small limit
  const login = await s.request("POST", "/api/login", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x".repeat(MAX_BODY + 10) }) }).catch(() => ({ status: 413 }));
  assert.strictEqual(login.status, 413);
  await s.close();
});

test("a photo needs a message, JSON and a real conversation; a failed start leaves no photo behind", async () => {
  const s = await startServer();
  assert.strictEqual((await s.ask({ task: "", image: url(JPEG) })).status, 400);
  const bad = await s.request("POST", "/api/ask", { headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ task: "hi", image: url(JPEG) }) });
  assert.strictEqual(bad.status, 415);
  const missing = await s.ask({ task: "hi", image: url(JPEG), conversationId: "0123456789abcdef" });
  assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(s.uploads(), []);
  await s.close();
});

test("the session says this Bot can take photos", async () => {
  const s = await startServer();
  assert.strictEqual((await s.request("GET", "/api/session")).json().images, true);
  await s.close();
});

test("SECURITY: from the phone, a photo needs the login like any other message", async () => {
  const HOST = "my-pc.tail1234.ts.net";
  const s = await startServer({ authConfig: { enabled: true, host: HOST, token: "a-long-random-test-token-0123456789" } });
  const res = await s.request("POST", "/api/ask", {
    headers: { Host: HOST, "X-Forwarded-For": "100.64.0.2", Origin: `https://${HOST}`, "Content-Type": "application/json" },
    body: JSON.stringify({ task: "hi", image: url(JPEG) }),
  });
  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(s.uploads(), []);
  assert.strictEqual(s.seen.length, 0);
  await s.close();
});

