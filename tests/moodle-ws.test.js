// tests/moodle-ws.test.js
// The Moodle TOKEN route (moodle-ws.js, moodle-token.js) with a FAKE Moodle: no network, no real token.
// What is checked: only read functions can be called, the token travels in the body and never in an address, a log or an error,
// only Moodle's own file addresses are downloaded, the answers have the same shape as the Chrome extension's, and the fallback
// to Chrome when the token is missing or refused.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMoodleWs, createMoodleSource, tokenReader, formBody, checkFileUrl, READ_FUNCTIONS, REST_URL, USER_AGENT } = require("../moodle-ws");
const { setEnvLine, readTokenAnswer } = require("../moodle-token");

const TOKEN = "abcdef0123456789abcdef0123456789";
const FILES = "https://moodle.bgu.ac.il/moodle/webservice/pluginfile.php";

// A fake Moodle: answers by wsfunction. Records every request.
function fakeMoodle(answers = {}) {
  const seen = [];
  const contents = [
    { id: 11, section: 0, name: "General", modules: [{ id: 100, name: "Announcements", modname: "forum", instance: 7 }] },
    { id: 12, section: 1, name: "Week 1", modules: [
      { id: 101, name: "Lecture 1", modname: "resource", instance: 1, contents: [{ type: "file", filename: "lec1.pdf", filesize: 10, fileurl: `${FILES}/5/mod_resource/content/1/lec1.pdf?forcedownload=1` }] },
      { id: 102, name: "Exercises", modname: "folder", instance: 2, contents: [{ type: "file", filename: "a.c", filesize: 3, fileurl: `${FILES}/6/mod_folder/content/0/a.c` }, { type: "file", filename: "b.c", filesize: 3, fileurl: `${FILES}/6/mod_folder/content/0/b.c` }] },
      { id: 103, name: "Hidden", modname: "resource", instance: 3, uservisible: false },
      { id: 104, name: "Bad file", modname: "resource", instance: 4, contents: [{ type: "file", filename: "x.pdf", filesize: 3, fileurl: "https://evil.example/moodle/webservice/pluginfile.php/1/x.pdf" }] },
    ] },
  ];
  const table = {
    core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 5, fullname: "Systems Programming", shortname: "sp", coursecategory: "CS", startdate: 1 }] },
    core_course_get_contents: contents,
    core_course_get_course_module: { cm: { id: 101, course: 5, instance: 1, modname: "resource" } },
    mod_forum_get_forum_discussions: { discussions: [{ id: 900, discussion: 55, name: "Hello <b>all</b>", created: 1700000000 }] },
    mod_forum_get_discussion_posts: { posts: [{ subject: "Hello", message: "<p>text</p>", author: { fullname: "Dr. A" }, timecreated: 1700000000, attachments: [{ filename: "a.pdf" }] }] },
    core_calendar_get_action_events_by_timesort: { events: [{ name: "HW1", course: { id: 5, fullname: "SP" }, timesort: 1700000500, modulename: "assign" }] },
    ...answers,
  };
  const send = async (req) => {
    seen.push(req);
    const p = new URLSearchParams(req.body);
    if (req.url !== REST_URL) return { status: 200, headers: { "content-type": "application/pdf" }, bytes: Buffer.from("FILEBYTES") };
    const a = table[p.get("wsfunction")];
    if (a && a.status) return { status: a.status, headers: {}, bytes: Buffer.from("Access Denied") };
    return { status: 200, headers: { "content-type": "application/json" }, bytes: Buffer.from(JSON.stringify(a === undefined ? { exception: "x", errorcode: "nofunction", message: "no" } : a)) };
  };
  return { send, seen };
}
const make = (answers, token = TOKEN) => { const m = fakeMoodle(answers); return { ...m, ws: createMoodleWs({ getToken: () => token, send: m.send, pauseMs: 0 }) }; };

