// COURSE TABS: answer time with and without the change (2026-11-27, Omri: "test the difference in response time between with
// change and without; test both the course tabs convos and the main one").
//
// The SAME questions go through Bot's real road twice: main's code (one conversation) and this branch's code (course tabs). The road
// is the real one: jobs.startThread -> buildHistory -> brain.handle -> the real model (agy, Neon low, the brain's first model).
// Everything is INVENTED (public repo): a fake thread in a temp folder, fake courses and pages, a fake calendar. No data/, no .env.
// One call at a time, never parallel; the order of the arms alternates every round (warm-up and queue effects cancel out).
//
// ARMS
//   old            main's code: everything is one thread (no tabs). The question is asked as Omri would today.
//   new-tab        this branch: the course question typed in the course's TAB (place "course:db").
//   new-main       this branch: the same question typed in MAIN (the course guess, 90 minutes).
// QUESTIONS
//   course   a Databases question that does NOT name the course (the talk decides which course it is)
//   chat     an everyday question in Main
// The invented talk: Databases study, then an Algorithms side talk most recently (the real case: courses mixed in one window).
//
// Run:   node experiments/2026-11-27-tabs-timing.js run <rounds> <mainCodeDir> [--fake]   -> experiments/2026-11-27-tabs-timing-results.json
//        node experiments/2026-11-27-tabs-timing.js table
// Live runs need the quota guard first: node tools/quota-guard.js begin --share 10 (the script checks it before every call).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OUT = path.join(__dirname, "2026-11-27-tabs-timing-results.json");
const NEW_ROOT = path.join(__dirname, "..");
const MODEL = "gemini-4-neon-low";

// ---------- the invented world ----------
const COURSES = [{ id: "db", name: "Intro to Databases" }, { id: "alg", name: "Algorithms" }];
const ASSIGNMENT = "Assignment 2 (Intro to Databases). Design a schema for a small library. Your schema must reach Third normal form (3NF) and you must submit it with a short ER diagram. Due: Thursday, 3 December 2026, 23:59.";
const PAGES = {
  db: [{ fileId: "f1", fileName: "Assignment_2.pdf", page: 1, text: ASSIGNMENT }, { fileId: "f2", fileName: "lecture4.pdf", page: 1, text: "Normalization. 1NF: atomic values. 2NF: no partial dependency on a part of the key. 3NF: no transitive dependency. A foreign key is a column that refers to the primary key of another table." }],
  alg: [{ fileId: "g1", fileName: "lecture6.pdf", page: 1, text: "Dijkstra's algorithm finds shortest paths from one source when all edge weights are non-negative. With a binary heap it runs in O((V+E) log V)." }],
};
const CALENDAR = "Tuesday 1 December\n  10:00-12:00  Algorithms lecture\nWednesday 2 December\n  14:00-16:00  Databases tutorial\nThursday 3 December\n  10:00-12:00  Databases lecture";
const long = (topic, n) => Array.from({ length: n }, (_, i) => `Point ${i + 1} about ${topic}: a careful explanation with a small made-up example, so the answer has the length of a real teaching answer.`).join(" ");
// [role, text, place]: place is the tab it was typed in WITH the tabs; without the tabs every message is in the one thread.
const TALK = [
  ["user", "remind me to buy milk at 18:00", null],
  ["assistant", "Done: a reminder at 18:00 to buy milk.", null],
  ["user", "let's study databases, what is 2NF?", "course:db"],
  ["assistant", "2NF: " + long("second normal form", 6), "course:db"],
  ["user", "and 3NF?", "course:db"],
  ["assistant", "3NF: " + long("third normal form", 6), "course:db"],
  ["user", "give me an example of a transitive dependency", "course:db"],
  ["assistant", "Example: " + long("transitive dependency", 7), "course:db"],
  ["user", "what is a good pasta recipe for tonight?", null],
  ["assistant", "A quick pasta: " + long("cooking pasta", 4), null],
  ["user", "in Algorithms, why does Dijkstra fail with negative edges?", "course:alg"],
  ["assistant", "Dijkstra: " + long("negative edges", 7), "course:alg"],
  ["user", "and what is the running time with a heap?", "course:alg"],
  ["assistant", "With a heap: " + long("heap running time", 6), "course:alg"],
];
const Q = {
  course: { msg: "Which normal form does the assignment ask me to reach?", ok: (t) => /3NF|third normal/i.test(t) },
  chat: { msg: "Explain in two sentences what a hash table is.", ok: (t) => /hash/i.test(t) },
};
// arm -> which code, which tab the question is typed in, which questions it runs
const ARMS = {
  old: { root: null, place: null, questions: ["course", "chat"] },
  "new-tab": { root: NEW_ROOT, place: "course:db", questions: ["course"] },
  "new-main": { root: NEW_ROOT, place: null, questions: ["course", "chat"] },
};

