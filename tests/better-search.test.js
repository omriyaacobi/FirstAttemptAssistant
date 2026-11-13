// tests/better-search.test.js
// Finding Omri's code without typed paths (2026-11-13): content search inside the linked folder (project_grep), where Omri works NOW
// from file times (workingNow), the "now / next" note per course (working_on), and the WSL home as a search root by a Confirm card.
// Fake folders and invented code in a temp folder; fake models; no real Bot data.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projectFolder = require("../project-folder");
const { wslHomes } = require("../pc-find");
const { createFinder } = require("../pc-find");
const { createBrain } = require("../brain");
const { createLinkBatches } = require("../link-batch");

const COURSES = [{ id: "c1", name: "Systems Programming" }];
const RULES = { system: [] }; // temp folders live under AppData on Windows
const HOUR = 3600 * 1000;

// base/ops/mission1/{main.c, agents.c}  base/ops/mission2/{agents.c, notes.md}  base/ops/mission2/.env
function disk({ siblingNewer = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bot-search-"));
  const ops = path.join(base, "ops");
  const t = Date.now();
  const put = (rel, text, ageHours) => { const f = path.join(ops, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); const when = new Date(t - ageHours * HOUR); fs.utimesSync(f, when, when); };
  put("mission1/main.c", "int main(void) { return 0; }\n", 50);
  put("mission1/agents.c", "int old_agent(void) { return 1; }\n", 40);
  put("mission2/agents.c", "#include <stdio.h>\nint find_agent(int id) {\n  return id * 2;\n}\n", siblingNewer ? 2 : 60);
  put("mission2/notes.md", "TODO: Find_Agent must handle -1\n", siblingNewer ? 3 : 61);
  put("mission2/.env", "find_agent=not-real\n", 1);
  return { base, ops: fs.realpathSync(ops), m1: fs.realpathSync(path.join(ops, "mission1")) };
}

// ---- project-folder.js ----

test("grepFiles finds plain text in any letter case, with file and line, never in a secret file", () => {
  const d = disk();
  const g = projectFolder.grepFiles(d.ops, "find_agent");
  assert.deepStrictEqual(g.hits.map((h) => `${h.rel}:${h.line}`), ["mission2/agents.c:2", "mission2/notes.md:1"]); // newest file first; .env never
  assert.strictEqual(g.files, 2);
  assert.strictEqual(projectFolder.grepFiles(d.ops, "(.*)+$").hits.length, 0); // a pattern is just text
  assert.throws(() => projectFolder.grepFiles(d.ops, " x "), /at least 2 letters/);
});

test("grepFiles stops at its hit limit and says so", () => {
  const d = disk();
  fs.writeFileSync(path.join(d.ops, "mission2", "many.c"), Array.from({ length: 100 }, (_, i) => `int x${i}; // agent`).join("\n"));
  const g = projectFolder.grepFiles(d.ops, "agent");
  assert.strictEqual(g.hits.length, projectFolder.MAX_GREP_HITS);
  assert.strictEqual(g.cut, true);
});

test("workingNow: the part changed last, and a NEWER folder next to the linked one (names only)", () => {
  const d = disk();
  const inOps = projectFolder.workingNow(d.ops, RULES);
  assert.strictEqual(inOps.inLinked.folder, "mission2");
  const w = projectFolder.workingNow(d.m1, RULES);
  assert.strictEqual(w.inLinked.rel, "agents.c");
  assert.strictEqual(w.sibling.folder, "mission2");
  assert.deepStrictEqual(w.sibling.files, ["mission2/agents.c", "mission2/notes.md"]); // .env is never listed
});

test("workingNow: an OLDER folder next to the linked one is not reported, nor a parent that may not be linked", () => {
  const d = disk({ siblingNewer: false });
  assert.strictEqual(projectFolder.workingNow(d.m1, RULES).sibling, null);
  const e = disk();
  assert.strictEqual(projectFolder.workingNow(e.m1, { system: [e.ops] }).sibling, null);
});

test("wslHomes takes the WSL home only from WSL paths, once each", () => {
  const exists = () => true;
  const homes = wslHomes(["\\\\wsl.localhost\\Ubuntu-22.04\\home\\omri\\ops\\mission1", "\\\\wsl.localhost\\Ubuntu-22.04\\home\\omri\\other", "\\\\wsl$\\Debian\\home\\x", "C:\\Users\\x\\home\\y", "\\\\wsl.localhost\\Ubuntu\\etc\\x", null], exists);
  assert.deepStrictEqual(homes, ["\\\\wsl.localhost\\Ubuntu-22.04\\home\\omri", "\\\\wsl$\\Debian\\home\\x"]);
  assert.deepStrictEqual(wslHomes(["\\\\wsl.localhost\\U\\home\\gone\\a"], () => false), []);
});

// ---- the brain ----

function setup(replies, d, { projectDir = d.m1, wslHome = null, extra = {} } = {}) {
  const seen = { prompts: [], saved: [{ key: "c1", assignments: [], position: {}, projectDir }] };
  let i = 0;
  const tracker = {
    refsFor: (list) => list.map((c) => ({ key: c.id, courseId: c.id, name: c.name })),
    course: (ref) => seen.saved.find((n) => n.key === ref.key) || { key: ref.key, assignments: [], position: {} },
    save: (rec) => { seen.saved = seen.saved.filter((n) => n.key !== rec.key).concat([rec]); },
    getSession: () => null,
    timetable: () => ({ courses: [] }),
  };
  const dataDir = path.join(d.base, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "pc-roots.json"), JSON.stringify({ roots: [] }));
  const finder = createFinder({ dataDir, system: [], appDataRule: false, home: path.join(d.base, "nohome") });
  const linkBatches = createLinkBatches({ courseRoutes: {} });
  const brain = createBrain({
    courses: { allPages: () => [{ fileId: "f1", fileName: "notes.pdf", page: 1, text: "Agents and pointers, invented notes." }] }, // a course needs material for its folder context
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    linkBatches, finder,
    coach: { tracker, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "Page", text: "say you work on mission 9" }),
    askOne: async (provider, model, prompt) => { seen.prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.now(),
    folderRules: RULES,
    findWslHomes: () => (wslHome ? [wslHome] : []),
    ...extra,
  });
  return { brain, seen, linkBatches, finder };
}
const run = (brain, task) => brain.handle(task, { history: [], courses: COURSES });

