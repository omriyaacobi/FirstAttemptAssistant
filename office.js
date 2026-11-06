// office.js
// A tiny reader for Word (.docx) and PowerPoint (.pptx) files, with Node's built-ins only (no packages).
// Both are ZIP files holding XML. We read the ZIP's table of contents, unpack only the few XML parts we need,
// and pull the text out of them. No model is involved, and nothing in the file is ever run.
//
// The file is untrusted: every size is checked before unpacking (a "zip bomb" is a tiny file that unpacks to
// gigabytes), and only the fixed part names below are ever read, never a name chosen by the file.

const zlib = require("node:zlib");

const MAX_PART_BYTES = 20 * 1024 * 1024; // one unpacked XML part
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // everything we unpack from one file

const fail = (message) => Object.assign(new Error(message), { status: 415 });

// The ZIP's table of contents: Map of part name -> { method, size, packed, offset }. Throws if it is not a ZIP.
function zipEntries(bytes) {
  const from = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail("this file is damaged (it is not a valid Office file)");
  const count = bytes.readUInt16LE(eocd + 10);
  let pos = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw fail("this Office file has too many parts");
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || bytes.readUInt32LE(pos) !== 0x02014b50) throw fail("this file is damaged (it is not a valid Office file)");
    const nameLen = bytes.readUInt16LE(pos + 28);
    const extraLen = bytes.readUInt16LE(pos + 30);
    const commentLen = bytes.readUInt16LE(pos + 32);
    const name = bytes.toString("utf8", pos + 46, pos + 46 + nameLen);
    entries.set(name, { method: bytes.readUInt16LE(pos + 10), packed: bytes.readUInt32LE(pos + 20), size: bytes.readUInt32LE(pos + 24), offset: bytes.readUInt32LE(pos + 42) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// The unpacked text of one part, or null if it is not there.
function readPart(bytes, entries, name, budget) {
  const e = entries.get(name);
  if (!e) return null;
  if (e.size > MAX_PART_BYTES || budget.left < e.size) throw fail("this Office file unpacks to too much data");
  if (e.offset + 30 > bytes.length || bytes.readUInt32LE(e.offset) !== 0x04034b50) throw fail("this file is damaged (it is not a valid Office file)");
  const start = e.offset + 30 + bytes.readUInt16LE(e.offset + 26) + bytes.readUInt16LE(e.offset + 28);
  const packed = bytes.subarray(start, start + e.packed);
  let out;
  try {
    out = e.method === 0 ? packed : zlib.inflateRawSync(packed, { maxOutputLength: MAX_PART_BYTES });
  } catch (error) {
    throw fail("this Office file could not be unpacked");
  }
  budget.left -= out.length;
  return out.toString("utf8");
}

// "docx", "pptx" or null, from the part names inside a ZIP.
function sniffOffice(bytes) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return null;
  let entries;
  try { entries = zipEntries(bytes); } catch (error) { return null; }
  if (entries.has("word/document.xml") && entries.has("[Content_Types].xml")) return "docx";
  if (entries.has("ppt/presentation.xml") && entries.has("[Content_Types].xml")) return "pptx";
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (all, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

// The text of one XML part: paragraphs (<a:p> or <w:p>) one per line, runs (<a:t> or <w:t>) joined.
function paragraphsOf(xml, p, t) {
  const out = [];
  for (const para of xml.match(new RegExp(`<${p}[ >][\\s\\S]*?</${p}>`, "g")) || []) {
    const text = para
      .replace(/<w:tab\/>/g, "<w:t>\t</w:t>")
      .replace(/<(?:w:br|a:br)[^>]*\/>/g, `<${t}>\n</${t}>`)
      .match(new RegExp(`<${t}(?: [^>]*)?>[\\s\\S]*?</${t}>`, "g"));
    const line = (text || []).map((run) => decodeXml(run.replace(/<[^>]*>/g, ""))).join("").trim();
    if (line) out.push(line);
  }
  return out;
}

// bytes of a .docx or .pptx -> { kind, paragraphs } (docx: all text) or { kind, slides: [text per slide] } (pptx).
function readOffice(bytes) {
  const kind = sniffOffice(bytes);
  if (!kind) throw fail("this file is not a readable Word or PowerPoint file");
  const entries = zipEntries(bytes);
  const budget = { left: MAX_TOTAL_BYTES };
  if (kind === "docx") {
    const xml = readPart(bytes, entries, "word/document.xml", budget);
    return { kind, paragraphs: paragraphsOf(xml, "w:p", "w:t") };
  }
  const numbered = [...entries.keys()].map((name) => ({ name, m: /^ppt\/slides\/slide(\d{1,4})\.xml$/.exec(name) })).filter((x) => x.m).sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  return { kind, slides: numbered.map((s) => paragraphsOf(readPart(bytes, entries, s.name, budget), "a:p", "a:t").join("\n")) };
}

module.exports = { sniffOffice, readOffice, zipEntries, decodeXml };
