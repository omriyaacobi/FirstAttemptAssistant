// html-text.test.js
// A web page inside a zip (a Word file "saved as web page") is a DOCUMENT: its text is taken out, tags and scripts are dropped.
// All pages and zips here are made up.

const test = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");
const { htmlToText, htmlBytesToText } = require("../html-text");
const { unzip, classify, imageSize, MAX_CODE_BYTES, MIN_IMAGE_BYTES } = require("../unzip");
const { zipSummary } = require("../zip-filing");

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
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x800, 8); head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(data), 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
const PNG = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${tag}`.repeat(25000))]);

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hidden title</title><style>p { color: red }</style>
<!--[if gte mso 9]><xml>secret conditional</xml><![endif]--></head>
<body><h1>Lecture 1: מבוא</h1>
<p class=MsoNormal>Eigenvalues &amp; eigenvectors:<br>a &lt; b, caf&eacute; &#1488;&#x5d1; &nbsp;done</p>
<script>alert("never run this"); var x = "<p>fake</p>";</script>
<ul><li>first item</li><li>פריט שני</li></ul>
<p>שלום עולם — Hello world</p>
<table><tr><td>cell A</td><td>cell B</td></tr></table>
<img src="image001.png" alt="x"></body></html>`;

test("HTML: tags, scripts, styles and comments go; entities are decoded; headings and paragraphs keep their breaks; Hebrew stays", () => {
  const t = htmlToText(PAGE);
  assert.match(t, /^# Lecture 1: מבוא\n\nEigenvalues & eigenvectors:\na < b, caf&eacute; אב done/); // a named entity not in the short list stays as written
  assert.match(t, /- first item\n- פריט שני/);
  assert.match(t, /שלום עולם — Hello world/);
  assert.match(t, /cell A \| cell B/);
  assert.doesNotMatch(t, /never run this|fake|Hidden title|color: red|secret conditional|image001/);
});

test("HTML: an unclosed script or comment does not leak its contents, and a page of many '<' with no '>' is fast", () => {
  assert.doesNotMatch(htmlToText("<p>keep</p><script>var a = 1; secret"), /secret/);
  assert.doesNotMatch(htmlToText("<p>keep</p><!-- secret"), /secret/);
  const start = Date.now();
  htmlToText("<a".repeat(2000000));
  assert.ok(Date.now() - start < 3000);
});

test("HTML: bytes with a NUL are refused, a BOM and UTF-16 work, an old Hebrew page that says windows-1255 is read", () => {
  assert.strictEqual(htmlBytesToText(Buffer.from([0x3c, 0x70, 0x3e, 0, 0x41])), null);
  assert.strictEqual(htmlBytesToText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>שלום</p>")])), "שלום");
  assert.strictEqual(htmlBytesToText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<p>hi שלום</p>", "utf16le")])), "hi שלום");
  const old = Buffer.concat([Buffer.from('<meta charset="windows-1255"><p>'), Buffer.from([0xf9, 0xec, 0xe5, 0xed]), Buffer.from("</p>")]);
  assert.strictEqual(htmlBytesToText(old), "שלום");
  assert.strictEqual(htmlBytesToText(Buffer.from([0x3c, 0x70, 0x3e, 0xf9, 0xec, 0x3c, 0x2f, 0x70, 0x3e])), null); // not UTF-8 and no charset: not trusted
});

test("ZIP html: a web page is a DOCUMENT (not code), allowed over 1 MB, filed as text; images are counted as images; code keeps its 1 MB cap", () => {
  assert.strictEqual(classify("notes/page.html"), "html");
  assert.strictEqual(classify("a/b.htm"), "html");
  const line = "<p class=MsoNormal style='margin:0cm;font-size:11.0pt'><span lang=HE>שלום Hello made-up lecture line</span></p>\n";
  const big = `<html><body>${line.repeat(30000)}</body></html>`; // over 3 MB of html, about 1.2 MB of text
  assert.ok(Buffer.byteLength(big) > 3 * 1024 * 1024);
  const zip = buildZip([
    { name: "notes.html", data: big },
    { name: "notes_files/image001.png", data: PNG("a") },
    { name: "notes_files/image002.png", data: PNG("b") },
    { name: "src/page.c", data: "int x;\n".repeat(MAX_CODE_BYTES / 6) }, // a code file over 1 MB is still refused
    { name: "src/main.c", data: "int main(void) { return 0; }\n" },
    { name: "script-only.html", data: "<script>var a = 1;</script>" },
  ]);
  const r = unzip(zip);
  const page = r.files.find((f) => f.name === "notes.html");
  assert.ok(page && page.group === "doc" && page.kind === "text");
  const text = page.bytes.toString("utf8");
  assert.match(text, /^שלום Hello made-up lecture line/);
  assert.ok(!text.includes("<p>"));
  assert.deepStrictEqual(r.files.map((f) => f.kind).sort(), ["code", "image", "image", "text"]);
  assert.deepStrictEqual(r.skipped.map((s) => s.code).sort(), ["codebig", "empty"]);
  const filed = r.files.map((f) => ({ name: f.name, courseName: "Calculus", group: f.group, kind: f.kind }));
  assert.match(zipSummary("en", "n.zip", filed, r.skipped, 0), /I filed 4 files \(1 text file, 2 images, 1 code file\) in Calculus/);
  assert.match(zipSummary("he", "n.zip", filed, r.skipped, 0), /\(קובץ טקסט אחד, 2 תמונות, קובץ קוד אחד\)/);
});

test("ZIP html: a page over 10 MB, a binary file named .html and a page whose text is over 2 MB are skipped with a reason", () => {
  const huge = Buffer.alloc(10 * 1024 * 1024 + 10, 0x61);
  const wide = `<p>${"שלום ".repeat(450000)}</p>`; // about 2.7 MB of text
  const r = unzip(buildZip([
    { name: "huge.html", data: huge },
    { name: "fake.html", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
    { name: "wide.html", data: wide },
  ]));
  assert.strictEqual(r.files.length, 0);
  assert.deepStrictEqual(r.skipped.map((s) => s.code), ["big", "notext", "big"]);
});

test("ZIP small images: a picture under MIN_IMAGE_BYTES is skipped and only counted (any zip); a bigger one is filed; the summary says so in one line", () => {
  const small = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("tiny formula fragment")]);
  const large = Buffer.concat([small.subarray(0, 8), Buffer.alloc(MIN_IMAGE_BYTES + 100, 7)]);
  const r = unzip(buildZip([
    { name: "page_files/image001.png", data: small },
    { name: "page_files/image002.png", data: small },
    { name: "page_files/image003.png", data: large },
    { name: "slide.jpg", data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("tiny")]) },
  ]));
  assert.deepStrictEqual(r.files.map((f) => f.name), ["image003.png"]);
  assert.deepStrictEqual(r.skipped.map((s) => s.code), ["small", "small", "small"]);
  const filed = r.files.map((f) => ({ name: f.name, courseName: "Calculus", group: f.group, kind: f.kind }));
  const en = zipSummary("en", "n.zip", filed, r.skipped, 0);
  assert.match(en, /filed 1 file \(1 image\) in Calculus/);
  assert.match(en, /Skipped 3 small, empty or repeated images \(icons, lines, formulas\)\./);
  assert.doesNotMatch(en, /image001|image002|slide\.jpg|Skipped 3:/); // counted, not listed
  assert.match(zipSummary("he", "n.zip", filed, r.skipped, 0), /דולגו 3 תמונות קטנות, ריקות או כפולות \(אייקונים, קווים, נוסחאות\)\./);
});