// ---------- one message through the real road ----------
async function runOne(armName, qid, { mainRoot, fake }) {
  const arm = ARMS[armName];
  const root = arm.root || mainRoot;
  const need = (f) => require(path.join(root, f));
  const { createThreadStore } = need("thread-store");
  const { createJobs } = need("jobs");
  const { createStore } = need("store");
  const { createBrain } = need("brain");
  const { ask } = need("providers");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-tabs-timing-"));
  const thread = createThreadStore(path.join(tmp, "thread"));
  const t0 = Date.now() - 40 * 60 * 1000; // the invented talk happened in the last 40 minutes
  TALK.forEach(([role, text, place], i) => thread.append({ role, text, at: t0 + i * 60000, ...(arm.root && place ? { place } : {}), ...(role === "assistant" ? { result: { mode: "single", brain: true, answer: text, ...(place ? { courseId: place.slice(7), courseName: COURSES.find((c) => "course:" + c.id === place).name } : {}) } } : {}) }));
  // replies point at their questions, as in the real thread
  const calls = [];
  const askOne = (provider, model, prompt, onText, extra = {}) => {
    const c = { start: Date.now(), promptChars: String(prompt).length, usage: null };
    calls.push(c);
    const onUsage = (u) => { c.usage = u; if (extra.onUsage) extra.onUsage(u); };
    const p = fake ? Promise.resolve(/assignment/i.test(String(prompt).slice(-400)) ? "It asks for 3NF (third normal form)." : "A hash table maps keys to slots with a hash function.") : ask("agy", model, prompt, onText, { agent: true, onUsage, timeoutMs: 120000 });
    return p.finally(() => { c.end = Date.now(); });
  };
  const brain = createBrain({
    courses: { allPages: (id) => PAGES[id] || [] },
    courseRoutes: { list: () => COURSES, courseFiles: (id) => ({ files: (PAGES[id] || []).map((p) => ({ id: p.fileId, name: p.fileName, status: "ready", pages: 1 })) }), linkFiles: () => [] },
    coach: null,
    reminders: { list: () => [], create: (r) => ({ id: "r1", ...r }) },
    memory: { list: () => [], add: () => ({ fact: { id: "m1", text: "" }, already: false }) },
    cards: { add: (proposal) => ({ id: "card1", events: proposal.events }) },
    readCalendar: async () => ({ text: CALENDAR }),
    askOne, chain: [{ provider: "agy", model: MODEL }],
    poolLevels: async () => [], poolRows: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    folderRules: { system: [] },
  });
  let result = null;
  const jobs = createJobs({ handle: async (task, options) => (result = await brain.handle(task, options)), thread, store: createStore(path.join(tmp, "store")), courses: () => COURSES, courseName: (id) => (COURSES.find((c) => c.id === id) || {}).name, maxRunning: 2, onFinish: () => {} });
  const started = Date.now();
  const job = jobs.startThread({ task: Q[qid].msg, ...(arm.place ? { place: arm.place } : {}) });
  let j = jobs.get(job.id);
  while (j && j.status === "running") { await new Promise((r) => setTimeout(r, 50)); j = jobs.get(job.id); }
  const seconds = +((Date.now() - started) / 1000).toFixed(1);
  const answer = String((result && result.answer) || "");
  fs.rmSync(tmp, { recursive: true, force: true });
  const tokensOf = (u) => (u ? (u.input || 0) + (u.output || 0) + (u.thinking || 0) + (u.cacheRead || 0) : 0);
  return {
    arm: armName, q: qid, seconds, ok: j && j.status === "done" && Q[qid].ok(answer), status: j && j.status, error: j && j.error,
    calls: calls.length, firstPromptChars: calls[0] ? calls[0].promptChars : 0, promptChars: calls.reduce((a, c) => a + c.promptChars, 0),
    tokens: calls.reduce((a, c) => a + tokensOf(c.usage), 0), brainTokens: result && result.tokens ? result.tokens : null,
    courseFiled: result ? result.courseId || null : null, tools: (result && result.tools) || [], answerStart: answer.slice(0, 80),
  };
}

