const test = require("node:test");
const assert = require("node:assert");
const { sniffOffice, readOffice } = require("../office");
const { sniffFile } = require("../upload");

const { makeZip } = require("./testzip");

const slide = (...lines) => `<p:sld><p:txBody>${lines.map((l) => `<a:p><a:r><a:rPr lang="en"/><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sld>`;
const pptx = () => makeZip({
  "[Content_Types].xml": "<Types/>",
  "ppt/presentation.xml": "<p:presentation/>",
  "ppt/slides/slide10.xml": slide("Last"),
  "ppt/slides/slide2.xml": slide("Limits &amp; series", "x &lt; 3"),
  "ppt/slides/slide1.xml": slide("Title slide"),
});
const docx = () => makeZip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": '<w:document><w:body><w:p><w:pPr/><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>שלום</w:t></w:r><w:r><w:tab/><w:t>&#1488;</w:t></w:r></w:p><w:p/></w:body></w:document>',
});

test("a PowerPoint file is recognised by its parts, and its slides are read in slide order", () => {
  assert.equal(sniffOffice(pptx()), "pptx");
  const r = readOffice(pptx());
  assert.deepEqual(r.slides, ["Title slide", "Limits & series\nx < 3", "Last"]);
});

test("a Word file is read paragraph by paragraph, Hebrew and entities included", () => {
  assert.equal(sniffOffice(docx()), "docx");
  assert.deepEqual(readOffice(docx()).paragraphs, ["Hello world", "שלום\tא"]);
});

test("stored (uncompressed) parts work too", () => {
  const r = readOffice(makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:p><w:r><w:t>plain</w:t></w:r></w:p>" }, { compress: false }));
  assert.deepEqual(r.paragraphs, ["plain"]);
});

test("uploads: Office files are sniffed by content; other ZIPs and damaged files are refused", () => {
  assert.deepEqual(sniffFile(pptx()), { kind: "office", ext: ".pptx" });
  assert.deepEqual(sniffFile(docx()), { kind: "office", ext: ".docx" });
  assert.throws(() => sniffFile(makeZip({ "readme.txt": "hi" })), (e) => e.status === 415);
  assert.throws(() => sniffFile(docx().subarray(0, 60)), (e) => e.status === 415);
  assert.equal(sniffOffice(Buffer.from("PK\x03\x04 not really a zip, only starts like one", "latin1")), null);
});

test("a zip bomb is refused: a part that claims or unpacks to too much is never inflated", () => {
  const big = makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:p><w:t>" + "a".repeat(21 * 1024 * 1024) + "</w:t></w:p>" });
  assert.throws(() => readOffice(big), /too much data/);
});
