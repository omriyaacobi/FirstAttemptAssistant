// pdfcut.test.js: the PDF cutter, on small PDFs built right here (no real files, no model).

const test = require("node:test");
const assert = require("node:assert");
const { openPdf } = require("../pdfcut");

// Builds a PDF from { id: "dictionary text" or { dict, stream } }. Objects are written in the order given, with a real table of contents.
function buildPdf(objects, trailer = "/Root 1 0 R") {
  const parts = [Buffer.from("%PDF-1.3\n")];
  let offset = parts[0].length;
  const at = {};
  for (const [id, value] of objects) {
    const dict = typeof value === "string" ? value : value.dict;
    const stream = typeof value === "string" ? null : Buffer.from(value.stream, "latin1");
    const bytes = stream
      ? Buffer.concat([Buffer.from(`${id} 0 obj\n${dict}\nstream\n`), stream, Buffer.from("\nendstream\nendobj\n")])
      : Buffer.from(`${id} 0 obj\n${dict}\nendobj\n`);
    at[id] = offset;
    parts.push(bytes);
    offset += bytes.length;
  }
  const top = Math.max(...objects.map(([id]) => id));
  const rows = ["0000000000 65535 f\r"];
  for (let id = 1; id <= top; id++) rows.push(at[id] === undefined ? "0000000000 65535 f\r" : `${String(at[id]).padStart(10, "0")} 00000 n\r`);
  parts.push(Buffer.from(`xref\n0 ${top + 1}\n${rows.join("\n")}\ntrailer\n<< /Size ${top + 1} ${trailer} >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

// Three pages whose objects are NOT in reading order. Each page has its own drawing and shares one font.
const threePages = () => buildPdf([
  [1, "<< /Type /Catalog /Pages 2 0 R >>"],
  [2, "<< /Type /Pages /Count 3 /Kids [ 5 0 R 3 0 R 7 0 R ] /Resources << /Font << /F1 9 0 R >> >> /MediaBox [0 0 612 792] >>"],
  [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"],
  [4, { dict: "<< /Length 6 >>", stream: "SECOND" }],
  [5, "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>"],
  [6, { dict: "<< /Length 5 >>", stream: "FIRST" }],
  [7, "<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>"],
  [8, { dict: "<< /Length 5 >>", stream: "THIRD" }],
  [9, "<< /Type /Font /Subtype /TrueType /FontDescriptor 10 0 R >>"],
  [10, { dict: "<< /Length 8 >>", stream: "FONTDATA" }],
]);

// Every entry of the table of contents must point at the object it names: a reader finds objects through this table.
function checkTable(pdf) {
  const text = pdf.toString("latin1");
  const start = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.strictEqual(text.slice(start, start + 4), "xref");
  const rows = text.slice(start).split("\n").slice(2);
  rows.forEach((row, id) => {
    const m = /^(\d{10}) (\d{5}) n/.exec(row);
    if (m) assert.ok(text.startsWith(`${id} ${Number(m[2])} obj`, Number(m[1])), `object ${id} is not where the table says`);
  });
}

test("cuts one page: only that page's objects, in a valid new file", () => {
  const out = openPdf(threePages()).cut(2, 2);
  const text = out.toString("latin1");
  assert.ok(text.includes("SECOND"));
  assert.ok(!text.includes("FIRST"));
  assert.ok(!text.includes("THIRD"));
  assert.ok(text.includes("FONTDATA"), "a shared font is copied too (reached through the inherited resources)");
  assert.ok(text.includes("/MediaBox [0 0 612 792]"), "what the page inherited from its parent moves onto the page");
  checkTable(out);
  assert.strictEqual(openPdf(out).pageCount, 1);
});

test("pages come in reading order (the page list), not in the order of the objects in the file", () => {
  const pdf = openPdf(threePages());
  assert.strictEqual(pdf.pageCount, 3);
  assert.ok(pdf.cut(1, 1).toString("latin1").includes("FIRST"));
  assert.ok(pdf.cut(3, 3).toString("latin1").includes("THIRD"));
});

test("a range keeps its pages in order, and a cut of a cut still works", () => {
  const out = openPdf(threePages()).cut(1, 2);
  const again = openPdf(out);
  assert.strictEqual(again.pageCount, 2);
  assert.ok(again.cut(2, 2).toString("latin1").includes("SECOND"));
  assert.ok(!again.cut(2, 2).toString("latin1").includes("FIRST"));
});

test("a range past the last page gives the pages that exist; a range with no pages gives null", () => {
  const pdf = openPdf(threePages());
  assert.strictEqual(openPdf(pdf.cut(3, 9)).pageCount, 1);
  assert.strictEqual(pdf.cut(4, 9), null);
});

test("a link to another page does not drag that page in", () => {
  const out = openPdf(buildPdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 2 /Kids [ 3 0 R 5 0 R ] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 9 9] /Annots [ << /Dest [ 5 0 R /Fit ] >> ] >>"],
    [4, { dict: "<< /Length 3 >>", stream: "ONE" }],
    [5, "<< /Type /Page /Parent 2 0 R /Contents 6 0 R /MediaBox [0 0 9 9] >>"],
    [6, { dict: "<< /Length 3 >>", stream: "TWO" }],
  ])).cut(1, 1);
  assert.ok(!out.toString("latin1").includes("TWO"));
  checkTable(out);
});

test("bytes inside a stream that look like an object are not taken for one", () => {
  const out = openPdf(buildPdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 1 /Kids [ 3 0 R ] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 9 9] >>"],
    [4, { dict: "<< /Length 31 >>", stream: "\n3 0 obj << /Type /Catalog >> \n " }],
  ])).cut(1, 1);
  assert.ok(out.toString("latin1").includes("/Type /Page"));
  assert.strictEqual(openPdf(out).pageCount, 1);
});

test("a stream whose length is stored in another object is still read and copied", () => {
  const out = openPdf(buildPdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 1 /Kids [ 3 0 R ] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 9 9] >>"],
    [4, { dict: "<< /Length 5 0 R >>", stream: "DRAWING" }],
    [5, "7"],
  ])).cut(1, 1);
  assert.ok(out.toString("latin1").includes("DRAWING"));
  checkTable(out);
});

test("a later copy of an object replaces the earlier one (how a PDF is edited)", () => {
  const out = openPdf(buildPdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 1 /Kids [ 3 0 R ] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 9 9] >>"],
    [4, { dict: "<< /Length 3 >>", stream: "OLD" }],
    [4, { dict: "<< /Length 3 >>", stream: "NEW" }],
  ])).cut(1, 1);
  assert.ok(out.toString("latin1").includes("NEW"));
  assert.ok(!out.toString("latin1").includes("OLD"));
});

test("hostile or unsupported files give null or a safe result, never a hang or a throw", () => {
  assert.strictEqual(openPdf(Buffer.from("not a pdf")), null);
  assert.strictEqual(openPdf("%PDF-1.3"), null);
  assert.strictEqual(openPdf(Buffer.from("%PDF-1.3\nnothing here")), null);
  const encrypted = buildPdf([[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, "<< /Type /Pages /Count 0 /Kids [ ] >>"]], "/Root 1 0 R /Encrypt 3 0 R");
  assert.strictEqual(openPdf(encrypted), null);
  // A page list that points back at itself must end, not loop for ever.
  const loop = openPdf(buildPdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 1 /Kids [ 2 0 R 3 0 R ] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 9 9] >>"],
  ]));
  assert.strictEqual(loop.pageCount, 1);
  // A cut-off file: an object with no end.
  assert.strictEqual(openPdf(Buffer.from("%PDF-1.3\n1 0 obj\n<< /Length 5 >>\nstream\nabc")), null);
});

// ---- object streams (2026-11-16): newer PDFs pack their small objects into one compressed object ----
const zlib = require("node:zlib");
// One object stream holding the given [id, "dictionary text"] pairs, as the { dict, stream } buildPdf takes.
function objStm(members, { extra = "", pack = (b) => zlib.deflateSync(b) } = {}) {
  let head = "";
  let body = "";
  for (const [id, text] of members) { head += `${id} ${body.length} `; body += text + "\n"; }
  const data = pack(Buffer.from(head + body, "latin1"));
  return { dict: `<< /Type /ObjStm /N ${members.length} /First ${head.length} /Filter /FlateDecode /Length ${data.length} ${extra}>>`, stream: data.toString("latin1") };
}
// The same three pages as above, but the catalog, the page list, the pages and the font sit inside an object stream (as Word and LaTeX write them).
const packedPages = (options) => buildPdf([
  [4, { dict: "<< /Length 6 >>", stream: "SECOND" }],
  [6, { dict: "<< /Length 5 >>", stream: "FIRST" }],
  [8, { dict: "<< /Length 5 >>", stream: "THIRD" }],
  [10, { dict: "<< /Length 8 >>", stream: "FONTDATA" }],
  [11, objStm([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 3 /Kids [ 5 0 R 3 0 R 7 0 R ] /Resources << /Font << /F1 9 0 R >> >> /MediaBox [0 0 612 792] >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"],
    [5, "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>"],
    [7, "<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>"],
    [9, "<< /Type /Font /Subtype /TrueType /FontDescriptor 10 0 R >>"],
  ], options)],
]);

test("a PDF that keeps its pages inside an object stream can be cut (it was read whole before)", () => {
  const pdf = openPdf(packedPages());
  assert.ok(pdf, "the file opens");
  assert.strictEqual(pdf.pageCount, 3);
  const out = pdf.cut(2, 2);
  const text = out.toString("latin1");
  assert.ok(text.includes("SECOND") && !text.includes("FIRST") && !text.includes("THIRD"));
  assert.ok(text.includes("FONTDATA"), "the shared font, named only inside the object stream, is copied too");
  assert.ok(text.includes("/MediaBox [0 0 612 792]"), "what the page inherited moves onto the page");
  assert.ok(!text.includes("/ObjStm"), "the cut file holds plain objects only");
  assert.ok(/\n3 0 obj\n<< \/Parent \d+ 0 R/.test(text) || /3 0 obj\n<<[^>]*\/Parent \d+ 0 R/.test(text), "the page is written out as a normal object that points at the new page list");
  checkTable(out);
  const again = openPdf(out);
  assert.strictEqual(again.pageCount, 1);
  assert.ok(openPdf(pdf.cut(1, 3)).cut(3, 3).toString("latin1").includes("THIRD"), "a cut of a cut still works");
});

test("an object stream Bot cannot unpack safely gives null (the file is then read whole, as before)", () => {
  assert.strictEqual(openPdf(packedPages({ extra: "/DecodeParms << /Predictor 12 >> " })), null, "extra unpacking parameters");
  assert.strictEqual(openPdf(packedPages({ pack: (b) => Buffer.from("this is not compressed data at all") })), null, "damaged data");
  // offsets that point past the end of the unpacked data
  const lying = buildPdf([[11, (() => { const data = zlib.deflateSync(Buffer.from("1 0 2 999999 << /Type /Catalog >>")); return { dict: `<< /Type /ObjStm /N 2 /First 13 /Filter /FlateDecode /Length ${data.length} >>`, stream: data.toString("latin1") }; })()]]);
  assert.strictEqual(openPdf(lying), null);
  // a tiny stream that unpacks to far more than the limit (a "zip bomb") is refused, not unpacked
  const bomb = zlib.deflateSync(Buffer.alloc(30 * 1024 * 1024, 32));
  assert.ok(bomb.length < 100 * 1024);
  assert.strictEqual(openPdf(buildPdf([[11, { dict: `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${bomb.length} >>`, stream: bomb.toString("latin1") }]])), null);
});

test("a newer copy of an object outside the stream replaces the packed one", () => {
  const pdf = packedPages();
  const edited = Buffer.concat([pdf, Buffer.from("3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>\nendobj\n")]);
  assert.ok(openPdf(edited).cut(2, 2).toString("latin1").includes("THIRD"), "page 2 now shows the newer drawing");
});
