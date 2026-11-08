// zip-course-page.test.js
// A .zip sent to a COURSE PAGE (POST /api/courses/<id>/files): the same opening as the chat zip (unzip.js) and the same summary
// (zip-filing.js), into THAT course, with no course picking. Real server on a random port, fake models, made-up zips only.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createCourses } = require("./courses");
const { createStore } = require("./store");
const { createServer } = require("./server");
const { createCourseRoutes } = require("./course-routes");
const { ingestFile } = require("./ingest");
const { askCourse } = require("./study");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-zipcourse-"));

// A tiny zip WRITER, only for tests (same idea as in unzip.test.js).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || "");
    const packed = zlib.deflateRawSync(data);
    const declared = e.size === undefined ? data.length : e.size;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(data), 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(declared, 24); head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const PDF = (tag) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`made-up ${tag} `.repeat(5))]);
const CODE = (tag) => `#include <stdio.h>\nint main(void) { printf("made-up ${tag}\\n"); return 0; }\n`;
const octet = { "Content-Type": "application/octet-stream" };

const fakeReader = async (model, prompt) => {
  const [, from, to] = /pages (\d+) to (\d+)/.exec(prompt);
  let out = "TOTAL PAGES: 1\n";
  for (let n = Number(from); n <= Math.min(Number(to), 1); n++) out += `=== PAGE ${n} ===\nKEYWORDS: k${n}\ntext of page ${n}\n`;
  return out;
};

async function start() {
  const dir = tmp();
  const courses = createCourses(path.join(dir, "courses"));
  const store = createStore(path.join(dir, "conv"));
  const courseRoutes = createCourseRoutes({ courses, store, ingestFile, askCourse, askFile: fakeReader, askChain: async () => ({ answer: "x", used: { model: "fake" } }) });
  const server = createServer({ store, courseRoutes });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const send = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { Host: `localhost:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch (e) { return null; } })() }));
    });
    req.on("error", reject);
    req.end(data);
  });
  const waitIdle = async () => { for (let i = 0; i < 100 && !courseRoutes.idle(); i++) await new Promise((r) => setTimeout(r, 20)); };
  const course = (await send("POST", "/api/courses", { name: "Systems Programming" })).json.course;
  const other = (await send("POST", "/api/courses", { name: "Calculus" })).json.course;
  const up = (zipName, bytes, id = course.id) => send("POST", `/api/courses/${id}/files?name=${encodeURIComponent(zipName)}`, bytes, octet);
  const files = async (id = course.id) => (await send("GET", `/api/courses/${id}`)).json.course.files;
  return { send, up, files, waitIdle, course, other, close: () => server.close() };
}

test("COURSE ZIP: documents and code files go into THIS course, with a short summary; leftovers are only counted", async () => {
  const s = await start();
  try {
    const zip = buildZip([
      { name: "week1/lecture one.pdf", data: PDF("a") },
      { name: "notes.txt", data: "plain made-up notes" },
      { name: "src/parser.c", data: CODE("p") },
      { name: "Makefile", data: "all:\n\tgcc main.c\n" },
      { name: "build/main.o", data: "xx" },
      { name: "node_modules/x/index.js", data: "x" },
      { name: "movie.mp4", data: "not supported" },
    ]);
    const r = await s.up("lecture-notes.docx.zip", zip);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.zip.filedCount, 4);
    assert.strictEqual(r.json.zip.skippedCount, 3);
    assert.match(r.json.zip.summary, /From "lecture-notes\.docx\.zip" I filed 4 files \(2 documents, 2 code files\) in Systems Programming/);
    assert.match(r.json.zip.summary, /movie\.mp4: this type is not supported/);
    assert.match(r.json.zip.summary, /Also skipped 2 compiled\/binary files/);
    assert.doesNotMatch(r.json.zip.summary, /main\.o|node_modules/); // counted, not listed
    await s.waitIdle();
    const here = (await s.files()).map((f) => f.name).sort();
    assert.deepStrictEqual(here, ["Makefile", "lecture one.pdf", "notes.txt", "src/parser.c"].sort());
    assert.deepStrictEqual(await s.files(s.other.id), []); // nothing in another course
  } finally { s.close(); }
});

test("COURSE ZIP: zip-slip names and a zip bomb are refused with a readable reason, never 'file type not supported'", async () => {
  const s = await start();
  try {
    const slip = await s.up("slip.zip", buildZip([{ name: "../evil.pdf", data: PDF("e") }, { name: "ok.txt", data: "fine made-up text" }]));
    assert.strictEqual(slip.status, 201); // the bad name is skipped, the good file is added
    assert.strictEqual(slip.json.zip.filedCount, 1);
    assert.match(slip.json.zip.summary, /evil\.pdf/);
    const bomb = await s.up("bomb.zip", buildZip([{ name: "a.txt", data: Buffer.alloc(2 * 1024 * 1024), size: 3 }]));
    assert.strictEqual(bomb.status, 400);
    assert.match(bomb.json.error, /not honest about its sizes/);
    assert.doesNotMatch(bomb.json.error, /not supported/);
    const cut = buildZip([{ name: "a.txt", data: "hello made-up" }]);
    const damaged = await s.up("cut.zip", cut.subarray(0, cut.length - 30));
    assert.strictEqual(damaged.status, 400);
    assert.doesNotMatch(damaged.json.error, /file type is not supported/);
  } finally { s.close(); }
});

test("COURSE ZIP: a file already in the course, or twice in the zip, is skipped as a duplicate (no crash, the others are added)", async () => {
  const s = await start();
  try {
    assert.strictEqual((await s.up("first.pdf", PDF("same"))).status, 201);
    const r = await s.up("again.zip", buildZip([
      { name: "copy.pdf", data: PDF("same") },
      { name: "new.txt", data: "made-up new notes" },
      { name: "dir/new-again.txt", data: "made-up new notes" },
    ]));
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.zip.filedCount, 1);
    assert.match(r.json.zip.summary, /Skipped 2:/);
    assert.match(r.json.zip.summary, /already in the course/);
    await s.waitIdle();
    assert.strictEqual((await s.files()).length, 2);
  } finally { s.close(); }
});

test("COURSE ZIP: other files keep the old behaviour and the old refusal, and a zip with nothing usable says so", async () => {
  const s = await start();
  try {
    const pdf = await s.up("lec.pdf", PDF("one"));
    assert.strictEqual(pdf.status, 201);
    assert.ok(pdf.json.file && !pdf.json.zip);
    const bad = await s.up("movie.mp4", Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    assert.strictEqual(bad.status, 415);
    assert.match(bad.json.error, /not supported/);
    const empty = await s.up("junk.zip", buildZip([{ name: "movie.mp4", data: "x" }]));
    assert.strictEqual(empty.status, 201);
    assert.strictEqual(empty.json.zip.filedCount, 0);
    assert.match(empty.json.zip.summary, /Nothing from "junk\.zip" was filed/);
  } finally { s.close(); }
});
