// moodle.js
// READ-ONLY access to BGU Moodle (https://moodle.bgu.ac.il/moodle/) with Omri's own username and password from .env
// (MOODLE_USER, MOODLE_PASS), or a MoodleSession cookie he pasted (MOODLE_COOKIE). Node built-ins only.
//
// What is enforced here, in code (tests/moodle.test.js):
//   - ONE host only (moodle.bgu.ac.il), https only. A redirect to any other host is never followed: it is reported (that would be
//     a single sign-on site, and the password is never sent anywhere but Moodle's own login form).
//   - an ALLOWLIST of paths (READ_PATHS) for GET, and exactly two POSTs: the login form, and /lib/ajax/service.php with method
//     names from READ_METHODS only. Nothing here can submit an assignment, post to a forum, change a setting or mark anything.
//     A GET whose address carries a sesskey is refused too (in Moodle that is how actions are made).
//   - one request at a time with a short pause between them, a clear User-Agent, a byte cap on every answer, a time limit.
//   - the session lives in memory only; when Moodle says the session ended, Bot logs in once more and repeats the request once.
//   - the password and the cookie are never logged or returned.
// Everything Moodle sends back (pages, file names, announcements) is untrusted DATA, never instructions.

const https = require("node:https");
const fs = require("node:fs");

const HOST = "moodle.bgu.ac.il";
const ROOT = "/moodle";
const USER_AGENT = "Bot-study-assistant (read-only, personal use)";
const PAUSE_MS = 600;
const TIMEOUT_MS = 30 * 1000;
const FILE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 6;

// GET paths Bot may open (after /moodle). Everything else is refused before any connection.
const READ_PATHS = [
  /^\/$/,
  /^\/index\.php$/,
  /^\/login\/index\.php$/,
  /^\/my\/(?:index\.php|courses\.php)?$/,
  /^\/course\/view\.php$/,
  /^\/course\/resources\.php$/,
  /^\/mod\/(?:resource|folder|url|page|forum|assign|label|book)\/view\.php$/,
  /^\/mod\/forum\/discuss\.php$/,
  /^\/pluginfile\.php\/[^?#]+$/,
  /^\/blocks\/video\/viewvideo\.php$/,
];
// The ajax methods Bot may call. All of them only READ. (Moodle's ajax also has methods that write; none is here.)
const READ_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_courseformat_get_state",
  "core_calendar_get_action_events_by_timesort",
  "core_course_get_contents",
  "mod_forum_get_discussion_posts",
  "mod_forum_get_forum_discussions",
]);

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the read-only guard ----------------------------------------------------------------------------------------------------------
// Returns the parsed URL or throws { code: "refused" }. `post` is "login" or "ajax" for the only two POSTs allowed.
function checkRequest(method, url, { ajaxMethods = [] } = {}) {
  let u;
  try { u = new URL(url); } catch (error) { throw fail("refused", "not a valid address"); }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== HOST || (u.port && u.port !== "443") || u.username || u.password) throw fail("refused", "only Moodle's own https address is allowed");
  if (!u.pathname.startsWith(ROOT + "/") && u.pathname !== ROOT) throw fail("refused", "outside Moodle");
  const rest = u.pathname.slice(ROOT.length) || "/";
  if (/(^|\/)\.\.?(\/|$)/.test(rest) || /%2e|%2f|%5c/i.test(rest)) throw fail("refused", "a strange path");
  if (method === "GET") {
    if (!READ_PATHS.some((re) => re.test(rest))) throw fail("refused", `Bot may not open ${rest} (read-only list)`);
    if (u.searchParams.has("sesskey")) throw fail("refused", "an address with a sesskey is an action, not a read");
    return u;
  }
  if (method === "POST" && rest === "/login/index.php" && !u.search) return u;
  if (method === "POST" && rest === "/lib/ajax/service.php") {
    if (!ajaxMethods.length) throw fail("refused", "an ajax call must name its methods");
    for (const m of ajaxMethods) if (!READ_METHODS.has(m)) throw fail("refused", `the ajax method ${m} is not on the read-only list`);
    return u;
  }
  throw fail("refused", `${method} ${rest} is not allowed (read-only)`);
}

// ---- a tiny cookie jar (one host) --------------------------------------------------------------------------------------------------
function createJar() {
  const jar = new Map();
  return {
    take(setCookie) {
      for (const line of [].concat(setCookie || [])) {
        const [pair, ...attrs] = String(line).split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const gone = attrs.some((a) => /^\s*max-age\s*=\s*(-\d+|0)\s*$/i.test(a)) || attrs.some((a) => {
          const m = /^\s*expires\s*=\s*(.+)$/i.exec(a);
          return m && Date.parse(m[1]) < Date.now();
        }) || value === "deleted";
        if (gone) jar.delete(name); else jar.set(name, value);
      }
    },
    header() { return [...jar].map(([k, v]) => `${k}=${v}`).join("; "); },
    set(name, value) { jar.set(name, value); },
    clear() { jar.clear(); },
    has(name) { return jar.has(name); },
  };
}