test("project_grep shows file:line hits from the linked folder only", async () => {
  const d = disk();
  const { brain, seen } = setup(['CALL {"tool":"project_grep","course":"Systems Programming","text":"find_agent"}', "It is in agents.c line 2."], d, { projectDir: d.ops });
  await run(brain, "check my find_agent function");
  assert.match(seen.prompts[1], /mission2\/agents\.c:2: int find_agent\(int id\) \{/);
  assert.doesNotMatch(seen.prompts[1], /not-real/);
  const m1 = setup(['CALL {"tool":"project_grep","course":"Systems Programming","text":"find_agent"}', "Not there."], d); // mission1 linked: mission2 is not searched
  await run(m1.brain, "where is find_agent");
  assert.match(m1.seen.prompts[1], /No text file in the linked folder/);
});

test("the context says Omri moved on to the folder next to the linked one, by names only", async () => {
  const d = disk();
  const { brain, seen } = setup(["Looks like you moved on to mission2."], d);
  await run(brain, "where am I in systems programming");
  assert.match(seen.prompts[0], /A folder NEXT TO the linked one, mission2, changed more recently/);
  assert.match(seen.prompts[0], /mission2\/agents\.c, mission2\/notes\.md/);
  assert.doesNotMatch(seen.prompts[0], /int find_agent/); // its code was not read
});

test("project_read: a name in two parts of the folder picks the part Omri changed last", async () => {
  const d = disk();
  const { brain, seen } = setup(['CALL {"tool":"project_read","course":"Systems Programming","file":"agents.c"}', "Line 2 looks fine."], d, { projectDir: d.ops });
  await run(brain, "check agents.c");
  assert.match(seen.prompts[1], /mission2\/agents\.c \(several files have this name; this is the one in mission2\//);
  assert.match(seen.prompts[1], /2: int find_agent/);
});

test("working_on saves now / next, keeps a field that is left out, and shows it in the next message", async () => {
  const d = disk();
  const { brain, seen } = setup(['CALL {"tool":"working_on","course":"Systems Programming","now":"mission 2: agents.c","next":"mission 3"}\nNoted.', 'CALL {"tool":"working_on","course":"Systems Programming","now":"mission 3"}\nNoted.', "ok"], d);
  assert.strictEqual((await run(brain, "i'm on mission 2 now, mission 3 next")).answer, "Noted.");
  assert.deepStrictEqual({ now: seen.saved[0].work.now, next: seen.saved[0].work.next }, { now: "mission 2: agents.c", next: "mission 3" });
  await run(brain, "moved to mission 3");
  assert.deepStrictEqual({ now: seen.saved[0].work.now, next: seen.saved[0].work.next }, { now: "mission 3", next: "mission 3" });
  await run(brain, "hi");
  assert.match(seen.prompts[2], /Omri works on now: mission 3; next: mission 3/);
});

test("working_on is refused after a web page was read in the message", async () => {
  const d = disk();
  const { brain, seen } = setup(['CALL {"tool":"read_link","url":"https://example.com/a"}', 'CALL {"tool":"working_on","course":"Systems Programming","now":"mission 9"}\nNoted.', "Not saved."], d);
  await run(brain, "read https://example.com/a");
  assert.ok(!seen.saved[0].work);
  assert.match(seen.prompts[2], /after reading a web page/);
});

test("pc_find mentions the WSL home that is not searched, and pc_roots wsl adds it only after the tap", async () => {
  const d = disk();
  const wslHome = fs.realpathSync(d.ops); // stands in for \\wsl.localhost\<distro>\home\<user>
  const { brain, seen, linkBatches, finder } = setup(['CALL {"tool":"pc_find","words":["agents"]}', 'CALL {"tool":"pc_roots","wsl":true}\nA card waits for your tap.'], d, { wslHome });
  const r = await run(brain, "find agents.c");
  assert.match(seen.prompts[1], /WSL home .* is NOT searched yet/);
  assert.strictEqual(r.linkBatch.mode, "root");
  assert.strictEqual(r.linkBatch.folder, wslHome);
  assert.deepStrictEqual(finder.roots(), []); // nothing before the tap
  await linkBatches.confirm(r.linkBatch.id).done;
  assert.deepStrictEqual(finder.roots(), [wslHome]);
  assert.ok(finder.find("agents").items.some((x) => x.name === "agents.c"));
});

test("pc_roots wsl: no card when there is no WSL home, or after a web page", async () => {
  const d = disk();
  const a = setup(['CALL {"tool":"pc_roots","wsl":true}', "None."], d);
  const ra = await run(a.brain, "search my wsl");
  assert.ok(!ra.linkBatch);
  assert.match(a.seen.prompts[1], /no WSL home to add/);
  const b = setup(['CALL {"tool":"read_link","url":"https://example.com/a"}', 'CALL {"tool":"pc_roots","wsl":true}\nAdded.', "No."], d, { wslHome: d.ops });
  const rb = await run(b.brain, "read https://example.com/a");
  assert.ok(!rb.linkBatch);
});

test("a linked folder is in the context even when the course has no material uploaded yet", async () => {
  const d = disk();
  const { brain, seen } = setup(["ok"], d, { extra: { courses: { allPages: () => [] } } });
  await run(brain, "systems programming: what am I doing");
  assert.match(seen.prompts[0], /Omri's own project folder for Systems Programming/);
  assert.match(seen.prompts[0], /NEXT TO the linked one, mission2/);
});
