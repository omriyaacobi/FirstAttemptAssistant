// experiments/speed-quality.js (2026-11-23, t19 round 2, asked by Omri through the manager): an A/B QUALITY test of the speed changes.
// A = main's code, B = this branch, each in its own checkout whose data/ is a JUNCTION to its own temp copy of Bot's real data (both
// copies made from the same snapshot), so doing-tools, reminders and Moodle downloads never touch Bot's real data. The brain is built
// like server.js builds it (real tools, real Moodle token road, real calendar read), except:
//   - the chain is Neon low ONLY (no fall-through to Claude Code; reserves off; no picked model), so the Claude plan is never spent;
//   - open_on_pc gets a fake opener that only records what it would open;
//   - a downloaded file is filed into the temp copy but NOT read by a model (askFile is a fake), so reading spends no quota;
//   - the recent talk is the copy's thread, the same for both arms; nothing is appended to it.
// Both brains live in ONE process and answer one after the other (never at the same time), arms alternating, so each keeps its warm
// agy spare as in the real Bot.
//
//   node experiments/speed-quality.js <A checkout> <B checkout> <reps> [q,q,...]   -> experiments/speed-quality-results.json (numbers)
//   node experiments/speed-quality.js table
// The answers and log lines go to SPEED_ANSWERS (a scratchpad file), never into the repo: they can hold private text.
// Moodle's token is read by Bot's own code from the main checkout's .env (tokenReader); this script never reads or prints it.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OUT = path.join(__dirname, "speed-quality-results.json");
const ANSWERS = process.env.SPEED_ANSWERS || path.join(os.tmpdir(), "speed-quality-answers.jsonl");
const REAL_ENV = path.join("C:\\Claude Code Project\\FirstAttemptAssistant", ".env");

// The questions: harder than round 2's, shaped like Omri's real use. Each rep may give a different text (rep % texts.length).
const Q = {
  ftc: ["In Calculus 2: F(x) = integral from x to x^2 of e^(-t^2) dt. What is F'(x)? Show the steps."],
  improper: ["Calc 2: does the integral from 1 to infinity of sin(x)/x^2 converge? and the integral from 0 to 1 of sin(x)/x^2? explain both"],
  critique: ["my friend wrote: integral from -1 to 1 of 1/x^2 dx = [-1/x] from -1 to 1 = -1 - 1 = -2. it looks fine to me, is it right?"],
  trap: ["in calc 2, if f is integrable on [a,b] then F(x) = integral from a to x of f is differentiable everywhere and F' = f, right?"],
  gamma: ["prove that the integral from 0 to infinity of x^p e^(-x) dx converges exactly when p > -1"],
  code: ["look at messages.c in mission3 of my operation_b7 folder: is there anything there that can leak memory or write past a buffer?"],
  grep: ["where in my operation_b7 code do I call malloc and not check for NULL?"],
  nosol: ["explain question 2 of the first exercise sheet in calculus 2 without solving it, just what it asks and what tools I need"],
  hint: ["in the SPL assignment 1, what does the scheduling policy part ask me to do? give me a hint how to start, not code"],
  multi: ["find where the Algorithms material explains why Dijkstra fails with negative edges, remind me tomorrow at 18:00 to do ps 6, and in one line: what does Bellman-Ford do differently?"],
  moodledl: ["download the newest practice-session file of Algorithms Planning from Moodle and open it"],
  moodlenew: ["what's new on moodle in all my courses?"],
  vague: ["open it and move it to the other folder"],
  hebrew: ["תסביר לי את ההבדל בין התכנסות בהחלט להתכנסות בתנאי של אינטגרל לא אמיתי, עם דוגמה לכל אחד"],
  longlist: ["in High-Performance Systems Programming, open the README of mission 2"],
};