test("only read functions are on the list, and nothing else can be called", async () => {
  for (const f of READ_FUNCTIONS) assert.match(f, /_get_/, `${f} must be a read`);
  const { ws, seen } = make();
  for (const bad of ["mod_assign_save_submission", "mod_forum_add_discussion_post", "core_user_update_user_preferences", "core_completion_update_activity_completion_status_manually", "core_course_view_course", "mod_resource_view_resource"]) {
    await assert.rejects(ws.call(bad, {}), (e) => e.code === "refused");
  }
  assert.strictEqual(seen.length, 0, "a refused function never reaches the network");
});

test("the token is sent in the body, never in the address; Bot says it is node", async () => {
  const { ws, seen } = make();
  await ws.ask("courses");
  assert.strictEqual(seen[0].url, REST_URL);
  assert.strictEqual(seen[0].method, "POST");
  assert.ok(!seen[0].url.includes(TOKEN));
  assert.strictEqual(new URLSearchParams(seen[0].body).get("wstoken"), TOKEN);
  assert.strictEqual(seen[0].headers["User-Agent"], USER_AGENT);
  assert.strictEqual(USER_AGENT, "node");
  assert.doesNotMatch(USER_AGENT, /mozilla|chrome|safari|moodlemobile/i);
});

test("the jobs answer in the same shapes as the Chrome extension", async () => {
  const { ws } = make();
  assert.deepStrictEqual((await ws.ask("courses")).data, [{ id: 5, name: "Systems Programming", short: "sp", category: "CS", start: 1 }]);
  const c = (await ws.ask("course", { courseid: 5 })).data;
  assert.deepStrictEqual(c.sections.map((s) => [s.number, s.title, s.cms]), [[0, "General", [100]], [1, "Week 1", [101, 102, 104]]]);
  assert.deepStrictEqual(c.items.map((i) => [i.id, i.module, i.files]), [[100, "forum", 0], [101, "resource", 1], [102, "folder", 2], [104, "resource", 1]]);
  assert.deepStrictEqual((await ws.ask("forum", { cmid: 100 })).data, [{ d: 55, title: "Hello <b>all</b>", time: 1700000000 }]);
  const posts = (await ws.ask("posts", { discussionid: 55 })).data;
  assert.deepStrictEqual(posts[0], { subject: "Hello", author: "Dr. A", created: 1700000000, message: "<p>text</p>", attachments: ["a.pdf"] });
  assert.deepStrictEqual((await ws.ask("events")).data[0], { name: "HW1", courseId: 5, course: "SP", due: 1700000500, module: "assign" });
  assert.deepStrictEqual((await ws.ask("folder", { cmid: 102 })).data, [{ index: 0, name: "a.c" }, { index: 1, name: "b.c" }]);
});

test("a file: only an address Moodle listed on its own host, token in the body", async () => {
  const { ws, seen } = make();
  await ws.ask("course", { courseid: 5 });
  const { file } = await ws.ask("file", { cmid: 101 });
  assert.strictEqual(file.name, "lec1.pdf");
  assert.strictEqual(file.bytes.toString(), "FILEBYTES");
  const req = seen[seen.length - 1];
  assert.strictEqual(req.url, `${FILES}/5/mod_resource/content/1/lec1.pdf`, "the query is dropped and the token is not in the address");
  assert.strictEqual(new URLSearchParams(req.body).get("token"), TOKEN);
  const f2 = await ws.ask("folderfile", { cmid: 102, index: 1 });
  assert.strictEqual(f2.file.name, "b.c");
  await assert.rejects(ws.ask("file", { cmid: 104 }), (e) => e.code === "refused"); // Moodle listed another host
  await assert.rejects(ws.ask("folderfile", { cmid: 102, index: 9 }), (e) => e.code === "notfile");
  await assert.rejects(ws.ask("file", { cmid: 100 }), (e) => e.code === "notfile"); // a forum is not a file
  for (const bad of ["https://evil.example/moodle/webservice/pluginfile.php/1/a", "http://moodle.bgu.ac.il/moodle/webservice/pluginfile.php/1/a", "https://moodle.bgu.ac.il/moodle/mod/assign/view.php", "https://moodle.bgu.ac.il/moodle/webservice/pluginfile.php/../../login/index.php", "https://moodle.bgu.ac.il.evil.example/moodle/webservice/pluginfile.php/1/a", "nope"]) {
    assert.throws(() => checkFileUrl(bad), (e) => e.code === "refused", bad);
  }
});

