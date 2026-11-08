// unzip.test.js
// Zip upload: unzip.js on its own, then the whole road (thread-files.js and the upload route).
// Every zip is built here from made-up bytes (buildZip below): no real files, no real text.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { unzip, looksLikeZip, classify, MAX_CODE_BYTES, MAX_FILES, MAX_ENTRIES, MAX_TOTAL_BYTES, MAX_FILE_BYTES } = require("./unzip");
const { createStudyCoach } = require("./study-coach");
const { createThreadFiles } = require("./thread-files");
const { createThreadStore } = require("./thread-store");
const { createServer } = require("./server");
const { createStore } = require("./store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-zip-"));

// ---- a tiny zip WRITER, only for tests. Each entry: { name, data, method (8 = deflate, 0 = stored), size (lie about the unpacked size),
// flags, attrs + madeBy (Unix file type), } ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function buildZip(entries, { cut = 0 } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || "");
    const method = e.method === undefined ? 8 : e.method;
    const packed = method === 8 ? zlib.deflateRawSync(data) : data;
    const declared = e.size === undefined ? data.length : e.size;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.flags || 0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(((e.madeBy || 0) << 8) | 20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(e.flags || 0, 8); head.writeUInt16LE(method, 10);
    head.writeUInt32LE(crc32(data), 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(declared, 24); head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(e.attrs || 0, 38); head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, dir, end]);
  return cut ? all.subarray(0, all.length - cut) : all;
}

const PDF = (tag) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`made-up ${tag} `.repeat(5))]);
const PNG = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${tag}`.repeat(25000))]);
const names = (r) => r.files.map((f) => f.name);

// ---------------------------------------------------------------- unzip.js
test("ZIP: a normal zip gives its files (folders are not listed, names inside folders are cut to the file name)", () => {
  const zip = buildZip([
    { name: "week1/", data: "", method: 0 },
    { name: "week1/lecture one.pdf", data: PDF("a") },
    { name: "notes.txt", data: "plain made-up text", method: 0 },
    { name: "pic.png", data: PNG("p") },
  ]);
  assert.strictEqual(looksLikeZip(zip), true);
  const r = unzip(zip);
  assert.deepStrictEqual(names(r), ["lecture one.pdf", "notes.txt", "pic.png"]);
  assert.deepStrictEqual(r.files[1].bytes, Buffer.from("plain made-up text"));
  assert.strictEqual(r.skipped.length, 0);
});

test("ZIP: zip-slip names are skipped (.., absolute, drive letter, backslash, hidden, control characters), never turned into a path", () => {
  const bad = ["../evil.pdf", "a/../../evil.pdf", "/etc/evil.pdf", "C:/evil.pdf", "C:evil.pdf", "..\\evil.pdf", ".hidden.pdf", "dir/.secret.txt", "__MACOSX/x.pdf", "tab\tname.pdf"];
  const zip = buildZip([...bad.map((name) => ({ name, data: PDF("x") })), { name: "good.pdf", data: PDF("g") }]);
  const r = unzip(zip);
  assert.deepStrictEqual(names(r), ["good.pdf"]);
  assert.strictEqual(r.skipped.length, bad.length);
});

test("ZIP: a zip bomb is refused: a tiny file that expands past what it declares, and sizes that add up past the total limit", () => {
  // 1. declares 10 bytes, really expands to 5 MB of zeros (the zip itself is a few KB)
  const lying = buildZip([{ name: "a.txt", data: Buffer.alloc(5 * 1024 * 1024), size: 10 }]);
  assert.ok(lying.length < 20000);
  assert.throws(() => unzip(lying), (e) => e.status === 400 && /not honest/.test(e.message));
  // 2. honest-looking but huge: declared sizes add up past the total limit. Nothing is unpacked (the data is tiny).
  const per = MAX_FILE_BYTES;
  const count = Math.ceil(MAX_TOTAL_BYTES / per) + 1;
  const huge = buildZip(Array.from({ length: count }, (_, i) => ({ name: `f${i}.txt`, data: "x", method: 0, size: per })));
  assert.throws(() => unzip(huge), (e) => e.status === 413);
  // 3. one file over the single-file limit is only skipped
  const big = buildZip([{ name: "big.txt", data: "x", method: 0, size: MAX_FILE_BYTES + 1 }, { name: "ok.txt", data: "fine" }]);
  const r = unzip(big);
  assert.deepStrictEqual(names(r), ["ok.txt"]);
  assert.match(r.skipped[0].reason, /MB/);
});

test("ZIP: more than MAX_FILES files: the first ones are kept, the rest are skipped and counted; far too many entries refuses the zip", () => {
  const many = buildZip(Array.from({ length: MAX_FILES + 5 }, (_, i) => ({ name: `f${i}.txt`, data: `text ${i}`, method: 0 })));
  const r = unzip(many);
  assert.strictEqual(r.files.length, MAX_FILES);
  assert.strictEqual(r.skipped.length, 5);
  const tooMany = buildZip(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}.txt`, data: "x", method: 0 })));
  assert.throws(() => unzip(tooMany), (e) => e.status === 413);
});

