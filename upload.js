// upload.js
// Checks a course file that arrives from the web page. Nothing here trusts the sender: the type is
// decided by the REAL first bytes (like photo.js), never by the file name or the Content-Type header.
//
// Unlike /api/ask (20 KB, or a few MB with a photo), a course file can be big, so it travels as raw
// bytes (no base64, which would add a third) and has its own limit.

const { sniffImage } = require("./photo");

const MAX_FILE_BYTES = 40 * 1024 * 1024; // one file
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // a plain-text file is read directly, so it can be smaller
const MAX_NAME_CHARS = 120;

const fail = (status, message) => Object.assign(new Error(message), { status });

// The kind of a file from its content: { kind: "pdf" | "image" | "text", ext } or throws a 415.
function sniffFile(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw fail(400, "the file is empty");
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", ext: ".pdf" };
  const image = sniffImage(bytes);
  if (image) return { kind: "image", ext: image };
  if (bytes.length <= MAX_TEXT_BYTES && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes); // throws on bytes that are not valid UTF-8
      return { kind: "text", ext: ".txt" };
    } catch (error) { /* not text */ }
  }
  throw fail(415, "only PDF, JPEG/PNG/WebP photos or plain text files (UTF-8, up to 2 MB) are accepted");
}

// The name shown in the list. It is only ever displayed as text and never used as a path.
function cleanName(name, fallback = "file") {
  const clean = String(name || "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return clean || fallback;
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

module.exports = { sniffFile, cleanName, readRawBody, MAX_FILE_BYTES, MAX_TEXT_BYTES };
