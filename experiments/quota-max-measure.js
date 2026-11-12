// experiments/quota-max-measure.js
// Where does the brain's quota go? This script spends NO quota: it never calls a model.
//
//   node experiments/quota-max-measure.js "C:\Claude Code Project\FirstAttemptAssistant" [days] [code folder]
//
// Part 1 reads the thread day files (data/thread/*.jsonl) and counts, from each answer's own log lines, how many model calls a
//        message cost, which model answered and which tools ran.
// Part 2 replays the user's real messages of the last [days] days through the REAL brain.js with a FAKE model (it only records the
//        prompt it was given), so we see how big the prompt is and what it is made of.
// It prints numbers only, never message text. The data folder is only read; data/study and data/thread are copied to a temp folder first.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const DAYS = Number(process.argv[3]) || 2;
const DATA = path.join(ROOT, "data");
// The CODE may come from another folder (a worktree) than the data: pass it as the 3rd argument. The profile is then read from that folder's own data/.
const CODE = path.resolve(process.argv[4] || ROOT);
const req = (name) => require(path.join(CODE, name));

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const stat = (arr) => `median ${pct(arr, 0.5)}, p90 ${pct(arr, 0.9)}, max ${Math.max(0, ...arr)}, mean ${arr.length ? Math.round(sum(arr) / arr.length) : 0}`;
// A rough token count: Hebrew letters cost about one token each, other text about 4 characters per token.
const tokens = (s) => { const he = (String(s).match(/[\u0590-\u05ff]/g) || []).length; return Math.round(he + (String(s).length - he) / 4); };

