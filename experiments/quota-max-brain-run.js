// experiments/quota-max-brain-run.js
// Runs the REAL brain (this folder's brain.js, the real briefing, the real tool loop) on a small set of real-shaped messages and
// prints what each one cost in TOKENS. THIS SPENDS QUOTA: every message is one to four real model calls.
//
//   node experiments/quota-max-brain-run.js <data root> <argon|sonnet> <out file> [ids,comma,separated]
//   BOT_BRAIN_AGENT=off node experiments/quota-max-brain-run.js ...      (the same, WITHOUT the slim agent, to compare)
//
// <data root> is the folder that holds the real data/ (the main checkout). Nothing real is changed: courses are only read, the
// study data is copied to a temp folder, and reminders, memory and cards are fakes (no reminder or event is really made).
// The answers are written to <out file> (keep it OUT of the repo: answers can hold private text). The screen shows numbers only.
// The reserve rule is skipped here on purpose (Omri, 2026-11-12: tests may use Argon under 25%); Bot's own rule is unchanged.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const [rootArg, which, outFile, only] = process.argv.slice(2);
const ROOT = path.resolve(rootArg || "");
const DATA = path.join(ROOT, "data");
const here = (name) => require(path.join(__dirname, "..", name));
const { MODELS } = here("router.js");
const model = { argon: MODELS.argonLow, sonnet: MODELS.sonnetInAgy }[which];
if (!fs.existsSync(DATA) || !model || !outFile) { console.error("usage: node quota-max-brain-run.js <data root> <argon|sonnet> <out file> [ids]"); process.exit(1); }

// The 7 messages of experiments/2026-11-11-quota-stretch.md, plus small everyday ones (the kind that should be cheap).
const SET = [
  { id: "calc", text: "In Calculus 2: explain the ratio test, and give me a series where it says nothing." },
  { id: "remind", text: "remind me tomorrow at 9 to submit PS4" },
  { id: "event", text: "add office hours on Thursday 14:00-15:00 to my calendar" },
  { id: "hebrew", text: "מה יש לי השבוע ובמה כדאי לי להתמקד היום?" },
  { id: "code", text: "In my Systems Programming assignment my decode loop copies decoded[temp_length] every time and the output comes out wrong. Give me a hint only, not the solution." },
  { id: "math", text: "does the series sum of 1/(n ln n) converge?" },
  { id: "search", text: "what do the High-Performance Systems Programming notes say about cache locality? cite the file" },
  { id: "thanks", text: "תודה, הבנתי" },
  { id: "day", text: "what day is the 3rd of December?" },
  { id: "followup", text: "can you explain that again, shorter?" },
  { id: "hebcourse", text: "מה ההבדל בין stack ל-heap לפי החומר של תכנות מערכות?" },
];

