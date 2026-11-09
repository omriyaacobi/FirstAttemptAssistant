// study-chat-timing.js: measures the study chat's real prompt on Argon LOW and Argon MEDIUM (seconds to the first words, seconds in total,
// characters). Made-up course and spec only. Spends a little Gemini (Argon) quota: 5 questions x 2 models x REPEAT.
//   node experiments/study-chat-timing.js            (all)
//   node experiments/study-chat-timing.js low        (one model)
// Output: one line per call, then a table. Results go into experiments/2026-11-09-study-chat-results.md by hand.
const { buildContext } = require("../study-chat");
const { ask } = require("../providers");
const { MODELS } = require("../router");

const SPEC = [
  "# Assignment 0: Library Manager",
  "## 1 Overview\nBuild a small library manager in C++. A Library holds Books. Each Book has a title, an author and a number of copies.",
  "## 2 Classes\n2.1 Write class Book (title, author, copies). 2.2 Write class Library with addBook, removeBook, find and a destructor that frees every Book.",
  "## 3 Build\n3.1 Put each class in a .h and a .cpp file. 3.2 Compile with g++ -std=c++17. 3.3 Provide a Makefile that uses the flags -Wall -Wextra and has the targets lib and clean.",
  "## 4 Rules\nUse of AI to write code is not allowed; explanations of concepts are allowed. Part of the grade is an oral exam on your own code and on memory management.",
  "## 5 Submission\nSubmit a zip with the sources and the Makefile.",
].join("\n\n");
const NOTES = [
  "# Make\nA Makefile is a text file of rules. A rule has a target, prerequisites and a recipe. Each recipe line starts with a Tab character. make rebuilds a target only when a prerequisite is newer than it.",
  "# Memory\nMemory from new must be released with delete. If a pointer goes out of scope without delete, the memory leaks. A destructor runs when an object dies and is the place to delete owned memory.",
  "# Compiling and linking\nThe compiler turns each .cpp file into an object file. The linker joins object files into a program. An 'undefined reference' error comes from the linker: a function was declared but its definition was not linked.",
];
const pages = [{ fileId: "fa", fileName: "Assignment_0_Demo.pdf", page: 1, text: SPEC }, ...NOTES.map((t, i) => ({ fileId: "fn", fileName: "notes.pdf", page: i + 1, text: t }))];

const QUESTIONS = [
  "I never used C++. How does a Makefile work, and what does section 3.3 need?",
  "I get: undefined reference to `Library::find(std::string const&)` when I build. What does that mean?\n```\nmain.o: in function `main':\nmain.cpp:12: undefined reference to `Library::find(std::string const&)'\n```",
  "Why does this loop print 5 books when I added 6?\n```cpp\nfor (int i = 0; i < count - 1; i++) {\n  std::cout << books[i]->title << \"\\n\";\n}\n```",
  "What is the difference between delete and a destructor? I do not understand when each one runs.",
  "I do not understand what the oral exam on memory management will ask. What should I be able to explain?",
];

async function one(model, question) {
  const { prompt } = buildContext({ text: question, pages, level: "coach", lang: "en", firstOfSession: true });
  const t0 = Date.now();
  let first = null;
  const answer = await ask("agy", model, prompt, (t) => { if (first === null && t) first = (Date.now() - t0) / 1000; });
  const total = (Date.now() - t0) / 1000;
  return { chars: prompt.length, first, total, length: String(answer).length, answer: String(answer) };
}

(async () => {
  const which = process.argv[2];
  const models = [MODELS.argonLow, MODELS.argonMedium].filter((m) => !which || m.model.includes(which));
  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    for (const m of models) {
      try {
        const r = await one(m.model, QUESTIONS[i]);
        rows.push({ q: i + 1, model: m.model, ...r });
        console.log(`Q${i + 1} ${m.model}: prompt ${r.chars} chars, first words ${r.first && r.first.toFixed(1)} s, total ${r.total.toFixed(1)} s, answer ${r.length} chars`);
        if (process.env.SHOW) console.log(r.answer + "\n");
      } catch (error) { console.log(`Q${i + 1} ${m.model}: FAILED ${error.message}`); }
    }
  }
  for (const m of models) {
    const mine = rows.filter((r) => r.model === m.model);
    if (!mine.length) continue;
    const avg = (k) => (mine.reduce((a, r) => a + (r[k] || 0), 0) / mine.length).toFixed(1);
    console.log(`AVERAGE ${m.model}: first words ${avg("first")} s, total ${avg("total")} s, answer ${avg("length")} chars (${mine.length} runs)`);
  }
  require("node:fs").writeFileSync(require("node:path").join(process.env.TEMP || ".", "study-chat-timing.json"), JSON.stringify(rows, null, 1));
})();
