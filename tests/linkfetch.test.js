// linkfetch.test.js
// Download from a link (linkfetch.js): the safety rules, the GitHub link shapes, the filing into a course, and the chat road.
// NO real network: the fetch is a fake `get` function (and a fake DNS for the address check). Made-up files, temporary folders only.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fetchLink, fetchChecked, classify, checkUrl, extractUrls, isPublicIp, makeLookup, explain, MAX_REDIRECTS } = require("../linkfetch");
const { createCourses } = require("../courses");
const { createStore } = require("../store");
const { createServer } = require("../server");
const { createCourseRoutes } = require("../course-routes");
const { ingestFile } = require("../ingest");
const { askCourse } = require("../study");
const { handleTask } = require("../core");
const { validateDecision, STUDY_INTENTS } = require("../frontdesk");
const { makeZip } = require("./testzip");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-link-"));
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("made-up pdf text ".repeat(6))]);
const ok = (bytes, headers = {}) => ({ status: 200, headers: { "content-type": "application/octet-stream", ...headers }, bytes });
const redirect = (location) => ({ status: 302, headers: {}, location, bytes: Buffer.alloc(0) });
// A fake network: a table of url -> response. Remembers every address it was asked for.
function net(table) {
  const asked = [];
  const get = async (url) => { asked.push(url); const r = table[url]; if (!r) return { status: 404, headers: {}, bytes: Buffer.alloc(0) }; return typeof r === "function" ? r(url) : r; };
  return { get, asked };
}
const code = (p) => p.then(() => { throw new Error("should have failed"); }, (e) => e.code);

test("only public addresses pass the address check (SSRF)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "ff02::1"]) assert.strictEqual(isPublicIp(ip), false, ip);
  for (const ip of ["140.82.121.3", "185.199.108.133", "8.8.8.8", "172.32.0.1", "2606:50c0:8000::154"]) assert.strictEqual(isPublicIp(ip), true, ip);
  assert.strictEqual(isPublicIp("not an ip"), false);
});

test("the connection lookup refuses a name that resolves to a private address (even if one of several is public)", async () => {
  const run = (answer) => new Promise((resolve) => makeLookup((host, cb) => cb(null, answer))("example.org", { all: true }, (e, list) => resolve({ e, list })));
  assert.strictEqual((await run([{ address: "127.0.0.1", family: 4 }])).e.code, "blocked");
  assert.strictEqual((await run([{ address: "140.82.121.3", family: 4 }, { address: "10.0.0.5", family: 4 }])).e.code, "blocked");
  assert.strictEqual((await run([{ address: "169.254.169.254", family: 4 }])).e.code, "blocked");
  const good = await run([{ address: "140.82.121.3", family: 4 }]);
  assert.strictEqual(good.e, null);
  assert.strictEqual(good.list[0].address, "140.82.121.3");
});

test("checkUrl: https only, no password, no odd port, no IP address, no local names", () => {
  assert.ok(checkUrl("https://github.com/a/b"));
  for (const bad of ["http://github.com/a/b", "ftp://x.org/f", "file:///etc/passwd", "https://user:pw@example.org/f", "https://example.org:8443/f", "https://127.0.0.1/f", "https://[::1]/f", "https://2130706433/f", "https://localhost/f", "https://printer.local/f", "https://intranet/f", "https://metadata.internal/f", "not a url"]) {
    assert.throws(() => checkUrl(bad), (e) => e.code === "badurl" || e.code === "blocked", bad);
  }
});

test("extractUrls takes the link from the user's words and drops trailing punctuation", () => {
  assert.deepStrictEqual(extractUrls("please download (https://github.com/o/r), thanks."), ["https://github.com/o/r"]);
  assert.deepStrictEqual(extractUrls("תוריד את https://example.org/a.pdf. ותוסיף"), ["https://example.org/a.pdf"]);
  assert.deepStrictEqual(extractUrls("no link here"), []);
  assert.deepStrictEqual(extractUrls("https://a.org/x https://a.org/x https://b.org/y"), ["https://a.org/x", "https://b.org/y"]);
});

