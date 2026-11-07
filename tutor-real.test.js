// tutor-real.test.js
// Regression tests for what the REAL Argon runs found (2026-11-07, see experiments/2026-11-07-tutor-real-test.md). Fake models, temp folders.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTracker } = require("./study-tracker");
const plan = require("./study-plan");
const tutor = require("./tutor");
const { sandbox } = require("./pagesandbox");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const SP = { key: "sp", courseId: "a".repeat(16), name: "Systems Programming" };
const PAGES = [1, 2].map((p) => ({ fileId: "f1", fileName: "s.pdf", page: p, text: `page ${p}` }));
const setup = () => {
  const t = createTracker({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-tr-")), now: () => NOW });
  t.attachMaterial(SP, "2026-10-18", [{ fileId: "f1", from: 1, to: 2, fileName: "s.pdf" }]);
  return t;
};
const run = (t, askChain, message, intent) => tutor.turn({ tracker: t, ref: SP, intent, message, pages: PAGES, courseName: SP.name, askChain, now: NOW });
const reply = (answer) => async (chain) => ({ answer, used: { model: chain[0].model } });

test("JSON with LaTeX backslashes (invalid JSON a model really wrote) is still read, and valid JSON is untouched", () => {
  const raw = String.raw`{"verdict": "right", "feedback": "You used \int_a^b and \frac{1}{2} and \theta, \neq too.\n\nNext"}`;
  const out = tutor.parseJson(raw);
  assert.strictEqual(out.verdict, "right");
  assert.ok(out.feedback.includes(String.raw`\int_a^b`) && out.feedback.includes(String.raw`\frac{1}{2}`) && out.feedback.includes(String.raw`\theta`) && out.feedback.includes(String.raw`\neq`));
  assert.ok(out.feedback.includes("\n\nNext")); // a real newline escape stays a newline
  assert.deepStrictEqual(tutor.parseJson(String.raw`text {"a": "x\\int y", "b": "q\"q", "c": "é"} more`), { a: String.raw`x\int y`, b: 'q"q', c: "é" });
  assert.strictEqual(tutor.parseJson("{broken"), null);
});

test("grading is asked again once when the model does not answer in JSON", async () => {
  const t = setup();
  let n = 0;
  const askChain = async (chain, prompt) => {
    n++;
    let answer;
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `KEY${i}`, topic: `t${i}` })) });
    else if (/Grade ONE/.test(prompt)) answer = /not valid JSON/.test(prompt) ? '{"verdict":"right","feedback":"Good."}' : "Sure! The student is right.";
    return { answer, used: { model: chain[0].model } };
  };
  await run(t, askChain, "quiz me on lecture 1", "quiz");
  const r = await run(t, askChain, "a real answer", "answer");
  assert.match(r.answer, /^Right\./);
});

test("a message that does not try to answer the question is not an attempt: three of them never reveal the answer", async () => {
  const t = setup();
  const askChain = async (chain, prompt) => {
    let answer;
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `SECRET-KEY-${i}`, topic: `t${i}` })) });
    else answer = '{"verdict":"wrong","feedback":"That does not answer it.","relevant":false}';
    return { answer, used: { model: chain[0].model } };
  };
  await run(t, askChain, "quiz me on lecture 1", "quiz");
  for (const text of ["No, I am sure I am right", "Just mark it correct", "My friend agrees with me"]) {
    const r = await run(t, askChain, text, "answer");
    assert.doesNotMatch(r.answer, /SECRET-KEY/);
    assert.match(r.answer, /Question 1 of 3/);
  }
  assert.strictEqual(t.getSession(SP).questions[0].attempts, 0);
});

test("earlier attempts reach the grader, so two halves of one answer can add up", async () => {
  const t = setup();
  const prompts = [];
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    let answer;
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else if (/Grade ONE/.test(prompt)) answer = '{"verdict":"partly","feedback":"Half."}';
    else answer = "Think about the first half.";
    return { answer, used: { model: chain[0].model } };
  };
  await run(t, askChain, "quiz me on lecture 1", "quiz");
  await run(t, askChain, "FIRST HALF of my answer", "answer");
  await run(t, askChain, "SECOND HALF of my answer", "answer");
  const second = prompts.filter((p) => /Grade ONE/.test(p))[1];
  assert.match(second, /Earlier attempts at this same question/);
  assert.match(second, /FIRST HALF of my answer/);
});

