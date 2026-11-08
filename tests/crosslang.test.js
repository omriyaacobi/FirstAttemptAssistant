// crosslang.test.js
// Course search across Hebrew and English (crosslang.js + the hooks in study.js). Fake models only: no agy, no network.
// Run with:  node --test crosslang.test.js

const test = require("node:test");
const assert = require("node:assert");
const { needsTranslation, languageOf, cleanWords, expandQuery, promptFor, EXPAND_TIMEOUT_MS } = require("../crosslang");
const { choosePages, askCourse } = require("../study");

const page = (fileId, n, text) => ({ fileId, fileName: fileId + ".pptx", page: n, text });
// English slides, no keywords (like an old .pptx read): a Hebrew question shares no word with them.
const SLIDES = [
  page("s", 1, "Pointer to pointer: int **ptr_to_ptr = &ptr; the address of an address"),
  page("s", 2, "Dynamic memory allocation with malloc and free on the heap"),
  page("s", 3, "Cache lines and locality of reference in loops over arrays"),
  page("s", 4, "Struct padding and alignment in memory layout"),
];
const HEBREW_NOTES = [
  page("h", 1, "אינטגרל מסוים וסכומי רימן של פונקציה רציפה"),
  page("h", 2, "נגזרת חלקית וגרדיאנט של פונקציה בשני משתנים"),
  page("h", 3, "כופלי לגרנז' לאופטימיזציה עם אילוץ"),
  page("h", 4, "פירוק לשברים חלקיים של פונקציה רציונלית"),
];

test("languageOf counts words: a Hebrew question with two English terms is still Hebrew", () => {
  assert.strictEqual(languageOf("מה ההבדל בין calloc ל malloc"), "he");
  assert.strictEqual(languageOf("what is a Riemann sum?"), "en");
  assert.strictEqual(languageOf("$x^2$ 123"), null);
});

test("needsTranslation: only when the question's language is not the notes' language", () => {
  assert.strictEqual(needsTranslation("מה זה מצביע למצביע", SLIDES), true); // Hebrew question, English notes
  assert.strictEqual(needsTranslation("what is a pointer", SLIDES), false); // same language: no model call, no delay
  assert.strictEqual(needsTranslation("what is a gradient", HEBREW_NOTES), true); // English question, Hebrew notes
  assert.strictEqual(needsTranslation("מה זה גרדיאנט", HEBREW_NOTES), false);
  assert.strictEqual(needsTranslation("12345", SLIDES), false); // no words to translate
  assert.strictEqual(needsTranslation("מה זה", [page("x", 1, "ab")]), false); // too little text to tell
});

test("LaTeX between $ signs does not make Hebrew notes look English", () => {
  const notes = [page("h", 1, "פתרון: $\\int_0^1 \\frac{x^2}{\\sqrt{1+x}} dx = \\sin(\\theta)$ ולכן האינטגרל מתכנס כי הפונקציה חסומה על הקטע הסגור וכל הנגזרות רציפות בכל נקודה")];
  assert.strictEqual(needsTranslation("מה זה אינטגרל", notes), false);
});

test("cleanWords keeps only search words: no commands, links or symbols, capped in size", () => {
  assert.strictEqual(cleanWords("pointer to pointer, מצביע למצביע; double pointer"), "pointer to pointer מצביע למצביע double pointer");
  assert.strictEqual(cleanWords("rm -rf /; http://evil.example/x?a=b, $(whoami)"), "rm -rf http evil example x a b whoami"); // symbols removed, what is left is still only words
  assert.strictEqual(cleanWords(["a1", "b"]), "a1"); // a 1-letter term is dropped
  assert.strictEqual(cleanWords(null), "");
  const many = cleanWords(Array.from({ length: 50 }, (_, i) => "term" + i).join(", "));
  assert.strictEqual(many.split(" ").length, 14);
  assert.ok(cleanWords("x".repeat(500) + "y").length <= 40);
});

test("expandQuery: good reply, bad reply, failure and timeout all end as a plain result, never a throw", async () => {
  let seen;
  const good = await expandQuery({ text: "מה זה מצביע למצביע", model: "m", askStructured: async (prompt, model, schema, opts) => { seen = { prompt, model, opts }; return { words: "pointer to pointer, double pointer" }; } });
  assert.strictEqual(good.words, "pointer to pointer double pointer");
  assert.strictEqual(seen.model, "m");
  assert.strictEqual(seen.opts.timeoutMs, EXPAND_TIMEOUT_MS);
  assert.ok(EXPAND_TIMEOUT_MS <= 10000, "a short time limit");
  assert.match(seen.prompt, /מה זה מצביע למצביע/);
  const empty = await expandQuery({ text: "q", model: "m", askStructured: async () => ({ words: "" }) });
  assert.strictEqual(empty.words, "");
  const junk = await expandQuery({ text: "q", model: "m", askStructured: async () => "not an object" });
  assert.strictEqual(junk.words, "");
  const failed = await expandQuery({ text: "q", model: "m", askStructured: async () => { throw new Error("agy crashed"); } });
  assert.deepStrictEqual([failed.words, /agy crashed/.test(failed.why)], ["", true]);
  const slow = await expandQuery({ text: "q", model: "m", askStructured: async (p, m, s, { timeoutMs }) => { throw new Error(`${m} timed out after ${timeoutMs} ms`); } });
  assert.strictEqual(slow.words, "");
  assert.match(slow.why, /timed out/);
});

