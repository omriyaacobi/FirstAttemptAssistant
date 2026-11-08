// unzip.js
// Opens a .zip that Omri uploads (for example a folder of lectures) and hands back the files inside, in memory.
// Node's built-ins only (node:zlib), like office.js: this project has no packages, so no new dependency is needed.
//
// A zip from outside is UNTRUSTED. Everything the zip says about itself (names, sizes, types) is a claim, so:
//   - sizes are checked while the data is really unpacked (zlib stops at a limit), not only from the declared size;
//   - an entry's name is NEVER used as a path. Files stay in memory and Bot gives them its own ids (course-routes.js);
//     the name is only shown as text. Names with "..", a leading "/", a drive letter or "\" are skipped anyway (zip-slip).
// Nothing in this file touches the disk.

const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { sniffFile, MAX_TEXT_BYTES } = require("./upload");
const { htmlBytesToText } = require("./html-text");

// ---- Limits. Each one is here so a mistake or a hostile zip cannot fill the memory or the disk of the PC. ----
const MAX_ZIP_BYTES = 200 * 1024 * 1024;       // the zip itself, as uploaded (the page and the server check this too)
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;     // everything unpacked together: stops a "zip bomb" (a tiny zip that unpacks to gigabytes)
const MAX_FILE_BYTES = 50 * 1024 * 1024;       // one unpacked file: the same limit as a single upload (upload.js)
const MAX_FILES = 200;                         // files we keep from one zip (a course's lectures fit comfortably)
const MAX_ENTRIES = 2000;                      // entries we even look at (folders, junk): above this the zip is refused as a whole
const MAX_NAME_CHARS = 200;                    // a longer name is suspicious
// IMAGES (a Word "saved as web page" comes with hundreds: bullets, line pieces, blank frames, labels). Decided in CODE from the picture's
// real header and bytes (judgeImage), never by a model. A picture is skipped, and only COUNTED, when it is:
const MIN_IMAGE_SIDE = 60;                     //   too thin or too small: its short side is under this many pixels (lines, bullets, icons)
const MIN_IMAGE_AREA = 20000;                  //   under this many pixels in all (about 140 x 140): a label or a formula fragment
const MIN_IMAGE_DENSITY = 0.03;                //   nearly empty: fewer than this many compressed bytes per pixel (a blank frame, a flat colour box)
const MIN_IMAGE_BYTES = 20 * 1024;             //   only when the size cannot be read from the header: smaller than this many bytes
//                                             //   (and a picture with the SAME bytes as one already kept from this zip is skipped too)
const MAX_CODE_BYTES = 1024 * 1024;            // one source-code / project text file (real code files are small; a bigger one is usually data)

const MAX_HTML_BYTES = 10 * 1024 * 1024;       // one web page (a Word file "saved as web page" holds ALL its text in one big .html); its TEXT must then fit MAX_TEXT_BYTES

// DOCUMENTS (the same as the single-file upload, upload.js). The REAL type is still checked later by sniffFile on the unpacked
// bytes, so a ".pdf" that is not a PDF is refused there.
const DOC_EXT = /\.(pdf|pptx|docx|txt|md|jpe?g|png|webp)$/i;
// SOURCE CODE and project text files, taken as plain TEXT (a zip from a programming course). They are data: never run, never read as
// instructions. Each one must really BE text (checkCodeBytes), whatever its name says.
const CODE_EXT = /\.(c|h|cc|cpp|cxx|hpp|hh|py|js|mjs|ts|java|cs|go|rs|sh|asm|s|sql|json|csv|yaml|yml|toml|css|tex|mk|cmake|ini|cfg)$/i;
// A web page is a DOCUMENT, not code: its text is taken out (html-text.js) and filed like a text file. It is never rendered or run.
const HTML_EXT = /.html?$/i;
const CODE_NAMES = new Set(["makefile", "readme", "license", "dockerfile"]); // extensionless names, any case
// Compiled / binary leftovers and tool folders: never read, and only COUNTED in the summary (not listed one by one).
const JUNK_EXT = /\.(o|a|so|dll|exe|obj|class|pyc|pyo|lib|dylib|elf|out|bin|dSYM|jar)$/i;
const JUNK_DIRS = new Set(["node_modules", "__pycache__", ".git", "build", "dist", "target", "obj", ".venv", "venv"]);

