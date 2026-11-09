// study-chat-live.js: a LIVE check of the study chat against a COPY of Bot (never port 3000). Made-up course, spec and notes.
//   1. in the worktree:  BOT_THREAD=on PORT=3100 node server.js     (empty data/, no .env, so nothing real is touched)
//   2. then:             node experiments/study-chat-live.js
// It creates a course, uploads a made-up assignment and notes (text files), sends a few messages like the page does (POST /api/ask), polls
// the job (the partial text shows the first words), and prints seconds to the first words and in total, the label, the model and the answer.
const PORT = Number(process.env.PORT) || 3100;
if (PORT === 3000) throw new Error("never port 3000: that is the real Bot");
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (path, opts = {}) => { const r = await fetch(base + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } }); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { raw: t, status: r.status }; } };

const SPEC = [
  "Assignment 0: Library Manager", "",
  "1. Overview", "Build a small library manager in C++. A Library holds Books. Each Book has a title, an author and a number of copies.", "",
  "2. Classes", "2.1 Write class Book (title, author, copies). 2.2 Write class Library with addBook, removeBook, find and a destructor that frees every Book.", "",
  "3. Build", "3.1 Put each class in a .h and a .cpp file. 3.2 Compile with g++ -std=c++17. 3.3 Provide a Makefile that uses the flags -Wall -Wextra and has the targets lib and clean.", "",
  "4. Rules", "Use of AI to write code is not allowed; explanations of concepts are allowed. Part of the grade is an oral exam on your own code and on memory management.", "",
  "5. Submission", "Submit a zip with the sources and the Makefile.", "",
].join("\n");
const NOTES = [
  "Make", "A Makefile is a text file of rules. A rule has a target, prerequisites and a recipe. Each recipe line starts with a Tab character. make rebuilds a target only when a prerequisite is newer than it.", "",
  "Memory", "Memory from new must be released with delete. If a pointer goes out of scope without delete, the memory leaks. A destructor runs when an object dies and is the place to delete owned memory.", "",
  "Compiling and linking", "The compiler turns each .cpp file into an object file. The linker joins object files into a program. An undefined reference error comes from the linker: a function was declared but its definition was not linked.", "",
].join("\n");

async function upload(courseId, name, text) {
  const r = await fetch(`${base}/api/courses/${courseId}/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(text, "utf8") });
  return r.json();
}

async function ask(task) {
  const t0 = Date.now();
  const { job } = await json("/api/ask", { method: "POST", body: JSON.stringify({ task }) });
  let first = null, last = null;
  for (;;) {
    await sleep(250);
    const j = await json(`/api/jobs/${job.id || job}`);
    const jj = j.job || j;
    if (jj.partial && first === null) first = (Date.now() - t0) / 1000;
    if (jj.status && jj.status !== "running" && jj.status !== "queued") { last = jj; break; }
    if (Date.now() - t0 > 240000) throw new Error("timeout");
  }
  return { first, total: (Date.now() - t0) / 1000, job: last };
}

(async () => {
  const course = await json("/api/courses", { method: "POST", body: JSON.stringify({ name: "Intro C++ Demo" }) });
  const id = (course.course || course).id;
  console.log("course", id);
  await upload(id, "Assignment_0_Demo.txt", SPEC);
  await upload(id, "notes.txt", NOTES);
  for (let i = 0; i < 60; i++) { const c = await json(`/api/courses/${id}`); const files = (c.course || c).files || []; if (files.length === 2 && files.every((f) => f.status === "ready")) break; await sleep(1000); }
  const messages = process.argv.slice(2).length ? process.argv.slice(2) : [
    "In Intro C++ Demo: explain how the Makefile in section 3.3 works, I never used C++",
    "why does my loop print 5 books when I added 6?\n```cpp\nfor (int i = 0; i < count - 1; i++) {\n  std::cout << books[i]->title << \"\\n\";\n}\n```",
    "ok and what is the difference between delete and a destructor?",
    "what should I study today?",
  ];
  for (const m of messages) {
    try {
      const r = await ask(m);
      const res = (r.job.result || {});
      console.log(`\n>>> ${m.slice(0, 80).replace(/\n/g, " ")}\n    first words ${r.first && r.first.toFixed(1)} s, total ${r.total.toFixed(1)} s | model ${res.model || (res.used && res.used.model)} | label ${(res.chat && res.chat.label) || "-"} | mode ${res.mode} | card ${res.proposal ? "YES" : "no"} | ${String(res.answer || r.job.error || "").length} chars`);
        console.log(String(res.answer || r.job.error || "").slice(0, 900));
    } catch (error) { console.log("FAILED", m.slice(0, 50), error.message); }
  }
})();
