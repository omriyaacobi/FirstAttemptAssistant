// Several course files with the same name (a zip of missions, each with its own README): course_files shows each one's id and
// first line, and course_read / open_on_pc take the id. All text here is invented.
const test = require("node:test");
const assert = require("node:assert");
const { createBrain } = require("../brain");

const C = { id: "c".repeat(16), name: "Systems Demo" };
const FILES = [
  { id: "1111111111111111", name: "README.pdf", status: "ready", pages: 1 },
  { id: "2222222222222222", name: "README.pdf", status: "ready", pages: 1 },
  { id: "3333333333333333", name: "notes.pdf", status: "ready", pages: 1 },
];
const PAGES = [
  { fileId: "1111111111111111", fileName: "README.pdf", page: 1, text: "<div dir=\"rtl\">\n\n# Mission 1 - The intercepted signal\nbody one" },
  { fileId: "2222222222222222", fileName: "README.pdf", page: 1, text: "# Mission 2 - The agent who is not there\nbody two" },
  { fileId: "3333333333333333", fileName: "notes.pdf", page: 1, text: "Notes\nbody three" },
];

function world(replies) {
  const prompts = [], opened = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => PAGES, originalPath: (cid, fid) => `C:/fake/${fid}.pdf` },
    courseRoutes: { list: () => [C], courseFiles: () => ({ files: FILES }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    opener: { openCopy: (p, name) => { opened.push([p, name]); return { how: "its normal app" }; } },
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.parse("2026-11-13T10:00:00Z"),
  });
  return { prompts, opened, ask: (t) => brain.handle(t, { history: [], courses: [C] }) };
}

test("course_files shows the id and first line of files that share a name, and only of those", async () => {
  const w = world(['CALL {"tool":"course_files","course":"Systems Demo"}', "ok"]);
  await w.ask("which readmes are there?");
  assert.match(w.prompts[1], /README\.pdf \[id 1111111111111111, starts: "Mission 1 - The intercepted signal"\]/);
  assert.match(w.prompts[1], /README\.pdf \[id 2222222222222222, starts: "Mission 2 - The agent who is not there"\]/);
  assert.match(w.prompts[1], /\nnotes\.pdf \(ready/);
});

test("course_read by id reads only that file; by a shared name it asks for the id", async () => {
  const w = world(['CALL {"tool":"course_read","course":"Systems Demo","file":"2222222222222222"}', 'CALL {"tool":"course_read","course":"Systems Demo","file":"README.pdf"}', "ok"]);
  await w.ask("read the mission 2 readme");
  assert.match(w.prompts[1], /body two/);
  assert.doesNotMatch(w.prompts[1], /body one/);
  assert.match(w.prompts[2], /more than one file of Systems Demo is called that; pass the id/);
});

test("open_on_pc opens the file whose id was given", async () => {
  const w = world(['CALL {"tool":"open_on_pc","course":"Systems Demo","file":"2222222222222222"}\nOpening it.', "ok"]);
  const r = await w.ask("open the mission 2 readme");
  assert.deepStrictEqual(w.opened, [["C:/fake/2222222222222222.pdf", "README.pdf"]]);
  assert.strictEqual(r.answer, "Opening it.");
});