test("ZIP: a zip inside a zip, other types, symlinks, passwords and unknown compression are skipped with a reason", () => {
  const inner = buildZip([{ name: "x.pdf", data: PDF("i") }]);
  const zip = buildZip([
    { name: "inner.zip", data: inner },
    { name: "program.exe", data: "MZ" },
    { name: "old.ppt", data: "x" },
    { name: "link.txt", data: "../../etc/passwd", madeBy: 3, attrs: (0o120777 << 16) >>> 0 },
    { name: "secret.pdf", data: PDF("s"), flags: 1 },
    { name: "weird.pdf", data: PDF("w"), method: 12 },
    { name: "empty.txt", data: "", method: 0 },
    { name: "ok.pdf", data: PDF("o") },
  ]);
  const r = unzip(zip);
  assert.deepStrictEqual(names(r), ["ok.pdf"]);
  const why = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
  assert.match(why["inner.zip"], /zip inside a zip/);
  assert.match(why["program.exe"], /compiled/); // now counted as a build leftover
  assert.strictEqual(r.skipped.find((s) => s.name === "program.exe").code, "junk");
  assert.match(why["old.ppt"], /not supported/);
  assert.match(why["link.txt"], /symbolic/);
  assert.match(why["secret.pdf"], /password/);
  assert.match(why["weird.pdf"], /compression/);
  assert.match(why["empty.txt"], /empty/);
});

test("ZIP: an empty zip gives no files; corrupt zips are refused with a 400, never a crash", () => {
  const empty = buildZip([]);
  assert.strictEqual(looksLikeZip(empty), true);
  assert.deepStrictEqual(unzip(empty), { files: [], skipped: [] });
  const good = buildZip([{ name: "a.pdf", data: PDF("a") }]);
  assert.throws(() => unzip(buildZip([{ name: "a.pdf", data: PDF("a") }], { cut: 10 })), (e) => e.status === 400); // the end is cut off
  assert.throws(() => unzip(Buffer.concat([good.subarray(0, 40), Buffer.alloc(good.length - 40, 7)])), (e) => e.status === 400); // the middle is garbage
  const garbled = Buffer.from(good); for (let i = 34; i < 50; i++) garbled[i] ^= 0xff; // bad compressed bytes: refused (400) or skipped, never a crash
  try { assert.strictEqual(unzip(garbled).files.length, 0); } catch (e) { assert.strictEqual(e.status, 400); }
  assert.throws(() => unzip(Buffer.from("not a zip at all")), (e) => e.status === 400);
  assert.strictEqual(looksLikeZip(Buffer.from("%PDF-1.4 hello hello hello")), false);
});

// ---------------------------------------------------------------- the whole road
const IDS = { calc: "b".repeat(16), sp: "a".repeat(16) };
const COURSES = [{ id: IDS.calc, name: "Calculus 2" }, { id: IDS.sp, name: "Systems Programming" }];
function fakeRoutes() {
  const added = [];
  return {
    added, list: () => COURSES,
    addUpload: (courseId, bytes, name) => {
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) && !bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) && bytes.includes(0)) throw Object.assign(new Error("this file type is not supported"), { status: 415 });
      if (added.some((a) => a.courseId === courseId && a.bytes.equals(bytes))) throw Object.assign(new Error("this file is already in the course"), { status: 409 });
      added.push({ courseId, bytes, name });
      return { id: String(added.length).padStart(16, "0"), name };
    },
    fileInfo: () => null,
  };
}
const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
// the real study coach, with a fake model that is never asked: only its timetable is used to pick a course
const fakeCoach = () => createStudyCoach({ dir: tmp(), courses: { list: () => COURSES, allPages: () => [] }, askChain: async () => ({ answer: "?", used: { model: "fake" } }), now: () => NOW });
function setup() {
  const thread = createThreadStore(tmp());
  const routes = fakeRoutes();
  const files = createThreadFiles({ thread, courseRoutes: routes, coach: fakeCoach(), now: () => NOW });
  return { thread, routes, files };
}