const fail = (status, message) => Object.assign(new Error(message), { status });

// Does this look like a zip at all? ("PK" then 03 04 = a file, or 05 06 = an empty zip.)
function looksLikeZip(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

// The table of contents at the end of the zip. Returns a list of { name, flags, method, packed, size, offset, madeBy, attrs }.
function readDirectory(bytes) {
  const from = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail(400, "this zip is damaged (no table of contents)");
  const count = bytes.readUInt16LE(eocd + 10);
  let pos = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || pos === 0xffffffff) throw fail(415, "zips this large (zip64) are not supported");
  if (count > MAX_ENTRIES) throw fail(413, `this zip has too many entries (${MAX_ENTRIES} at most)`);
  const list = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || bytes.readUInt32LE(pos) !== 0x02014b50) throw fail(400, "this zip is damaged");
    const nameLen = bytes.readUInt16LE(pos + 28);
    const extraLen = bytes.readUInt16LE(pos + 30);
    const commentLen = bytes.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > bytes.length) throw fail(400, "this zip is damaged");
    list.push({
      madeBy: bytes.readUInt16LE(pos + 4) >> 8, // 3 = made on Unix, where the file type is kept in the attributes
      flags: bytes.readUInt16LE(pos + 8),
      method: bytes.readUInt16LE(pos + 10),
      packed: bytes.readUInt32LE(pos + 20),
      size: bytes.readUInt32LE(pos + 24),
      attrs: bytes.readUInt32LE(pos + 38),
      offset: bytes.readUInt32LE(pos + 42),
      raw: bytes.subarray(pos + 46, pos + 46 + nameLen),
      utf8: (bytes.readUInt16LE(pos + 8) & 0x800) !== 0,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return list.map((e) => ({ ...e, name: e.raw.toString(e.utf8 ? "utf8" : "latin1") }));
}

// Why is this name not acceptable? Returns text, or null if it is fine. The name is only ever DISPLAYED (see top of file).
function badName(name) {
  if (!name || name.length > MAX_NAME_CHARS) return "the name is empty or too long";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "the name has control characters";
  if (name.includes("\\")) return "the name has a backslash"; // Windows-style path
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return "the name is an absolute path";
  const parts = name.split("/");
  if (parts.includes("..")) return "the name tries to leave the folder (..)";
  if (parts.some((p) => p.startsWith("."))) return "hidden file"; // .DS_Store, .git, ._ files and so on
  if (parts[0] === "__MACOSX") return "macOS metadata";
  return null;
}

// "junk" = compiled or tool leftovers (counted only); "code" = a source/project text file; "doc" = a document; "html" = a web page
// (its text is taken out); null = unknown type.
function classify(name) {
  const parts = name.split("/");
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((p) => JUNK_DIRS.has(p) || /^cmake-build-/i.test(p))) return "junk";
  if (JUNK_EXT.test(base)) return "junk";
  if (DOC_EXT.test(base)) return "doc";
  if (HTML_EXT.test(base)) return "html";
  if (CODE_EXT.test(base) || CODE_NAMES.has(base.toLowerCase())) return "code";
  return null;
}

// A code file must REALLY be text, by its bytes: no NUL, valid UTF-8, few control characters, and sniffFile (the same check as a
// single upload) must call it text, so a PDF or a program renamed ".c" is refused. Returns true when it is fine.
function looksLikeText(data) {
  if (data.includes(0)) return false;
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch (error) { return false; }
  const odd = (text.match(/[\u0001-\u0008\u000b\u000e-\u001f\u007f]/g) || []).length;
  if (odd > Math.max(2, text.length / 100)) return false;
  try { return sniffFile(data).kind === "text"; } catch (error) { return false; }
}

// What a document is, for the summary ("1 text file, 149 images, 27 code files"). Decided from the name only; sniffFile checks the real bytes.
function kindOf(name, group) {
  if (group === "code") return "code";
  if (group === "html") return "text";
  if (/.pdf$/i.test(name)) return "pdf";
  if (/.(pptx|docx)$/i.test(name)) return "office";
  if (/.(jpe?g|png|webp)$/i.test(name)) return "image";
  return "text";
}

