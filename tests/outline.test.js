// outline.test.js: step 3 of the "where am I" plan, the outline builder (code only). Every document here is made up.
const test = require("node:test");
const assert = require("node:assert");
const { buildOutline, sectionByName, sectionAtFraction, sectionAtPage, validPages } = require("../outline");

const filler = (n, word = "alpha") => Array.from({ length: n }, (_, i) => `${word} sentence number ${i} about the topic at hand.`).join("\n");
const pagesOf = (fileId, texts, fileName = "notes.pdf") => texts.map((text, i) => ({ fileId, fileName, page: i + 1, text }));

test("8 lecture headings over 16 pages: 8 lecture sections with page ranges, found by name or number", () => {
  const texts = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? `Lecture ${i / 2 + 1}: Topic ${i / 2 + 1}\n${filler(5)}` : filler(6, "beta")));
  const o = buildOutline(pagesOf("f1", texts));
  const f = o.files[0];
  assert.strictEqual(f.kind, "headings");
  assert.strictEqual(f.realPages, true);
  assert.deepStrictEqual(f.sections.map((s) => s.lecture), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual([f.sections[0].fromPage, f.sections[0].toPage], [1, 2]);
  assert.deepStrictEqual([f.sections[7].fromPage, f.sections[7].toPage], [15, 16]);
  assert.strictEqual(sectionByName(o, "lecture 5").lecture, 5);
  assert.strictEqual(sectionByName(o, "Lecture 5: Topic 5").lecture, 5);
  assert.strictEqual(sectionByName(o, "lecture 12"), null); // not in the notes
  assert.strictEqual(sectionByName(o, "Topic 99"), null);
  assert.strictEqual(sectionByName(o, ""), null);
  assert.strictEqual(sectionAtPage(o, "f1", 9).lecture, 5);
  assert.strictEqual(sectionAtPage(o, "f1", 17), null);
  assert.strictEqual(validPages(o, "f1", 1, 16), true);
  assert.strictEqual(validPages(o, "f1", 1, 17), false);
  assert.strictEqual(validPages(o, "f1", 0, 3), false);
  assert.strictEqual(validPages(o, "nope", 1, 2), false);
});

test("a mention of another lecture inside a sentence, or a jump in numbers, is not a heading", () => {
  const texts = ["Lecture 1: Intro\nAs we saw in lecture 3 this is easy.\nLecture 9\nmore", "Lecture 2: Next\ntext", "Lecture 3\ntext"];
  const f = buildOutline(pagesOf("f", texts)).files[0];
  assert.deepStrictEqual(f.sections.map((s) => s.lecture), [1, 2, 3]);
});

test("one file with 8 markdown headings, two levels: fractions map to the heading that holds that part", () => {
  const body = Array.from({ length: 8 }, (_, i) => `# Section ${i + 1}\n${filler(40, "w" + i)}\n## Detail ${i + 1}\n${filler(5)}`).join("\n\n");
  const o = buildOutline(pagesOf("one", [body]));
  const f = o.files[0];
  assert.strictEqual(f.sections.filter((s) => s.level === 1).length, 8);
  assert.strictEqual(f.sections.filter((s) => s.level === 2).length, 8);
  assert.strictEqual(f.realPages, false); // one page only
  const half = sectionAtFraction(o, 0.5);
  assert.match(half.title, /^(Section 4|Section 5|Detail 4)$/);
  assert.strictEqual(sectionAtFraction(o, 0).title, "Section 1");
  assert.match(sectionAtFraction(o, 1).title, /Detail 8|Section 8/);
  assert.strictEqual(sectionAtFraction(o, 1.2), null);
  assert.strictEqual(sectionAtFraction(o, -0.1), null);
  assert.strictEqual(sectionByName(o, "# section 3").title, "Section 3");
  assert.strictEqual(sectionByName(o, "detail 3").level, 2);
  // a level-1 section ends where the next level-1 section starts, so it holds its details
  const s1 = f.sections[0];
  assert.strictEqual(s1.end, f.sections.find((s) => s.title === "Section 2").start);
});

test("no headings at all: equal slices by size ('Part k of n'), a small file is one part, and a name that is not there is not found", () => {
  const big = buildOutline(pagesOf("big", Array.from({ length: 6 }, (_, i) => filler(120, "p" + i))));
  const f = big.files[0];
  assert.strictEqual(f.kind, "parts");
  assert.strictEqual(f.sections.length, 10);
  assert.strictEqual(f.sections[2].title, "Part 3 of 10");
  const sizes = f.sections.map((s) => s.chars);
  assert.ok(Math.max(...sizes) < 1.4 * Math.min(...sizes), sizes.join(","));
  assert.strictEqual(sectionAtFraction(big, 0.33).index, 4);
  assert.strictEqual(sectionByName(big, "Part 3 of 10").index, 3);
  assert.strictEqual(sectionByName(big, "Introduction"), null);
  const small = buildOutline(pagesOf("s", ["just a few words"]));
  assert.strictEqual(small.files[0].sections.length, 1);
  assert.strictEqual(small.files[0].sections[0].title, "Part 1 of 1");
});

