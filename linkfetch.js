// linkfetch.js
// Download a file from a LINK the user typed, so it can be filed into a course (course-routes.js fileFetched, which uses the SAME
// checks as an upload: real first bytes, unzip.js limits, looksLikeText, judgeImage, no duplicates). This file only does the
// SAFE FETCHING and the plain-language errors. It never files anything and never calls a model.
//
// Where the URL comes from: ONLY the user's own words (extractUrls on his message) or the box on the course page. A model never
// chooses or rewrites a URL. What is downloaded is untrusted data, never instructions.
//
// What is enforced here, in code:
//   - https only, no user:password in the URL, port 443 only, no IP-address hosts, no localhost / .local / .internal names.
//   - EVERY connection (the first one and each redirect) resolves the name and refuses private, loopback, link-local and other
//     non-public addresses (SSRF), and connects to the address it checked (so the name cannot change between check and connect).
//   - at most 5 redirects; a GitHub link may only be redirected to GitHub hosts; each hop is checked again.
//   - size cap while streaming (200 MB for a zip, 50 MB for one file), total time limit, no cookies, no token, no credentials.
//   - a login page, a private repository or a web page instead of a file is reported plainly; Bot never tries to log in.
// GitHub: a repo link -> the repo zip (default branch from the public API, no token); a /blob/ link -> raw.githubusercontent.com.
// Any other https link the user typed is a direct link (a PDF, pptx, docx, txt, zip ...).

const https = require("node:https");
const dns = require("node:dns");
const net = require("node:net");
const { say } = require("./lang");
const { MAX_ZIP_BYTES, MAX_FILE_BYTES } = require("./unzip");
const { htmlBytesToText } = require("./html-text");

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 5 * 60 * 1000; // the whole download of one file (a 200 MB zip on a slow line)
const API_TIMEOUT_MS = 20 * 1000;
const MAX_API_BYTES = 256 * 1024; // the repo info (JSON) is small
const GITHUB_HOSTS = new Set(["github.com", "codeload.github.com", "raw.githubusercontent.com", "api.github.com"]);
const NAME = /^[A-Za-z0-9_.-]{1,100}$/; // an owner or repo name on GitHub
const BRANCH = /^[A-Za-z0-9._\/-]{1,100}$/;

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ---- addresses -----------------------------------------------------------------------------------------------------------------
// true only for a PUBLIC address. Everything else (private, loopback, link-local, carrier-grade NAT, multicast, reserved) is refused.
function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 shared address space
    if (a === 169 && b === 254) return false; // link-local (cloud metadata lives here)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false; // documentation ranges
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s); // an IPv4 address written inside IPv6
    if (mapped) return isPublicIp(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(s)) return false; // the hex form of the same: refuse rather than decode
    if (s === "::" || s === "::1") return false;
    const first = parseInt(s.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (s.startsWith("64:ff9b:") || s.startsWith("2001:db8") || s.startsWith("2002:")) return false; // NAT64, documentation, 6to4
    return true;
  }
  return false;
}