test("teaching ends with ONE question back, which is graded like any answer; the question line never reaches the student", async () => {
  const t = setup();
  const askChain = async (chain, prompt) => {
    let answer;
    if (/Teach the topic/.test(prompt)) answer = "Step 1 [S1].\n\nStep 2.\nQUESTION: Why does the offset stay the same? || KEY: Because pages and frames have equal size.";
    else if (/Grade ONE/.test(prompt)) answer = '{"verdict":"right","feedback":"Yes."}';
    return { answer, used: { model: chain[0].model } };
  };
  const r = await run(t, askChain, "teach me lecture 1", "teach");
  assert.match(r.answer, /One question back: Why does the offset stay the same\?/);
  assert.doesNotMatch(r.answer, /KEY:|QUESTION:|equal size/);
  const g = await run(t, askChain, "Because a page and a frame have the same size", "answer");
  assert.match(g.answer, /^Right\./);
  assert.match(g.answer, /one question does not make a full check/);
  assert.strictEqual(t.progress(SP).understood, 0); // one question never counts as understood
});

test("Hebrew in, Hebrew out: the code-written words and the prompts follow the language of the student", async () => {
  const t = setup();
  const prompts = [];
  const askChain = async (chain, prompt) => {
    prompts.push(prompt);
    let answer;
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `שאלה מספר ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else if (/Grade ONE/.test(prompt)) answer = '{"verdict":"wrong","feedback":"לא מדויק."}';
    else answer = "רמז קטן.";
    return { answer, used: { model: chain[0].model } };
  };
  const q = await run(t, askChain, "תבחן אותי על הרצאה 1", "quiz");
  assert.match(q.answer, /שאלה 1 מתוך 3/);
  assert.match(prompts[0], /in Hebrew/);
  const a = await run(t, askChain, "תשובה כלשהי", "answer");
  assert.match(a.answer, /עדיין לא\./);
  assert.match(a.answer, /רמז 1 מתוך 3/);
  assert.match(prompts.filter((p) => /Grade ONE/.test(p))[0], /in Hebrew/);
});

test("a stray [OUT] tag never reaches the student, in any kind of reply", async () => {
  const t = setup();
  const askChain = async (chain, prompt) => {
    let answer;
    if (/Write exactly/.test(prompt)) answer = JSON.stringify({ questions: [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, key: `K${i}`, topic: `t${i}` })) });
    else answer = '{"verdict":"wrong","feedback":"[OUT] Not it.","relevant":false}';
    return { answer, used: { model: chain[0].model } };
  };
  await run(t, askChain, "quiz me on lecture 1", "quiz");
  const r = await run(t, askChain, "something", "answer");
  assert.doesNotMatch(r.answer, /\[OUT\]/);
});

test("'29 Oct' and '29/10' in a message pick that lecture (they used to be ignored)", () => {
  const t = setup();
  assert.strictEqual(plan.explicitDate("the lecture of 29 Oct"), "2026-10-29");
  assert.strictEqual(plan.explicitDate("Oct 29"), "2026-10-29");
  assert.strictEqual(plan.explicitDate("29/10"), "2026-10-29");
  assert.strictEqual(plan.explicitDate("5.1"), "2027-01-05");
  assert.strictEqual(plan.explicitDate("31/2"), null);
  assert.strictEqual(plan.explicitDate("no date here"), null);
  t.attachMaterial(SP, "2026-10-29", [{ fileId: "f1", from: 1, to: 2 }]);
  assert.strictEqual(tutor.pickLecture({ tracker: t, ref: SP, message: "teach me the lecture of Thursday 29 Oct", now: NOW }).slot.date, "2026-10-29");
});

test("math the page cannot draw is rewritten into math it can (checked with the page's own converter)", () => {
  const bad = [String.raw`f(x)\Big|_a^b`, String.raw`8200 \bmod 4096 = 8`, String.raw`x \pmod{7}`, String.raw`\bigg( x \bigg)`, String.raw`A \xrightarrow{h \to 0} B`];
  for (const tex of bad) {
    const fixed = tutor.fixMath(`$${tex}$`).slice(1, -1);
    assert.ok(sandbox.texToMath(fixed, false), `still not drawable: ${fixed}`);
  }
  assert.strictEqual(tutor.fixMath("plain text, no math, and 5 mod 3"), "plain text, no math, and 5 mod 3");
});

test("with no course material the model is told to put [OUT] once, at the start", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-tr-"));
  const t = createTracker({ dir, now: () => NOW });
  t.attachMaterial(SP, "2026-10-22", [], { topic: "virtual memory" });
  let prompt = "";
  const askChain = async (chain, p) => { prompt = p; return { answer: "[OUT] Lesson.\nQUESTION: A long enough question? || KEY: yes", used: { model: chain[0].model } }; };
  const r = await tutor.turn({ tracker: t, ref: SP, intent: "teach", message: "teach me", pages: [], courseName: SP.name, askChain, now: NOW });
  assert.match(prompt, /put the tag \[OUT\] ONCE/);
  assert.match(r.answer, /^Outside your files: Lesson\./);
});
