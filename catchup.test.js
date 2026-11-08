// catchup.test.js
// catchup.js with made-up notes (one big file, Hebrew and English headings) and a FAKE model. No real model, no real data.
const test = require("node:test");
const assert = require("node:assert");
const { buildOutline } = require("./outline");
const cu = require("./catchup");

const body = (word, n) => Array.from({ length: n }, (_, i) => `${word} sentence number ${i + 1} explains the idea with a small example.`).join("\n");
// 4 pages of text; headings: a chapter with two sub-sections, a Hebrew chapter, an English one.
function notes() {
  const text = [
    "# Chapter 1 Introduction", body("intro", 6),
    "# Chapter 2 Memory", "## 2.1 Stack and heap", body("stack", 90), "## 2.2 Pointers", body("pointer", 20),
    "# פרק 3 ניהול זיכרון דינמי", body("malloc", 30),
    "# Chapter 4 Files", body("file", 10),
  ].join("\n");
  const lines = text.split("\n");
  const per = Math.ceil(lines.length / 4);
  return Array.from({ length: 4 }, (_, i) => ({ fileId: "f1", fileName: "notes.txt", page: i + 1, text: lines.slice(i * per, (i + 1) * per).join("\n") }));
}

test("units are leaf sections and chunks stay about one screen", () => {
  const pages = notes(), o = buildOutline(pages);
  const units = cu.unitsOf(o).map((u) => u.title);
  assert.ok(units.includes("2.1 Stack and heap") && units.includes("2.2 Pointers"), units.join("|"));
  assert.ok(!units.includes("Chapter 2 Memory"), "a parent with children is not a unit");
  const chunks = cu.chunksOf(o, pages);
  assert.ok(chunks.length >= 6);
  for (const c of chunks) assert.ok(c.text.length <= cu.CHUNK_CHARS + 700, `${c.key} has ${c.text.length}`);
  const stack = chunks.filter((c) => c.title === "2.1 Stack and heap");
  assert.ok(stack.length >= 2 && stack[0].parts === stack.length, "a long section is cut into numbered parts");
});

test("matchSections: words against titles, both languages, nothing invented", () => {
  const pages = notes(), o = buildOutline(pages);
  assert.deepStrictEqual(cu.matchSections(o, "teach me about pointers", undefined, pages).map((u) => u.title), ["2.2 Pointers"]);
  assert.deepStrictEqual(cu.matchSections(o, "תלמד אותי את ניהול הזיכרון הדינמי", undefined, pages).map((u) => u.title), ["פרק 3 ניהול זיכרון דינמי"]);
  assert.deepStrictEqual(cu.matchSections(o, "teach me quantum physics", undefined, pages), []);
  assert.deepStrictEqual(cu.matchSections(o, "teach me the next part", undefined, pages), [], "generic words match nothing");
  const memory = cu.matchSections(o, "memory", undefined, pages).map((u) => u.title);
  assert.ok(memory.includes("2.1 Stack and heap") && memory.includes("2.2 Pointers"), "a parent title brings its leaves");
});

test("sectionByNumber: section 3, 2.2, and a number that does not exist", () => {
  const o = buildOutline(notes());
  assert.deepStrictEqual(cu.sectionByNumber(o, "explain section 2.2").map((u) => u.title), ["2.2 Pointers"]);
  assert.ok(cu.sectionByNumber(o, "הסבר סעיף 2.1").length === 1);
  assert.deepStrictEqual(cu.sectionByNumber(o, "explain section 99"), []);
  assert.deepStrictEqual(cu.sectionByNumber(o, "explain things"), []);
});

test("chooseByModel keeps only ids that are in the real outline", async () => {
  const pages = notes(), o = buildOutline(pages);
  const real = cu.unitsOf(o)[2].id;
  const ask = (answer) => async () => ({ answer });
  const got = await cu.chooseByModel({ askChain: ask(JSON.stringify({ ids: [real, "s999", "../etc"] })), chain: [{ model: "x" }], outline: o, pages, text: "memory" });
  assert.deepStrictEqual(got.map((u) => u.id), [real]);
  assert.deepStrictEqual(await cu.chooseByModel({ askChain: ask("not json"), chain: [{ model: "x" }], outline: o, pages, text: "x" }), []);
  assert.deepStrictEqual(await cu.chooseByModel({ askChain: async () => { throw new Error("down"); }, chain: [{ model: "x" }], outline: o, pages, text: "x" }), []);
});

test("nextChunk: first chunk, then after the cursor, then the first one not taught in a named section", () => {
  const pages = notes(), o = buildOutline(pages), chunks = cu.chunksOf(o, pages);
  const st = (taught, cursor) => ({ taught, cursor });
  assert.strictEqual(cu.nextChunk(chunks, st([], null)).key, chunks[0].key);
  assert.strictEqual(cu.nextChunk(chunks, st([chunks[0].key], chunks[0].key)).key, chunks[1].key);
  assert.strictEqual(cu.nextChunk(chunks, st([chunks[chunks.length - 1].key], chunks[chunks.length - 1].key)), null, "the end of the notes");
  const stack = cu.matchSections(o, "stack heap", undefined, pages);
  const first = chunks.filter((c) => c.title === "2.1 Stack and heap");
  assert.strictEqual(cu.nextChunk(chunks, st([first[0].key], first[0].key), stack).key, first[1].key);
});

test("buildSchedule: deadline first, then courses in turns, concepts-first courses first, nothing past the budget", () => {
  const today = "2026-11-08"; // a Sunday
  const mk = (course, label, minutes, extra = {}) => ({ course, kind: "chunk", label, minutes, say: "x", deadline: null, concepts: false, focus: false, ...extra });
  const items = [mk("A", "a1", 25), mk("A", "a2", 25), mk("B", "b1", 25, { concepts: true }), mk("B", "b2", 25, { concepts: true }), mk("C", "hw", 60, { kind: "assignment", deadline: "2026-11-10" })];
  const s = cu.buildSchedule(items, { today, budget: 90 });
  assert.deepStrictEqual(s.grid[0].items.map((i) => i.label), ["hw", "b1"], "the deadline first, then the concepts course");
  assert.ok(s.grid.every((g) => g.minutes <= 100));
  assert.strictEqual(s.late.length, 0);
  const tight = cu.buildSchedule([mk("C", "hw1", 80, { deadline: "2026-11-08" }), mk("C", "hw2", 80, { deadline: "2026-11-08" })], { today, budget: 90 });
  assert.strictEqual(tight.late.length, 1, "the second one lands after its deadline and is reported");
});

test("parseBudget", () => {
  assert.strictEqual(cu.parseBudget("I have 2 hours a day"), 120);
  assert.strictEqual(cu.parseBudget("45 minutes a day"), 45);
  assert.strictEqual(cu.parseBudget("יש לי שעתיים ביום"), 120);
  assert.strictEqual(cu.parseBudget("5 minutes"), null);
  assert.strictEqual(cu.parseBudget("what should I do"), null);
  assert.strictEqual(cu.parseBudget("20 hours a day"), 360);
});

test("buildSchedule: a day is filled with the first item that still fits, not left half empty", () => {
  const mk = (course, label, minutes) => ({ course, kind: "chunk", label, minutes, say: "x", deadline: null, concepts: false, focus: false });
  const s = cu.buildSchedule([mk("A", "big", 80), mk("A", "big2", 80), mk("B", "small", 10)], { today: "2026-11-08", budget: 90 });
  assert.deepStrictEqual(s.grid[0].items.map((i) => i.label), ["big", "small"]);
  assert.deepStrictEqual(s.grid[1].items.map((i) => i.label), ["big2"]);
});
