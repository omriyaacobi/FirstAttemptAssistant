// calendar.js
// Bot's Google Calendar helper. Not wired into the router yet: you run it by hand.
//   node calendar.js login                       sign in with Google (once, opens a consent page)
//   node calendar.js list [YYYY-MM-DD]           show events of a day (default today), read-only
//   node calendar.js add "title" <start> <end>   add ONE event; times like 2026-10-29T15:00 (your local time)
//
// How it works (OAuth, "Sign in with Google"):
//   1. login prints a Google URL. You approve in the browser.
//   2. Google redirects the browser to http://127.0.0.1:<port>/ with a one-time CODE. A tiny
//      local server (loopback = only your own computer can reach it) catches the code.
//   3. We swap the code for an ACCESS token (valid ~1 hour) and a REFRESH token (used to get new
//      access tokens without asking you again). Both are saved in data/google-token.json (git-ignored).
//   PKCE: a random secret ("verifier") we make up per login; Google only accepts the code from
//   whoever knows it, so a stolen code is useless.
//
// Safety:
//   - Only the scope calendar.events (read and write events, nothing else: no mail, no Drive, no
//     deleting whole calendars).
//   - The client id/secret come from .env (git-ignored); tokens live in data/ (git-ignored).
//   - There is no delete function on purpose.
//   - While the Google app is in "Testing" mode the refresh token dies after 7 days: just run login again.
//   - Built-in modules only. All network calls go through one injectable function, so tests use a fake.

const https = require("node:https");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_HOST = "oauth2.googleapis.com";
const API_HOST = "www.googleapis.com";
const TOKEN_FILE = path.join(__dirname, "data", "google-token.json");

// Minimal .env reader: KEY=value lines, # comments. Returns an object; does NOT touch process.env.
function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

// The client id/secret come from .env, or else from the JSON file Google lets you download
// ("client_secret_....json") saved in the data/ folder. data/ is git-ignored, so the file can
// never be committed by accident (in the project root it could be).
function loadCredentials(envFile = path.join(__dirname, ".env"), dataDir = path.join(__dirname, "data")) {
  let text = "";
  try { text = fs.readFileSync(envFile, "utf8"); } catch (error) { /* missing file handled below */ }
  const env = parseEnv(text);
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  let files = [];
  try { files = fs.readdirSync(dataDir).filter((f) => /^client_secret.*\.json$/.test(f)); } catch (error) { /* no data folder */ }
  for (const file of files) {
    try {
      const { installed } = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
      if (installed && installed.client_id && installed.client_secret) return { clientId: installed.client_id, clientSecret: installed.client_secret };
    } catch (error) { /* not a Google client file, try the next */ }
  }
  throw new Error("No Google client found: put the downloaded client_secret_....json in the data folder, or fill in .env (see .env.example)");
}

// The real network function: {host, path, method, headers}, body string -> {status, body (parsed JSON or text)}.
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, timeout: 20000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (error) { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  return { verifier, challenge: base64url(crypto.createHash("sha256").update(verifier).digest()) };
}

function buildAuthUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline", // ask for a refresh token
    prompt: "consent",
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenCall(params, request) {
  const body = new URLSearchParams(params).toString();
  const res = await request(
    { host: TOKEN_HOST, path: "/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
    body
  );
  if (res.status !== 200 || !res.body.access_token) {
    const why = res.body && (res.body.error_description || res.body.error) || `HTTP ${res.status}`;
    throw new Error(`Google token request failed: ${why}`);
  }
  return res.body;
}

function readToken(file = TOKEN_FILE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
}

function saveToken(token, file = TOKEN_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(token, null, 2), { mode: 0o600 });
}

// Returns a valid access token, refreshing (and saving) it when it is about to expire.
async function getAccessToken({ credentials, request = httpsRequest, file = TOKEN_FILE, now = Date.now() }) {
  const saved = readToken(file);
  if (!saved || !saved.refresh_token) throw new Error("Not signed in. Run: node calendar.js login");
  if (saved.access_token && saved.expires_at && saved.expires_at - 60000 > now) return saved.access_token;
  let fresh;
  try {
    fresh = await tokenCall({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: saved.refresh_token, grant_type: "refresh_token" }, request);
  } catch (error) {
    throw new Error(`${error.message}. If it says invalid_grant, the 7-day Testing limit probably ended: run node calendar.js login again.`);
  }
  saveToken({ ...saved, access_token: fresh.access_token, expires_at: now + fresh.expires_in * 1000 }, file);
  return fresh.access_token;
}