test("classify: repo, tree, blob, raw, codeload and direct links", () => {
  assert.deepStrictEqual(classify("https://github.com/octocat/Hello-World"), { type: "repo", owner: "octocat", repo: "Hello-World", branch: null, expectZip: true, name: "Hello-World.zip" });
  assert.strictEqual(classify("https://github.com/octocat/Hello-World.git").repo, "Hello-World");
  assert.strictEqual(classify("https://github.com/octocat/Hello-World/tree/dev").branch, "dev");
  const blob = classify("https://github.com/octocat/Hello-World/blob/master/src/main.c");
  assert.strictEqual(blob.url, "https://raw.githubusercontent.com/octocat/Hello-World/master/src/main.c");
  assert.strictEqual(blob.name, "main.c");
  assert.strictEqual(classify("https://raw.githubusercontent.com/o/r/main/README.md").github, true);
  assert.strictEqual(classify("https://codeload.github.com/o/r/zip/refs/heads/main").expectZip, true);
  const direct = classify("https://cs.example.edu/course/slides%20week1.pdf");
  assert.strictEqual(direct.github, false);
  assert.strictEqual(direct.name, "slides week1.pdf");
  assert.strictEqual(classify("https://example.edu/files/code.zip").expectZip, true);
  assert.throws(() => classify("https://github.com/octocat"), (e) => e.code === "unsupported");
  assert.throws(() => classify("https://github.com/octocat/Hello-World/issues/1"), (e) => e.code === "unsupported");
  assert.throws(() => classify("https://github.com/o/r/blob/main/../../etc/passwd"), (e) => e.code === "unsupported");
});

test("a redirect to a private address, to http, or to a local name is refused; the private address is never asked", async () => {
  for (const target of ["https://127.0.0.1/secret", "http://example.org/x", "https://localhost/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x"]) {
    const n = net({ "https://example.edu/a.pdf": redirect(target) });
    const c = await code(fetchChecked("https://example.edu/a.pdf", { get: n.get, maxBytes: 1000 }));
    assert.ok(c === "blocked" || c === "badurl", target);
    assert.deepStrictEqual(n.asked, ["https://example.edu/a.pdf"], "only the first address is ever requested");
  }
});

test("a GitHub link cannot be redirected to another site; too many redirects stop; a relative redirect works", async () => {
  const n = net({ "https://raw.githubusercontent.com/o/r/m/f.txt": redirect("https://evil.example.org/f.txt") });
  assert.strictEqual(await code(fetchChecked("https://raw.githubusercontent.com/o/r/m/f.txt", { get: n.get, maxBytes: 10, github: true })), "blocked");
  const loop = net({ "https://a.example.org/x": redirect("/x") });
  assert.strictEqual(await code(fetchChecked("https://a.example.org/x", { get: loop.get, maxBytes: 10 })), "redirects");
  assert.strictEqual(loop.asked.length, MAX_REDIRECTS + 1);
  const rel = net({ "https://a.example.org/x": redirect("/y"), "https://a.example.org/y": ok(Buffer.from("hi")) });
  assert.strictEqual((await fetchChecked("https://a.example.org/x", { get: rel.get, maxBytes: 10 })).bytes.toString(), "hi");
});

test("a redirect to a login page is reported as a login, and nothing is sent to it", async () => {
  const n = net({ "https://raw.githubusercontent.com/o/r/main/f.txt": redirect("https://github.com/login?return_to=x") });
  assert.strictEqual(await code(fetchLink("https://github.com/o/r/blob/main/f.txt", { get: n.get })), "login");
  assert.ok(n.asked.every((u) => !u.includes("/login")));
});

test("a GitHub repo: default branch from the API, then the codeload zip", async () => {
  const zip = makeZip({ "r-main/a.txt": "hello" });
  const n = net({
    "https://api.github.com/repos/octocat/Hello-World": ok(Buffer.from(JSON.stringify({ default_branch: "trunk" })), { "content-type": "application/json" }),
    "https://codeload.github.com/octocat/Hello-World/zip/refs/heads/trunk": ok(zip, { "content-type": "application/zip" }),
  });
  const got = await fetchLink("https://github.com/octocat/Hello-World", { get: n.get });
  assert.deepStrictEqual(n.asked, ["https://api.github.com/repos/octocat/Hello-World", "https://codeload.github.com/octocat/Hello-World/zip/refs/heads/trunk"]);
  assert.strictEqual(got.name, "Hello-World-trunk.zip");
  assert.strictEqual(got.expectZip, true);
  assert.strictEqual(got.repo, "octocat/Hello-World");
  assert.ok(got.bytes.equals(zip));
});