function makeArm(name, checkout, log) {
  const here = (file) => require(path.join(checkout, file));
  const D = path.join(checkout, "data"); // a junction to this arm's temp copy
  const { createBrain, askWarm } = here("brain.js");
  const { MODELS } = here("router.js");
  const { buildHistory } = here("thread-context.js");
  const coursesStore = here("courses.js").createCourses(path.join(D, "courses"));
  const store = here("store.js").createStore(path.join(D, "conversations"));
  const notRead = async () => { throw new Error("not read in the quality test"); };
  const courseRoutes = here("course-routes.js").createCourseRoutes({ store, courses: coursesStore, onFileReady: null, ingestFile: here("ingest.js").ingestFile, askFile: notRead, log: () => {} });
  const coach = here("study-coach.js").createStudyCoach({ dir: path.join(D, "study"), courses: coursesStore, askChain: here("providers.js").askChain, log: () => {} });
  const thread = here("thread-store.js").createThreadStore(path.join(D, "thread"));
  const linkBatches = here("link-batch.js").createLinkBatches({ thread, courseRoutes, log: () => {} });
  const ws = here("moodle-ws.js");
  const moodleSource = ws.createMoodleSource({ ws: ws.createMoodleWs({ getToken: ws.tokenReader(REAL_ENV) }), bridge: here("moodle-bridge.js").createBridge(), log: () => {} });
  const moodleTools = here("moodle-tools.js").createMoodleTools({ bridge: moodleSource, courseRoutes, dataDir: D, linkBatches });
  const opened = [];
  const opener = {
    openLocal: (p, { editor } = {}) => { opened.push(`local:${path.basename(String(p))}${editor ? " (VS Code)" : ""}`); return { target: path.basename(String(p)), how: editor ? "VS Code" : "its normal app" }; },
    openUrl: (u) => { opened.push(`url:${String(u).replace(/\?.*$/, "?…")}`); return { target: "the page", how: "Chrome" }; },
    openCopy: (p, n) => { opened.push(`copy:${n}`); return { target: n, how: "its normal app" }; },
  };
  let spent = [];
  const brain = createBrain({
    courses: coursesStore, courseRoutes, linkBatches, moodle: moodleTools, coach,
    reminders: here("reminders.js").getReminders(), todo: here("todo.js").createTodo({ file: path.join(D, "todo.md") }),
    memory: here("profile.js").createMemory(), cards: here("calendar-add.js").getCards(), readCalendar: here("calendar-chat.js").readCalendar,
    searchChats: (query) => here("recall.js").findInThread(thread, query, { oldChats: store }),
    courseWork: (courseId) => here("course-work.js").workDone(thread.page({ limit: 400 }).messages, courseId),
    finder: here("pc-find.js").createFinder({ dataDir: D, forbidden: [checkout] }),
    opener, modelChoice: null, tokenLog: null,
    chain: [MODELS.neonLow], reserves: {}, poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    askOne: (provider, model, q, onText, extra = {}) => askWarm(provider, model, q, onText, { ...extra, onUsage: (u) => { spent.push({ model, prompt: q.length, ...u }); if (extra.onUsage) extra.onUsage(u); } }),
  });
  const history = () => buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  return {
    name, brain, moodleTools, coursesStore,
    async run(text) {
      spent = []; opened.length = 0;
      const lines = [];
      const t0 = Date.now();
      let r = null, failed = "";
      try { r = await brain.handle(text, { history: history(), courses: courseRoutes.list(), log: (l) => { lines.push(String(l)); log(`  [${name}] ${String(l).slice(0, 160)}`); } }); } catch (error) { failed = String(error.message).slice(0, 300); }
      const sum = (k) => spent.reduce((a, c) => a + (c[k] || 0), 0);
      return {
        seconds: +((Date.now() - t0) / 1000).toFixed(1), calls: spent.length, models: [...new Set(spent.map((c) => c.model))],
        tokens: sum("input") + sum("cacheRead") + sum("output"), output: sum("output"), thinking: sum("thinking"),
        tools: (r && r.tools) || [], opened: [...opened], // only the COUNT is kept in the results file (names stay in the scratchpad) failed: failed || (r && r.used && r.used.provider === "none" ? "all models failed" : ""),
        answer: r ? String(r.answer || "") : "", lines,
      };
    },
  };
}

const load = () => (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { runs: [] });

async function main() {
  const [a, b, repsArg, only] = process.argv.slice(2);
  if (a === "table") return table();
  if (!a || !b) { console.error("usage: node experiments/speed-quality.js <A checkout> <B checkout> <reps> [q,q]"); process.exit(1); }
  const quiet = () => {};
  const arms = [makeArm("A", path.resolve(a), quiet), makeArm("B", path.resolve(b), quiet)];
  for (const arm of arms) { try { arm.brain.warmUp(); } catch (error) { /* only slower */ } }
  await new Promise((r) => setTimeout(r, 6000)); // the spares start
  const reps = Number(repsArg) || 2;
  const ids = only ? only.split(",") : Object.keys(Q);
  const rows = load();
  for (let rep = 0; rep < reps; rep++) {
    for (const [qi, id] of ids.entries()) {
      const texts = Q[id];
      const text = texts[rep % texts.length];
      const order = (rep + qi) % 2 === 0 ? arms : [arms[1], arms[0]];
      for (const arm of order) {
        const res = await arm.run(text);
        const { answer, lines, ...nums } = res;
        rows.runs.push({ at: new Date().toISOString(), arm: arm.name, q: id, rep, ...nums, opened: nums.opened.length });
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
        fs.appendFileSync(ANSWERS, JSON.stringify({ arm: arm.name, q: id, rep, ...nums, answer, lines }) + "\n");
        console.log(`${arm.name} ${id.padEnd(9)} rep ${rep} ${String(res.seconds).padStart(5)} s calls ${res.calls} tokens ${res.tokens} think ${res.thinking} tools ${res.tools.join(",") || "-"} opened ${res.opened.join(";") || "-"} ${res.failed}`);
        await new Promise((r) => setTimeout(r, 1500)); // the next spare starts, as between two real messages
      }
    }
  }
  process.exit(0);
}

function table() {
  const { runs } = load();
  const by = new Map();
  for (const r of runs) { const k = `${r.q}|${r.arm}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const avg = (xs, k) => +(xs.reduce((s, x) => s + (x[k] || 0), 0) / xs.length).toFixed(1);
  console.log("| question | arm | runs | seconds | model calls | tokens | thinking | failed |\n|---|---|---|---|---|---|---|---|");
  for (const id of Object.keys(Q)) for (const arm of ["A", "B"]) {
    const xs = by.get(`${id}|${arm}`) || [];
    if (xs.length) console.log(`| ${id} | ${arm} | ${xs.length} | ${avg(xs, "seconds")} | ${avg(xs, "calls")} | ${Math.round(avg(xs, "tokens"))} | ${Math.round(avg(xs, "thinking"))} | ${xs.filter((x) => x.failed).length} |`);
  }
  for (const arm of ["A", "B"]) { const xs = runs.filter((r) => r.arm === arm); if (xs.length) console.log(`${arm}: ${xs.length} runs, ${avg(xs, "seconds")} s, ${avg(xs, "calls")} calls, ${Math.round(avg(xs, "tokens"))} tokens per message`); }
}

main().catch((error) => { console.error(error); process.exit(1); });