// ---------- the schedule ----------
async function run(rounds, mainRoot, fake) {
  const { createGuard } = require("../tools/quota-guard");
  const guard = createGuard({ share: 10 });
  const rows = fs.existsSync(OUT) && !fake ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { started: new Date().toISOString(), mainCode: mainRoot, runs: [] };
  const plan = Object.entries(ARMS).flatMap(([arm, a]) => a.questions.map((q) => [arm, q]));
  for (let round = 1; round <= rounds; round++) {
    const order = round % 2 ? plan : plan.slice().reverse();
    for (const [arm, q] of order) {
      if (!fake) { const g = await guard.allow(); if (!g.ok) { console.error(`STOP (quota guard): ${g.why}`); fs.writeFileSync(OUT, JSON.stringify(rows, null, 2)); return; } }
      const r = await runOne(arm, q, { mainRoot, fake });
      r.round = round;
      rows.runs.push(r);
      if (!fake) fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
      console.error(`r${round} ${q.padEnd(6)} ${arm.padEnd(8)} ${String(r.seconds).padStart(5)} s  calls ${r.calls}  prompt ${r.firstPromptChars} ch  ${r.tokens} tok  filed ${r.courseFiled}  ${r.ok ? "ok" : "WRONG"}${r.error ? " ERR " + r.error : ""}`);
    }
  }
  if (fake) console.error("(fake model: nothing was saved)");
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
function table() {
  const { runs } = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log("| question | arm | runs | median s | min-max s | median calls | first prompt (chars) | median tokens | right | filed under |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const q of Object.keys(Q)) for (const arm of Object.keys(ARMS)) {
    const rs = runs.filter((r) => r.arm === arm && r.q === q && r.status === "done");
    if (!rs.length) continue;
    const s = rs.map((r) => r.seconds);
    const filed = [...new Set(rs.map((r) => r.courseFiled || "none"))].join(", ");
    console.log(`| ${q} | ${arm} | ${rs.length} | ${median(s).toFixed(1)} | ${Math.min(...s).toFixed(1)}-${Math.max(...s).toFixed(1)} | ${median(rs.map((r) => r.calls))} | ${median(rs.map((r) => r.firstPromptChars))} | ${median(rs.map((r) => r.tokens))} | ${rs.filter((r) => r.ok).length}/${rs.length} | ${filed} |`);
  }
  const failed = runs.filter((r) => r.status !== "done");
  if (failed.length) console.log(`\nFailed runs: ${failed.length} (${failed.map((r) => `${r.arm}/${r.q}: ${r.error}`).join("; ")})`);
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "run") run(Number(a) || 1, b, c === "--fake").catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === "table") table();
  else console.error("usage: run <rounds> <mainCodeDir> [--fake] | table");
}
