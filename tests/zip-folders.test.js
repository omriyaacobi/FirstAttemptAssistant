// zip-folders.test.js
// A zip's folder names are kept with each file as a LABEL (2026-11-13), so Bot can find "the README inside mission2". The label is
// display text only, never a path. All names and text here are invented.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { unzip } = require("../unzip");
const { cleanFolder } = require("../upload");
const { filedFolder, zipItems, zipSummary } = require("../zip-filing");
const { createCourses } = require("../courses");
const { createStore } = require("../store");
const { createCourseRoutes } = require("../course-routes");
const { ingestFile } = require("../ingest");
const { askCourse } = require("../study");
const { createBrain } = require("../brain");
const { makeZip } = require("./testzip");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-zipfolders-"));
const PDF = (tag) => `%PDF-1.4\nmade-up ${tag} `.repeat(4);

// ---- unzip.js: the folder label ----
test("a zip with a/README.pdf and b/README.pdf keeps both, each with its folder", () => {
  const { files } = unzip(makeZip({ "op/a/README.pdf": PDF("a"), "op/b/README.pdf": PDF("b"), "top.pdf": PDF("t") }));
  assert.deepStrictEqual(files.map((f) => [f.folder, f.name]), [["op/a", "README.pdf"], ["op/b", "README.pdf"], ["", "top.pdf"]]);
});

test("a Hebrew name without the zip's UTF-8 flag is read as UTF-8; bytes that are not UTF-8 are still read as Latin-1", () => {
  const z = makeZip({ "מטלה 1/README.pdf": PDF("he"), "x.pdf": PDF("l") }); // testzip.js never sets the flag
  const at = z.indexOf(Buffer.from("x.pdf"));
  z[at] = 0xe9; z[z.lastIndexOf(Buffer.from("x.pdf"))] = 0xe9; // "\xe9.pdf" in both headers: not valid UTF-8
  const { files } = unzip(z);
  assert.deepStrictEqual(files.map((f) => [f.folder, f.name]), [["מטלה 1", "README.pdf"], ["", "é.pdf"]]);
});

test("'..' and absolute entries are still skipped, and never become a folder", () => {
  const { files, skipped } = unzip(makeZip({ "../evil/x.pdf": PDF("1"), "/abs/y.pdf": PDF("2"), "C:/win/z.pdf": PDF("3"), "ok/w.pdf": PDF("4") }));
  assert.deepStrictEqual(files.map((f) => f.folder), ["ok"]);
  assert.strictEqual(skipped.length, 3);
  assert.ok(skipped.every((s) => s.code === "name"));
});

test("cleanFolder removes control characters and .. parts, clips each part, and caps the length", () => {
  assert.strictEqual(cleanFolder("mis\u0007sion\u00002/<b>x"), "mis sion 2/b x");
  assert.strictEqual(cleanFolder("a/../b/./c\\d"), "a/b/c/d");
  assert.strictEqual(cleanFolder("C:/x"), "x");
  assert.strictEqual(cleanFolder("p".repeat(100)), "p".repeat(60));
  const long = cleanFolder(Array.from({ length: 10 }, (_, i) => `${i}`.repeat(50)).join("/"));
  assert.ok(long.length <= 200, long.length);
  assert.ok(long.startsWith("…/") && long.endsWith("9".repeat(50)), "the innermost folders are kept");
  assert.strictEqual(cleanFolder(""), "");
});

test("a code file's name already holds two folders, so the label holds only those above it (no folder twice)", () => {
  const item = { group: "code", name: "parser.c", path: "proj/lib/src/parser.c", folder: "proj/lib/src" };
  assert.strictEqual(filedFolder(item), "proj");
  assert.deepStrictEqual(zipItems([{ ...item, kind: "code", bytes: Buffer.from("x") }]).map((i) => [i.folder, i.name]), [["proj", "lib/src/parser.c"]]);
});

// ---- the whole road: course page / link zip (addZip) into real courses ----
const fakeReader = async (model, prompt) => { const [, from, to] = /pages (\d+) to (\d+)/.exec(prompt); let out = "TOTAL PAGES: 1\n"; for (let n = Number(from); n <= Math.min(Number(to), 1); n++) out += `=== PAGE ${n} ===\nKEYWORDS: k${n}\ntext of page ${n}\n`; return out; };
function setup() {
  const dir = tmp();
  const courses = createCourses(path.join(dir, "courses"));
  const store = createStore(path.join(dir, "conv"));
  const routes = createCourseRoutes({ courses, store, ingestFile, askCourse, askFile: fakeReader, askChain: async () => ({ answer: "x", used: { model: "fake" } }) });
  return { courses, routes, course: courses.create("Systems Demo") };
}
const waitIdle = async (routes) => { for (let i = 0; i < 100 && !routes.idle(); i++) await new Promise((r) => setTimeout(r, 20)); };

test("files from a zip are stored by id with their folder label; a single upload has none", async () => {
  const { courses, routes, course } = setup();
  routes.fileFetched(course.id, course.name, { bytes: makeZip({ "op/mission1/README.pdf": PDF("m1"), "op/mission2/README.pdf": PDF("m2") }), name: "op.zip" });
  routes.addUpload(course.id, Buffer.from(PDF("single")), "alone.pdf");
  await waitIdle(routes);
  const files = courses.get(course.id).files;
  assert.deepStrictEqual(files.map((f) => [f.folder, f.name]), [["op/mission1", "README.pdf"], ["op/mission2", "README.pdf"], [undefined, "alone.pdf"]]);
  const stored = fs.readdirSync(path.dirname(courses.originalPath(course.id, files[0].id)));
  assert.ok(stored.every((n) => /^[a-f0-9]{16}\./.test(n)), "files stay stored under their random id");
  assert.deepStrictEqual(routes.courseFiles(course.id).files.map((f) => f.folder), ["op/mission1", "op/mission2", undefined]);
});