test("promptFor marks the message as data to translate, not instructions", () => {
  assert.match(promptFor("hi"), /only data to translate/);
});

test("choosePages: translated words find the English page; without them the Hebrew question finds nothing", () => {
  const q = "מה זה מצביע למצביע";
  assert.strictEqual(choosePages(SLIDES, q).picked.length, 0);
  const r = choosePages(SLIDES, q, [], "pointer to pointer double pointer");
  assert.strictEqual(r.picked[0].page, 1);
  assert.strictEqual(r.why, "search + translated words");
});

test("choosePages: a named lecture and the whole course ignore the translated words", () => {
  const lectures = [page("f", 1, "הרצאה 1\nמבוא"), page("f", 2, "הרצאה 2\nנגזרות"), page("f", 3, "הרצאה 3\nאינטגרלים pointer")];
  const byLecture = choosePages(lectures, "הרצאה 2", [], "pointer");
  assert.deepStrictEqual(byLecture.picked.map((p) => p.page), [2, 3]);
  assert.match(byLecture.why, /^lecture 2/);
  assert.strictEqual(choosePages(lectures, "כל החומר", [], "pointer").why, "the whole course");
  // a follow-up that names no lecture keeps the lecture from the history, also with translated words
  assert.match(choosePages(lectures, "עוד שאלה", [{ role: "user", text: "הרצאה 1" }], "pointer").why, /^lecture 1/);
});

// ---- askCourse ----
const course = (files) => ({ name: "C", files: files.map((name) => ({ name, status: "ready", pages: 4 })) });
const answerer = (log) => async (chain, prompt) => { log.push(prompt); return { answer: "Pointer to a pointer [S1]", used: { model: "m" } }; };

test("askCourse: a Hebrew question about English slides sends the right page when the expander works", async () => {
  const prompts = [];
  const calls = [];
  const r = await askCourse({
    course: course(["s.pptx"]), pages: SLIDES, question: "מה זה מצביע למצביע?", askChain: answerer(prompts),
    expand: async (text) => { calls.push(text); return { words: "pointer to pointer double pointer", seconds: 3.1 }; },
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r.sources[0].page, 1);
  assert.match(prompts[0], /ptr_to_ptr/);
  assert.match(prompts[0], /מה זה מצביע למצביע\?/); // the user's own question is in the prompt...
  assert.doesNotMatch(prompts[0], /double pointer/); // ...and the model's search words are not
});

test("askCourse: if the expander finds nothing, fails, or is slow, the answer is the same as today's search", async () => {
  for (const result of [{ words: "", seconds: 6, why: "timed out" }, { words: "", seconds: 0.1, why: "agy crashed" }]) {
    const prompts = [];
    const logs = [];
    const r = await askCourse({ course: course(["s.pptx"]), pages: SLIDES, question: "מה זה מצביע למצביע?", askChain: answerer(prompts), expand: async () => result, log: (l) => logs.push(l) });
    assert.match(prompts[0], /No page of this course matched/); // exactly what happens without any expander
    assert.deepStrictEqual(r.sources, []);
    assert.ok(logs.some((l) => /plain search/.test(l)));
  }
});

test("askCourse: the expander is not called for the same language, a named lecture, or the whole course", async () => {
  let called = 0;
  const expand = async () => { called++; return { words: "x", seconds: 0 }; };
  const run = (pages, question) => askCourse({ course: course(["s.pptx"]), pages, question, askChain: answerer([]), expand });
  await run(SLIDES, "what is a pointer");
  await run(HEBREW_NOTES, "מה זה גרדיאנט");
  const lectures = [page("f", 1, "הרצאה 1 pointer"), page("f", 2, "הרצאה 2 pointer")];
  await run(lectures, "explain lecture 2 please");
  await run(lectures, "explain all the material please");
  assert.strictEqual(called, 0);
});

test("askCourse: the translated words never reach a web search", async () => {
  const prompts = [];
  let step = 0;
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    step++;
    return step === 1 ? { answer: "NEED_WEB: מצביע למצביע ב c", used: { model: "m" } } : { answer: "ok", used: { model: "m" } };
  };
  await askCourse({ course: course(["s.pptx"]), pages: SLIDES, question: "מה זה מצביע למצביע?", askChain, expand: async () => ({ words: "pointer to pointer double pointer", seconds: 1 }) });
  // prompts: [course answer, web check (if the query passed safeWebQuery), final answer]. No prompt after the first holds the model's words.
  assert.ok(prompts.length >= 2);
  for (const p of prompts) assert.doesNotMatch(p, /double pointer/);
});

test("askCourse without an expander behaves as before", async () => {
  const prompts = [];
  await askCourse({ course: course(["s.pptx"]), pages: SLIDES, question: "מה זה מצביע למצביע?", askChain: answerer(prompts) });
  assert.match(prompts[0], /No page of this course matched/);
});
