// tests/todo.test.js - todo.js (the shared to-do list file) and the brain's todo_read / todo_update tools. Temp folders and FAKE models only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTodo, parse, MAX_TEXT, UNDO_MS } = require("../todo");
const { createBrain } = require("../brain");

const SAMPLE = `# To do

Some words that are not items and must stay.

## Soon
- [ ] [t1] First thing
  - a sub point of t1
- [x] [t2] Second thing, done

## Later
- [ ] [t3] Third thing

## Empty
`;

function fresh(text = SAMPLE, now = () => Date.now()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-test-"));
  const file = path.join(dir, "todo.md");
  fs.writeFileSync(file, text);
  return { dir, file, todo: createTodo({ file, now }) };
}
const body = (f) => fs.readFileSync(f.file, "utf8");

test("parse finds sections, items, done state and the indented lines of an item", () => {
  const p = parse(SAMPLE);
  assert.deepStrictEqual(p.sections.map((s) => s.name), ["Soon", "Later", "Empty"]);
  assert.deepStrictEqual(p.items.map((i) => [i.id, i.done, i.section]), [["t1", false, "Soon"], ["t2", true, "Soon"], ["t3", false, "Later"]]);
  assert.strictEqual(p.items[0].end - p.items[0].start, 2);
});

test("read: the whole file, one item with its sub lines, an unknown id lists the ids, a missing file is said", () => {
  const f = fresh();
  assert.strictEqual(f.todo.read(), SAMPLE);
  assert.match(f.todo.read({ id: "t1" }), /First thing\n {2}- a sub point/);
  assert.match(f.todo.read({ id: "[T3]" }), /Third thing/);
  assert.throws(() => f.todo.read({ id: "t99" }), /ids: t1, t2, t3/);
  assert.match(createTodo({ file: path.join(f.dir, "none.md") }).read(), /no to-do list file/);
});

