// wait-for-file-live.js
// A test copy of Bot for the "wait for the file" check (see 2026-11-08-wait-for-file.md). NOT the real Bot: it is the real server, thread, jobs,
// course routes and core.js, but the models are fake: the file reader takes READ_SECONDS (default 20) and the front desk always picks the
// first course. Data goes to the folder next to this script's project (data/), so run it from a COPY of the code with an empty data/.
//   PORT=3100 READ_SECONDS=20 node experiments/wait-for-file-live.js

const path = require("node:path");
const root = path.join(__dirname, "..");
const { createServer } = require(path.join(root, "server"));
const { createStore } = require(path.join(root, "store"));
const { createCourses } = require(path.join(root, "courses"));
const { createCourseRoutes } = require(path.join(root, "course-routes"));
const { createThreadStore } = require(path.join(root, "thread-store"));
const { handleTask } = require(path.join(root, "core"));

const PORT = Number(process.env.PORT) || 3100;
if (PORT === 3000) throw new Error("never port 3000: that is the real Bot");
const READ_SECONDS = Number(process.env.READ_SECONDS) || 20;
const data = path.join(root, "data");
const t0 = Date.now();
const log = (text) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${text}`);

const store = createStore(path.join(data, "conversations"));
const coursesStore = createCourses(path.join(data, "courses"));
// A slow, fake reader: marks the file "reading", waits, then saves one page of made-up text and marks it ready.
async function ingestFile({ courses, courseId, fileId }) {
  courses.setFile(courseId, fileId, { status: "reading", progress: "starting" });
  log(`reader: started reading ${courseId}/${fileId}`);
  await new Promise((r) => setTimeout(r, READ_SECONDS * 1000));
  courses.savePages(courseId, fileId, [{ page: 1, keywords: "", text: "Assignment 3 covers summary pages 12 to 18." }]);
  courses.setFile(courseId, fileId, { status: "ready", pages: 1, pagesTotal: 1, progress: "", error: "" });
  log("reader: file ready");
}
const courseRoutes = createCourseRoutes({ store, courses: coursesStore, askCourse: async () => ({}), ingestFile, askChain: async () => ({}), askFile: async () => ({}), log });
const thread = createThreadStore(path.join(data, "thread"));
const cut = thread.markUnanswered(); if (cut) log(`restart: ${cut} question(s) had no answer and now say so`); // same call as server.js

// The fake front desk: a message with "remind" is a fast reply, everything else is a question to the first course.
const decide = async (task, options) => (/remind/i.test(task)
  ? { action: "answer", destination: null, answer: "Fast reply (no course involved).", reason: "test" }
  : { action: "course", destination: null, answer: "", reason: "test", course: options.courses[0], studyIntent: "ask" });
const handle = (task, options = {}) => handleTask(task, {
  ...options,
  deps: {
    ...(options.deps || {}), decide, prewarmAnswer() {}, refreshQuota() {}, lowPools: async () => [], speculate: null, facts: () => [], about: () => "",
    courseAnswer: async (id) => {
      const c = coursesStore.get(id);
      return { mode: "course", courseId: id, answer: "Files in the course now: " + c.files.map((f) => `${f.name} (${f.status}, ${f.pages} page)`).join(", ") + ". " + (c.files.some((f) => f.status === "ready" && f.pages) ? "The assignment covers summary pages 12 to 18." : "The assignment is not in the course yet."), sources: [] };
    },
  },
});

const server = createServer({ handle, store, courseRoutes, thread, supervised: false });
server.listen(PORT, "127.0.0.1", () => log(`test Bot on http://localhost:${PORT} (fake models, reading takes ${READ_SECONDS} s)`));