test("ZIP upload: files named after a course are filed there, the bad ones are skipped, and there is ONE summary message", () => {
  const { thread, routes, files } = setup();
  const zip = buildZip([
    { name: "Calculus 2 lecture 1.pdf", data: PDF("1") },
    { name: "Calculus 2 lecture 2.pdf", data: PDF("2") },
    { name: "run.exe", data: "MZ" },
    { name: "../evil.pdf", data: PDF("e") },
    { name: "Calculus 2 fake.pdf", data: Buffer.from([1, 0, 2, 0, 3]) }, // says PDF, is not: the same first-bytes check as a single file refuses it
  ]);
  const r = files.receive({ bytes: zip, name: "week1.zip", text: "" });
  assert.strictEqual(r.status, "filed");
  assert.deepStrictEqual(routes.added.map((a) => a.courseId), [IDS.calc, IDS.calc]);
  const msgs = [...thread.all()];
  assert.deepStrictEqual(msgs.map((m) => m.role), ["user", "assistant"]); // one question, ONE answer
  assert.match(msgs[0].text, /^\(file attached: week1\.zip\)/);
  assert.match(msgs[1].text, /filed 2 files \(2 PDFs\) in Calculus 2/);
  assert.match(msgs[1].text, /Skipped 2:/);
  assert.match(msgs[1].text, /Also skipped 1 compiled\/binary file\./); // run.exe is a build leftover: counted, not listed
  assert.ok(!/run\.exe/.test(msgs[1].text));
  assert.match(msgs[1].text, /evil\.pdf: the name tries to leave the folder/);
  assert.match(msgs[1].text, /fake\.pdf: this file type is not supported/);
  assert.strictEqual(msgs[1].replyTo, msgs[0].id);
});

test("ZIP upload: when no rule knows the course Bot asks ONCE for all the files; nothing is saved until a tap; then one summary", () => {
  const { thread, routes, files } = setup();
  const zip = buildZip([{ name: "a.pdf", data: PDF("a") }, { name: "b.pdf", data: PDF("b") }, { name: "c.pdf", data: PDF("c") }]);
  const r = files.receive({ bytes: zip, name: "stuff.zip", text: "" });
  assert.strictEqual(r.status, "asking");
  assert.strictEqual(routes.added.length, 0);
  const ask = [...thread.all()].pop();
  assert.ok(ask.result.fileChoice && ask.result.fileChoice.id === r.pendingId);
  assert.match(ask.text, /3 more files wait for you/);
  const done = files.assign(r.pendingId, IDS.sp);
  assert.strictEqual(done.filedCount, 3);
  assert.deepStrictEqual(routes.added.map((a) => a.courseId), [IDS.sp, IDS.sp, IDS.sp]);
  const last = [...thread.all()].pop();
  assert.match(last.text, /filed 3 files \(3 PDFs\) in Systems Programming/);
  assert.throws(() => files.assign(r.pendingId, IDS.sp), (e) => e.status === 404); // used once
});

test("ZIP upload: a duplicate inside a zip is skipped, not fatal; an empty zip and a refused zip each get an answer in the thread", () => {
  const { thread, routes, files } = setup();
  const same = PDF("same");
  files.receive({ bytes: buildZip([{ name: "Calculus 2 a.pdf", data: same }, { name: "Calculus 2 b.pdf", data: same }]), name: "dup.zip" });
  assert.strictEqual(routes.added.length, 1);
  assert.match([...thread.all()].pop().text, /already in the course/);
  files.receive({ bytes: buildZip([]), name: "empty.zip" });
  assert.match([...thread.all()].pop().text, /Nothing from "empty\.zip" was filed/);
  const before = [...thread.all()].length;
  assert.throws(() => files.receive({ bytes: buildZip([{ name: "a.txt", data: Buffer.alloc(2 * 1024 * 1024), size: 3 }]), name: "bomb.zip" }), (e) => e.status === 400);
  const after = [...thread.all()];
  assert.strictEqual(after.length, before + 2); // the question and the reason
  assert.strictEqual(after[after.length - 1].error, true);
});

