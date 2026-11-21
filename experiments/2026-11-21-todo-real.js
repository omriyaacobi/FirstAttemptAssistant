// experiments/2026-11-21-todo-real.js
// Real Neon low calls: does the brain's briefing make the model use todo_read / todo_update for "the to-do list"? The list is a FAKE file
// in a temp folder (nothing of Omri's). No courses, no calendar, nothing posted. Run:  node experiments/2026-11-21-todo-real.js
// Cost: 4 messages = about 4 to 8 Neon low calls.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.join(__dirname, "..");
const { createBrain } = require(path.join(root, "brain"));
const { createTodo } = require(path.join(root, "todo"));
const { MODELS } = require(path.join(root, "router"));
const providers = require(path.join(root, "providers"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-todo-real-"));
const file = path.join(dir, "todo.md");
fs.writeFileSync(file, `# To do

## Soon
- [ ] [t1] Back up the data folder every night to the cloud drive (backup.js)
- [ ] [t2] Make the chat page show message times in 24-hour format
- [x] [t3] Fix the typo on the settings page

## Later
- [ ] [t4] Research a faster way to read big PDFs
`);
const todo = createTodo({ file });

(async () => {
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    coach: null, todo,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => { throw new Error("no web in this experiment"); },
    askOne: (provider, m, question) => providers.ask(provider, m, question, () => {}, { agent: true, timeoutMs: 2 * 60 * 1000 }),
    chain: [MODELS.neonLow], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
  });
  const history = [];
  for (const task of ["what's on the to-do list?", "mark the backup item done", "add to the Later section: look at the Moodle watch speed", "undo that", "start the 24-hour times item"]) {
    const logs = [];
    const r = await brain.handle(task, { history, courses: [], log: (l) => logs.push(l) });
    console.log("\n================ OMRI:", task);
    console.log("---- tools:", logs.filter((l) => /tool/.test(l)).join(" | ") || "(none)", "| improve button:", JSON.stringify((r.extras || {}).improve || null));
    console.log("---- BOT (" + (r.model || "?") + "):\n" + r.answer);
    history.push({ role: "user", text: task, at: Date.now() }, { role: "assistant", text: r.answer, at: Date.now() + 1 });
  }
  console.log("\n---- the fake file at the end:\n" + fs.readFileSync(file, "utf8"));
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
