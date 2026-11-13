// upload.js
// Checks a course file that arrives from the web page. Nothing here trusts the sender: the type is
// decided by the REAL first bytes (like photo.js), never by the file name or the Content-Type header.
//
// Unlike /api/ask (20 KB, or a few MB with a photo), a course file can be big, so it travels as raw
// bytes (no base64, which would add a third) and has its own limit.

const { sniffImage } = require("./photo");
const { sniffOffice } = require("./office");

const MAX_FILE_BYTES = 50 * 1024 * 1024; // one file
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // a plain-text file is read directly, so it can be smaller
const MAX_NAME_CHARS = 120;

const fail = (status, message) => Object.assign(new Error(message), { status });

// The kind of a file from its content: { kind: "pdf" | "image" | "office" | "text", ext } or throws a 415.
function sniffFile(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw fail(400, "the file is empty");
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", ext: ".pdf" };
  const image = sniffImage(bytes);
  if (image) return { kind: "image", ext: image };
  const office = sniffOffice(bytes); // Word and PowerPoint files are ZIPs with known parts inside
  if (office) return { kind: "office", ext: "." + office };
  if (bytes.length <= MAX_TEXT_BYTES && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes); // throws on bytes that are not valid UTF-8
      return { kind: "text", ext: ".txt" };
    } catch (error) { /* not text */ }
  }
  throw fail(415, "this file type is not supported: use a PDF, a PowerPoint (.pptx) or Word (.docx) file, a JPEG/PNG/WebP photo or a plain text file (UTF-8, up to 2 MB). Older .ppt or .doc: save as .pptx / .docx or PDF first");
}

// The name shown in the list. It is only ever displayed as text and never used as a path.
function cleanName(name, fallback = "file") {
  const clean = String(name || "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return clean || fallback;
}

// The FOLDER a file sat in inside a zip ("operation_b7/mission2"), kept as a LABEL so Bot can tell "the README inside mission2" from
// the others. Display text ONLY: it is never joined into a disk path (files are stored by random id, courses.js). Cleaned here, by code:
// control characters and <> removed, "\" read as "/", empty, "." and ".." parts dropped, each part clipped to 60 characters, and at
// most 200 characters in all (the innermost folders are kept, the outer ones cut, marked with "…/"). "" = no folder.
const MAX_FOLDER_CHARS = 200;
const MAX_FOLDER_PART = 60;
function cleanFolder(folder) {
  const parts = String(folder || "").replace(/\\/g, "/").split("/")
    .map((p) => p.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_PART).trim())
    .filter((p) => p && p !== "." && p !== ".." && !/^[a-zA-Z]:$/.test(p));
  let out = parts.join("/");
  while (out.length > MAX_FOLDER_CHARS && parts.length > 1) { parts.shift(); out = "…/" + parts.join("/"); }
  return out.slice(0, MAX_FOLDER_CHARS);
}

// Reads the whole request body as bytes, but gives up (413) as soon as it passes the limit.
function readRawBody(req, limit = MAX_FILE_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(fail(413, `the file is too big (${Math.round(limit / 1048576)} MB at most)`));
    }
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(fail(413, `the file is too big (${Math.round(limit / 1048576)} MB at most)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = { sniffFile, cleanName, cleanFolder, readRawBody, MAX_FILE_BYTES, MAX_TEXT_BYTES, MAX_FOLDER_CHARS };
