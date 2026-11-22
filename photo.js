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
// Several pictures in one message (2026-11-22): the thread and Improve Bot planning take up to MAX_PHOTOS. The page reads the
// same number from /api/session (maxPhotos), so there is one place to change it. Each picture keeps the 3 MB limit.
const MAX_PHOTOS = 4;
const MAX_PHOTOS_BODY = MAX_PHOTOS * MAX_B64 + 20000; // the whole request: every picture plus the other fields

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

// The pictures of one request: the old single field (`one`, e.g. "image") OR the list field (`many`, e.g. "images"), never both.
// EVERY picture is checked with parsePhoto (real bytes, 3 MB); one bad picture refuses the whole request and says which one.
// Returns the parsed pictures in the order they were sent ([] when none came).
function parsePhotos(input, { one, many }) {
  const single = input[one], list = input[many];
  const hasOne = single !== undefined && single !== null, hasMany = list !== undefined && list !== null;
  if (hasOne && hasMany) throw fail(400, `send the picture in "${one}" or the pictures in "${many}", not both`);
  if (hasOne) return [parsePhoto(single)];
  if (!hasMany) return [];
  if (!Array.isArray(list)) throw fail(400, `"${many}" must be a list of pictures`);
  if (list.length > MAX_PHOTOS) throw fail(413, `at most ${MAX_PHOTOS} pictures per message (${list.length} were sent)`);
  return list.map((dataUrl, i) => {
    try { return parsePhoto(dataUrl); } catch (error) {
      throw list.length > 1 ? fail(error.status || 400, `picture ${i + 1}: ${error.message}`) : error;
    }
  });
}

// Saves checked pictures (savePhoto, random names). If one cannot be saved, the ones already saved are deleted again.
function savePhotos(dir, parsed) {
  const saved = [];
  try {
    for (const p of parsed) saved.push(savePhoto(dir, p));
    return saved;
  } catch (error) {
    removePhotos(saved);
    throw error;
  }
}
const removePhotos = (saved) => { for (const s of saved || []) { try { fs.rmSync(typeof s === "string" ? s : s.path, { force: true }); } catch (error) { /* already gone */ } } };

// The fixed names the pictures get in agy's private folder, from their real types (never a name from the sender):
// one picture is "photo.jpg" (as it always was), several are "photo1.jpg", "photo2.png", ... in the order they were sent.
function photoNames(exts) {
  return exts.length === 1 ? ["photo" + exts[0]] : exts.map((ext, i) => `photo${i + 1}${ext}`);
}

module.exports = { parsePhoto, parsePhotos, savePhoto, savePhotos, removePhotos, photoNames, sniffImage, MAX_PHOTO_BYTES, MAX_PHOTO_BODY, MAX_PHOTOS, MAX_PHOTOS_BODY };