test("ZIP upload (server): a .zip goes through POST /api/thread/upload and answers 201; a corrupt one is refused with 400", async () => {
  const { thread, routes, files } = setup();
  const server = createServer({ handle: async () => ({ mode: "single", answer: "x", used: {} }), store: createStore(tmp()), thread, coach: null, threadFiles: files, courseRoutes: null,
    push: { notifyAll: async () => {}, publicKey: () => null, subscribe() {}, unsubscribe() {} }, usage: async () => [] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const post = (p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: p, headers: { Host: `localhost:${port}`, "Content-Type": "application/octet-stream" } }, (res) => {
      let text = ""; res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(body);
  });
  try {
    const ok = await post("/api/thread/upload?name=Calculus%202.zip", buildZip([{ name: "l1.pdf", data: PDF("1") }]));
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.json.filedCount, 1);
    assert.strictEqual(routes.added.length, 1);
    const bad = await post("/api/thread/upload?name=broken.zip", buildZip([{ name: "l1.pdf", data: PDF("1") }], { cut: 10 }));
    assert.strictEqual(bad.status, 400);
  } finally { server.close(); }
});

// ---------------------------------------------------------------- a zip from a programming course (code, build leftovers)
// Everything below is made up: short invented C-like text, empty "compiled" files, no real names.
const CODE = (tag) => `/* made-up ${tag} */\nint ${tag}_add(int a, int b) {\n  return a + b;\n}\n`;
const ELF_LIKE = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]), Buffer.alloc(40)]);
function codeZip() {
  return buildZip([
    { name: "proj/docs/guide.pdf", data: PDF("g") },
    { name: "proj/docs/notes.md", data: "# made-up notes\nabout the parser\n" },
    { name: "proj/src/parser.c", data: CODE("parser") },
    { name: "proj/src/parser.h", data: "#ifndef P_H\n#define P_H\nint parser_add(int a, int b);\n#endif\n" },
    { name: "proj/tests/Makefile", data: "all:\n\techo made-up\n" },
    { name: "proj/Makefile", data: "all:\n\techo made-up root\n" },
    { name: "proj/src/parser.o", data: ELF_LIKE },
    { name: "proj/lib/libx.a", data: ELF_LIKE },
    { name: "proj/build/out.txt", data: "left over of a build" },
    { name: "proj/node_modules/pkg/index.js", data: "module.exports = 1;" },
    { name: "proj/src/__pycache__/m.pyc", data: ELF_LIKE },
    { name: "proj/src/fake.c", data: Buffer.concat([Buffer.from("int x;\n"), Buffer.alloc(30)]) }, // NUL bytes: not text, refused
    { name: "proj/src/pdf-in-disguise.c", data: PDF("d") }, // a PDF renamed .c: refused, not filed as a PDF
    { name: "proj/data.weird", data: "who knows" },
    { name: "proj/../../evil.c", data: CODE("evil") },
  ]);
}

test("ZIP code: source and project text files are kept as code, build leftovers are marked junk, fakes and hostile names are refused", () => {
  const r = unzip(codeZip());
  assert.deepStrictEqual(r.files.map((f) => `${f.group}:${f.path}`).sort(), [
    "code:proj/Makefile", "code:proj/src/parser.c", "code:proj/src/parser.h", "code:proj/tests/Makefile", "doc:proj/docs/guide.pdf", "doc:proj/docs/notes.md",
  ]);
  const byCode = {};
  for (const s of r.skipped) byCode[s.code] = (byCode[s.code] || 0) + 1;
  assert.deepStrictEqual(byCode, { junk: 5, notext: 2, type: 1, name: 1 }); // .o .a build/ node_modules/ __pycache__/ ; fake.c + pdf-in-disguise.c ; .weird ; ../
  assert.strictEqual(classify("a/b/Makefile"), "code");
  assert.strictEqual(classify("README"), "code");
  assert.strictEqual(classify("x/y.exe"), "junk");
  assert.strictEqual(classify("x/y.docx"), "doc");
});

