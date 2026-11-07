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

// ---- Limits. Each one is here so a mistake or a hostile zip cannot fill the memory or the disk of the PC. ----
const MAX_ZIP_BYTES = 200 * 1024 * 1024;       // the zip itself, as uploaded (the page and the server check this too)
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;     // everything unpacked together: stops a "zip bomb" (a tiny zip that unpacks to gigabytes)
const MAX_FILE_BYTES = 50 * 1024 * 1024;       // one unpacked file: the same limit as a single upload (upload.js)
const MAX_FILES = 200;                         // files we keep from one zip (a course's lectures fit comfortably)
const MAX_ENTRIES = 2000;                      // entries we even look at (folders, junk): above this the zip is refused as a whole
const MAX_NAME_CHARS = 200;                    // a longer name is suspicious

// Only these types are taken (the same as the single-file upload, upload.js). The REAL type is still checked later by
// sniffFile on the unpacked bytes, so a ".pdf" that is not a PDF is refused there.
const ALLOWED_EXT = /\.(pdf|pptx|docx|txt|md|jpe?g|png|webp)$/i;

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

// Unpacks the zip. Returns { files: [{ name, bytes }], skipped: [{ name, reason }] }.
// Throws (status 400 / 413 / 415) when the whole zip must be refused: damaged, too many entries, or it unpacks to too much.
function unzip(bytes) {
  if (!looksLikeZip(bytes)) throw fail(400, "this is not a zip file");
  if (bytes.length > MAX_ZIP_BYTES) throw fail(413, `the zip is too big (${Math.round(MAX_ZIP_BYTES / 1048576)} MB at most)`);
  const entries = readDirectory(bytes);
  const files = [];
  const skipped = [];
  let total = 0; // bytes REALLY unpacked so far
  for (const e of entries) {
    const shown = e.name.replace(/[\u0000-\u001f\u007f<>]+/g, " ").slice(0, 80); // safe to show; never used as a path
    const skip = (reason) => skipped.push({ name: shown, reason });
    if (e.name.endsWith("/")) continue; // a folder: nothing to say
    const bad = badName(e.name);
    if (bad) { skip(bad); continue; }
    // A symlink is a "file" whose content is a path to somewhere else. Unix zips mark it in the attributes (0xA000 = symlink).
    if (e.madeBy === 3 && ((e.attrs >>> 16) & 0xf000) === 0xa000) { skip("symbolic link"); continue; }
    if (/\.zip$/i.test(e.name)) { skip("a zip inside a zip is not opened"); continue; }
    if (!ALLOWED_EXT.test(e.name)) { skip("this type is not supported"); continue; }
    if (e.flags & 1) { skip("password-protected"); continue; }
    if (e.method !== 0 && e.method !== 8) { skip("unknown compression"); continue; }
    if (files.length >= MAX_FILES) { skip(`more than ${MAX_FILES} files: the rest are left out`); continue; }
    if (e.size > MAX_FILE_BYTES) { skip(`over ${Math.round(MAX_FILE_BYTES / 1048576)} MB`); continue; }
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
    if (data.length !== e.size) { skip("damaged (the size does not match)"); continue; }
    if (data.length === 0) { skip("empty file"); continue; }
    files.push({ name: e.name.split("/").pop(), bytes: data });
  }
  return { files, skipped };
}

module.exports = { unzip, looksLikeZip, MAX_ZIP_BYTES, MAX_TOTAL_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_ENTRIES };
