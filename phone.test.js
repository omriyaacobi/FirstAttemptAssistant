// phone.test.js
// Tests the phone login (auth.js) and how server.js treats requests that come through Tailscale.
// A request "from the phone" is simulated with the phone's Host name and/or a proxy header.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("./server");
const { createStore } = require("./store");
const { createAuth, loadPhoneConfig, parseEnv, MAX_FAILS, LOCK_MS } = require("./auth");

const HOST = "my-pc.tail1234.ts.net";
const TOKEN = "a-long-random-test-token-0123456789";
const config = { enabled: true, host: HOST, token: TOKEN };

async function start({ authConfig = config } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-phone-"));
  const pushed = [];
  const push = {
    publicKey: () => "PUBLIC-KEY",
    subscribe: (s) => { if (!s || !s.endpoint) throw new Error("bad endpoint"); pushed.push(s); return pushed.length; },
    unsubscribe: () => true,
    notifyAll: async (m) => { pushed.push(m); return { sent: 1, removed: 0, total: 1 }; },
  };
  const calls = [];
  const server = createServer({
    handle: async () => ({ mode: "single", answer: "hello", used: { provider: "p", model: "m" } }),
    store: createStore(dir),
    auth: createAuth({ config: authConfig }),
    push,
    selfEdit: { list: () => [], isActive: () => false, start: async () => { calls.push("selfedit"); return { record: {} }; } },
    gitOps: { status: async () => ({}), push: async () => { calls.push("push"); return {}; } },
    usage: async () => [],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  // The phone, as tailscale serve forwards it: Tailscale name as Host, plus a proxy header.
  const phone = (method, p, { cookie, body, headers = {} } = {}) =>
    request(method, p, {
      headers: { Host: HOST, "X-Forwarded-For": "100.64.0.2", Origin: `https://${HOST}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const pc = (method, p, body) =>
    request(method, p, { headers: { Host: `localhost:${port}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async () => {
    const res = await phone("POST", "/api/login", { body: { token: TOKEN } });
    assert.strictEqual(res.status, 200);
    return res.headers["set-cookie"][0].split(";")[0];
  };
  return { port, request, phone, pc, login, pushed, calls, close: () => new Promise((r) => server.close(r)) };
}

// ---- auth.js on its own ----

test("phone config: off unless both settings are present and sensible", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-env-")), ".env");
  assert.strictEqual(loadPhoneConfig(file).enabled, false); // no .env at all
  fs.writeFileSync(file, `BOT_PHONE_HOST=${HOST}\n`);
  assert.strictEqual(loadPhoneConfig(file).enabled, false);
  fs.writeFileSync(file, `BOT_PHONE_HOST=${HOST}\nBOT_PHONE_TOKEN=short\n`);
  assert.match(loadPhoneConfig(file).reason, /at least/);
  fs.writeFileSync(file, `BOT_PHONE_HOST=evil.example.com\nBOT_PHONE_TOKEN=${TOKEN}\n`);
  assert.match(loadPhoneConfig(file).reason, /ts\.net/);
  fs.writeFileSync(file, `# phone\nBOT_PHONE_HOST="${HOST.toUpperCase()}"\nBOT_PHONE_TOKEN=${TOKEN}\n`);
  assert.deepStrictEqual(loadPhoneConfig(file), { enabled: true, host: HOST, token: TOKEN });
  assert.deepStrictEqual(parseEnv("A=1\n#B=2\n C = 'x y' "), { A: "1", C: "x y" });
});

test("SECURITY: after too many wrong tokens, even the right one is refused for a while", () => {
  let t = 1_000_000;
  const auth = createAuth({ config, now: () => t });
  for (let i = 0; i < MAX_FAILS; i++) assert.strictEqual(auth.login("wrong").status, 401);
  assert.strictEqual(auth.login(TOKEN).status, 429);
  t += LOCK_MS + 1;
  assert.strictEqual(auth.login(TOKEN).ok, true);
});

test("the session cookie is HttpOnly, Secure and SameSite=Strict, and does not contain the token", () => {
  const { cookie } = createAuth({ config }).login(TOKEN);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!cookie.includes(TOKEN));
});

// ---- the server ----

test("the PC needs no login and keeps every feature", async () => {
  const s = await start();
  const session = (await s.pc("GET", "/api/session")).json();
  assert.deepStrictEqual(session, { remote: false, phoneAccess: true, loggedIn: true, images: true, pushKey: "PUBLIC-KEY" });
  assert.strictEqual((await s.pc("GET", "/api/selfedit")).status, 200);
  assert.strictEqual((await s.pc("POST", "/api/login", { token: TOKEN })).status, 400); // nothing to log in to
  await s.close();
});

test("SECURITY: the phone gets only the page until it logs in", async () => {
  const s = await start();
  assert.strictEqual((await s.phone("GET", "/")).status, 200);
  assert.strictEqual((await s.phone("GET", "/manifest.webmanifest")).status, 200);
  assert.deepStrictEqual((await s.phone("GET", "/api/session")).json(), { remote: true, phoneAccess: true, loggedIn: false, images: true, pushKey: null });
  for (const [method, p] of [["GET", "/api/conversations"], ["GET", "/api/reminders"], ["GET", "/api/usage"]]) {
    assert.strictEqual((await s.phone(method, p)).status, 401, p);
  }
  assert.strictEqual((await s.phone("POST", "/api/ask", { body: { task: "hi" } })).status, 401);
  assert.strictEqual((await s.phone("GET", "/api/jobs")).status, 401);
  assert.strictEqual((await s.phone("GET", "/api/jobs/" + "a".repeat(32))).status, 401);
  assert.strictEqual((await s.phone("POST", "/api/push/subscribe", { body: { subscription: { endpoint: "x" } } })).status, 401);
  await s.close();
});

test("SECURITY: a forwarded request counts as the phone even if its Host looks local", async () => {
  const s = await start();
  const res = await s.request("GET", "/api/conversations", { headers: { Host: `127.0.0.1:${s.port}`, "X-Forwarded-For": "100.64.0.2" } });
  assert.strictEqual(res.status, 401);
  const res2 = await s.request("GET", "/api/selfedit", { headers: { Host: `localhost:${s.port}`, "Tailscale-User-Login": "someone@example.com" } });
  assert.strictEqual(res2.status, 403);
  const session = await s.request("GET", "/api/session", { headers: { Host: `localhost:${s.port}`, Forwarded: "for=100.64.0.2" } });
  assert.strictEqual(session.json().remote, true);
  await s.close();
});

test("opening the app from the Android home screen (marked cross-site) still loads the page", async () => {
  const s = await start();
  const launch = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" };
  assert.strictEqual((await s.phone("GET", "/", { headers: launch })).status, 200);
  assert.strictEqual((await s.phone("GET", "/manifest.webmanifest", { headers: launch })).status, 200);
  // ...but an API request marked cross-site is still refused, even with a valid login.
  const cookie = await s.login();
  assert.strictEqual((await s.phone("GET", "/api/reminders", { cookie, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.strictEqual((await s.phone("POST", "/api/ask", { cookie, body: { task: "hi" }, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  await s.close();
});

test("SECURITY: wrong token is refused and gives no cookie", async () => {
  const s = await start();
  const res = await s.phone("POST", "/api/login", { body: { token: "nope" } });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.headers["set-cookie"], undefined);
  await s.close();
});

test("after logging in, the phone can chat, see reminders and turn on push", async () => {
  const s = await start();
  const cookie = await s.login();
  assert.strictEqual((await s.phone("GET", "/api/session", { cookie })).json().pushKey, "PUBLIC-KEY");
  assert.strictEqual((await s.phone("GET", "/api/reminders", { cookie })).status, 200);
  const ask = await s.phone("POST", "/api/ask", { cookie, body: { task: "hi" } });
  assert.strictEqual(ask.status, 202);
  const jobId = ask.json().job.id;
  assert.strictEqual((await s.phone("GET", "/api/jobs/" + jobId, { cookie })).status, 200);
  assert.strictEqual((await s.phone("GET", "/api/jobs", { cookie })).status, 200);
  assert.strictEqual((await s.phone("POST", "/api/push/subscribe", { cookie, body: { subscription: { endpoint: "https://fcm.googleapis.com/x" } } })).status, 200);
  assert.deepStrictEqual((await s.phone("POST", "/api/push/test", { cookie, body: {} })).json(), { sent: 1, removed: 0, total: 1 });
  await s.close();
});

test("SECURITY: even logged in, the phone can't use Improve Bot, Restart or GitHub", async () => {
  const s = await start();
  const cookie = await s.login();
  for (const [method, p] of [["GET", "/api/selfedit"], ["POST", "/api/selfedit"], ["POST", "/api/restart"], ["GET", "/api/git"], ["POST", "/api/git/push"]]) {
    const res = await s.phone(method, p, { cookie, body: method === "POST" ? { request: "x" } : undefined });
    assert.strictEqual(res.status, 403, p);
  }
  assert.deepStrictEqual(s.calls, []);
  await s.close();
});

test("SECURITY: the phone's requests must come from the phone's own https origin", async () => {
  const s = await start();
  const cookie = await s.login();
  const res = await s.phone("GET", "/api/reminders", { cookie, headers: { Origin: `http://${HOST}` } });
  assert.strictEqual(res.status, 403);
  const res2 = await s.phone("GET", "/api/reminders", { cookie, headers: { Origin: "https://evil.example" } });
  assert.strictEqual(res2.status, 403);
  await s.close();
});

test("SECURITY: with phone access off, the Tailscale name and forwarded requests are refused", async () => {
  const s = await start({ authConfig: { enabled: false, reason: "off" } });
  assert.strictEqual((await s.phone("GET", "/")).status, 403);
  const res = await s.request("GET", "/", { headers: { Host: "localhost:" + 1, "X-Forwarded-For": "1.2.3.4" } });
  assert.strictEqual(res.status, 403);
  await s.close();
});