test("a /tree/<branch> link skips the API; a /blob/ link goes to raw.githubusercontent.com", async () => {
  const n = net({ "https://codeload.github.com/o/r/zip/refs/heads/dev": ok(Buffer.from("PK"), {}), "https://raw.githubusercontent.com/o/r/main/src/a.c": ok(Buffer.from("int x;\n")) });
  await fetchLink("https://github.com/o/r/tree/dev", { get: n.get });
  const f = await fetchLink("https://github.com/o/r/blob/main/src/a.c", { get: n.get });
  assert.deepStrictEqual(n.asked, ["https://codeload.github.com/o/r/zip/refs/heads/dev", "https://raw.githubusercontent.com/o/r/main/src/a.c"]);
  assert.strictEqual(f.name, "a.c");
});

test("private or missing repo: said plainly; the API rate limit falls back to the HEAD archive; no token is ever sent", async () => {
  const gone = net({ "https://api.github.com/repos/o/secret": { status: 404, headers: {}, bytes: Buffer.alloc(0) } });
  const e = await fetchLink("https://github.com/o/secret", { get: gone.get }).catch((x) => x);
  assert.strictEqual(e.code, "private");
  assert.match(explain("en", e), /private.*never log in/);
  assert.match(explain("he", e), /פרטי/);
  const limited = net({ "https://api.github.com/repos/o/r": { status: 403, headers: { "x-ratelimit-remaining": "0" }, bytes: Buffer.alloc(0) }, "https://codeload.github.com/o/r/zip/HEAD": ok(Buffer.from("PK")) });
  const got = await fetchLink("https://github.com/o/r", { get: limited.get });
  assert.strictEqual(got.name, "r-HEAD.zip");
  assert.strictEqual(await code(fetchLink("https://example.edu/x.pdf", { get: net({ "https://example.edu/x.pdf": { status: 401, headers: {}, bytes: Buffer.alloc(0) } }).get })), "login");
});

test("a web page where a file was expected is refused (a login or error page is never filed as notes); too big is refused", async () => {
  const page = net({ "https://example.edu/notes.pdf": ok(Buffer.from("<html>please sign in</html>"), { "content-type": "text/html; charset=utf-8" }) });
  assert.strictEqual(await code(fetchLink("https://example.edu/notes.pdf", { get: page.get })), "webpage");
  const big = net({ "https://example.edu/a.pdf": () => { throw Object.assign(new Error("too big"), { code: "toobig", limit: 52428800 }); } });
  const e = await fetchLink("https://example.edu/a.pdf", { get: big.get }).catch((x) => x);
  assert.strictEqual(e.code, "toobig");
  assert.match(explain("en", e), /50 MB/);
});

test("the limits passed to the network call: 200 MB for a zip, 50 MB for one file", async () => {
  const limits = [];
  const get = async (url, o) => { limits.push(o.maxBytes); return ok(PDF); };
  await fetchLink("https://example.edu/a.pdf", { get });
  await fetchLink("https://example.edu/a.zip", { get });
  assert.deepStrictEqual(limits, [50 * 1024 * 1024, 200 * 1024 * 1024]);
});

// ---- filing: the course page route and the chat road ----
const fakeReader = async (model, prompt) => { const [, from, to] = /pages (\d+) to (\d+)/.exec(prompt); let out = "TOTAL PAGES: 1\n"; for (let n = Number(from); n <= Math.min(Number(to), 1); n++) out += `=== PAGE ${n} ===\nKEYWORDS: k${n}\ntext of page ${n}\n`; return out; };
function setup(fetchLinkFake) {
  const dir = tmp();
  const courses = createCourses(path.join(dir, "courses"));
  const store = createStore(path.join(dir, "conv"));
  const routes = createCourseRoutes({ courses, store, ingestFile, askCourse, askFile: fakeReader, askChain: async () => ({ answer: "x", used: { model: "fake" } }), fetchLink: fetchLinkFake });
  return { courses, routes, course: courses.create("Systems Programming") };
}
const waitIdle = async (routes) => { for (let i = 0; i < 100 && !routes.idle(); i++) await new Promise((r) => setTimeout(r, 20)); };

