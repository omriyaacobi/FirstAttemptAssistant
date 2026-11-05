// courses.js
// Where the study notebooks live on disk: one folder per course, inside data/courses/ (git-ignored:
// lecturers' files are copyrighted and the repo is PUBLIC, so nothing here may ever be committed).
//
//   data/courses/<course id>/course.json        name, exam date (later), the list of files and their reading status
//   data/courses/<course id>/files/<id>.pdf     the original file, saved under a RANDOM name
//   data/courses/<course id>/files/<id>.pages.json   the text of each page, made once when the file was read
//   data/courses/<course id>/chat.migrated.json the old single chat (now a real chat in data/conversations/, see course-routes.js)
//
// Every id is 16 random hex characters and is checked on every call, because an id becomes part of a
// file path ("../../x" must never get through). Names typed by you are only ever stored as text.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { cleanName } = require("./upload");

const ID_PATTERN = /^[a-f0-9]{16}$/;
const MAX_COURSES = 12;
const MAX_FILES_PER_COURSE = 200;
const MAX_COURSE_BYTES = 400 * 1024 * 1024;
const MAX_CHAT_MESSAGES = 100;
const MAX_PAGE_CHARS = 6000; // one page of text is cut to this when saved

const fail = (status, message) => Object.assign(new Error(message), { status });
const newId = () => crypto.randomBytes(8).toString("hex");
const validId = (id) => typeof id === "string" && ID_PATTERN.test(id);

function createCourses(dir) {
  fs.mkdirSync(dir, { recursive: true });

  const courseDir = (id) => path.join(dir, id);
  const metaFile = (id) => path.join(courseDir(id), "course.json");

  // Write to a temp file, then rename, so a stop halfway never leaves a half-written file.
  function writeJson(file, data) {
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(data));
    fs.renameSync(temp, file);
  }
  function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
  }

  function get(id) {
    return validId(id) ? readJson(metaFile(id)) : null;
  }
  function save(course) {
    writeJson(metaFile(course.id), course);
  }

  const bytesOf = (course) => course.files.reduce((a, f) => a + (f.bytes || 0), 0);
  const summary = (c) => ({
    id: c.id, name: c.name, created: c.created,
    files: c.files.length,
    pages: c.files.reduce((a, f) => a + (f.status === "ready" ? f.pages || 0 : 0), 0),
    reading: c.files.filter((f) => f.status === "queued" || f.status === "reading").length,
  });

  function list() {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const course = get(name);
      if (course) out.push(course);
    }
    return out.sort((a, b) => a.created - b.created).map(summary);
  }

  function create(name) {
    if (list().length >= MAX_COURSES) throw fail(400, `at most ${MAX_COURSES} courses`);
    const course = { id: newId(), name: cleanName(name, ""), created: Date.now(), files: [] };
    if (!course.name) throw fail(400, "the course needs a name");
    fs.mkdirSync(path.join(courseDir(course.id), "files"), { recursive: true });
    save(course);
    return course;
  }

  function rename(id, name) {
    const course = get(id);
    if (!course) throw fail(404, "course not found");
    const clean = cleanName(name, "");
    if (!clean) throw fail(400, "the course needs a name");
    course.name = clean;
    save(course);
    return course;
  }

  function remove(id) {
    if (!get(id)) return false;
    fs.rmSync(courseDir(id), { recursive: true, force: true });
    return true;
  }

  // ---- files ----
  const filePath = (id, fid, ext) => path.join(courseDir(id), "files", fid + ext);

  // Saves the bytes under a random name and lists the file as "queued" (waiting to be read).
  function addFile(id, { bytes, kind, ext, name }) {
    const course = get(id);
    if (!course) throw fail(404, "course not found");
    if (course.files.length >= MAX_FILES_PER_COURSE) throw fail(400, `at most ${MAX_FILES_PER_COURSE} files per course`);
    if (bytesOf(course) + bytes.length > MAX_COURSE_BYTES) throw fail(413, "this course is full (400 MB of files)");
    const file = { id: newId(), name: cleanName(name), kind, ext, bytes: bytes.length, status: "queued", pages: 0, progress: "", error: "", added: Date.now() };
    fs.writeFileSync(filePath(id, file.id, ext), bytes, { flag: "wx" });
    course.files.push(file);
    save(course);
    return file;
  }

  // Changes fields of one file entry (status, pages, progress, error). Returns the entry, or null if it is gone
  // (the file or course was deleted while it was being read).
  function setFile(id, fid, patch) {
    const course = get(id);
    const file = course && course.files.find((f) => f.id === fid);
    if (!file) return null;
    Object.assign(file, patch);
    save(course);
    return file;
  }

  function getFile(id, fid) {
    const course = get(id);
    return (course && course.files.find((f) => f.id === fid)) || null;
  }

  function removeFile(id, fid) {
    const course = get(id);
    const file = course && course.files.find((f) => f.id === fid);
    if (!file) return false;
    course.files = course.files.filter((f) => f.id !== fid);
    save(course);
    fs.rmSync(filePath(id, fid, file.ext), { force: true });
    fs.rmSync(filePath(id, fid, ".pages.json"), { force: true });
    return true;
  }

  const originalPath = (id, fid) => {
    const file = getFile(id, fid);
    return file ? filePath(id, fid, file.ext) : null;
  };

  // pages: [{ page, text, keywords }]. Text is cut to MAX_PAGE_CHARS.
  function savePages(id, fid, pages) {
    if (!getFile(id, fid)) return false;
    const clean = pages.map((p) => ({ page: Number(p.page), text: String(p.text || "").slice(0, MAX_PAGE_CHARS), keywords: String(p.keywords || "").slice(0, 300) }));
    writeJson(filePath(id, fid, ".pages.json"), clean);
    return true;
  }
  function getPages(id, fid) {
    if (!validId(id) || !validId(fid)) return [];
    return readJson(filePath(id, fid, ".pages.json")) || [];
  }

  // Every page of every READY file in a course, each with the file it came from.
  function allPages(id) {
    const course = get(id);
    if (!course) return [];
    const out = [];
    for (const file of course.files) {
      if (file.status !== "ready") continue;
      for (const p of getPages(id, file.id)) out.push({ ...p, fileId: file.id, fileName: file.name });
    }
    return out;
  }

  // ---- the old single chat of a course ----
  // Before course chats, each course had one chat.json. The server turns it into the first real chat of the course
  // once (course-routes.js), then sets the file aside under another name (never deleted: it is your data).
  function legacyChat(id) {
    return (validId(id) && readJson(path.join(courseDir(id), "chat.json"))) || [];
  }
  function retireLegacyChat(id) {
    const old = path.join(courseDir(id), "chat.json");
    if (validId(id) && fs.existsSync(old)) fs.renameSync(old, path.join(courseDir(id), "chat.migrated.json"));
  }

  // After a restart nothing is reading any more: files that were queued or being read are marked so you can retry.
  function recover() {
    for (const c of list()) {
      for (const f of get(c.id).files) {
        if (f.status === "queued" || f.status === "reading") setFile(c.id, f.id, { status: "failed", error: "interrupted by a restart: press Retry", progress: "" });
      }
    }
  }

  return { list, get, create, rename, remove, addFile, setFile, getFile, removeFile, originalPath, savePages, getPages, allPages, legacyChat, retireLegacyChat, recover };
}

module.exports = { createCourses, validId, ID_PATTERN, MAX_PAGE_CHARS, MAX_COURSES, MAX_COURSE_BYTES };