// The pixel size of a PNG, JPEG or WebP, read from its header (no package). Returns { w, h } or null when it cannot be read.
function imageSize(b) {
  try {
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b.toString("latin1", 12, 16) === "IHDR") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: hop from marker to marker until the "start of frame", which holds the size
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; } // padding
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += m === 0x01 || (m >= 0xd0 && m <= 0xd9) ? 2 : 2 + b.readUInt16BE(i + 2); // a few markers have no length
      }
      return null;
    }
    if (b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
      const kind = b.toString("latin1", 12, 16);
      if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8L") { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
      if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    }
  } catch (error) { /* a cut-off header */ }
  return null;
}

// Is this picture worth keeping for studying? Returns null (keep) or { reason, code } to skip it (counted only). `seen` holds the
// fingerprints of the pictures already kept from this zip. Easy to read on purpose: size and bytes only, never what the picture shows.
function judgeImage(data, seen) {
  const size = imageSize(data);
  if (!size) { if (data.length < MIN_IMAGE_BYTES) return { reason: "a small image (icon or formula fragment)", code: "small" }; }
  else {
    if (Math.min(size.w, size.h) < MIN_IMAGE_SIDE || size.w * size.h < MIN_IMAGE_AREA) return { reason: "a small or thin image (icon, line or formula fragment)", code: "small" };
    if (data.length / (size.w * size.h) < MIN_IMAGE_DENSITY) return { reason: "a nearly empty image (blank frame or flat box)", code: "small" };
  }
  const print = crypto.createHash("sha1").update(data).digest("hex");
  if (seen.has(print)) return { reason: "the same image again", code: "small" };
  seen.add(print);
  return null;
}