const AGY = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const usage = () => { try { return execFileSync(AGY, ["-p", "/usage"], { encoding: "utf8" }).trim().split(/\r?\n/).filter((l) => l.split("\t").length >= 4).map((l) => { const [pool, window, left] = l.split("\t"); return `${pool} / ${window.replace(/ Limit.*/, "")}: ${left}`; }).join(" | "); } catch (error) { return "(could not read /usage)"; } };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quota-brain-"));
  fs.cpSync(path.join(DATA, "study"), path.join(tmp, "study"), { recursive: true });
  fs.cpSync(path.join(DATA, "thread"), path.join(tmp, "thread"), { recursive: true });
  // The profile is read from this folder's own data/ (git-ignored): copy the two files so the prompt is the real one.
  const mine = path.join(__dirname, "..", "data");
  fs.mkdirSync(mine, { recursive: true });
  for (const f of ["profile.md", "memory.json"]) { try { fs.copyFileSync(path.join(DATA, f), path.join(mine, f)); } catch (error) { /* no such file */ } }

  const { createBrain, askWarm } = here("brain.js");
  const { buildHistory } = here("thread-context.js");
  const { createCourses } = here("courses.js");
  const { createCourseRoutes } = here("course-routes.js");
  const { createStore } = here("store.js");
  const { createStudyCoach } = here("study-coach.js");
  const { createThreadStore } = here("thread-store.js");
  const { createMemory, aboutBlock } = here("profile.js");

  const coursesStore = createCourses(path.join(DATA, "courses"));
  const never = async () => { throw new Error("not in this test"); };
  const realRoutes = createCourseRoutes({ store: createStore(path.join(tmp, "conversations")), courses: coursesStore, onFileReady: null, askCourse: never, ingestFile: never, askChain: never, askFile: never, expand: never, about: () => aboutBlock(), log: () => {} });
  const courseRoutes = { list: () => realRoutes.list(), courseFiles: (id) => realRoutes.courseFiles(id), linkFiles: (id) => realRoutes.linkFiles(id), addLink: never }; // read-only
  const coach = createStudyCoach({ dir: path.join(tmp, "study"), courses: coursesStore, askChain: here("providers.js").askChain, log: () => {} });
  const thread = createThreadStore(path.join(tmp, "thread"));
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });

  // The real calendar, read once and read-only (the real Bot shows the model the same week).
  let calendarText = "";
  try { const got = await Promise.race([require(path.join(ROOT, "calendar-chat.js")).readCalendar({ from: new Date().toISOString().slice(0, 10), days: 7 }), new Promise((r) => setTimeout(() => r(null), 8000))]); calendarText = got && got.text ? got.text : ""; } catch (error) { calendarText = ""; }

  const pick = only ? SET.filter((m) => only.split(",").includes(m.id)) : SET;
  const agent = process.env.BOT_BRAIN_AGENT !== "off";
  console.log(`model ${model.model}, slim agent ${agent ? "ON" : "OFF"}, ${pick.length} message(s), recent talk ${history.reduce((a, h) => a + h.text.length, 0)} chars, calendar ${calendarText.length} chars`);
  console.log("pools before:", usage());
  const out = [`# ${model.model}, slim agent ${agent ? "ON" : "OFF"}, ${new Date().toISOString()}`];
  let allCalls = 0, allTokens = 0;
  for (const m of pick) {
    const spent = [], log = [], made = [];
    const brain = createBrain({
      courses: coursesStore, courseRoutes, coach, moodle: null, memory: createMemory(),
      reminders: { list: () => [], create: (r) => { made.push("reminder"); return { id: "test", ...r }; } },
      cards: { add: (p) => { made.push("card"); return { id: "test", events: p.events }; } },
      readCalendar: async () => ({ text: calendarText }),
      askOne: (provider, mdl, q, onText, extra = {}) => askWarm(provider, mdl, q, onText, { onUsage: (u) => { spent.push({ model: mdl, prompt: q.length, ...u }); if (extra.onUsage) extra.onUsage(u); } }),
      chain: [model], reserves: {}, poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    });
    const t0 = Date.now();
    let answer = "", tools = [], failed = "";
    try { const r = await brain.handle(m.text, { history, courses: courseRoutes.list(), log: (l) => log.push(l) }); answer = r.answer || ""; tools = r.tools || []; } catch (error) { failed = String(error.message).slice(0, 300); }
    const sum = (k) => spent.reduce((a, c) => a + (c[k] || 0), 0);
    const tokens = sum("input") + sum("cacheRead") + sum("output") + sum("thinking");
    allCalls += spent.length; allTokens += tokens;
    console.log(`${m.id.padEnd(9)} ${failed ? "FAILED" : "ok    "} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  calls ${spent.length}  tokens ${String(tokens).padStart(6)} (in ${sum("input")}, cache ${sum("cacheRead")}, out ${sum("output")}, think ${sum("thinking")})  prompt chars ${spent.map((c) => c.prompt).join("/")}  tools: ${tools.join(",") || "-"}${made.length ? "  made: " + made.join(",") : ""}`);
    out.push(`\n## ${m.id}: ${m.text}\ncalls ${spent.length}, tokens ${tokens}, tools ${tools.join(",") || "-"}, made ${made.join(",") || "-"}\n${failed ? "FAILED: " + failed : answer}\n\nlog:\n${log.join("\n")}`);
  }
  console.log(`TOTAL: ${allCalls} calls, ${allTokens} tokens, ${Math.round(allTokens / Math.max(1, pick.length))} per message`);
  await new Promise((r) => setTimeout(r, 4000)); // the counters lag a moment
  console.log("pools after: ", usage());
  fs.writeFileSync(outFile, out.join("\n"));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { /* a temp folder */ }
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