// ---- one HTTPS request (the real network) ------------------------------------------------------------------------------------------
// Returns { status, headers, bytes }. Never follows redirects (the caller does, checking each hop).
function httpsSend({ method, url, headers, body, maxBytes = MAX_PAGE_BYTES, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); return reject(fail("toobig", "too big", { limit: maxBytes })); }
      const chunks = [];
      let total = 0;
      res.on("data", (c) => {
        total += c.length;
        if (total > maxBytes) { reject(fail("toobig", "too big", { limit: maxBytes })); res.destroy(); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on("error", (e) => reject(fail("network", e.message)));
    });
    const timer = setTimeout(() => { reject(fail("timeout", "Moodle took too long")); req.destroy(); }, timeoutMs);
    req.on("timeout", () => { reject(fail("timeout", "Moodle did not answer in time")); req.destroy(); });
    req.on("error", (e) => reject(e.code === "toobig" ? e : fail("network", e.message)));
    req.on("close", () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}

// ---- reading login pages (small, careful patterns) --------------------------------------------------------------------------------
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
};
function findLoginToken(html) {
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) if (attr(tag, "name") === "logintoken") return attr(tag, "value") || "";
  return null;
}
function findSesskey(html) {
  const m = /"sesskey"\s*:\s*"([A-Za-z0-9]{5,40})"/.exec(html) || /[?&]sesskey=([A-Za-z0-9]{5,40})/.exec(html);
  return m ? m[1] : null;
}
const looksLoggedIn = (html) => !!findSesskey(html) && /login\/logout\.php/.test(html);
// What the login page looks like, without guessing: a form with a username and a password field, where it posts to, a CAPTCHA
// marker, links to other sign-in sites (identity providers).
function describeLoginPage(html, pageUrl) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find((f) => /name\s*=\s*["']password["']/i.test(f)) || null;
  let formHost = null;
  if (form) {
    const action = attr(/<form\b[^>]*>/i.exec(form)[0], "action");
    try { formHost = new URL(action ? action.replace(/&amp;/g, "&") : pageUrl, pageUrl).hostname; } catch (error) { formHost = "?"; }
  }
  const idpHosts = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const near = html.slice(Math.max(0, m.index - 400), m.index);
    if (!/potentialidp|login-identityprovider|auth\/(?:saml2|oidc|oauth2|shibboleth|cas)/i.test(near + m[1])) continue;
    try { idpHosts.add(new URL(m[1].replace(/&amp;/g, "&"), pageUrl).hostname); } catch (error) { /* skip */ }
  }
  return {
    hasPasswordForm: !!form,
    hasUsernameField: !!form && /name\s*=\s*["']username["']/i.test(form),
    formHost,
    hasLoginToken: findLoginToken(html) !== null,
    captcha: /g-recaptcha|h-captcha|hcaptcha|recaptcha|cf-turnstile|captcha/i.test(html),
    identityProviders: [...idpHosts],
    errorShown: /loginerrormessage|alert-danger|id\s*=\s*["']loginerrormessage/i.test(html),
  };
}

// ---- the session -------------------------------------------------------------------------------------------------------------------
// createMoodle({ user, pass, cookie, send, pauseMs }) -> { login, page, ajax, file, state }. `send` is injectable (tests: a fake Moodle).
function createMoodle({ user = "", pass = "", cookie = "", send = httpsSend, pauseMs = PAUSE_MS, now = () => Date.now() } = {}) {
  const jar = createJar();
  let sesskey = null;
  let loggedIn = false;
  let queue = Promise.resolve();
  let lastAt = 0;
  const hostsSeen = [];
  if (cookie) jar.set("MoodleSession", String(cookie).trim());

  // one request at a time, a short pause between requests
  const serial = (fn) => {
    const run = queue.then(async () => {
      const wait = lastAt + pauseMs - now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { lastAt = now(); }
    });
    queue = run.catch(() => {});
    return run;
  };

  // One request with redirects followed (GET only after the first hop). Every hop goes through checkRequest. A hop to another
  // host is NOT followed: it is returned as { offsite: host } so the caller can say what it saw.
  async function request(method, url, { body, contentType, ajaxMethods, maxBytes, timeoutMs } = {}) {
    let current = checkRequest(method, url, { ajaxMethods });
    let m = method;
    let b = body;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!hostsSeen.includes(current.hostname)) hostsSeen.push(current.hostname);
      const headers = { "User-Agent": USER_AGENT, Accept: m === "POST" && ajaxMethods ? "application/json" : "*/*", "Accept-Encoding": "identity" };
      const c = jar.header();
      if (c) headers.Cookie = c;
      if (b !== undefined) { headers["Content-Type"] = contentType; headers["Content-Length"] = Buffer.byteLength(b); }
      const r = await serial(() => send({ method: m, url: current.toString(), headers, body: b, maxBytes, timeoutMs }));
      jar.take(r.headers && r.headers["set-cookie"]);
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers && r.headers.location;
        if (!loc) throw fail("network", "Moodle redirected without saying where");
        let next;
        try { next = new URL(loc, current); } catch (error) { throw fail("network", "a broken redirect"); }
        if (next.hostname.toLowerCase() !== HOST) {
          if (!hostsSeen.includes(next.hostname)) hostsSeen.push(next.hostname);
          return { status: r.status, offsite: next.hostname, finalUrl: next.toString(), bytes: Buffer.alloc(0), headers: r.headers || {} };
        }
        current = checkRequest("GET", next.toString());
        m = "GET"; b = undefined; // a redirect after a POST is a GET
        continue;
      }
      return { status: r.status, headers: r.headers || {}, bytes: r.bytes || Buffer.alloc(0), finalUrl: current.toString() };
    }
    throw fail("network", "too many redirects");
  }

  const isLoginUrl = (u) => /\/login\/index\.php/.test(new URL(u).pathname);

  // Log in with the form. Returns a report (no secrets): { ok, hosts, reason, page }.
  async function login() {
    loggedIn = false; sesskey = null;
    if (cookie) { // a pasted session: just check it
      const r = await request("GET", `https://${HOST}${ROOT}/my/`);
      const html = r.bytes.toString("utf8");
      if (!r.offsite && looksLoggedIn(html)) { loggedIn = true; sesskey = findSesskey(html); return { ok: true, hosts: [...hostsSeen], via: "cookie" }; }
      return { ok: false, hosts: [...hostsSeen], reason: "cookie-expired" };
    }
    if (!user || !pass) return { ok: false, hosts: [...hostsSeen], reason: "no-credentials" };
    jar.clear();
    const first = await request("GET", `https://${HOST}${ROOT}/login/index.php`);
    if (first.offsite) return { ok: false, hosts: [...hostsSeen], reason: "sso", offsite: first.offsite };
    const html = first.bytes.toString("utf8");
    const page = describeLoginPage(html, first.finalUrl);
    if (first.status !== 200) return { ok: false, hosts: [...hostsSeen], reason: `status-${first.status}`, page };
    if (!page.hasPasswordForm || !page.hasUsernameField) return { ok: false, hosts: [...hostsSeen], reason: "no-form", page };
    if (page.formHost && page.formHost !== HOST) return { ok: false, hosts: [...hostsSeen], reason: "sso", offsite: page.formHost, page };
    if (page.captcha) return { ok: false, hosts: [...hostsSeen], reason: "captcha", page };
    const token = findLoginToken(html);
    const form = new URLSearchParams({ anchor: "", ...(token !== null ? { logintoken: token } : {}), username: user, password: pass });
    const r = await request("POST", `https://${HOST}${ROOT}/login/index.php`, { body: form.toString(), contentType: "application/x-www-form-urlencoded" });
    if (r.offsite) return { ok: false, hosts: [...hostsSeen], reason: "sso", offsite: r.offsite };
    let out = r.bytes.toString("utf8");
    if (!looksLoggedIn(out)) { // some setups land on a page without the logout link; the dashboard tells
      if (isLoginUrl(r.finalUrl)) {
        const p = describeLoginPage(out, r.finalUrl);
        return { ok: false, hosts: [...hostsSeen], reason: p.captcha ? "captcha" : "wrong-password-or-blocked", page: p };
      }
      const my = await request("GET", `https://${HOST}${ROOT}/my/`);
      out = my.bytes.toString("utf8");
      if (my.offsite || !looksLoggedIn(out)) return { ok: false, hosts: [...hostsSeen], reason: "not-logged-in-after-form", finalPath: new URL(my.finalUrl).pathname };
    }
    loggedIn = true;
    sesskey = findSesskey(out);
    return { ok: true, hosts: [...hostsSeen], via: "password" };
  }

  async function ensure() {
    if (loggedIn && sesskey) return;
    const r = await login();
    if (!r.ok) throw fail("login", `Moodle login failed (${r.reason})`, { report: r });
  }

  // A page (HTML text). If Moodle sends us to the login page, the session ended: log in again and try once more.
  async function page(pathAndQuery) {
    await ensure();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await request("GET", `https://${HOST}${ROOT}${pathAndQuery}`);
      if (!r.offsite && !isLoginUrl(r.finalUrl) && r.status === 200) {
        const html = r.bytes.toString("utf8");
        const k = findSesskey(html);
        if (k) sesskey = k;
        return { html, url: r.finalUrl, headers: r.headers };
      }
      if (r.status === 404) throw fail("notfound", "Moodle says not found");
      if (r.status === 403) throw fail("forbidden", "Moodle says this is not allowed for you");
      if (attempt === 0) { loggedIn = false; await ensure(); continue; }
      throw fail("login", "Moodle keeps sending me to the login page");
    }
  }

  // One or more read-only ajax calls. Returns the list of `data` values. An expired session -> log in again, once.
  async function ajax(calls) {
    const list = [].concat(calls);
    const names = list.map((c) => c.methodname);
    await ensure();
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = `https://${HOST}${ROOT}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(names.join(","))}`;
      const body = JSON.stringify(list.map((c, i) => ({ index: i, methodname: c.methodname, args: c.args || {} })));
      const r = await request("POST", url, { body, contentType: "application/json", ajaxMethods: names });
      let data = null;
      try { data = JSON.parse(r.bytes.toString("utf8")); } catch (error) { /* checked below */ }
      const expired = (d) => d && d.error && /servicerequireslogin|invalidsesskey|requirelogin/i.test(String(d.errorcode || (d.exception && d.exception.errorcode) || ""));
      if (Array.isArray(data) && !data.some(expired)) {
        return data.map((d) => {
          if (d.error) throw fail("moodle", `Moodle refused ${names.join(",")}: ${String((d.exception && d.exception.message) || d.errorcode || "error").slice(0, 200)}`);
          return d.data;
        });
      }
      if (data && !Array.isArray(data) && data.error && !expired(data)) throw fail("moodle", `Moodle refused: ${String(data.errorcode || data.error).slice(0, 200)}`);
      if (attempt === 0) { loggedIn = false; await ensure(); continue; }
      throw fail("login", "Moodle keeps ending the session");
    }
  }

  // A file (bytes). Only pluginfile.php addresses. Returns { bytes, name, type }.
  async function file(url, { maxBytes, timeoutMs = FILE_TIMEOUT_MS } = {}) {
    await ensure();
    checkRequest("GET", url);
    if (!/^\/moodle\/pluginfile\.php\//.test(new URL(url).pathname)) throw fail("refused", "only Moodle files (pluginfile.php) are downloaded");
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await request("GET", url, { maxBytes, timeoutMs });
      if (!r.offsite && !isLoginUrl(r.finalUrl) && r.status === 200) {
        const type = String(r.headers["content-type"] || "").toLowerCase();
        const disp = String(r.headers["content-disposition"] || "");
        const dm = /filename\*=UTF-8''([^;]+)/i.exec(disp) || /filename="([^"]+)"/i.exec(disp);
        let name = dm ? dm[1] : decodeURIComponent(new URL(r.finalUrl).pathname.split("/").pop() || "file");
        try { name = decodeURIComponent(name); } catch (error) { /* keep */ }
        return { bytes: r.bytes, name, type };
      }
      if (r.status === 404) throw fail("notfound", "Moodle says that file is not there");
      if (r.status === 403) throw fail("forbidden", "Moodle does not let you open that file");
      if (attempt === 0) { loggedIn = false; await ensure(); continue; }
      throw fail("login", "Moodle keeps sending me to the login page");
    }
  }

  return { login, page, ajax, file, ensure, state: () => ({ loggedIn, hasSesskey: !!sesskey, hosts: [...hostsSeen] }) };
}

// The settings from .env (never printed). MOODLE_COOKIE wins over the password when both are set.
function loadMoodleConfig(envFile, env = process.env) {
  let file = {};
  try { file = require("./auth").parseEnv(fs.readFileSync(envFile, "utf8")); } catch (error) { /* no .env */ }
  const pick = (k) => String(env[k] !== undefined && env[k] !== "" ? env[k] : file[k] || "").trim();
  const user = pick("MOODLE_USER");
  const pass = String(env.MOODLE_PASS || file.MOODLE_PASS || ""); // a password may have spaces at the ends: kept as typed
  const cookie = pick("MOODLE_COOKIE");
  if (!cookie && (!user || !pass)) return { enabled: false, reason: "MOODLE_USER and MOODLE_PASS (or MOODLE_COOKIE) are not set in .env" };
  return { enabled: true, user, pass, cookie };
}

module.exports = {
  createMoodle, loadMoodleConfig, checkRequest, createJar, describeLoginPage, findLoginToken, findSesskey, looksLoggedIn, httpsSend,
  HOST, ROOT, READ_PATHS, READ_METHODS, USER_AGENT, PAUSE_MS, MAX_PAGE_BYTES,
};