// Unpacks the zip. Returns { files: [{ name, path, group, bytes }], skipped: [{ name, reason, code }] }.
// group is "doc" or "code". path is the name inside the zip (shown only, never used as a path). code is a short stable key for the
// reason, so the summary can be written in the user's language; "junk" ones are only counted there.
// Throws (status 400 / 413 / 415) when the whole zip must be refused: damaged, too many entries, or it unpacks to too much.
function unzip(bytes) {
  if (!looksLikeZip(bytes)) throw fail(400, "this is not a zip file");
  if (bytes.length > MAX_ZIP_BYTES) throw fail(413, `the zip is too big (${Math.round(MAX_ZIP_BYTES / 1048576)} MB at most)`);
  const entries = readDirectory(bytes);
  const files = [];
  const skipped = [];
  const seenImages = new Set(); // fingerprints of the pictures kept so far
  let total = 0; // bytes REALLY unpacked so far
  for (const e of entries) {
    const shown = e.name.replace(/[\u0000-\u001f\u007f<>]+/g, " ").slice(0, 80); // safe to show; never used as a path
    const skip = (reason, code = "other") => skipped.push({ name: shown, reason, code });
    if (e.name.endsWith("/")) continue; // a folder: nothing to say
    const bad = badName(e.name);
    if (bad) { skip(bad, /^(hidden file|macOS metadata)$/.test(bad) ? "junk" : "name"); continue; }
    // A symlink is a "file" whose content is a path to somewhere else. Unix zips mark it in the attributes (0xA000 = symlink).
    if (e.madeBy === 3 && ((e.attrs >>> 16) & 0xf000) === 0xa000) { skip("symbolic link", "link"); continue; }
    if (/\.zip$/i.test(e.name)) { skip("a zip inside a zip is not opened", "nested"); continue; }
    const group = classify(e.name);
    if (group === "junk") { skip("compiled or tool leftover", "junk"); continue; }
    const extless = !group && !e.name.split("/").pop().includes("."); // no extension at all (an executable named like the project): its BYTES decide below
    if (!group && !extless) { skip("this type is not supported", "type"); continue; }
    if (e.flags & 1) { skip("password-protected", "password"); continue; }
    if (e.method !== 0 && e.method !== 8) { skip("unknown compression", "compression"); continue; }
    if (files.length >= MAX_FILES) { skip(`more than ${MAX_FILES} files: the rest are left out`, "toomany"); continue; }
    if (group === "code" && e.size > MAX_CODE_BYTES) { skip(`a code file over ${Math.round(MAX_CODE_BYTES / 1048576)} MB`, "codebig"); continue; }
    if (group === "html" && e.size > MAX_HTML_BYTES) { skip(`a web page over ${Math.round(MAX_HTML_BYTES / 1048576)} MB`, "big"); continue; }
    if (e.size > MAX_FILE_BYTES) { skip(`over ${Math.round(MAX_FILE_BYTES / 1048576)} MB`, "big"); continue; }
    if (e.offset + 30 > bytes.length || bytes.readUInt32LE(e.offset) !== 0x04034b50) throw fail(400, "this zip is damaged");
    const start = e.offset + 30 + bytes.readUInt16LE(e.offset + 26) + bytes.readUInt16LE(e.offset + 28);
    const packed = bytes.subarray(start, start + e.packed);
    if (packed.length !== e.packed) throw fail(400, "this zip is damaged (a file is cut off)");
    // The size the zip DECLARES is only a claim, so it is never trusted: zlib is told to stop as soon as the output is bigger than
    // the declared size. A zip that expands past what it declared is lying (a zip bomb), so the WHOLE zip is refused.
    // The declared sizes also add up against the total limit BEFORE anything is unpacked, so honest-but-huge zips stop early too.
    if (total + e.size > MAX_TOTAL_BYTES) throw fail(413, `this zip unpacks to more than ${Math.round(MAX_TOTAL_BYTES / 1048576)} MB, so it was not opened`);
    total += e.size; // counted as declared; a file whose real size differs is skipped below, so the real total can only be smaller
    let data;
    try {
      data = e.method === 0 ? packed : zlib.inflateRawSync(packed, { maxOutputLength: Math.max(1, e.size) });
    } catch (error) {
      if (error.code === "ERR_BUFFER_TOO_LARGE") throw fail(400, "this zip is not honest about its sizes, so it was not opened");
      throw fail(400, "this zip is damaged (a file could not be unpacked)");
    }
    if (data.length !== e.size) { skip("damaged (the size does not match)", "damaged"); continue; }
    if (data.length === 0) { skip("empty file", "empty"); continue; }
    if (group === "doc" && kindOf(e.name, group) === "image") { const no = judgeImage(data, seenImages); if (no) { skip(no.reason, no.code); continue; } }
    if (extless) { // text without an extension is not filed (unknown type); anything else (NUL bytes, not UTF-8) is a compiled leftover
      if (looksLikeText(data)) skip("this type is not supported", "type"); else skip("compiled or tool leftover", "junk");
      continue;
    }
    if (group === "code" && !looksLikeText(data)) { skip("not really text (it looks like a binary file)", "notext"); continue; }
    const base = e.name.split("/").pop();
    if (group === "html") { // the text of the page, as plain UTF-8 bytes (the page itself is never kept)
      const text = htmlBytesToText(data);
      if (text === null) { skip("not really text (it does not look like a web page)", "notext"); continue; }
      if (!text) { skip("a web page with no text", "empty"); continue; }
      const out = Buffer.from(text, "utf8");
      if (out.length > MAX_TEXT_BYTES) { skip(`the text of this page is over ${Math.round(MAX_TEXT_BYTES / 1048576)} MB`, "big"); continue; }
      files.push({ name: base, path: shown, group: "doc", kind: "text", bytes: out });
      continue;
    }
    files.push({ name: base, path: shown, group, kind: kindOf(e.name, group), bytes: data });
  }
  return { files, skipped };
}

module.exports = { unzip, looksLikeZip, classify, MAX_HTML_BYTES, MIN_IMAGE_BYTES, MIN_IMAGE_SIDE, MIN_IMAGE_AREA, MIN_IMAGE_DENSITY, imageSize, judgeImage, MAX_CODE_BYTES, MAX_ZIP_BYTES, MAX_TOTAL_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_ENTRIES };