// ---- The image rule (judgeImage in unzip.js): pixels, emptiness and repeats, read from the real header. All pictures here are made up. ----
// A PNG with a real header (width x height) and a body of `bytes` bytes: enough for the rule, which never decodes the picture.
function pngOf(w, h, bytes, fill = 7) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8); head.write("IHDR", 12, "latin1"); head.writeUInt32BE(w, 16); head.writeUInt32BE(h, 20);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - 33), fill)]);
}
function jpegOf(w, h) { // SOI, one APP0 segment, then a "start of frame" with the size, then some body
  const app = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14, 1)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof, Buffer.alloc(40000, 9)]);
}

test("IMAGE size: read from a PNG, a JPEG and a WebP header; unreadable bytes give null", () => {
  assert.deepStrictEqual(imageSize(pngOf(640, 480, 100)), { w: 640, h: 480 });
  assert.deepStrictEqual(imageSize(jpegOf(710, 410)), { w: 710, h: 410 });
  const webp = Buffer.alloc(40); webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUIntLE(799, 24, 3); webp.writeUIntLE(599, 27, 3);
  assert.deepStrictEqual(imageSize(webp), { w: 800, h: 600 });
  assert.strictEqual(imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])), null);
  assert.strictEqual(imageSize(Buffer.from([0xff, 0xd8, 0xff])), null);
  assert.strictEqual(imageSize(Buffer.from("hello")), null);
});

test("IMAGE rule: a thin or small picture, a nearly empty one and the same one again are skipped; real-sized ones are kept even when small in bytes", () => {
  const r = unzip(buildZip([
    { name: "p/line.png", data: pngOf(679, 2, 3000) },            // too thin
    { name: "p/bullet.png", data: pngOf(40, 40, 3000) },          // too small
    { name: "p/label.png", data: pngOf(130, 100, 5000) },         // under 20,000 pixels
    { name: "p/blank.png", data: pngOf(400, 265, 1059) },         // about 0.01 bytes per pixel: an empty frame
    { name: "p/code.png", data: pngOf(293, 129, 4740) },          // 4 KB but a real size and not empty: kept (the old 20 KB rule lost it)
    { name: "p/code-again.png", data: pngOf(293, 129, 4740) },    // the same bytes: skipped
    { name: "p/code-other.png", data: pngOf(293, 129, 4740, 8) }, // different bytes: kept
    { name: "p/photo.jpg", data: jpegOf(710, 410) },              // a JPEG, read by its frame header
    { name: "p/fake.png", data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]) }, // no readable size, under 20 KB
  ]));
  assert.deepStrictEqual(r.files.map((f) => f.name), ["code.png", "code-other.png", "photo.jpg"]);
  assert.deepStrictEqual(r.skipped.map((s) => s.code), ["small", "small", "small", "small", "small", "small"]);
  assert.deepStrictEqual(r.skipped.map((s) => s.name), ["p/line.png", "p/bullet.png", "p/label.png", "p/blank.png", "p/code-again.png", "p/fake.png"]);
  assert.match(r.skipped[4].reason, /same image again/);
});