// A lookup function for https.request: resolves ALL addresses, refuses if any is not public, and connects to the one it checked.
function makeLookup(lookupAll = (host, cb) => dns.lookup(host, { all: true, verbatim: true }, cb)) {
  return (hostname, options, callback) => {
    if (typeof options === "function") callback = options;
    lookupAll(hostname, (error, addresses) => {
      if (error) return callback(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
      if (!list.length || list.some((a) => !isPublicIp(a.address))) return callback(fail("blocked", `"${hostname}" does not point to a public address`));
      if (options && options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

// ---- the URL itself ---------------------------------------------------------------------------------------------------------------
// Checks one URL BEFORE any connection. Returns the parsed URL or throws { code: "badurl" | "blocked" }.
function checkUrl(text) {
  let u;
  try { u = new URL(String(text)); } catch (error) { throw fail("badurl", "that is not a valid link"); }
  if (u.protocol !== "https:") throw fail("badurl", "only https links are allowed");
  if (u.username || u.password) throw fail("badurl", "a link with a user name or password is not allowed");
  if (u.port && u.port !== "443") throw fail("badurl", "only the normal https port is allowed");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) throw fail("blocked", "links to an address (an IP) are not allowed, only to a site name");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) throw fail("blocked", "that address is not a public site");
  return u;
}

// The https links in a message the user wrote (code, not a model). Trailing punctuation is not part of the link.
function extractUrls(text) {
  const found = String(text || "").match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const out = [];
  for (let url of found) {
    url = url.replace(/[)\].,;:!?،״׳'"]+$/u, "");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

const safeSegment = (s) => { try { return decodeURIComponent(s); } catch (error) { return s; } };
const isLoginPath = (p) => /^\/(?:login|signin|sign-in|sign_in|session|sso|auth|oauth|accounts?\/login)(?:\/|$)/i.test(p);

// What a link means. Returns { type, url, expectZip, name } (url = the address to download) or { type: "repo", owner, repo, branch|null, name }.
// The repo needs one more step (its default branch), done in fetchLink.
function classify(text) {
  const u = checkUrl(text);
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map(safeSegment);
  const lastName = (p) => p.length ? p[p.length - 1] : "";
  if (host === "github.com" || host === "www.github.com") {
    const [owner, repoRaw, kind, ...rest] = parts;
    const repo = String(repoRaw || "").replace(/\.git$/i, "");
    if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) throw fail("unsupported", "that GitHub link does not name a repository");
    if (!kind || kind === "tree") {
      // /tree/<branch>: the first segment is the branch (a branch name with a slash cannot be told apart from a folder here, so the default branch is used then)
      const branch = kind === "tree" && rest.length === 1 && BRANCH.test(rest[0]) && !rest[0].includes("..") ? rest[0] : null;
      return { type: "repo", owner, repo, branch, expectZip: true, name: `${repo}.zip` };
    }
    if (kind === "blob" || kind === "raw") {
      const [ref, ...path] = rest;
      if (!ref || !path.length || !BRANCH.test(ref) || ref.includes("..") || path.some((s) => s === ".." || s === "." || /[\u0000-\u001f]/.test(s))) throw fail("unsupported", "that GitHub link does not name a file");
      const enc = path.map(encodeURIComponent).join("/");
      return { type: "file", url: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${enc}`, expectZip: /\.zip$/i.test(lastName(path)), name: lastName(path), github: true };
    }
    throw fail("unsupported", "from GitHub I can download a repository (github.com/owner/repo) or one file (a /blob/ link)");
  }
  if (host === "raw.githubusercontent.com" || host === "codeload.github.com") {
    return { type: "file", url: u.toString(), expectZip: host === "codeload.github.com" || /\.zip$/i.test(lastName(parts)), name: host === "codeload.github.com" ? `${parts[1] || "repo"}.zip` : lastName(parts), github: true };
  }
  // any other https link the user typed himself: a direct link
  return { type: "file", url: u.toString(), expectZip: /\.zip$/i.test(lastName(parts)), name: lastName(parts) || host, github: false };
}

// ---- one HTTPS GET ----------------------------------------------------------------------------------------------------------------
// The real network call. Returns { status, headers, bytes }. Does NOT follow redirects (fetchChecked does, checking each hop).
// No cookies, no Authorization, no referrer; the body is read only up to maxBytes.
function httpGet(url, { maxBytes, timeoutMs = TIMEOUT_MS, lookup = makeLookup() } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      lookup,
      headers: { "User-Agent": "Bot-study-assistant", Accept: "*/*", "Accept-Encoding": "identity" }, // identity: the size we count is the size we keep
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode;
      const location = res.headers.location;
      if (status >= 300 && status < 400 || status >= 400) { res.resume(); return resolve({ status, headers: res.headers, bytes: Buffer.alloc(0), location }); } // the body of an error page is not needed
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); return reject(fail("toobig", "too big", { limit: maxBytes })); }
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) { reject(fail("toobig", "too big", { limit: maxBytes })); res.destroy(); req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on("error", (e) => reject(e.code ? e : fail("network", e.message)));
    });
    // a hard limit on the whole call (the socket timeout above only counts idle time)
    const timer = setTimeout(() => { reject(fail("timeout", "the download took too long")); req.destroy(); }, timeoutMs);
    req.on("timeout", () => { reject(fail("timeout", "the server did not answer in time")); req.destroy(); });
    req.on("error", (e) => reject(e.code === "blocked" || e.code === "toobig" ? e : fail("network", e.message)));
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

// GET with redirects checked hop by hop. `get` is injectable so the tests never touch the network.
// github: true -> a redirect may only go to GitHub hosts. Returns { status, headers, bytes, finalUrl }.
async function fetchChecked(startUrl, { get = httpGet, maxBytes, github = false, timeoutMs } = {}) {
  let current = checkUrl(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (github && !GITHUB_HOSTS.has(current.hostname.toLowerCase())) throw fail("blocked", "GitHub sent me to another site, which I do not follow");
    const r = await get(current.toString(), { maxBytes, ...(timeoutMs ? { timeoutMs } : {}) });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.location || (r.headers && r.headers.location);
      if (!loc) throw fail("network", "the server redirected without saying where");
      let next;
      try { next = new URL(loc, current); } catch (error) { throw fail("badurl", "the server sent a broken redirect"); }
      next = checkUrl(next.toString()); // https, no IP, no local names; the address itself is checked again at connect time
      if (isLoginPath(next.pathname)) throw fail("login", "the link leads to a login page");
      current = next;
      continue;
    }
    return { status: r.status, headers: r.headers || {}, bytes: r.bytes, finalUrl: current.toString() };
  }
  throw fail("redirects", "too many redirects");
}

// What a bad status means, in plain words (code), never trying to log in.
function statusError(status, headers, github) {
  if (status === 401) return fail("login", "the link needs a login");
  if (status === 403 && headers && String(headers["x-ratelimit-remaining"]) === "0") return fail("ratelimit", "GitHub is limiting requests right now");
  if (status === 403) return fail("login", "the link needs a login or is not allowed");
  if (status === 404 || status === 410) return fail(github ? "private" : "notfound", github ? "not found (or private)" : "not found");
  return fail("network", `the server answered ${status}`);
}

// The main function. `get` is injectable (tests). Returns { bytes, name, expectZip, source } or throws an error with a `code`.
async function fetchLink(link, { get = httpGet } = {}) {
  const c = classify(link);
  let target = c;
  if (c.type === "repo") {
    let branch = c.branch;
    if (!branch) { // the default branch from the public API (no token)
      let usedHead = false;
      try {
        const api = await fetchChecked(`https://api.github.com/repos/${c.owner}/${c.repo}`, { get, maxBytes: MAX_API_BYTES, github: true, timeoutMs: API_TIMEOUT_MS });
        if (api.status !== 200) throw statusError(api.status, api.headers, true);
        let info = null;
        try { info = JSON.parse(api.bytes.toString("utf8")); } catch (error) { /* checked below */ }
        branch = info && typeof info.default_branch === "string" && BRANCH.test(info.default_branch) && !info.default_branch.includes("..") ? info.default_branch : null;
        if (!branch) throw fail("network", "GitHub did not say which branch is the default");
      } catch (error) {
        if (error.code !== "ratelimit") throw error;
        usedHead = true; // the API limit is reached: HEAD is the default branch for the archive address
      }
      if (usedHead) branch = "HEAD";
    }
    const ref = branch === "HEAD" ? "HEAD" : `refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
    target = { type: "file", url: `https://codeload.github.com/${c.owner}/${c.repo}/zip/${ref}`, expectZip: true, name: `${c.repo}-${branch.replace(/\//g, "-")}.zip`, github: true };
  }
  const maxBytes = target.expectZip ? MAX_ZIP_BYTES : MAX_FILE_BYTES;
  const r = await fetchChecked(target.url, { get, maxBytes, github: target.github });
  if (r.status !== 200) throw statusError(r.status, r.headers, target.github);
  if (!r.bytes.length) throw fail("empty", "the file is empty");
  const type = String((r.headers && r.headers["content-type"]) || "").toLowerCase();
  // A web page where a file was expected is a login page, a "file not found" page or a landing page: never filed as notes.
  if (type.includes("text/html") && !/\.html?$/i.test(target.name)) throw fail("webpage", "that link is a web page, not a file");
  const host = new URL(r.finalUrl).hostname;
  return { bytes: r.bytes, name: target.name, expectZip: target.expectZip, source: host, repo: c.type === "repo" ? `${c.owner}/${c.repo}` : null };
}

// ---- LOOK: read a page, save nothing ------------------------------------------------------------------------------------------------
// The same safe fetching, but the result is TEXT for the user (or for a model as untrusted data), never a file in a course.
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_CHARS = 60000;
const noControl = (t) => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ");
async function fetchPage(link, { get = httpGet } = {}) {
  const c = classify(link);
  // a repo is "looked at" through its README
  const url = c.type === "repo" ? `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch ? encodeURIComponent(c.branch) : "HEAD"}/README.md` : c.url;
  const github = c.type === "repo" ? true : c.github;
  const r = await fetchChecked(url, { get, maxBytes: MAX_PAGE_BYTES, github });
  if (r.status !== 200) throw statusError(r.status, r.headers, github);
  const b = r.bytes;
  if (!b.length) throw fail("empty", "the page is empty");
  const type = String((r.headers && r.headers["content-type"]) || "").toLowerCase();
  const binary = b.subarray(0, 5).toString("latin1") === "%PDF-" || (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 4096).includes(0);
  if (binary || /^(?:image|audio|video)\//.test(type)) throw fail("notpage", "that link is a file, not a page");
  let text;
  let title = "";
  if (/html/.test(type) || /^\s*<(?:!doctype|html|head|body)/i.test(b.subarray(0, 600).toString("utf8"))) {
    text = htmlBytesToText(b);
    if (text === null) throw fail("notpage", "that link is a file, not a page");
    const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(b.subarray(0, 200000).toString("utf8"));
    title = m ? m[1].replace(/\s+/g, " ").trim() : "";
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch (error) { throw fail("notpage", "that link is a file, not a page"); }
  }
  text = noControl(text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw fail("empty", "the page has no readable text");
  if (!title) title = (text.split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim().slice(0, 100);
  return { text: text.slice(0, MAX_PAGE_CHARS), title: noControl(title).slice(0, 120), source: new URL(r.finalUrl).hostname, url: r.finalUrl, cut: text.length > MAX_PAGE_CHARS };
}

// Many addresses from a text (the text of a file): https only, no repeats, at most `max`. http links are counted, never used.
const MAX_BATCH = 50;
function httpsUrls(text, max = MAX_BATCH) {
  const urls = [];
  let notHttps = 0;
  let more = 0;
  for (const u of extractUrls(text)) {
    if (!/^https:\/\//i.test(u)) { notHttps++; continue; }
    if (urls.length >= max) { more++; continue; }
    urls.push(u);
  }
  return { urls, notHttps, more };
}

// ---- the words for the user, in the language of his message ---------------------------------------------------------------------------
function explain(lang, error) {
  const code = error && error.code;
  const T = {
    badurl: ["That link cannot be used: only normal https links are allowed.", "אי אפשר להשתמש בקישור הזה: רק קישורי https רגילים מותרים."],
    blocked: ["I will not open that link: it points to a private or non-public address.", "לא אפתח את הקישור הזה: הוא מצביע לכתובת פרטית או לא ציבורית."],
    unsupported: [`${error && error.message ? error.message : "I do not know that kind of link"}.`, "מגיטהאב אני יכול להוריד מאגר שלם (github.com/owner/repo) או קובץ אחד (קישור /blob/)."],
    private: ["I could not find that on GitHub. If the repository is private, I cannot download it: I never log in. Make it public, or download the zip yourself and upload it here.", "לא מצאתי את זה בגיטהאב. אם המאגר פרטי אני לא יכול להוריד אותו: אני אף פעם לא מתחבר לחשבון. אפשר להפוך אותו לציבורי, או להוריד את ה-zip בעצמך ולהעלות אותו כאן."],
    notfound: ["That link gives \"not found\".", "הקישור מחזיר \"לא נמצא\"."],
    login: ["That link needs a login (or is private). I do not log in anywhere. Download the file yourself and upload it here.", "הקישור דורש התחברות (או שהוא פרטי). אני לא מתחבר לשום מקום. אפשר להוריד את הקובץ בעצמך ולהעלות אותו כאן."],
    ratelimit: ["GitHub is limiting requests right now. Try again in a few minutes.", "גיטהאב מגבילה בקשות כרגע. אפשר לנסות שוב בעוד כמה דקות."],
    toobig: [`That is too big (${Math.round((error && error.limit ? error.limit : MAX_ZIP_BYTES) / 1048576)} MB at most for this kind of download).`, `זה גדול מדי (עד ${Math.round((error && error.limit ? error.limit : MAX_ZIP_BYTES) / 1048576)} מגה-בייט להורדה כזו).`],
    timeout: ["The download took too long, so I stopped it.", "ההורדה לקחה יותר מדי זמן ועצרתי אותה."],
    redirects: ["The link bounces between too many addresses, so I stopped.", "הקישור מפנה בין יותר מדי כתובות ולכן עצרתי."],
    webpage: ["That link is a web page, not a file (it may be a login page). I only download files.", "הקישור הזה הוא דף אינטרנט ולא קובץ (אולי דף התחברות). אני מוריד רק קבצים."],
    empty: ["The file at that link is empty.", "הקובץ בקישור ריק."],
    notpage: ["That link is a file, not a page I can read. Say \"download\" if you want it saved in a course.", "הקישור הזה הוא קובץ ולא דף שאפשר לקרוא. אם רוצים לשמור אותו בקורס, כתבו \"תוריד\"."],
    network: ["I could not download it: the server did not answer properly.", "לא הצלחתי להוריד: השרת לא ענה כראוי."],
  };
  const row = T[code] || T.network;
  return say(lang, row[0], row[1]);
}

module.exports = { fetchPage, httpsUrls, MAX_BATCH, MAX_PAGE_BYTES, fetchLink, fetchChecked, classify, checkUrl, extractUrls, isPublicIp, makeLookup, httpGet, explain, MAX_REDIRECTS, GITHUB_HOSTS };