test("a file item not seen before is looked up by its number first", async () => {
  const { ws, seen } = make();
  const { file } = await ws.ask("file", { cmid: 101 });
  assert.strictEqual(file.name, "lec1.pdf");
  assert.deepStrictEqual(seen.slice(0, 2).map((r) => new URLSearchParams(r.body).get("wsfunction")), ["core_course_get_course_module", "core_course_get_contents"]);
});

test("job arguments are whole numbers only", async () => {
  const { ws, seen } = make();
  for (const bad of [{ cmid: "1; drop" }, { cmid: -1 }, { cmid: 1.5 }, {}]) await assert.rejects(ws.ask("file", bad), (e) => e.code === "refused");
  await assert.rejects(ws.ask("submit", {}), (e) => e.code === "refused");
  assert.strictEqual(seen.length, 0);
});

test("errors: a refused token, the edge, and the token never shows in a message", async () => {
  const bad = make({ core_course_get_enrolled_courses_by_timeline_classification: { exception: "moodle_exception", errorcode: "invalidtoken", message: `Invalid token ${TOKEN}` } });
  await assert.rejects(bad.ws.ask("courses"), (e) => e.code === "token" && !e.message.includes(TOKEN));
  const other = make({ core_course_get_enrolled_courses_by_timeline_classification: { exception: "x", errorcode: "dmlreadexception", message: `boom ${TOKEN}` } });
  await assert.rejects(other.ws.ask("courses"), (e) => e.code === "moodle" && !e.message.includes(TOKEN));
  const edge = make({ core_course_get_enrolled_courses_by_timeline_classification: { status: 403 } });
  await assert.rejects(edge.ws.ask("courses"), (e) => e.code === "blocked");
  const none = make({}, "");
  assert.strictEqual(none.ws.enabled(), false);
  await assert.rejects(none.ws.ask("courses"), (e) => e.code === "token");
  assert.strictEqual(none.seen.length, 0);
});

