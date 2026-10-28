const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const cal = require("./calendar.js");

const creds = { clientId: "id", clientSecret: "secret" };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "caltest-")), "token.json");

function fakeRequest(responses) {
  const calls = [];
  const fn = async (options, body) => { calls.push({ options, body }); return responses.shift(); };
  fn.calls = calls;
  return fn;
}

test("parseEnv reads KEY=value, skips comments, strips quotes", () => {
  assert.deepStrictEqual(cal.parseEnv('# c\nA=1\nB="two"\n  C = 3 \n'), { A: "1", B: "two", C: "3" });
});

test("loadCredentials complains when there is no .env and no downloaded file", () => {
  assert.throws(() => cal.loadCredentials(path.join(os.tmpdir(), "nope-.env"), path.join(os.tmpdir(), "nope-data")), /No Google client found/);
});

test("loadCredentials reads Google's downloaded client_secret file from the data folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caltest-"));
  fs.writeFileSync(path.join(dir, "notes.json"), "{}");
  fs.writeFileSync(path.join(dir, "client_secret_123.apps.googleusercontent.com.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "csec" } }));
  assert.deepStrictEqual(cal.loadCredentials(path.join(dir, "no.env"), dir), { clientId: "cid", clientSecret: "csec" });
});

test("loadCredentials prefers .env when it is filled in", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caltest-"));
  fs.writeFileSync(path.join(dir, ".env"), "GOOGLE_CLIENT_ID=a\nGOOGLE_CLIENT_SECRET=b\n");
  fs.writeFileSync(path.join(dir, "client_secret_x.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "csec" } }));
  assert.deepStrictEqual(cal.loadCredentials(path.join(dir, ".env"), dir), { clientId: "a", clientSecret: "b" });
});

test("auth URL asks only for the calendar.events scope, PKCE, offline", () => {
  const url = new URL(cal.buildAuthUrl({ clientId: "id", redirectUri: "http://127.0.0.1:1/", state: "s", challenge: "c" }));
  assert.strictEqual(url.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(url.searchParams.get("access_type"), "offline");
});

test("valid access token is reused without a network call", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ access_token: "A", refresh_token: "R", expires_at: 10_000_000 }));
  const request = fakeRequest([]);
  assert.strictEqual(await cal.getAccessToken({ credentials: creds, request, file, now: 1000 }), "A");
  assert.strictEqual(request.calls.length, 0);
});

test("expired token is refreshed and saved", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ access_token: "old", refresh_token: "R", expires_at: 0 }));
  const request = fakeRequest([{ status: 200, body: { access_token: "NEW", expires_in: 3600 } }]);
  assert.strictEqual(await cal.getAccessToken({ credentials: creds, request, file, now: 5000 }), "NEW");
  assert.match(request.calls[0].body, /grant_type=refresh_token/);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(saved.access_token, "NEW");
  assert.strictEqual(saved.refresh_token, "R");
});

test("not signed in gives a helpful error", async () => {
  await assert.rejects(cal.getAccessToken({ credentials: creds, request: fakeRequest([]), file: tmpFile() }), /login/);
});

test("invalid_grant mentions the 7-day limit", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ refresh_token: "R", expires_at: 0 }));
  const request = fakeRequest([{ status: 400, body: { error: "invalid_grant" } }]);
  await assert.rejects(cal.getAccessToken({ credentials: creds, request, file }), /7-day/);
});

test("listEvents only does a GET and maps results", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ access_token: "A", refresh_token: "R", expires_at: Date.now() + 1e7 }));
  const request = fakeRequest([{ status: 200, body: { items: [{ summary: "Lecture", start: { dateTime: "2026-10-29T10:00:00+02:00" }, end: { dateTime: "2026-10-29T12:00:00+02:00" } }, { start: { date: "2026-10-29" }, end: { date: "2026-10-30" } }] } }]);
  const events = await cal.listEvents("2026-10-29", { credentials: creds, request, file });
  assert.strictEqual(request.calls[0].options.method, "GET");
  assert.match(request.calls[0].options.headers.Authorization, /^Bearer A$/);
  assert.deepStrictEqual(events.map((e) => e.summary), ["Lecture", "(no title)"]);
});

test("listEvents rejects a bad day", async () => {
  await assert.rejects(cal.listEvents("tomorrow", { credentials: creds, request: fakeRequest([]), file: tmpFile() }), /Day must/);
});

test("checkEventInput rejects bad input", () => {
  const ok = { summary: "x", start: "2026-10-29T15:00", end: "2026-10-29T16:00" };
  assert.doesNotThrow(() => cal.checkEventInput(ok));
  assert.throws(() => cal.checkEventInput({ ...ok, summary: "  " }), /Title/);
  assert.throws(() => cal.checkEventInput({ ...ok, start: "15:00" }), /Times/);
  assert.throws(() => cal.checkEventInput({ ...ok, end: "2026-10-29T14:00" }), /End must/);
  assert.throws(() => cal.checkEventInput({ ...ok, end: "2026-13-40T14:00" }), /real/);
});

test("createEvent POSTs one event and bad input makes no call", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ access_token: "A", refresh_token: "R", expires_at: Date.now() + 1e7 }));
  const request = fakeRequest([{ status: 200, body: { id: "e1", summary: "Dentist", start: { dateTime: "2026-10-29T15:00:00+02:00" }, end: { dateTime: "x" }, htmlLink: "L" } }]);
  await assert.rejects(cal.createEvent({ summary: "", start: "a", end: "b" }, { credentials: creds, request, file }));
  assert.strictEqual(request.calls.length, 0);
  const made = await cal.createEvent({ summary: "Dentist", start: "2026-10-29T15:00", end: "2026-10-29T16:00" }, { credentials: creds, request, file });
  assert.strictEqual(request.calls.length, 1);
  assert.strictEqual(request.calls[0].options.method, "POST");
  assert.strictEqual(JSON.parse(request.calls[0].body).summary, "Dentist");
  assert.strictEqual(made.id, "e1");
});

test("API errors become readable messages", async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ access_token: "A", refresh_token: "R", expires_at: Date.now() + 1e7 }));
  const request = fakeRequest([{ status: 403, body: { error: { message: "API not enabled" } } }]);
  await assert.rejects(cal.listEvents(undefined, { credentials: creds, request, file }), /API not enabled/);
});

test("login: ignores a wrong state, then accepts the real redirect and saves tokens", async () => {
  const file = tmpFile();
  const request = fakeRequest([{ status: 200, body: { access_token: "A", refresh_token: "R", expires_in: 3600, scope: cal.SCOPE } }]);
  let url;
  const done = cal.login({ credentials: creds, request, file, log: (l) => { if (l.startsWith("https://")) url = l; } });
  await new Promise((r) => setTimeout(r, 100));
  const auth = new URL(url);
  const origin = new URL(auth.searchParams.get("redirect_uri")).origin;
  const get = (q) => new Promise((resolve) => http.get(`${origin}/?${q}`, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.strictEqual(await get("state=WRONG&code=x"), 400);
  assert.strictEqual(request.calls.length, 0);
  assert.strictEqual(await get(`state=${auth.searchParams.get("state")}&code=CODE`), 200);
  await done;
  assert.match(request.calls[0].body, /code_verifier=/);
  assert.match(request.calls[0].body, /code=CODE/);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).refresh_token, "R");
});