test("Hebrew headings: הרצאה N lines, פרק N, and a Hebrew markdown heading", () => {
  const lec = buildOutline(pagesOf("he", [`הרצאה 1: מבוא\n${filler(4)}`, `הרצאה 2\n${filler(4)}`, `הרצאה מספר 3 - זיכרון\n${filler(4)}`])).files[0];
  assert.deepStrictEqual(lec.sections.map((s) => s.lecture), [1, 2, 3]);
  assert.strictEqual(sectionByName({ files: [lec] }, "הרצאה 3").lecture, 3);
  const chap = buildOutline(pagesOf("he2", [`פרק 1: ניהול זיכרון\n${filler(4)}\nפרק 2: תהליכים\n${filler(4)}\nפרק 3\n${filler(3)}`])).files[0];
  assert.strictEqual(chap.sections.length, 3);
  assert.strictEqual(chap.sections[1].title, "פרק 2: תהליכים");
  const md = buildOutline(pagesOf("he3", [`# מבוא\n${filler(4)}\n## הגדרות\n${filler(4)}\n# סיכום\n${filler(4)}`])).files[0];
  assert.deepStrictEqual(md.sections.map((s) => s.title), ["מבוא", "הגדרות", "סיכום"]);
  assert.strictEqual(sectionByName({ files: [md] }, "הגדרות").level, 2);
});

test("a web page saved as ONE page: sections and fractions work, page numbers are not accepted", () => {
  const html = `# Operating Systems notes\n\n# Memory\n${filler(30, "m")}\n\n## Paging\n${filler(20, "p")}\n\n# Processes\n${filler(30, "q")}\n\n# Files\n${filler(10, "f")}`;
  const o = buildOutline(pagesOf("web", [html], "notes.html"));
  const f = o.files[0];
  assert.strictEqual(f.pageCount, 1);
  assert.strictEqual(f.realPages, false);
  assert.strictEqual(validPages(o, "web", 1, 1), false);
  assert.strictEqual(sectionAtPage(o, "web", 1), null);
  assert.deepStrictEqual(f.sections.map((s) => s.title), ["Operating Systems notes", "Memory", "Paging", "Processes", "Files"]);
  assert.strictEqual(sectionByName(o, "paging").level, 2);
  assert.strictEqual(sectionByName(o, "Networking"), null);
  const third = sectionAtFraction(o, 0.33);
  assert.ok(["Memory", "Paging"].includes(third.title), third.title);
});

test("numbered titles count only when there are several and the numbers rise; list items do not", () => {
  const doc = `Intro text\n\n1 Basics\n${filler(5)}\n\n2 Memory\n${filler(5)}\n\n2.1 Paging\n${filler(5)}\n\n3 Files\n${filler(5)}`;
  const f = buildOutline(pagesOf("n", [doc])).files[0];
  assert.deepStrictEqual(f.sections.map((s) => s.title), ["1 Basics", "2 Memory", "2.1 Paging", "3 Files"]);
  const list = buildOutline(pagesOf("l", [`Shopping\n\n1 Buy milk\n\n7 Buy eggs\n\n2 Buy bread`])).files[0];
  assert.strictEqual(list.kind, "parts");
  const one = buildOutline(pagesOf("o", [`# Only title\n${filler(10)}`])).files[0];
  assert.strictEqual(one.kind, "parts"); // a single heading is not an outline
});

test("several files, empty input, junk, and hostile text stay safe and fast", () => {
  const two = buildOutline([...pagesOf("a", [`Lecture 1\n${filler(3)}`, `Lecture 2\n${filler(3)}`], "a.pdf"), ...pagesOf("b", [filler(400, "bb")], "b.txt")]);
  assert.deepStrictEqual(two.files.map((f) => f.fileName), ["a.pdf", "b.txt"]);
  assert.strictEqual(sectionAtFraction(two, 0.5).fileId, "b"); // the biggest file by default
  assert.strictEqual(sectionAtFraction(two, 0.75, "a").lecture, 2);
  assert.deepStrictEqual(buildOutline([]), { files: [] });
  assert.deepStrictEqual(buildOutline(null), { files: [] });
  assert.deepStrictEqual(buildOutline([null, { fileId: 5 }, { fileId: "x", page: "1", text: "t" }, { fileId: "e", page: 1, text: "   " }]), { files: [] });
  const t0 = Date.now();
  const hostile = buildOutline(pagesOf("h", ["#".repeat(200000) + "\n" + "Lecture ".repeat(50000) + "\n" + "1 ".repeat(100000) + "\n".repeat(100000)]));
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(hostile.files.length <= 1);
  const many = buildOutline(pagesOf("m", [Array.from({ length: 2000 }, (_, i) => `# H${i}\ntext ${i}`).join("\n")]));
  assert.strictEqual(many.files[0].sections.length, 400); // capped
  assert.strictEqual(sectionByName(buildOutline(pagesOf("c", ["# A\nx\n# B\ny"])), "a\u0000").title, "A");
});