test("the token is read from .env, and a changed file is picked up", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mws-"));
  const env = path.join(dir, ".env");
  const get = tokenReader(env);
  assert.strictEqual(get(), "");
  fs.writeFileSync(env, `A=1\nMOODLE_TOKEN=${TOKEN}\n`);
  assert.strictEqual(get(), TOKEN);
  fs.writeFileSync(env, "A=1\nMOODLE_TOKEN=not a token!\n");
  fs.utimesSync(env, new Date(), new Date(Date.now() + 5000));
  assert.strictEqual(get(), "", "something that is not letters and digits is not used");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("formBody: lists the way Moodle reads them", () => {
  assert.strictEqual(formBody({ a: 1, b: [2, 3], c: true, d: "x y" }), "a=1&b%5B0%5D=2&b%5B1%5D=3&c=1&d=x%20y");
});

test("the source: token first, Chrome when the token is missing or refused, nothing else", async () => {
  const bridge = (connected) => ({ connected: () => connected, ask: async (kind) => ({ data: `chrome:${kind}`, file: null }) });
  const good = make();
  const s1 = createMoodleSource({ ws: good.ws, bridge: bridge(true) });
  assert.strictEqual((await s1.ask("courses")).data[0].id, 5);
  assert.strictEqual(s1.via(), "token");
  const refused = make({ core_course_get_enrolled_courses_by_timeline_classification: { exception: "x", errorcode: "invalidtoken", message: "no" } });
  const lines = [];
  const s2 = createMoodleSource({ ws: refused.ws, bridge: bridge(true), log: (l) => lines.push(l) });
  assert.strictEqual((await s2.ask("courses")).data, "chrome:courses");
  await s2.ask("courses");
  assert.strictEqual(lines.length, 1, "said once in the log, not at every call");
  assert.ok(!lines[0].includes(TOKEN));
  const s3 = createMoodleSource({ ws: refused.ws, bridge: bridge(false) });
  await assert.rejects(s3.ask("courses"), (e) => e.code === "token");
  const none = make({}, "");
  const s4 = createMoodleSource({ ws: none.ws, bridge: bridge(true) });
  assert.strictEqual((await s4.ask("courses")).data, "chrome:courses");
  assert.strictEqual(s4.via(), "chrome");
  assert.strictEqual(createMoodleSource({ ws: none.ws, bridge: bridge(false) }).connected(), false);
  // a Moodle error that is not about reaching it (a missing item) is NOT retried through Chrome
  const s5 = createMoodleSource({ ws: good.ws, bridge: { connected: () => true, ask: async () => { throw new Error("must not be asked"); } } });
  await assert.rejects(s5.ask("folderfile", { cmid: 102, index: 9 }), (e) => e.code === "notfile");
});

test("moodle-token.js: the .env line and Moodle's answers", () => {
  assert.strictEqual(setEnvLine("A=1\nMOODLE_TOKEN=old\nB=2\n", TOKEN), `A=1\nMOODLE_TOKEN=${TOKEN}\nB=2\n`);
  const added = setEnvLine("A=1\n", TOKEN);
  assert.match(added, /^A=1\n# Moodle read-only token.*\nMOODLE_TOKEN=abcdef0123456789abcdef0123456789\n$/);
  assert.deepStrictEqual(readTokenAnswer(200, JSON.stringify({ token: TOKEN, privatetoken: "p" })), { token: TOKEN });
  assert.match(readTokenAnswer(200, JSON.stringify({ error: "x", errorcode: "invalidlogin" })).error, /user name or password/);
  assert.match(readTokenAnswer(403, "Access Denied").error, /edge/);
  assert.match(readTokenAnswer(200, "<html>").error, /not JSON/);
  assert.ok(!readTokenAnswer(200, JSON.stringify({ token: "short" })).token);
});

// ---- the TEXT of items (2026-11-19): pages, assignments, labels, links, books. Made-up data only. ----
const { createBridge } = require("../moodle-bridge");
const ITEM_CONTENTS = [{ id: 21, section: 1, name: "Info", modules: [
  { id: 301, name: "Schedule", modname: "page", instance: 41, contents: [{ type: "file", filename: "index.html", filesize: 0, fileurl: `${FILES}/9/mod_page/content/3/index.html` }] },
  { id: 302, name: "Contact", modname: "label", instance: 42, description: "<p>Office: room 1</p>" },
  { id: 303, name: "HW 1", modname: "assign", instance: 43 },
  { id: 304, name: "Forum", modname: "forum", instance: 44, description: "<p>Ask here</p>" },
  { id: 305, name: "Guide", modname: "book", instance: 45, contents: [{ type: "content", filename: "structure", content: "[]" }, { type: "file", filename: "index.html", filesize: 10, fileurl: `${FILES}/9/mod_book/chapter/1/index.html` }] },
  { id: 306, name: "Site", modname: "url", instance: 46 },
] }];
const ITEM_ANSWERS = {
  core_course_get_contents: ITEM_CONTENTS,
  core_course_get_course_module: { cm: { id: 301, course: 5, instance: 41, modname: "page" } },
  mod_page_get_pages_by_courses: { pages: [{ coursemodule: 999, content: "<p>other page</p>" }, { coursemodule: 301, intro: "", content: "<h2>Hours</h2><p>Sunday 10-12</p>" }] },
  mod_assign_get_assignments: { courses: [{ id: 5, assignments: [{ cmid: 303, intro: "<p>Write a shell</p>", duedate: 1800000000, cutoffdate: 0, allowsubmissionsfromdate: 1790000000, introattachments: [{ filename: "hw1.pdf" }] }] }] },
  mod_label_get_labels_by_courses: { labels: [{ coursemodule: 302, intro: "<p>Office: room 1</p>" }] },
  mod_book_get_books_by_courses: { books: [{ coursemodule: 305, intro: "<p>A guide</p>" }] },
  mod_url_get_urls_by_courses: { urls: [{ coursemodule: 306, intro: "", externalurl: "https://example.org/site" }] },
};

test("item text: every new function only reads, and each kind of item gives its text", async () => {
  for (const f of ["mod_page_get_pages_by_courses", "mod_assign_get_assignments", "mod_url_get_urls_by_courses", "mod_label_get_labels_by_courses", "mod_resource_get_resources_by_courses", "mod_folder_get_folders_by_courses", "mod_book_get_books_by_courses"]) assert.ok(READ_FUNCTIONS.has(f), f);
  const { ws, seen } = make(ITEM_ANSWERS);
  const page = (await ws.ask("item", { cmid: 301 })).data;
  assert.strictEqual(page.module, "page");
  assert.deepStrictEqual(page.html.map((h) => h.label), ["page"]);
  assert.match(page.html[0].html, /Sunday 10-12/);
  const asked = new URLSearchParams(seen.find((r) => /mod_page_get_pages/.test(r.body)).body);
  assert.strictEqual(asked.get("courseids[0]"), "5"); // only the item's own course
  const label = (await ws.ask("item", { cmid: 302 })).data;
  assert.match(label.html[0].html, /room 1/);
  const hw = (await ws.ask("item", { cmid: 303 })).data;
  assert.deepStrictEqual(hw.dates, { allowsubmissionsfromdate: 1790000000, duedate: 1800000000 });
  assert.deepStrictEqual(hw.files, ["hw1.pdf"]);
  const url = (await ws.ask("item", { cmid: 306 })).data;
  assert.strictEqual(url.url, "https://example.org/site");
  // a kind with no read of its own (a forum) gives the description Moodle showed, with no extra call
  const before = seen.length;
  const forum = (await ws.ask("item", { cmid: 304 })).data;
  assert.match(forum.html[0].html, /Ask here/);
  assert.strictEqual(seen.length, before);
  // a book: its chapters are Moodle's own files, downloaded on the checked road
  const book = (await ws.ask("item", { cmid: 305 })).data;
  assert.deepStrictEqual(book.html.map((h) => h.label), ["description", "chapter 1"]);
  assert.strictEqual(seen[seen.length - 1].url, `${FILES}/9/mod_book/chapter/1/index.html`);
  assert.ok(!seen.some((r) => r.url.includes(TOKEN)));
});

test("item text: token route only; the Chrome extension is never asked for it", async () => {
  const bridge = createBridge();
  await assert.rejects(bridge.ask("item", { cmid: 301 }), (e) => e.code === "tokenonly");
  assert.strictEqual(bridge.next({}), null); // nothing was queued for the extension
  const chrome = { connected: () => true, ask: async () => { throw new Error("Chrome must not be asked"); } };
  const noToken = createMoodleSource({ ws: make(ITEM_ANSWERS, "").ws, bridge: chrome });
  await assert.rejects(noToken.ask("item", { cmid: 301 }), (e) => e.code === "tokenonly");
  const refused = createMoodleSource({ ws: make({ ...ITEM_ANSWERS, core_course_get_course_module: { exception: "x", errorcode: "invalidtoken" } }).ws, bridge: chrome });
  await assert.rejects(refused.ask("item", { cmid: 301 }), (e) => e.code === "token");
});
