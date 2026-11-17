// experiments/2026-11-17-tutor-real.js
// A FEW real model calls to judge the teaching after the 2026-11-17 study fixes. Replays the hard moment of 2026-11-16 (19:33,
// Calculus 2, lecture 4) with the REAL brain briefing, the REAL course pages and the REAL talk of that evening as history, but:
//   - everything is only READ from the real data folder; the study record lives in a temp folder (made up: "lectures 1-3 done");
//   - nothing is posted to the thread, no reminder, no calendar.
// Run:  node experiments/2026-11-17-tutor-real.js "<path of the real Bot folder>" [model: hydrogen|argon]
// Cost: 2 messages = 2 to 5 model calls.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.join(__dirname, "..");
const real = process.argv[2];
if (!real || !fs.existsSync(path.join(real, "data", "courses"))) { console.error("give the path of the real Bot folder"); process.exit(1); }
const { createCourses } = require(path.join(root, "courses"));
const { createStudyCoach } = require(path.join(root, "study-coach"));
const { createBrain } = require(path.join(root, "brain"));
const { MODELS } = require(path.join(root, "router"));
const providers = require(path.join(root, "providers"));
const { workDone } = require(path.join(root, "course-work"));
const lp = require(path.join(root, "lecture-parts"));

const CALC = "1c0bd5cbbdcdc210";
const NOW = new Date("2026-11-16T19:33:03+02:00").getTime();
const clock = { now: NOW };
const store = createCourses(path.join(real, "data", "courses")); // only list / allPages are called: reads
const courses = { list: () => store.list().filter((c) => c.id === CALC), allPages: (id) => store.allPages(id) };
const thread = fs.readFileSync(path.join(real, "data", "thread", "2026-11-16.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.at < NOW);
const model = process.argv[3] === "argon" ? MODELS.argonLow : MODELS.hydrogenMedium;

(async () => {
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-real-")), courses, askChain: providers.askChain, now: () => clock.now, log: console.log });
  const list = courses.list();
  const ref = coach.tracker.refsFor(list)[0];
  coach.brainTools.position({ courseId: CALC, fields: { mode: "selfStudy", where: { type: "lecture", n: 3 } }, said: "lectures 1-3 are done, moving to lecture 4" });
  const said = [];
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => list, courseFiles: (id) => ({ files: (store.get(id) || { files: [] }).files }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => { throw new Error("no web in this experiment"); },
    askOne: (provider, m, question) => providers.ask(provider, m, question, () => {}, { agent: true, timeoutMs: 2 * 60 * 1000 }),
    courseWork: (courseId) => workDone([...thread, ...said], courseId, { now: clock.now, timeZone: "Asia/Jerusalem" }),
    chain: [model], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => clock.now,
  });
  const history = thread.slice(-12).map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.result && m.result.courseId ? { courseId: m.result.courseId } : {}) }));
  // The first message is Omri's real one of 19:33, read from the thread at run time (real chat text is never kept in the public repo).
  const real1933 = fs.readFileSync(path.join(real, "data", "thread", "2026-11-16.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.role === "user" && m.at >= NOW);
  if (!real1933) throw new Error("the 19:33 message was not found in the thread");
  const messages = [
    real1933.text,
    "I have 10 minutes, let's finish what is left of lecture 4",
  ];
  for (const task of messages) {
    clock.now += 60 * 1000;
    const logs = [];
    const r = await brain.handle(task, { history, courses: list, log: (l) => logs.push(l) });
    console.log("\n================ OMRI:", task);
    console.log("---- log:", logs.filter((l) => /tool|asking|failed|answered/.test(l)).join(" | "));
    console.log("---- BOT (" + (r.model || "?") + "):\n" + r.answer);
    console.log("---- marked in lecture 4:", (lp.worked(coach.tracker.course(ref))["4"] || []).map((m) => m.topic).join("; ") || "(nothing)");
    history.push({ role: "user", text: task, at: clock.now }, { role: "assistant", text: r.answer, at: clock.now + 1, courseId: CALC });
    said.push({ role: "assistant", at: clock.now + 1, text: r.answer, result: { courseId: CALC } });
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
