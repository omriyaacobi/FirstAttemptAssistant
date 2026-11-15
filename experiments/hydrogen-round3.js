// Round 3 of the Hydrogen contest (2026-11-15). Omri doubted the first contest: Hydrogen is "Everyday help" in the Gemini app,
// two levels below Argon, so how can it win? This run is FAIRER and HARDER:
//   - Argon MEDIUM joins (it thinks, like Hydrogen medium); Argon low did not think at all.
//   - HARD tests with known answers (traps, a clever substitution, a proof, a subtle linear-algebra case, C++ UB and slicing,
//     a Java wait/notify deadlock, an exact algorithm bound), so the models do not all hit the ceiling.
//   - The REAL tutor prompts (tutor.js gradeAnswer / makeHint) and the REAL reader prompt (ingest.js chunkPrompt on a made-up PDF).
//   - REPEATS: Hydrogen runs each test 3 times; Argon (scarce week) once per level.
//   - Brain tests run the brain's tool rounds like brain.js does (up to 3 rounds; lookups get made-up results).
//   - Answers are written BLIND (hydrogen-round3-blind.md: random letters per test); the key is in a separate file.
// Everything is invented (no data/, no real chat; the repo is public).
// Run: node experiments/hydrogen-round3.js hydrogen   (Hydrogen medium + high)
//      node experiments/hydrogen-round3.js argon      (Argon low + medium)
//      node experiments/hydrogen-round3.js blind      (no model calls: writes the blind file and the key)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ask, askAgyStreamWithImage, askAgyWithFile } = require("../providers");
const { parseReply, leaksPrompt, withoutCalls } = require("../brain");
const { gradeAnswer, makeHint } = require("../tutor");
const { chunkPrompt, parseTranscript } = require("../ingest");
const { TESTS: OLD_TESTS, finalValue, brainPrompt, photoSection, usage } = require("./hydrogen-contest");

const DIR = __dirname;
const outFile = (group) => path.join(DIR, `hydrogen-round3-results-${group}.json`);

// ---- the brain, with its tool rounds (like brain.js: at most MAX_TOOL_ROUNDS = 3 more rounds) ----
const LOOKUPS = new Set(["course_search", "course_read", "course_files", "calendar_read", "reminders_list", "study_status", "search_memory", "read_link", "project_files", "project_read", "project_grep", "pc_find", "pc_list", "moodle_courses", "moodle_course", "moodle_news"]);
function fakeResult(call) { // made-up results: the course files hold nothing about these questions, except the geometric-series page
  if (call.tool === "course_search" && /geometric|הנדסי/i.test(String(call.query))) return "Calculus 2 / lecture3.pdf, page 4: \"A geometric series sum a*q^n (n from 0) converges if and only if |q| < 1, and then its sum is a/(1-q).\"";
  if (call.tool === "course_search") return `No pages of ${call.course || "the course"} match this query.`;
  if (call.tool === "study_status") return `${call.course || "the course"}: attending, last lecture covered: 6 of 13.`;
  if (call.tool === "calendar_read") return "No events in that range.";
  if (call.tool === "course_files") return "lecture1.pdf ... lecture6.pdf, assignment3.pdf";
  return "No result.";
}
async function brainRun(model, test) {
  const base = test.photo ? brainPrompt(test.message, photoSection("photo.png")) : brainPrompt(test.message);
  const transcript = [];
  const rounds = [];
  let text = "";
  for (let round = 0; round <= 3; round++) {
    const last = round === 3;
    const prompt = [base, ...transcript, last ? "You have used all your tool rounds. Write the final reply to Omri now, from what you have. No CALL lines." : transcript.length ? "Continue: either more CALL lines (only if really needed), or the final reply to Omri." : ""].filter(Boolean).join("\n\n");
    let spent = null;
    const t0 = Date.now();
    text = test.photo
      ? await askAgyStreamWithImage(model, prompt, path.join(DIR, test.photo), () => {}, { onUsage: (u) => { spent = u; } })
      : await ask("agy", model, prompt, () => {}, { agent: true, onUsage: (u) => { spent = u; }, timeoutMs: 300000 });
    rounds.push({ seconds: +((Date.now() - t0) / 1000).toFixed(1), usage: spent });
    const calls = parseReply(text).calls;
    if (!calls.length || !calls.every((c) => LOOKUPS.has(c.tool))) break; // an answer, or doing-tools: this is the final reply
    transcript.push(`## Tool round ${round + 1}\n` + calls.map((c, i) => `You called: ${JSON.stringify(c).slice(0, 400)}\n<tool-result id="r${round}${i}">\n${fakeResult(c)}\n</tool-result id="r${round}${i}">`).join("\n\n"));
  }
  return { text, rounds };
}