test("a repo zip from a link is filed in the course through the zip road (code files, leftovers counted, duplicates skipped)", async () => {
  const zip = makeZip({ "repo-main/src/parser.c": "int main(void){return 0;}\n", "repo-main/README.md": "# made-up readme\n", "repo-main/build/x.o": "xx" });
  const s = setup(async () => ({ bytes: zip, name: "repo-main.zip", expectZip: true, source: "codeload.github.com", repo: "o/repo" }));
  const r = await s.routes.addLink(s.course.id, "https://github.com/o/repo", "en");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filedCount, 2);
  assert.match(r.text, /Downloaded the GitHub repository o\/repo\. From "repo-main\.zip" I filed 2 files/);
  await waitIdle(s.routes);
  assert.deepStrictEqual(s.courses.get(s.course.id).files.map((f) => f.name).sort(), ["README.md", "repo-main/src/parser.c"]);
  const again = await s.routes.addLink(s.course.id, "https://github.com/o/repo", "he");
  assert.strictEqual(again.filedCount, 0); // both were already there: duplicates, not filed twice
  assert.match(again.text, /כבר/);
});

test("a single PDF from a link is filed; the same file again says it is already there; a refusal is explained", async () => {
  const s = setup(async () => ({ bytes: PDF, name: "slides week1.pdf", expectZip: false, source: "example.edu", repo: null }));
  const r = await s.routes.addLink(s.course.id, "https://example.edu/slides.pdf", "en");
  assert.strictEqual(r.ok, true);
  assert.match(r.text, /Downloaded "slides week1\.pdf" from your link and filed it in Systems Programming/);
  const twice = await s.routes.addLink(s.course.id, "https://example.edu/slides.pdf", "en");
  assert.strictEqual(twice.ok, false);
  assert.match(twice.text, /could not file it/);
  const bad = setup(async () => ({ bytes: Buffer.from([0, 1, 2, 3, 255, 254]), name: "x.pdf", expectZip: false, source: "example.edu", repo: null }));
  const r2 = await bad.routes.addLink(bad.course.id, "https://example.edu/x.pdf", "en");
  assert.strictEqual(r2.ok, false); // real first bytes decide, not the name
});

test("a download that fails says why in the message's language and files nothing", async () => {
  const s = setup(async () => { throw Object.assign(new Error("x"), { code: "login" }); });
  const en = await s.routes.addLink(s.course.id, "https://example.edu/x.pdf", "en");
  const he = await s.routes.addLink(s.course.id, "https://example.edu/x.pdf", "he");
  assert.match(en.text, /needs a login/);
  assert.match(he.text, /התחברות/);
  assert.strictEqual(s.courses.get(s.course.id).files.length, 0);
});

test("COURSE PAGE: POST /api/courses/<id>/link files the download and returns the summary; bad input is refused", async () => {
  const s = setup(async (url) => { if (url.includes("bad")) throw Object.assign(new Error("x"), { code: "blocked" }); return { bytes: PDF, name: "a.pdf", expectZip: false, source: "example.edu", repo: null }; });
  const server = createServer({ store: createStore(tmp()), courseRoutes: s.routes });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const post = (body) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: `/api/courses/${s.course.id}/link`, headers: { Host: `localhost:${port}`, "Content-Type": "application/json", "Content-Length": data.length } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t) })); });
    req.on("error", reject); req.end(data);
  });
  try {
    const good = await post({ url: "https://example.edu/a.pdf" });
    assert.strictEqual(good.status, 201);
    assert.strictEqual(good.json.link.filedCount, 1);
    assert.strictEqual((await post({ url: "https://example.edu/bad" })).status, 422);
    assert.strictEqual((await post({})).status, 400);
    assert.strictEqual((await post({ url: 5 })).status, 400);
  } finally { server.close(); await waitIdle(s.routes); }
});