test("ZIP code: a code file over the code limit is skipped; a high-bit (non UTF-8) one too; the document limit is unchanged", () => {
  const big = buildZip([{ name: "a.c", data: "x", method: 0, size: MAX_CODE_BYTES + 1 }, { name: "latin.c", data: Buffer.from([0x69, 0x6e, 0x74, 0x20, 0xe9, 0x0a]) }, { name: "ok.c", data: CODE("ok") }]);
  const r = unzip(big);
  assert.deepStrictEqual(r.files.map((f) => f.name), ["ok.c"]);
  assert.deepStrictEqual(r.skipped.map((s) => s.code), ["codebig", "notext"]);
});

function codeSetup() {
  const s = setup();
  const sniffing = s.routes.addUpload;
  s.routes.addUpload = (courseId, bytes, name) => { // the real kind check of a single upload, so the road is as real as possible
    require("./upload").sniffFile(bytes);
    return sniffing(courseId, bytes, name);
  };
  return s;
}

test("ZIP code upload (English): documents and code are counted apart, junk is ONE line, code is filed under its path", () => {
  const { thread, routes, files } = codeSetup();
  const r = files.receive({ bytes: codeZip(), name: "Systems Programming proj.zip", text: "here is the project" });
  assert.strictEqual(r.status, "filed");
  assert.strictEqual(r.filedCount, 6);
  assert.deepStrictEqual(routes.added.map((a) => a.name).sort(), ["guide.pdf", "notes.md", "proj/Makefile", "proj/src/parser.c", "proj/src/parser.h", "proj/tests/Makefile"].sort());
  const text = [...thread.all()].pop().text;
  assert.match(text, /I filed 6 files \(1 text file, 1 PDF, 4 code files\) in Systems Programming\./);
  assert.match(text, /Also skipped 5 compiled\/binary files\./);
  assert.match(text, /Skipped 4:/);
  assert.match(text, /fake\.c: not really text/);
  assert.match(text, /evil\.c: the name tries to leave the folder/);
  assert.ok(!/parser\.o|libx\.a|pycache|node_modules/.test(text), "junk is never listed by name");
  assert.ok(text.split("\n").length < 14);
});

test("ZIP code upload (Hebrew): the reasons are Hebrew, names sit inside isolate marks, junk is one line", () => {
  const { thread, files } = codeSetup();
  files.receive({ bytes: codeZip(), name: "Systems Programming proj.zip", text: "שלום, זה הפרויקט של Systems Programming" });
  const text = [...thread.all()].pop().text;
  assert.match(text, /תייקתי 6 קבצים \(קובץ טקסט אחד, קובץ PDF אחד, 4 קבצי קוד\)/);
  assert.match(text, /בנוסף דולגו 5 קבצים מקומפלים\/בינאריים\./);
  assert.match(text, /דולגו 4:/);
  assert.match(text, /\u2066[^\n]*fake\.c\u2069: לא טקסט אמיתי/);
  assert.match(text, /\u2066[^\n]*evil\.c\u2069: שם לא בטוח/);
  assert.ok(!/ this type is |not supported|the name tries/.test(text), "no English reasons inside the Hebrew message");
  assert.ok(!/parser\.o|libx\.a/.test(text));
});

test("ZIP code upload: a made-up code file reaches the course as plain text and a question about its name finds it (real courses + ingest + search)", async () => {
  const { createCourses } = require("./courses");
  const { ingestFile } = require("./ingest");
  const { createIndex, search } = require("./search");
  const courses = createCourses(tmp());
  const c = courses.create("Systems Programming");
  const { sniffFile } = require("./upload");
  const bytes = Buffer.from(CODE("parser"));
  const { kind, ext } = sniffFile(bytes);
  const file = courses.addFile(c.id, { bytes, kind, ext, name: "src/parser.c" });
  await ingestFile({ courses, courseId: c.id, fileId: file.id, askFile: async () => { throw new Error("no model for text"); } });
  const pages = courses.allPages(c.id);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].fileName, "src/parser.c");
  const other = courses.addFile(c.id, { bytes: Buffer.from("plain notes about something else entirely\n"), kind: "text", ext: ".txt", name: "other.txt" });
  await ingestFile({ courses, courseId: c.id, fileId: other.id, askFile: async () => { throw new Error("no"); } });
  const all = courses.allPages(c.id);
  const hits = search(createIndex(all), "what does the parser do", 3);
  assert.strictEqual(all[hits[0].index].fileName, "src/parser.c");
});