// ---- the HARD tests ----
const ANS = "Give the final value on the last line as: Answer: <value>";
const fv = (t) => finalValue(t).toLowerCase();
const HARD = [
  { id: "m-alt-trap", topic: "math", message: `Does the series sum_{n=1}^inf (-1)^n * n/(n+1) converge or diverge? ${ANS} (converges or diverges)`, ok: (t) => /diverg/.test(fv(t)) && !/converg/.test(fv(t)), key: "diverges (terms do not tend to 0; the alternating series test does not apply)" },
  { id: "m-pseries-log", topic: "math", message: `For which real p does the series sum_{n=2}^inf 1/(n (ln n)^p) converge? ${ANS}`, ok: (t) => /p>1/.test(fv(t)) && !/p>=1|p≥1/.test(fv(t)), key: "p > 1 (integral test)" },
  { id: "m-symmetry", topic: "math", message: `Compute the integral of sin(x)/(sin(x)+cos(x)) from 0 to pi/2. ${ANS}`, ok: (t) => /^(π\/4|0\.785)/.test(fv(t).split("=").pop()), key: "pi/4 (substitute x -> pi/2 - x and add)" },
  { id: "m-hard-integral", topic: "math", message: `Compute the integral of ln(1+x)/(1+x^2) from 0 to 1. ${ANS}`, ok: (t) => { const v = fv(t).split("=").pop(); return (/π/.test(v) && /(ln|log)\(?2/.test(v) && /8/.test(v)) || /^0\.272/.test(v); }, key: "(pi/8) ln 2 ≈ 0.2722 (x = tan t, then t -> pi/4 - t)" },
  { id: "m-proof-root", topic: "math", message: "Show that the equation x^3 + x - 1 = 0 has exactly one real solution. Give a rigorous argument.", ok: null, key: "existence: IVT (f(0) = -1 < 0 < 1 = f(1), f continuous); uniqueness: f'(x) = 3x^2 + 1 > 0 so f is strictly increasing (or Rolle). Both parts needed." },
  { id: "m-la-param", topic: "math", message: "For which values of the real parameter a does the system x+y+z=1, x+2y+az=2, x+4y+a^2 z=4 have a unique solution, no solution, or infinitely many solutions?", ok: null, key: "det = (a-1)(a-2). Unique for a != 1, 2. For a = 1 AND for a = 2: infinitely many (the right side equals column 2, so (0,1,0) always solves it). NEVER no solution." },
  { id: "m-lhopital-trap", topic: "math", message: `Find the limit of (x^2 * sin(1/x)) / sin(x) as x -> 0. ${ANS}`, ok: (t) => /^0$/.test(fv(t).split("=").pop()), key: "0 (write as (x/sin x) * x sin(1/x); L'Hopital fails because the derivative ratio has no limit)" },
  { id: "m-interval", topic: "math", message: `Find the exact interval of convergence (including endpoints) of sum_{n=1}^inf (x-2)^n / (n * 3^n). ${ANS}`, ok: (t) => /\[-1,5\)/.test(fv(t)), key: "[-1, 5): R = 3; x = -1 alternating harmonic converges, x = 5 harmonic diverges" },
  { id: "cpp-slicing", topic: "C++", message: "What exactly does this program print?\n```cpp\n#include <iostream>\n#include <string>\nstruct A { virtual std::string name() const { return \"A\"; } virtual ~A() = default; };\nstruct B : A { std::string name() const override { return \"B\"; } };\nvoid show(A a) { std::cout << a.name(); }\nint main() {\n    B b;\n    A& r = b;\n    show(b);\n    std::cout << r.name();\n    A arr[1] = { b };\n    std::cout << arr[0].name() << '\\n';\n}\n```\n" + ANS, ok: (t) => /(^|[^a-z])aba([^a-z]|$)/.test(fv(t)), key: "ABA (show() and the array copy slice B into an A; only the reference keeps B's vtable)" },
  { id: "cpp-ub", topic: "C++", message: "For each snippet: is it undefined behaviour? If not, what exactly is guaranteed?\n```cpp\n// 1\nconst std::string& f() { std::string s = \"hello\"; return s; }\nstd::cout << f();\n// 2\nstd::vector<int> v{1, 2, 3};\nint& r = v[0];\nv.push_back(4);\nstd::cout << r;\n// 3\nstd::string a = \"abc\";\nstd::string b = std::move(a);\nstd::cout << a.size();\n```", ok: null, key: "1: UB (dangling reference to a destroyed local). 2: UB if push_back reallocates (v{1,2,3} usually has capacity 3, so in practice UB; the standard says the reference is invalidated when size exceeds capacity). 3: NOT UB: a is in a valid but unspecified state, so a.size() is fine but its value is not guaranteed (usually 0)." },
  { id: "java-wait-deadlock", topic: "Java", message: "Two threads share Objects a and b.\n```java\n// t1\nsynchronized (a) { synchronized (b) { a.wait(); } }\n// t2\nsynchronized (b) { synchronized (a) { a.notify(); } }\n```\nt1 is started first and reaches a.wait(). Will t2 ever call a.notify()? Explain exactly what each thread holds.", ok: null, key: "No. a.wait() releases ONLY a's monitor; t1 keeps holding b. t2 blocks forever trying to enter synchronized(b), so it never reaches notify: t1 waits forever and t2 blocks forever (a deadlock)." },
  { id: "algo-minmax", topic: "algorithms", message: `What is the minimum number of comparisons needed in the worst case to find both the minimum and the maximum of 100 distinct numbers? ${ANS}`, ok: (t) => /^148$/.test(fv(t).split("=").pop()), key: "148 = ceil(3n/2) - 2 (compare in pairs)" },
];

// ---- the TUTOR (tutor.js, real prompts) ----
const TQ = { q: "Use the ratio test to decide whether the series sum_{n=1}^inf n^2 / 2^n converges.", key: "a_{n+1}/a_n = (n+1)^2 / (2 n^2), which tends to 1/2 < 1, so by the ratio test the series converges." };
const MATERIAL = { block: '<course-material id="m1">\n[S1] lecture6.pdf, page 3\nRatio test: if lim |a_{n+1}/a_n| = L exists, the series converges when L < 1 and diverges when L > 1; L = 1 says nothing.\n</course-material id="m1">' };
const TUTOR = [
  { id: "grade-wrong", kind: "grade", answer: "It diverges, because n^2 grows to infinity.", expect: "wrong" },
  { id: "grade-partly", kind: "grade", answer: "a_{n+1}/a_n = (n+1)^2/(2n^2), and this tends to 1/4, which is < 1, so it converges.", expect: "partly" },
  { id: "grade-right", kind: "grade", answer: "a_{n+1}/a_n = ((n+1)/n)^2 * 1/2 -> 1/2 < 1, so by the ratio test it converges.", expect: "right" },
  { id: "hint-1", kind: "hint", level: 1, answer: "" },
  { id: "hint-2", kind: "hint", level: 2, answer: "I don't know where to start." },
  { id: "hint-3", kind: "hint", level: 3, answer: "I wrote a_{n+1} = (n+1)^2/2^(n+1) but I am stuck." },
];
// A hint "gives it away" when it states the limit (1/2) or the conclusion (converges).
const giveaway = (h) => /1\s*\/\s*2|\\frac\{1\}\{2\}|½|0\.5|converges(?!\s*or)/i.test(h);
async function tutorRun(model, t) {
  let spent = null, seconds = 0;
  const askChain = async (chain, prompt) => {
    const t0 = Date.now();
    const answer = await ask("agy", model, prompt, () => {}, { onUsage: (u) => { spent = u; }, timeoutMs: 240000 });
    seconds += (Date.now() - t0) / 1000;
    return { answer, used: { provider: "agy", model } };
  };
  if (t.kind === "grade") {
    const r = await gradeAnswer({ askChain, q: TQ, answer: t.answer, material: MATERIAL, lang: "en" });
    return { text: JSON.stringify(r), ok: r.verdict === t.expect, verdict: r.verdict, seconds: +seconds.toFixed(1), usage: spent };
  }
  const r = await makeHint({ askChain, q: TQ, level: t.level, answer: t.answer, material: MATERIAL, lang: "en" });
  return { text: r.hint, ok: !giveaway(r.hint), seconds: +seconds.toFixed(1), usage: spent };
}

// ---- the READER (ingest.js chunkPrompt on a made-up 3-page PDF) ----
const PDF_PAGES = [
  ["Calculus 2 - Lecture 7: Power series", "Definition 7.1: a power series is sum_{n=0}^inf a_n (x - c)^n.", "Theorem 7.2 (Cauchy-Hadamard): R = 1 / limsup |a_n|^(1/n).", "Example 7.3: sum x^n / 3^n has R = 3."],
  ["Example 7.4: sum_{n=1}^inf x^n / n converges for -1 <= x < 1.", "At x = -1 it is the alternating harmonic series, its sum is -ln 2.", "Remark: so the series sum_{n=1}^inf 1/2^n equals 3.", "Exercise 7.5: find R for sum n! x^n."],
  ["Taylor: e^x = sum_{n=0}^inf x^n / n!, valid for every real x.", "Remainder bound: |R_n(x)| <= M |x|^(n+1) / (n+1)!", "Table: n = 1, 2, 3 ; bound = 0.5, 0.1667, 0.0417", "Homework 7: questions 3, 8, 11, due 2026-11-22."],
];
function makePdf(file) { // a tiny valid PDF (Helvetica text lines), built by hand so no package is needed
  const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const objs = [];
  const n = PDF_PAGES.length;
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${PDF_PAGES.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  PDF_PAGES.forEach((lines, i) => {
    const stream = "BT /F1 13 Tf 50 760 Td 18 TL\n" + lines.map((l) => `(${esc(l)}) Tj T*`).join("\n") + "\nET";
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + n * 2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out);
}
const PDF = path.join(DIR, "hydrogen-notes.pdf");
// What must survive, per page (checked on the text with spaces, $ and backslashes removed).
const KEEP = [
  ["7.1", "7.2", "cauchy", "limsup", "7.3", "3^n", "r=3"],
  ["7.4", "-1", "<1", "ln2", "equals3", "7.5", "n!"],
  ["e^x", "(n+1)!", "0.5", "0.1667", "0.0417", "3,8,11", "2026-11-22"],
];
const squash = (s) => String(s).toLowerCase().replace(/[\s$\\{}]/g, "");
async function readerRun(model) {
  const t0 = Date.now();
  const out = await askAgyWithFile(model, chunkPrompt(1, 3, "material.pdf"), PDF, { timeoutMs: 6 * 60 * 1000 });
  const parsed = parseTranscript(out);
  const found = KEEP.map((keys, i) => { const p = parsed.pages.find((x) => x.page === i + 1); const s = p ? squash(p.text) : ""; return keys.filter((k) => s.includes(k)); });
  const score = found.reduce((a, f) => a + f.length, 0) / KEEP.flat().length;
  const keptError = !!parsed.pages.find((x) => x.page === 2 && /equals\s*\$?\s*3|=\s*3\b/.test(x.text)); // fixed after the run: "equals $3$" was missed at first
  return { text: out, seconds: +((Date.now() - t0) / 1000).toFixed(1), usage: null, total: parsed.total, pages: parsed.pages.length, score: +score.toFixed(2), missing: KEEP.map((keys, i) => keys.filter((k) => !found[i].includes(k))), keptError, ok: parsed.total === 3 && parsed.pages.length === 3 && score >= 0.9 && keptError };
}

// ---- the earlier tests where Hydrogen high failed, now with the brain's tool rounds ----
const RERUN = ["plan-week", "photo-moved", "he-geometric", "tool-reminder-he", "tool-timetable", "tool-search"].map((id) => OLD_TESTS.find((t) => t.id === id));

// ---- running ----
async function record(results, file, base, fn) {
  const t0 = Date.now();
  let r;
  try { r = await fn(); } catch (error) { r = { error: String(error.message).slice(0, 300), ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1) }; }
  const row = { ...base, ...r };
  results.runs.push(row);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  const tok = (row.rounds || [{ usage: row.usage }]).reduce((a, x) => a + (x.usage ? x.usage.input + x.usage.output + x.usage.thinking : 0), 0);
  console.error(`${base.model} / ${base.part} / ${base.test} #${base.rep}: ${row.rounds ? row.rounds.reduce((a, x) => a + x.seconds, 0).toFixed(1) : row.seconds}s, ${row.rounds ? row.rounds.length : 1} call(s), ${tok} tokens, ${row.ok === null ? "hand" : row.ok ? "OK" : "FAIL"}${row.error ? " ERROR " + row.error.slice(0, 100) : ""}`);
}
async function brainRecord(results, file, model, part, test, rep) {
  await record(results, file, { model, part, test: test.id, topic: test.topic, rep }, async () => {
    const { text, rounds } = await brainRun(model, test);
    const leak = leaksPrompt(text);
    let ok = null;
    if (test.ok) { try { ok = !!test.ok(text) && !leak; } catch (error) { ok = false; } }
    return { text, rounds, ok, leak, final: finalValue(text), calls: parseReply(text).calls };
  });
}

async function runGroup(group) {
  const file = outFile(group);
  const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { date: new Date().toISOString(), usage: {}, runs: [] };
  if (!fs.existsSync(PDF)) makePdf(PDF);
  const plan = group === "hydrogen"
    ? [{ model: "gemini-4-hydrogen-medium", reps: 3, tutor: 3, reader: 3, rerun: 3 }, { model: "gemini-4-hydrogen-high", reps: 3, tutor: 3, reader: 3, rerun: 3 }]
    : [{ model: "gemini-4-argon-low", reps: 1, tutor: 0, reader: 1, rerun: 0 }, { model: "gemini-4-argon-medium", reps: 1, tutor: 1, reader: 0, rerun: 0 }];
  for (const p of plan) {
    results.usage["before " + p.model] = usage();
    console.error("before", p.model + ":", results.usage["before " + p.model].join(" | "));
    for (let rep = 1; rep <= p.reps; rep++) for (const t of HARD) await brainRecord(results, file, p.model, "hard", t, rep); // repeats interleaved over time
    for (let rep = 1; rep <= p.tutor; rep++) for (const t of TUTOR) await record(results, file, { model: p.model, part: "tutor", test: t.id, topic: "tutor", rep }, () => tutorRun(p.model, t));
    for (let rep = 1; rep <= p.reader; rep++) await record(results, file, { model: p.model, part: "reader", test: "reader-pdf", topic: "reading", rep }, () => readerRun(p.model));
    for (let rep = 1; rep <= p.rerun; rep++) for (const t of RERUN) await brainRecord(results, file, p.model, "rerun", t, rep);
    results.usage["after " + p.model] = usage();
    console.error("after", p.model + ":", results.usage["after " + p.model].join(" | "));
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
  }
  console.error("saved", file, `(${results.runs.length} rows, ${results.runs.reduce((a, r) => a + (r.rounds ? r.rounds.length : 1), 0)} model calls)`);
}

// The blind file: for every hand-graded test (and the first run of every hard test), the answers with the model names replaced by
// letters that are shuffled again for each test. The key goes to a separate file, read only after grading.
function writeBlind() {
  const runs = ["hydrogen", "argon"].flatMap((g) => (fs.existsSync(outFile(g)) ? JSON.parse(fs.readFileSync(outFile(g), "utf8")).runs : []));
  const key = {};
  let md = "# Round 3 answers, BLIND\n\nModel names are replaced by letters, shuffled again for every test. Grade, then read hydrogen-round3-key.json.\n";
  for (const t of HARD) {
    const rows = runs.filter((r) => r.part === "hard" && r.test === t.id && (t.ok === null || r.rep === 1));
    const order = rows.map((r) => ({ r, k: crypto.randomBytes(4).readUInt32LE() })).sort((a, b) => a.k - b.k).map((x) => x.r);
    md += `\n\n## ${t.id}\nQuestion: ${t.message.split("\n")[0]}\nReference: ${t.key}\n`;
    order.forEach((r, i) => {
      const label = `${t.id}:${String.fromCharCode(65 + i)}`;
      key[label] = { model: r.model, rep: r.rep };
      md += `\n### ${label}\n${r.error ? "(ERROR) " + r.error : withoutCalls(r.text).slice(0, 1800)}\n`;
    });
  }
  for (const t of TUTOR.filter((x) => x.kind === "hint")) {
    const rows = runs.filter((r) => r.part === "tutor" && r.test === t.id && !r.error);
    const order = rows.map((r) => ({ r, k: crypto.randomBytes(4).readUInt32LE() })).sort((a, b) => a.k - b.k).map((x) => x.r);
    md += `\n\n## tutor ${t.id} (level ${t.level}; must not give the limit 1/2 or the conclusion)\nQuestion: ${TQ.q}\n`;
    order.forEach((r, i) => { const label = `${t.id}:${i + 1}`; key[label] = { model: r.model, rep: r.rep }; md += `- ${label}: ${r.text}\n`; });
  }
  fs.writeFileSync(path.join(DIR, "hydrogen-round3-blind.md"), md);
  fs.writeFileSync(path.join(DIR, "hydrogen-round3-key.json"), JSON.stringify(key, null, 2));
  console.error("blind file written:", Object.keys(key).length, "answers");
}

module.exports = { HARD, TUTOR, KEEP, makePdf, squash, giveaway, brainRun };
if (require.main === module) {
  const g = process.argv[2];
  if (g === "blind") writeBlind();
  else if (g === "hydrogen" || g === "argon") runGroup(g);
  else console.error("usage: node experiments/hydrogen-round3.js hydrogen | argon | blind");
}
