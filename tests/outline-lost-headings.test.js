// The two outline bugs of 2026-11-16, on made-up notes of the same shape as the real files:
//  - Meni's notes (a Word file saved as a page): the headings Word numbered by itself came out as "- Title" lines, so every chapter
//    title and the whole of chapter 4 were missing;
//  - the Calculus 2 notebook: its lecture lines carry the date and the course in front ("05/11/25 חדו״א 2 הרצאה 4").
const test = require("node:test");
const assert = require("node:assert");
const { buildOutline } = require("../outline");
const catchup = require("../catchup");

const para = (s, n = 6) => Array.from({ length: n }, (_, i) => `${s} sentence ${i + 1} of the text, long enough to look like notes.`).join("\n\n");
// chapters 2, 3 and 5 keep hand-typed sub-numbers; chapter 4 lost every number
const WORD_NOTES = [
  "Systems course", "", "- about the course", "", para("intro"), "",
  "1.1 Basic terms", "", para("basic"), "",
  "- Memory management", "", "2.1 Views of memory", "", para("views"), "", "2.1.1 Hardware", "", para("hardware"), "",
  "- a list item that is not a heading", "- another list item", "", "2.1.2 The operating system", "", para("os"), "",
  "2.2 Objects", "", "2.2.1 Layout of an object", "", para("layout"), "",
  "- Concurrency", "", "3.1 Motivation", "", para("why threads"), "",
  "- Safety and correctness", "", "3.3.1 Introduction", "", para("safety"), "", "3.3.2 Safe objects", "", para("objects"), "",
  "- one lone list line", "", para("more text of chapter three"), "",
  "- Communication between processes", "", "- Introduction", "", "- Motivation", "", para("sockets"), "", "- The network layers", "", para("layers"), "",
  "- Databases", "", "5.1 Introduction to tables", "", para("tables"), "",
].join("\n");
const pagesOf = (text, fileName = "notes.html") => [{ fileId: "f1", fileName, page: 1, text }];

test("a chapter title that lost its number is found above its first numbered section, with the number worked out", () => {
  const f = buildOutline(pagesOf(WORD_NOTES)).files[0];
  const titles = f.sections.map((s) => s.title);
  assert.ok(titles.includes("2 Memory management"), titles.join(" | "));
  assert.ok(titles.includes("3 Concurrency"));
  assert.ok(titles.includes("5 Databases"));
  assert.ok(titles.includes("3.3 Safety and correctness"), "a lost section title above 3.3.1");
  assert.strictEqual(f.sections.find((s) => s.title === "3 Concurrency").level, 1);
  assert.ok(!titles.some((t) => /list item|lone list line|about the course/.test(t)), "ordinary list lines are not headings");
});

test("a whole chapter whose headings all lost their numbers (chapter 4) is found, and the chapter before it ends there", () => {
  const o = buildOutline(pagesOf(WORD_NOTES));
  const f = o.files[0];
  const ch4 = f.sections.find((s) => s.title === "4 Communication between processes");
  assert.ok(ch4, f.sections.map((s) => s.title).join(" | "));
  assert.strictEqual(ch4.level, 1);
  const last3 = f.sections.find((s) => s.title === "3.3.2 Safe objects");
  assert.strictEqual(last3.end, ch4.start, "3.3.2 no longer swallows chapter 4");
  assert.ok(WORD_NOTES.slice(ch4.start, ch4.end).includes("sockets sentence 1") && !WORD_NOTES.slice(ch4.start, ch4.end).includes("tables sentence"));
  // "chapter 4" / "פרק 4" now reaches it
  assert.deepStrictEqual(catchup.sectionByNumber(o, "teach me chapter 4").map((u) => u.title), ["4 Communication between processes"]);
  assert.deepStrictEqual(catchup.sectionByNumber(o, "תלמד אותי את פרק 4").map((u) => u.title), ["4 Communication between processes"]);
});

test("nothing is added when the numbering does not prove it", () => {
  // two chapters missing between 2 and 5: Bot does not guess which lone lines are their titles
  const text = WORD_NOTES.replace("- Concurrency\n\n3.1 Motivation", "3.1 Motivation").replace(/3\.3\.(\d)/g, "3.4.$1");
  const titles = buildOutline(pagesOf(text)).files[0].sections.map((s) => s.title);
  assert.ok(!titles.some((t) => /^[34] /.test(t)), titles.join(" | "));
  // a file with too few dotted titles keeps its old outline (no "- " line becomes a heading)
  const small = buildOutline(pagesOf(["- A", "", "1.1 One", "", para("x"), "", "- B", "", "- C", "", "- D", "", para("y")].join("\n"))).files[0];
  assert.ok(!small.sections.some((s) => /^\d+ [A-D]$/.test(s.title)));
});

test("lecture lines with the date and the course in front are lectures (the Calculus notebook)", () => {
  const pages = [
    { fileId: "nb", fileName: "notebook.pdf", page: 1, text: "27/10/25 חדו״א 2 הרצאה 1\n\n" + para("riemann sums") + "\n\nנראה את זה בהרצאה הבאה" },
    { fileId: "nb", fileName: "notebook.pdf", page: 2, text: "29/10/25 חדו״א 2 הרצאה 2\n\n" + para("darboux") },
    { fileId: "nb", fileName: "notebook.pdf", page: 3, text: para("more of lecture two") + "\n\nכמו שראינו בהרצאה 1, הטענה נכונה." },
    { fileId: "nb", fileName: "notebook.pdf", page: 4, text: "03/11/25\nחדו״א 2 הרצאה 3\n\n" + para("the fundamental theorem") },
    { fileId: "nb", fileName: "notebook.pdf", page: 5, text: "Calculus 2 lecture 4\n\n" + para("integration by parts") },
  ];
  const f = buildOutline(pages).files[0];
  assert.strictEqual(f.kind, "headings");
  assert.deepStrictEqual(f.sections.map((s) => [s.kind, s.lecture, s.fromPage, s.toPage]), [["lecture", 1, 1, 1], ["lecture", 2, 2, 3], ["lecture", 3, 4, 4], ["lecture", 4, 5, 5]]);
});

test("a sentence that only mentions a lecture is not a lecture line", () => {
  const text = ["Lecture 1: sets", "", para("sets"), "", "As we said, this was shown in the proof of lecture 2.", "", para("more"), "", "Lecture 2: maps", "", para("maps")].join("\n");
  const f = buildOutline(pagesOf(text)).files[0];
  assert.deepStrictEqual(f.sections.map((s) => s.lecture), [1, 2]);
  assert.ok(f.sections[1].title.startsWith("Lecture 2: maps"));
});