async function api(method, pathAndQuery, body, deps) {
  const token = await getAccessToken(deps);
  const payload = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${token}` };
  if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
  const res = await (deps.request || httpsRequest)({ host: API_HOST, path: pathAndQuery, method, headers }, payload);
  if (res.status < 200 || res.status >= 300) {
    const why = res.body && res.body.error && res.body.error.message || `HTTP ${res.status}`;
    throw new Error(`Calendar API error: ${why}`);
  }
  return res.body;
}

function parseDay(day) {
  if (day === undefined) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Day must look like 2026-10-29');
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Not a real date");
  return d;
}

// Events of `days` local days (default 1) from `day` on your main calendar, read-only.
async function listEvents(day, deps, days = 1) {
  const start = parseDay(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const query = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
  const data = await api("GET", `/calendar/v3/calendars/primary/events?${query}`, null, deps);
  return (data.items || []).map((e) => ({
    summary: e.summary || "(no title)",
    start: e.start && (e.start.dateTime || e.start.date),
    end: e.end && (e.end.dateTime || e.end.date),
  }));
}

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Validates the input (never trust it), then inserts ONE event on the main calendar.
function checkEventInput({ summary, start, end }) {
  if (typeof summary !== "string" || !summary.trim() || summary.length > 200) throw new Error("Title must be 1-200 characters");
  if (!LOCAL_TIME.test(start || "") || !LOCAL_TIME.test(end || "")) throw new Error("Times must look like 2026-10-29T15:00");
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) throw new Error("Not a real date/time");
  if (new Date(end) <= new Date(start)) throw new Error("End must be after start");
  return { summary: summary.trim(), start, end };
}

async function createEvent(input, deps) {
  const { summary, start, end } = checkEventInput(input);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const created = await api("POST", "/calendar/v3/calendars/primary/events", {
    summary,
    start: { dateTime: `${start}:00`, timeZone },
    end: { dateTime: `${end}:00`, timeZone },
  }, deps);
  return { id: created.id, summary: created.summary, start: created.start && created.start.dateTime, end: created.end && created.end.dateTime, link: created.htmlLink };
}

// Interactive login. Resolves with the saved token info (no secrets printed).
function login({ credentials, request = httpsRequest, file = TOKEN_FILE, log = console.log, now = () => Date.now() }) {
  return new Promise((resolve, reject) => {
    const state = base64url(crypto.randomBytes(16));
    const pkce = makePkce();
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }
      const finish = (code, text, error) => {
        res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }).end(text);
        server.close();
        if (error) reject(error);
      };
      // A request with the wrong state is not from our login: refuse it but keep waiting for the real one.
      if (url.searchParams.get("state") !== state) { res.writeHead(400, { "Content-Type": "text/plain" }).end("Wrong state, ignoring."); return; }
      if (url.searchParams.get("error")) return finish(400, "Sign-in was cancelled.", new Error(`Google said: ${url.searchParams.get("error")}`));
      const code = url.searchParams.get("code");
      if (!code) return finish(400, "No code.", new Error("No code in redirect"));
      try {
        const t = await tokenCall({
          client_id: credentials.clientId, client_secret: credentials.clientSecret, code,
          code_verifier: pkce.verifier, grant_type: "authorization_code", redirect_uri: `http://127.0.0.1:${server.address().port}/`,
        }, request);
        if (!t.refresh_token) throw new Error("Google sent no refresh token");
        saveToken({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now() + t.expires_in * 1000, scope: t.scope }, file);
        finish(200, "Bot is signed in to Google Calendar. You can close this tab.");
        resolve({ scope: t.scope });
      } catch (error) {
        finish(500, "Sign-in failed, see the terminal.", error);
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/`;
      log("Open this URL in your browser and approve:\n");
      log(buildAuthUrl({ clientId: credentials.clientId, redirectUri, state, challenge: pkce.challenge }));
      log("\nWaiting for Google (5 minutes max)...");
    });
    setTimeout(() => { server.close(); reject(new Error("Timed out waiting for sign-in")); }, 5 * 60 * 1000).unref();
  });
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const credentials = loadCredentials();
  if (cmd === "login") {
    await login({ credentials });
    console.log("Signed in. Token saved in data/google-token.json");
  } else if (cmd === "list") {
    for (const e of await listEvents(args[0], { credentials })) console.log(`${e.start} -> ${e.end}  ${e.summary}`);
  } else if (cmd === "add") {
    const [summary, start, end] = args;
    console.log(await createEvent({ summary, start, end }, { credentials }));
  } else {
    console.log('Usage: node calendar.js login | list [YYYY-MM-DD] | add "title" 2026-10-29T15:00 2026-10-29T16:00');
  }
}

module.exports = { parseEnv, loadCredentials, makePkce, buildAuthUrl, getAccessToken, listEvents, createEvent, checkEventInput, login, SCOPE };

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