// ---- the chat road: the front desk only labels the intent; code takes the URL from the user's message ----
const COURSES = [{ id: "aaaaaaaaaaaaaaa1", name: "Calculus 2" }, { id: "aaaaaaaaaaaaaaa2", name: "Systems Programming" }];
const deps = (extra = {}) => ({ chainForDestination: () => [{ provider: "agy", model: "fake" }], chainForType: () => [], lowPools: async () => [], refreshQuota: () => {}, prewarmAnswer: () => {}, speculate: null, about: () => "", facts: () => [], addFact: () => { throw new Error("no"); },
  askChain: async () => { throw new Error("no model may be called for a download"); }, ...extra });
const deskSaying = (course) => async () => ({ action: "course", destination: null, answer: "", reason: "r", course, studyIntent: "linksave" });

test("front desk: 'link' is a known study intent and the course is still checked against the real list", () => {
  assert.ok(STUDY_INTENTS.includes("linksave"));
  const d = validateDecision({ action: "course", course: "systems programming", studyIntent: "linksave", reason: "r" }, { courses: COURSES });
  assert.deepStrictEqual(d.course, COURSES[1]);
  assert.strictEqual(d.studyIntent, "linksave");
  assert.strictEqual(validateDecision({ action: "course", course: "Made Up", studyIntent: "linksave", reason: "r" }, { courses: COURSES }), null);
});

test("chat: the URL is taken from the user's words by code (a model-proposed URL is ignored), no model is called, the reply is in the message's language", async () => {
  const seen = [];
  const decide = async () => ({ action: "course", destination: null, answer: "", reason: "r", course: COURSES[1], studyIntent: "linksave", url: "https://evil.example.org/hijack" });
  const out = await handleTask("download https://github.com/octocat/Hello-World into my systems course", { deps: deps({ decide, fetchLink: async (id, url, lang) => { seen.push({ id, url, lang }); return { ok: true, text: "Downloaded the GitHub repository." }; } }), courses: COURSES });
  assert.deepStrictEqual(seen, [{ id: COURSES[1].id, url: "https://github.com/octocat/Hello-World", lang: "en" }]);
  assert.strictEqual(out.answer, "Downloaded the GitHub repository.");
  assert.strictEqual(out.courseId, COURSES[1].id);
  const he = await handleTask("תוריד את https://example.edu/a.pdf לחומרים", { deps: deps({ decide: deskSaying(COURSES[0]), fetchLink: async (id, url, lang) => { seen.push(lang); return { ok: true, text: "בוצע" }; } }), courses: COURSES });
  assert.strictEqual(seen[1], "he");
  assert.strictEqual(he.answer, "בוצע");
});

test("chat: no link in the message, no course named with several courses, and several links are each said plainly; nothing is downloaded", async () => {
  let calls = 0;
  const fetchLinkFake = async () => { calls++; return { ok: true, text: "done" }; };
  const noLink = await handleTask("download the repo please", { deps: deps({ decide: deskSaying(COURSES[0]), fetchLink: fetchLinkFake }), courses: COURSES });
  assert.match(noLink.answer, /did not find a link/);
  const noCourse = await handleTask("download https://example.edu/a.pdf", { deps: deps({ decide: deskSaying(null), fetchLink: fetchLinkFake }), courses: COURSES });
  assert.match(noCourse.answer, /Which course/);
  assert.strictEqual(calls, 0);
  const two = await handleTask("get https://example.edu/a.pdf and https://example.edu/b.pdf", { deps: deps({ decide: deskSaying(COURSES[0]), fetchLink: fetchLinkFake }), courses: COURSES });
  assert.match(two.answer, /took the first one/);
  assert.strictEqual(calls, 1);
  const only = await handleTask("get https://example.edu/a.pdf", { deps: deps({ decide: deskSaying(null), fetchLink: fetchLinkFake }), courses: [COURSES[0]] });
  assert.match(only.answer, /done/); // a single course is used without asking
});
