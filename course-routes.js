// course-routes.js
// The web routes of the study notebooks, kept out of server.js so that file stays small.
// server.js calls handle() AFTER all its security checks (Host, Origin, Sec-Fetch-Site, phone login),
// so none of these routes can be reached without passing them.
//
//   GET    /api/courses                          list the courses
//   POST   /api/courses            {name}        add a course
//   GET    /api/courses/<id>                     the course, its files and its chat
//   POST   /api/courses/<id>/rename {name}
//   DELETE /api/courses/<id>
//   POST   /api/courses/<id>/files?name=...      upload one file (raw bytes, up to 40 MB)
//   DELETE /api/courses/<id>/files/<fid>
//   POST   /api/courses/<id>/files/<fid>/retry   read a failed file again
//   GET    /api/courses/<id>/files/<fid>/pages?from=1   the saved text of up to 20 pages
//   POST   /api/courses/<id>/ask   {text, deeper}   ask a question using only this course
//   POST   /api/courses/<id>/chat/clear

const { validId } = require("./courses");
const { sniffFile, readRawBody } = require("./upload");

const MAX_QUESTION_CHARS = 4000;
const PAGES_PER_REQUEST = 20;
const MAX_ASKS = 2; // questions running at once, across all courses

function createCourseRoutes({ courses, askCourse, ingestFile, askFile, about = () => "", askChain, log = () => {} }) {
  courses.recover();

  // Files are read one at a time (each reading is a big model call, and quota is limited).
  const queue = [];
  let reading = false;
  async function pump() {
    if (reading) return;
    reading = true;
    while (queue.length) {
      const { courseId, fileId } = queue.shift();
      await ingestFile({ courses, courseId, fileId, askFile, log });
    }
    reading = false;
  }
  const enqueue = (courseId, fileId) => { queue.push({ courseId, fileId }); pump(); };

  const asking = new Map(); // course id -> { since, text }

  async function handle(req, res, url, { sendJson, readJsonBody }) {
    const m = url.pathname.match(/^\/api\/courses(?:\/([^/]+))?(?:\/(.*))?$/);
    if (!m) return false;
    const [, id, rest = ""] = m;
    const get = req.method === "GET";

    if (!id) {
      if (get) return sendJson(res, 200, { courses: courses.list() }), true;
      if (req.method === "POST") {
        const input = await readJsonBody(req, res);
        if (!input) return true;
        try { return sendJson(res, 201, { course: courses.create(input.name) }), true; } catch (error) { return sendJson(res, error.status || 400, { error: error.message }), true; }
      }
      return sendJson(res, 405, { error: "method not allowed" }), true;
    }
    if (!validId(id)) return sendJson(res, 404, { error: "course not found" }), true;
    const course = courses.get(id);
    if (!course) return sendJson(res, 404, { error: "course not found" }), true;

    if (rest === "") {
      if (get) {
        const a = asking.get(id);
        return sendJson(res, 200, { course, chat: courses.getChat(id), asking: a ? { since: a.since } : null }), true;
      }
      if (req.method === "DELETE") {
        if (asking.has(id)) return sendJson(res, 409, { error: "Bot is answering a question in this course; wait for it to finish" }), true;
        courses.remove(id);
        return sendJson(res, 200, { ok: true }), true;
      }
    }

    if (rest === "rename" && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return true;
      try { return sendJson(res, 200, { course: courses.rename(id, input.name) }), true; } catch (error) { return sendJson(res, error.status || 400, { error: error.message }), true; }
    }

    if (rest === "chat/clear" && req.method === "POST") {
      if (!(await readJsonBody(req, res))) return true;
      courses.clearChat(id);
      return sendJson(res, 200, { ok: true }), true;
    }

    if (rest === "files" && req.method === "POST") {
      // Raw bytes, not JSON. A web page on another site cannot send this type without a CORS preflight, which we never allow.
      if (!String(req.headers["content-type"] || "").startsWith("application/octet-stream")) return sendJson(res, 415, { error: "send the file as application/octet-stream" }), true;
      try {
        const bytes = await readRawBody(req);
        const { kind, ext } = sniffFile(bytes);
        const file = courses.addFile(id, { bytes, kind, ext, name: url.searchParams.get("name") });
        enqueue(id, file.id);
        return sendJson(res, 201, { file }), true;
      } catch (error) {
        return sendJson(res, error.status || 500, { error: error.message }), true;
      }
    }

    const fileRoute = rest.match(/^files\/([^/]+)(?:\/(retry|pages))?$/);
    if (fileRoute) {
      const [, fid, action] = fileRoute;
      const file = validId(fid) ? courses.getFile(id, fid) : null;
      if (!file) return sendJson(res, 404, { error: "file not found" }), true;
      if (!action && req.method === "DELETE") {
        courses.removeFile(id, fid);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (action === "retry" && req.method === "POST") {
        if (!(await readJsonBody(req, res))) return true;
        if (file.status !== "failed" && file.status !== "ready") return sendJson(res, 409, { error: "this file is already being read" }), true;
        courses.setFile(id, fid, { status: "queued", error: "", progress: "" });
        enqueue(id, fid);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (action === "pages" && get) {
        const from = Math.max(1, parseInt(url.searchParams.get("from"), 10) || 1);
        const all = courses.getPages(id, fid);
        const shown = all.filter((p) => p.page >= from).slice(0, PAGES_PER_REQUEST);
        const last = shown.length ? shown[shown.length - 1].page : null;
        return sendJson(res, 200, { pages: shown, more: last !== null && all.some((p) => p.page > last) }), true;
      }
    }

    if (rest === "ask" && req.method === "POST") {
      const input = await readJsonBody(req, res);
      if (!input) return true;
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return sendJson(res, 400, { error: "the question is empty" }), true;
      if (text.length > MAX_QUESTION_CHARS) return sendJson(res, 413, { error: `the question is longer than ${MAX_QUESTION_CHARS} characters` }), true;
      if (asking.has(id)) return sendJson(res, 409, { error: "Bot is still answering your last question in this course" }), true;
      if (asking.size >= MAX_ASKS) return sendJson(res, 429, { error: "busy, wait for the current tasks to finish" }), true;
      const history = courses.getChat(id);
      courses.appendChat(id, [{ role: "user", text, at: Date.now() }]);
      asking.set(id, { since: Date.now() });
      // Runs in the background: the page polls GET /api/courses/<id>, so closing or reloading the page loses nothing.
      (async () => {
        let message;
        try {
          const result = await askCourse({ course, pages: courses.allPages(id), question: text, history, deeper: input.deeper === true, about: about(), askChain, log });
          message = { role: "assistant", text: result.answer, sources: result.sources, model: result.model, seconds: result.seconds, searched: result.searched, at: Date.now() };
        } catch (error) {
          message = { role: "assistant", text: "Something went wrong: " + String(error.message).slice(0, 300), error: true, at: Date.now() };
        }
        try { courses.appendChat(id, [message]); } catch (error) { /* the course was deleted meanwhile */ }
        asking.delete(id);
      })();
      return sendJson(res, 202, { ok: true }), true;
    }

    return sendJson(res, 404, { error: "not found" }), true;
  }

  return { handle, idle: () => queue.length === 0 && !reading && asking.size === 0 };
}

module.exports = { createCourseRoutes, MAX_QUESTION_CHARS };