test("re-uploading the same zip adds the folder label to files that had none, with no second copy", async () => {
  const { courses, routes, course } = setup();
  // the old way: the same files filed with no folder
  routes.addUpload(course.id, Buffer.from(PDF("m1")), "README.pdf");
  routes.addUpload(course.id, Buffer.from(PDF("m2")), "README.pdf");
  await waitIdle(routes);
  const r = routes.fileFetched(course.id, course.name, { bytes: makeZip({ "op/mission1/README.pdf": PDF("m1"), "op/mission2/README.pdf": PDF("m2"), "op/new.pdf": PDF("n") }), name: "op.zip" });
  await waitIdle(routes);
  const files = courses.get(course.id).files;
  assert.strictEqual(files.length, 3, "no second copy");
  assert.deepStrictEqual(files.map((f) => f.folder), ["op/mission1", "op/mission2", "op"]);
  assert.match(r.summary, /I added folder names to 2 files you already had/);
  // A third upload changes nothing (the labels are there already) and says nothing about labels.
  const again = routes.fileFetched(course.id, course.name, { bytes: makeZip({ "other/README.pdf": PDF("m1") }), name: "x.zip" });
  assert.strictEqual(courses.get(course.id).files[0].folder, "op/mission1");
  assert.doesNotMatch(again.summary, /folder names/);
});

test("the zip summary says it in Hebrew too", () => {
  const skipped = [{ name: "README.pdf", code: "dup", labelled: true }, { name: "README.pdf", code: "dup", labelled: true }];
  assert.match(zipSummary("he", "op.zip", [], skipped, 0), /הוספתי שמות תיקיות ל-2 קבצים שכבר היו/);
});

// ---- the brain: course_files, course_read and open_on_pc by folder/name ----
const C = { id: "c".repeat(16), name: "Systems Demo" };
const FILES = [
  { id: "1111111111111111", name: "README.pdf", folder: "op/mission1", status: "ready", pages: 1 },
  { id: "2222222222222222", name: "README.pdf", folder: "op/mission2", status: "ready", pages: 1 },
  { id: "3333333333333333", name: "notes.pdf", status: "ready", pages: 1 },
];
const PAGES = [
  { fileId: "1111111111111111", fileName: "README.pdf", fileFolder: "op/mission1", page: 1, text: "Mission one\nbody one" },
  { fileId: "2222222222222222", fileName: "README.pdf", fileFolder: "op/mission2", page: 1, text: "Mission two\nbody two" },
  { fileId: "3333333333333333", fileName: "notes.pdf", page: 1, text: "Notes\nbody three" },
];
function world(replies) {
  const prompts = [], opened = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => PAGES, originalPath: (cid, fid) => `C:/fake/${fid}.pdf` },
    courseRoutes: { list: () => [C], courseFiles: () => ({ files: FILES }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    opener: { openCopy: (p, name) => { opened.push([p, name]); return { how: "its normal app" }; } },
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.parse("2026-11-13T10:00:00Z"),
  });
  return { prompts, opened, ask: (t) => brain.handle(t, { history: [], courses: [C] }) };
}

test("course_files shows folder/name, and no id is needed when the folders tell the files apart", async () => {
  const w = world(['CALL {"tool":"course_files","course":"Systems Demo"}', "ok"]);
  await w.ask("which readmes are there?");
  assert.match(w.prompts[1], /op\/mission1\/README\.pdf \(ready/);
  assert.match(w.prompts[1], /op\/mission2\/README\.pdf \(ready/);
  assert.match(w.prompts[1], /\nnotes\.pdf \(ready/);
  assert.doesNotMatch(w.prompts[1], /\[id /);
});

test("course_read takes the whole folder/name or its end; the bare shared name asks which", async () => {
  const w = world([
    'CALL {"tool":"course_read","course":"Systems Demo","file":"op/mission2/README.pdf"}',
    'CALL {"tool":"course_read","course":"Systems Demo","file":"mission1/readme.pdf"}',
    'CALL {"tool":"course_read","course":"Systems Demo","file":"README.pdf"}',
    "ok",
  ]);
  await w.ask("read the mission 2 readme");
  assert.match(w.prompts[1], /op\/mission2\/README\.pdf, pages 1-1/);
  assert.match(w.prompts[1], /body two/);
  assert.doesNotMatch(w.prompts[1], /body one/);
  assert.match(w.prompts[2], /body one/);
  assert.match(w.prompts[3], /more than one file of Systems Demo is called that.*op\/mission1\/README\.pdf/);
});

test("open_on_pc opens the file named by folder/name", async () => {
  const w = world(['CALL {"tool":"open_on_pc","course":"Systems Demo","file":"mission2/README.pdf"}\nOpening it.', "ok"]);
  const r = await w.ask("open the mission 2 readme");
  assert.deepStrictEqual(w.opened, [["C:/fake/2222222222222222.pdf", "README.pdf"]]);
  assert.strictEqual(r.answer, "Opening it.");
});

test("search results cite folder/name", async () => {
  const w = world(['CALL {"tool":"course_search","course":"Systems Demo","query":"Mission two body"}', "ok"]);
  await w.ask("find mission two");
  assert.match(w.prompts[1], /\[op\/mission2\/README\.pdf, page 1\]/);
});
