// photo.js
// Checks a photo that arrives from the web page, and saves it. Nothing here trusts the sender.
//
// The page sends the photo as a "data URL": text that looks like  data:image/jpeg;base64,/9j/4AAQ...
// (base64 is a way to write binary bytes as plain letters and digits). We decode it and then look at
// the FIRST BYTES of the real data (the "magic bytes", a fixed signature every JPEG, PNG or WebP file
// starts with). The declared type and any file name are ignored: only the real bytes decide.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // decoded size
const MAX_B64 = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4; // base64 text is about 4/3 bigger than the bytes
const MAX_PHOTO_BODY = MAX_B64 + 20000; // the whole request: the photo plus the other fields

const fail = (status, message) => Object.assign(new Error(message), { status });

// The type of an image from its first bytes, or null.
function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return null;
}

// data URL text -> { bytes, ext }. Throws an error with a `status` for the server to send.
function parsePhoto(dataUrl) {
  if (typeof dataUrl !== "string") throw fail(400, "the photo must be sent as text (a data URL)");
  const head = /^data:image\/[a-z0-9.+-]{1,20};base64,/i.exec(dataUrl);
  if (!head) throw fail(400, "the photo is not a picture the page prepared");
  const b64 = dataUrl.slice(head[0].length);
  if (b64.length > MAX_B64) throw fail(413, "the photo is too big (3 MB at most)");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw fail(400, "the photo data is damaged");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) throw fail(413, "the photo is too big (3 MB at most)");
  const ext = sniffImage(bytes);
  if (!ext) throw fail(415, "only JPEG, PNG or WebP photos are accepted");
  return { bytes, ext };
}

// Saves the photo under a random name (never one from the sender). Returns { path, ext }.
function savePhoto(dir, { bytes, ext }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, crypto.randomBytes(16).toString("hex") + ext);
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { path: file, ext };
}

module.exports = { parsePhoto, savePhoto, sniffImage, MAX_PHOTO_BYTES, MAX_PHOTO_BODY };
