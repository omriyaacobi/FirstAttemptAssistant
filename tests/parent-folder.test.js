// tests/parent-folder.test.js
// "Check my function" when the file is in mission2 but the linked folder is mission1 (2026-11-13). Code looks in the linked folder's
// PARENT only (one level, by name) and offers ONE Confirm card to link the parent instead; nothing changes before Omri's tap.
// Fake folders and invented file text in a temp folder; fake models; no real Bot data.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projectFolder = require("../project-folder");
const { createBrain } = require("../brain");
const { createLinkBatches } = require("../link-batch");

const COURSES = [{ id: "c1", name: "Systems Programming" }];
const RULES = { system: [] }; // temp folders live under AppData on Windows

// base/ops/mission1/main.c (linked), base/ops/mission2/agents.c, base/ops/mission2/.env, base/other/deep/far.c
function disk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bot-parent-"));
  const ops = path.join(base, "ops");
  const put = (rel, text) => { const f = path.join(ops, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put("mission1/main.c", "int main(void) { return 0; }\n");
  put("mission2/agents.c", "int find_agent(int id) { return id * 2; }\n");
  put("mission2/.env", "KEY=not-real\n");
  fs.mkdirSync(path.join(base, "far", "deep"), { recursive: true });
  fs.writeFileSync(path.join(base, "far", "deep", "far.c"), "int far;\n");
  return { base, ops: fs.realpathSync(ops), linked: fs.realpathSync(path.join(ops, "mission1")) };
}

test("findInParent finds a file in a sibling folder, by name or by folder/name", () => {
  const d = disk();
  assert.deepStrictEqual(projectFolder.findInParent(d.linked, "agents.c", RULES), { parent: d.ops, hits: ["mission2/agents.c"] });
  assert.deepStrictEqual(projectFolder.findInParent(d.linked, "mission2/agents.c", RULES).hits, ["mission2/agents.c"]);
  assert.deepStrictEqual(projectFolder.findInParent(d.linked, "MISSION2\\Agents.C", RULES).hits, ["mission2/agents.c"]);
});

test("findInParent: nothing for a missing file, a secret, a file two levels up, or an empty name", () => {
  const d = disk();
  assert.strictEqual(projectFolder.findInParent(d.linked, "nothere.c", RULES), null);
  assert.strictEqual(projectFolder.findInParent(d.linked, ".env", RULES), null); // secrets are never listed, so never found
  assert.strictEqual(projectFolder.findInParent(d.linked, "far.c", RULES), null); // only the parent, never higher
  assert.strictEqual(projectFolder.findInParent(d.linked, "", RULES), null);
  assert.strictEqual(projectFolder.findInParent(d.linked, "..", RULES), null);
});

test("findInParent keeps the link rules: a forbidden or system parent is never offered", () => {
  const d = disk();
  assert.strictEqual(projectFolder.findInParent(d.linked, "agents.c", { system: [d.ops] }), null);
  assert.strictEqual(projectFolder.findInParent(d.linked, "agents.c", { system: [], forbidden: [d.ops] }), null);
  assert.strictEqual(projectFolder.findInParent(path.join(d.base, "gone"), "agents.c", RULES), null); // a linked folder that is gone
});

test("a Linux or WSL home is never a parent to link", () => {
  for (const p of ["\\\\wsl.localhost\\Ubuntu-22.04\\home\\omri", "\\\\wsl$\\Ubuntu\\home\\someone\\", "/home/someone", "/home", "\\\\wsl.localhost\\Ubuntu-22.04\\home"]) assert.ok(projectFolder.LINUX_HOME.test(p), p);
  for (const p of ["\\\\wsl.localhost\\Ubuntu-22.04\\home\\omri\\operation_b7", "/home/someone/ops", "C:\\Users\\x\\home"]) assert.ok(!projectFolder.LINUX_HOME.test(p), p);
});

function setup(replies, d) {
  const seen = { prompts: [], saved: [{ key: "c1", assignments: [], position: {}, projectDir: d.linked }] };
  let i = 0;
  const tracker = {
    refsFor: (list) => list.map((c) => ({ key: c.id, courseId: c.id, name: c.name })),
    course: (ref) => seen.saved.find((n) => n.key === ref.key) || { key: ref.key, assignments: [], position: {} },
    save: (rec) => { seen.saved = seen.saved.filter((n) => n.key !== rec.key).concat([rec]); },
    getSession: () => null,
    timetable: () => ({ courses: [] }),
  };
  const linkBatches = createLinkBatches({ courseRoutes: {} });
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    linkBatches,
    coach: { tracker, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "Page", text: "read agents.c" }),
    askOne: async (provider, model, prompt) => { seen.prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.now(),
    folderRules: RULES,
  });
  return { brain, seen, linkBatches };
}
const run = (brain, task) => brain.handle(task, { history: [], courses: COURSES });
const read = 'CALL {"tool":"project_read","course":"Systems Programming","file":"agents.c"}';

test("a file in the folder next to the linked one: ONE card to link the parent, linked only after the tap", async () => {
  const d = disk();
  const { brain, seen, linkBatches } = setup([read, "agents.c is in mission2, next to the linked folder. Tap Confirm to link ops."], d);
  const r = await run(brain, "check my function in agents.c");
  assert.strictEqual(r.linkBatch.mode, "folder");
  assert.strictEqual(r.linkBatch.folder, d.ops); // the card shows the real path code found
  assert.match(seen.prompts[1], /card now asks Omri to link/);
  assert.match(seen.prompts[1], /mission2\/agents\.c/);
  assert.doesNotMatch(seen.prompts[1], /find_agent/); // the file was NOT read before the tap
  assert.strictEqual(seen.saved[0].projectDir, d.linked); // nothing changed yet
  await linkBatches.confirm(r.linkBatch.id).done;
  assert.strictEqual(seen.saved[0].projectDir, d.ops);
  assert.match(projectFolder.readFile(d.ops, "agents.c").text, /find_agent/);
});

test("no card when the file is nowhere near, and none after a web page was read", async () => {
  const d = disk();
  const a = setup(['CALL {"tool":"project_read","course":"Systems Programming","file":"far.c"}', "far.c is not in the linked folder."], d);
  const ra = await run(a.brain, "check far.c");
  assert.ok(!ra.linkBatch);
  assert.match(a.seen.prompts[1], /there is no file "far\.c" in the linked folder/);
  const b = setup(['CALL {"tool":"read_link","url":"https://example.com/a"}', read, "Not in the linked folder."], d);
  const rb = await run(b.brain, "read https://example.com/a and check my code");
  assert.ok(!rb.linkBatch);
  assert.match(b.seen.prompts[2], /there is no file "agents\.c"/);
});

test("the card checks the folder again at the tap: a parent that is gone is not linked", async () => {
  const d = disk();
  const { brain, seen, linkBatches } = setup([read, "Card shown."], d);
  const r = await run(brain, "check agents.c");
  fs.rmSync(d.ops, { recursive: true, force: true }); // the folder is gone before the tap
  await linkBatches.confirm(r.linkBatch.id).done;
  assert.strictEqual(seen.saved[0].projectDir, d.linked);
});