test("add: goes to the end of the named section, new id is the highest + 1, other text stays byte for byte", () => {
  const f = fresh();
  assert.match(f.todo.update({ action: "add", text: "Fourth\tthing", section: "soon" }), /Added \[t4\] to "Soon"/);
  assert.strictEqual(body(f), SAMPLE.replace("- [x] [t2] Second thing, done\n", "- [x] [t2] Second thing, done\n- [ ] [t4] Fourth thing\n"));
  f.todo.update({ action: "add", text: "Into the empty one", section: "Empty" });
  assert.match(body(f), /## Empty\n- \[ \] \[t5\] Into the empty one/);
});

test("add: bad section, empty text, too long, control characters and no section are refused and nothing is written", () => {
  const f = fresh();
  assert.throws(() => f.todo.update({ action: "add", text: "x", section: "nope" }), /no section fits/);
  assert.throws(() => f.todo.update({ action: "add", text: "x" }), /which section/);
  assert.throws(() => f.todo.update({ action: "add", text: "  ", section: "Soon" }), /empty/);
  assert.throws(() => f.todo.update({ action: "add", text: "a".repeat(MAX_TEXT + 1), section: "Soon" }), /at most/);
  assert.throws(() => f.todo.update({ action: "add", text: "a\u0000b", section: "Soon" }), /control/);
  assert.throws(() => f.todo.update({ action: "explode" }), /must be one of/);
  assert.strictEqual(body(f), SAMPLE);
});

test("a newline in the text cannot make a second item or a heading", () => {
  const f = fresh();
  f.todo.update({ action: "add", text: "one\n## Evil\n- [ ] [t77] two", section: "Soon" });
  const p = parse(body(f));
  assert.strictEqual(p.sections.length, 3);
  assert.strictEqual(p.items.length, 4);
});

test("done / undone / reword / move / remove", () => {
  const f = fresh();
  assert.match(f.todo.update({ action: "done", id: "t1" }), /Marked \[t1\] done/);
  assert.match(body(f), /- \[x\] \[t1\] First thing\n {2}- a sub point/);
  assert.match(f.todo.update({ action: "done", id: "t1" }), /already done/);
  f.todo.update({ action: "undone", id: "t2" });
  assert.match(body(f), /- \[ \] \[t2\]/);
  f.todo.update({ action: "reword", id: "t1", text: "Renamed" });
  assert.match(body(f), /- \[x\] \[t1\] Renamed\n\n## Later|- \[x\] \[t1\] Renamed\n- \[ \] \[t2\]/);
  assert.doesNotMatch(body(f), /sub point/, "the item's sub lines go with the old text");
  f.todo.update({ action: "move", id: "t3", section: "Soon" });
  const p = parse(body(f));
  assert.deepStrictEqual(p.items.map((i) => [i.id, i.section]), [["t1", "Soon"], ["t2", "Soon"], ["t3", "Soon"]]);
  f.todo.update({ action: "move", id: "t1", section: "Empty" });
  assert.deepStrictEqual(parse(body(f)).items.map((i) => [i.id, i.section]), [["t2", "Soon"], ["t3", "Soon"], ["t1", "Empty"]]);
  assert.match(f.todo.update({ action: "remove", id: "t2" }), /Removed \[t2\]/);
  assert.deepStrictEqual(parse(body(f)).items.map((i) => i.id), ["t3", "t1"]);
  assert.throws(() => f.todo.update({ action: "done", id: "t2" }), /no item/);
  assert.match(body(f), /Some words that are not items and must stay\./);
});

test("move an item down past later sections keeps every line", () => {
  const f = fresh();
  f.todo.update({ action: "move", id: "t1", section: "Later" });
  assert.deepStrictEqual(parse(body(f)).items.map((i) => [i.id, i.section]), [["t2", "Soon"], ["t3", "Later"], ["t1", "Later"]]);
  assert.match(body(f), /- \[ \] \[t1\] First thing\n {2}- a sub point of t1/);
});

test("undo puts the last change back, once; refuses after 2 hours and when someone edited the file since", () => {
  let t = 1000;
  const f = fresh(SAMPLE, () => t);
  assert.match(f.todo.update({ action: "undo" }), /no change/);
  f.todo.update({ action: "remove", id: "t3" });
  assert.match(f.todo.update({ action: "undo" }), /Undone: Removed \[t3\]/);
  assert.strictEqual(body(f), SAMPLE);
  assert.match(f.todo.update({ action: "undo" }), /no change/);
  f.todo.update({ action: "done", id: "t1" });
  fs.appendFileSync(f.file, "\n- [ ] [t9] added by Claude Code\n");
  assert.match(f.todo.undo(), /changed after Bot's last change/);
  assert.match(body(f), /\[t9\]/);
  f.todo.update({ action: "undone", id: "t2" });
  t += UNDO_MS + 1;
  assert.match(f.todo.undo(), /more than 2 hours/);
});

test("a hand edit between two calls is seen (the file is read fresh), and no temp file is left behind", () => {
  const f = fresh();
  f.todo.update({ action: "done", id: "t1" });
  fs.writeFileSync(f.file, body(f) + "- [ ] [t10] from Claude Code\n");
  f.todo.update({ action: "done", id: "t10" });
  assert.match(body(f), /- \[x\] \[t10\]/);
  assert.deepStrictEqual(fs.readdirSync(f.dir).filter((n) => n.endsWith(".tmp")), []);
});

test("windows line endings in the file are understood", () => {
  const f = fresh(SAMPLE.replace(/\n/g, "\r\n"));
  assert.match(f.todo.update({ action: "done", id: "t3" }), /done/);
});

// ---- the brain's tools ----
const COURSES = [{ id: "calc", name: "Calculus 2" }];
function brainWith({ todo, replies, fetchPage, image }) {
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => [{ fileId: "f1", fileName: "n.pdf", page: 1, text: "notes" }] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    coach: null,
    reminders: { list: () => [], create: () => ({}) },
    todo,
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    fetchPage,
    askOne: async (p, m, prompt) => { prompts.push(prompt); return replies[i++]; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.parse("2026-11-21T10:00:00Z"),
  });
  return { brain, prompts };
}

test("brain: todo_read shows the list as DATA, and todo_update changes the file", async () => {
  const f = fresh();
  const { brain, prompts } = brainWith({ todo: f.todo, replies: ['CALL {"tool":"todo_read"}', "You have 3 items."] });
  await brain.handle("what's on the to-do list?", { history: [], courses: COURSES });
  assert.match(prompts[1], /<tool-result[^>]*>[\s\S]*\[t1\] First thing/);
  const b2 = brainWith({ todo: f.todo, replies: ['CALL {"tool":"todo_update","action":"done","id":"t3"}\nDone, t3 is finished.', "unused"] });
  const r = await b2.brain.handle("mark the third item done", { history: [], courses: COURSES });
  assert.match(body(f), /- \[x\] \[t3\]/);
  assert.match(String(r.answer || r.text || JSON.stringify(r)), /t3/);
});

test("brain: a failed update says why and the file is unchanged; a missing todo is said plainly", async () => {
  const f = fresh();
  const a = brainWith({ todo: f.todo, replies: ['CALL {"tool":"todo_update","action":"done","id":"t42"}', "It does not exist."] });
  await a.brain.handle("mark t42 done", { history: [], courses: COURSES });
  assert.match(a.prompts[1], /FAILED, nothing was done: .*no item "t42"/);
  assert.strictEqual(body(f), SAMPLE);
  const b = brainWith({ todo: null, replies: ['CALL {"tool":"todo_read"}', "Off."] });
  await b.brain.handle("the list?", { history: [], courses: COURSES });
  assert.match(b.prompts[1], /not set up/);
});

test("brain: after reading a course file, todo_update is refused (file text must not become an item)", async () => {
  const f = fresh();
  const a = brainWith({ todo: f.todo, replies: ['CALL {"tool":"course_search","course":"Calculus 2","query":"x"}', 'CALL {"tool":"todo_update","action":"add","text":"from the file","section":"Soon"}', "Refused."] });
  await a.brain.handle("look at the notes and add a task", { history: [], courses: COURSES });
  assert.match(a.prompts.join("\n"), /FAILED, nothing was done: Bot does not change the to-do list in a message after reading a course file/);
  assert.strictEqual(body(f), SAMPLE);
});

test("the brief names both tools and tells the model what the list is", () => {
  const brief = fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8");
  for (const needle of ["todo_read", "todo_update", "to-do list", "improve_bot"]) assert.ok(brief.includes(needle), needle);
});
