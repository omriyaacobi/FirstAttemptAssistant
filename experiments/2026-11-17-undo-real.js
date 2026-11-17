// experiments/2026-11-17-undo-real.js
// A few real model calls: after the study coach's "no" word list was removed (2026-11-17), does the REAL brain call study_undo
// when Omri answers a stored position with a plain "no"? Real briefing and course list; the study record lives in a temp folder;
// nothing is posted to the thread. Two rounds: English "no", then Hebrew "לא נכון".
// Run:  node experiments/2026-11-17-undo-real.js "<path of the real Bot folder>" [model: hydrogen|argon]
// Cost: 4 messages = about 4 to 8 model calls.

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

const CALC = "1c0bd5cbbdcdc210";
const store = createCourses(path.join(real, "data", "courses")); // reads only
const courses = { list: () => store.list().filter((c) => c.id === CALC), allPages: (id) => store.allPages(id) };
const model = process.argv[3] === "argon" ? MODELS.argonLow : MODELS.hydrogenMedium;

async function round(messages) {
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-undo-")), courses, askChain: providers.askChain, log: () => {} });
  const list = courses.list();
  const ref = coach.tracker.refsFor(list)[0];
  const tools = [];
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => list, courseFiles: (id) => ({ files: (store.get(id) || { files: [] }).files }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => { throw new Error("no web in this experiment"); },
    askOne: (provider, m, question) => providers.ask(provider, m, question, () => {}, { agent: true, timeoutMs: 2 * 60 * 1000 }),
    chain: [model], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
  });
  const history = [];
  for (const task of messages) {
    const logs = [];
    const r = await brain.handle(task, { history, courses: list, log: (l) => logs.push(l) });
    console.log("\n================ OMRI:", task);
    console.log("---- tools:", logs.filter((l) => /tool/.test(l)).join(" | ") || "(none)");
    console.log("---- BOT (" + (r.model || "?") + "):\n" + r.answer);
    console.log("---- position now:", JSON.stringify(coach.tracker.course(ref).position || null));
    history.push({ role: "user", text: task, at: Date.now() }, { role: "assistant", text: r.answer, at: Date.now() + 1, courseId: CALC });
    tools.push(logs.join(" | "));
  }
  return tools;
}

(async () => {
  await round(["In Calculus 2 I'm studying from the notes alone and I finished lecture 5", "no"]);
  await round(["בחדו\"א 2 אני לומד לבד מהסיכומים וסיימתי את הרצאה 5", "לא נכון"]);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