function readThread(dir) {
  const days = fs.readdirSync(dir).filter((n) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort();
  const all = [];
  for (const d of days) for (const line of fs.readFileSync(path.join(dir, d), "utf8").split("\n")) { if (!line.trim()) continue; try { all.push({ ...JSON.parse(line), day: d.slice(0, 10) }); } catch (error) { /* a broken line */ } }
  return all;
}

// ---------- Part 1: what the log lines of real answers say ----------
function part1(all) {
  console.log("== Part 1: real answers, from the thread files ==");
  const byDay = new Map();
  for (const m of all) {
    const d = byDay.get(m.day) || { user: 0, answers: 0, calls: 0, models: {}, tools: {}, brain: 0, rounds: [], failed: 0, other: {} };
    byDay.set(m.day, d);
    if (m.role === "user") { d.user++; continue; }
    if (m.ack) continue;
    d.answers++;
    const log = Array.isArray(m.log) ? m.log : [];
    // every "asking <model>" line is one model call, whoever wrote it ([brain], [tutor], [course], [study-chat], [front desk] ...)
    const asks = log.filter((l) => /\basking\s+[\w.-]+/.test(l));
    for (const l of asks) { const model = /\basking\s+([\w.-]+)/.exec(l)[1]; d.models[model] = (d.models[model] || 0) + 1; }
    d.calls += asks.length;
    d.failed += log.filter((l) => / failed/.test(l)).length;
    if (m.result && m.result.brain) { d.brain++; d.rounds.push(log.filter((l) => /^\[brain\] asking/.test(l)).length); }
    for (const t of (m.result && Array.isArray(m.result.tools) ? m.result.tools : [])) d.tools[t] = (d.tools[t] || 0) + 1;
    for (const l of log) { const tag = /^\[([\w -]+)\]/.exec(l); if (tag && !/^(brain|queue)$/.test(tag[1])) d.other[tag[1]] = (d.other[tag[1]] || 0) + 1; }
  }
  for (const [day, d] of byDay) {
    console.log(`${day}: ${d.user} messages, ${d.answers} answers (${d.brain} by the brain), ${d.calls} logged model calls, ${d.failed} failed tries`);
    if (d.calls) console.log(`   calls by model: ${JSON.stringify(d.models)}`);
    if (d.rounds.length) { const h = {}; for (const r of d.rounds) h[r] = (h[r] || 0) + 1; console.log(`   brain calls per message: ${JSON.stringify(h)} (mean ${(sum(d.rounds) / d.rounds.length).toFixed(2)})`); }
    if (Object.keys(d.tools).length) console.log(`   tools: ${JSON.stringify(d.tools)}`);
    if (Object.keys(d.other).length) console.log(`   other log tags (lines): ${JSON.stringify(d.other)}`);
  }
}

// ---------- Part 2: the real prompt, with a fake model ----------
async function part2(all) {
  console.log(`\n== Part 2: the brain's prompt for the real messages of the last ${DAYS} day(s) (fake model, no quota) ==`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quota-max-"));
  fs.cpSync(path.join(DATA, "study"), path.join(tmp, "study"), { recursive: true });
  fs.cpSync(path.join(DATA, "thread"), path.join(tmp, "thread"), { recursive: true });

  const { createBrain } = req("brain.js");
  const { buildHistory } = req("thread-context.js");
  const { createCourses } = req("courses.js");
  const { createCourseRoutes } = req("course-routes.js");
  const { createStore } = req("store.js");
  const { createStudyCoach } = req("study-coach.js");
  const { createThreadStore } = req("thread-store.js");
  const { createSummaries } = req("thread-summary.js");
  const { createMemory, aboutBlock } = req("profile.js");
  const { getReminders } = req("reminders.js");
  const { cardNote } = req("calendar-add.js");

  const coursesStore = createCourses(path.join(DATA, "courses"));
  const never = async () => { throw new Error("no model in this script"); };
  const courseRoutes = createCourseRoutes({ store: createStore(path.join(tmp, "conversations")), courses: coursesStore, onFileReady: null, askCourse: never, ingestFile: never, askChain: never, askFile: never, expand: never, about: () => aboutBlock(), log: () => {} });
  const coach = createStudyCoach({ dir: path.join(tmp, "study"), courses: coursesStore, askChain: never, log: () => {} });
  const threadCopy = createThreadStore(path.join(tmp, "thread"));
  const notes = (() => { try { return createSummaries({ thread: threadCopy, dir: path.join(tmp, "thread", "summaries"), askChain: never, log: () => {} }).notesBlock(); } catch (error) { return ""; } })();

  // The real calendar, read ONCE (read-only), then the same text for every replayed message.
  let calendarText = "";
  try { const got = await Promise.race([require(path.join(ROOT, "calendar-chat.js")).readCalendar({ from: new Date().toISOString().slice(0, 10), days: 7 }), new Promise((r) => setTimeout(() => r(null), 8000))]); calendarText = got && got.text ? got.text : ""; } catch (error) { calendarText = ""; }
  console.log(`calendar block: ${calendarText.length} chars (0 = could not be read, then the real prompt is a little bigger)`);
  console.log(`daily notes block: ${notes.length} chars`);

  const days = [...new Set(all.map((m) => m.day))].slice(-DAYS);
  const entryOf = (m) => {
    const add = m.result && m.result.calendarAdd;
    if (!add || !Array.isArray(add.events)) return { role: m.role, text: m.text };
    const e = { role: m.role, text: m.text, cardId: typeof add.id === "string" ? add.id : undefined };
    try { e.note = cardNote(add); e.noteShort = cardNote(add, { short: true }); } catch (error) { /* only a help */ }
    return e;
  };

  const rows = [];
  for (let i = 0; i < all.length; i++) {
    const m = all[i];
    if (m.role !== "user" || !days.includes(m.day) || /^\(photo attached\)/.test(m.text)) continue;
    const before = all.slice(0, i);
    const fakeStore = { page: ({ limit }) => ({ messages: before.slice(-limit) }) };
    const history = buildHistory(fakeStore, { entryOf, notes });
    let prompt = "";
    const brain = createBrain({
      courses: coursesStore, courseRoutes, coach, moodle: null, reminders: getReminders(), memory: createMemory(), cards: { add: () => ({}) },
      readCalendar: async () => ({ text: calendarText }), fallback: async () => ({ answer: "" }),
      askOne: async (provider, model, question) => { prompt = question; return "ok"; },
      poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {}, now: () => m.at,
    });
    try { await brain.handle(m.text, { history, courses: courseRoutes.list(), log: () => {} }); } catch (error) { console.log("   (one message could not be replayed: " + String(error.message).slice(0, 80) + ")"); continue; }
    // Cut the prompt at the headings brain.js writes itself.
    const marks = ["\n\n## Right now", "\n\n## Calendar and reminders", "\n\n## Omri's courses in Bot", "\n\n## The course this talk is in", "\n\n## Conversation so far", "\n\n## Omri's new message"];
    const names = ["briefing", "time+profile", "calendar+reminders", "course list", "focus course (assignment, pages, code)", "conversation", "new message"];
    const at = marks.map((k) => prompt.indexOf(k));
    const cuts = [0, ...at.map((x) => (x < 0 ? null : x)), prompt.length];
    const parts = {};
    for (let k = 0; k < names.length; k++) {
      if (cuts[k] === null) { parts[names[k]] = 0; continue; }
      let end = null; for (let j = k + 1; j < cuts.length; j++) if (cuts[j] !== null) { end = cuts[j]; break; }
      parts[names[k]] = end - cuts[k];
    }
    // inside the focus part: assignment / project code / course pages
    const focus = at[3] >= 0 ? prompt.slice(at[3], at[4] >= 0 ? at[4] : at[5]) : "";
    const kind = (k) => { const re = new RegExp(`<data id="\\w+" kind="${k}">[\\s\\S]*?</data id="\\w+">`, "g"); return sum((focus.match(re) || []).map((x) => x.length)); };
    rows.push({ chars: prompt.length, tokens: tokens(prompt), parts, focus: at[3] >= 0, assignment: kind("assignment"), code: kind("project-files") + kind("project-code"), pages: kind("course-material"), msg: m.text.length });
  }

  console.log(`replayed ${rows.length} messages; ${rows.filter((r) => r.focus).length} had a course in focus`);
  console.log(`prompt size, characters: ${stat(rows.map((r) => r.chars))}`);
  console.log(`prompt size, rough tokens: ${stat(rows.map((r) => r.tokens))}`);
  console.log(`the user's own message, characters: ${stat(rows.map((r) => r.msg))}`);
  const total = sum(rows.map((r) => r.chars));
  console.log("share of ALL prompt characters, by part:");
  for (const n of Object.keys(rows[0] ? rows[0].parts : {})) { const v = sum(rows.map((r) => r.parts[n])); console.log(`   ${n.padEnd(40)} ${String(Math.round((100 * v) / total)).padStart(3)}%   (mean ${Math.round(v / rows.length)} chars per message)`); }
  const f = rows.filter((r) => r.focus);
  if (f.length) {
    console.log(`with a course in focus (${f.length}): prompt ${stat(f.map((r) => r.chars))}`);
    console.log(`   of that, mean chars: assignment text ${Math.round(sum(f.map((r) => r.assignment)) / f.length)}, linked-folder code ${Math.round(sum(f.map((r) => r.code)) / f.length)}, matching course pages ${Math.round(sum(f.map((r) => r.pages)) / f.length)}`);
  }
  const g = rows.filter((r) => !r.focus);
  if (g.length) console.log(`without a course in focus (${g.length}): prompt ${stat(g.map((r) => r.chars))}`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { /* a temp folder */ }
}

(async () => {
  const all = readThread(path.join(DATA, "thread"));
  part1(all);
  await part2(all);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
