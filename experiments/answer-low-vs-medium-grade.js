// answer-low-vs-medium-grade.js
// Step 2 of the experiment: grading that does not know which model wrote an answer.
//   node experiments/answer-low-vs-medium-grade.js blind <runs.json> <blind.json>
//        -> writes a SHUFFLED file where every answer has a random code ("b17") and NO model name or timing.
//           A person (me) reads that file and writes grades.json: { "b17": { "f": 0|1, "i": 0|1, "l": 0|1, "note": "..." } }
//           f = factual error, i = incomplete answer, l = language mistake.
//   node experiments/answer-low-vs-medium-grade.js join <runs.json> <blind.json> <grades.json>
//        -> joins the grades back to the models and prints the counts (and the auto-check disagreements).
// The regex checks from answer-low-vs-medium.js are also run, as a second, mechanical opinion that cannot be biased.

const fs = require("node:fs");
const { Q } = require("./answer-low-vs-medium");

const hebrewShare = (text) => {
  const letters = (text.match(/[A-Za-z֐-׿]/g) || []).length;
  return letters ? (text.match(/[֐-׿]/g) || []).length / letters : 0;
};

function autoCheck(item, answer) {
  const flags = [];
  for (const f of item.facts || []) if (!f.test(answer)) flags.push("missing " + f);
  for (const b of item.bad || []) if (b.test(answer)) flags.push("bad " + b);
  const share = hebrewShare(answer);
  if (item.lang === "he" && share < 0.3) flags.push("not Hebrew");
  if (item.lang === "en" && share > 0.4 && !/Hebrew|עברית/.test(item.q)) flags.push("not English");
  return flags;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const [mode, runsFile, blindFile, gradesFile] = process.argv.slice(2);
const runs = JSON.parse(fs.readFileSync(runsFile, "utf8"));

if (mode === "blind") {
  const items = shuffle(runs.filter((r) => r.answer).map((r, i) => ({ r })));
  const blind = items.map(({ r }, i) => ({ code: "b" + (i + 1), run: `${r.id}|${r.model}|${r.rep}`, id: r.id }));
  fs.writeFileSync(blindFile, JSON.stringify(blind)); // the key (kept apart from what I read)
  // What I read: question, the facts to check, the answer. No model, no timing.
  const readable = blind.map((b) => {
    const item = Q.find((q) => q.id === b.id);
    const r = runs.find((x) => `${x.id}|${x.model}|${x.rep}` === b.run);
    return `### ${b.code}  (Q${item.id}, answer must be in ${item.lang === "he" ? "Hebrew" : "English"})\nQ: ${item.q}\nA: ${r.answer}\n`;
  });
  fs.writeFileSync(blindFile.replace(/\.json$/, "-read.txt"), readable.join("\n"));
  console.log(`${blind.length} answers shuffled`);
}

if (mode === "join") {
  const blind = JSON.parse(fs.readFileSync(blindFile, "utf8"));
  const grades = JSON.parse(fs.readFileSync(gradesFile, "utf8"));
  const stats = {};
  const worst = [];
  const disagree = [];
  for (const b of blind) {
    const r = runs.find((x) => `${x.id}|${x.model}|${x.rep}` === b.run);
    const g = grades[b.code] || { f: 0, i: 0, l: 0 };
    const s = (stats[r.model] ||= { n: 0, f: 0, i: 0, l: 0, anyBad: 0, seconds: [], autoFlagged: 0 });
    s.n++; s.f += g.f || 0; s.i += g.i || 0; s.l += g.l || 0; s.anyBad += (g.f || g.i || g.l) ? 1 : 0; s.seconds.push(r.seconds);
    const item = Q.find((q) => q.id === b.id);
    const flags = autoCheck(item, r.answer);
    if (flags.length) s.autoFlagged++;
    if (g.f || g.i || g.l) worst.push({ model: r.model, id: b.id, code: b.code, g, q: item.q, answer: r.answer });
    if (!!flags.length !== !!(g.f || g.i || g.l)) disagree.push({ code: b.code, model: r.model, id: b.id, flags, g });
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const [model, s] of Object.entries(stats)) {
    console.log(model, JSON.stringify({ n: s.n, factual: s.f, incomplete: s.i, language: s.l, answersWithAProblem: s.anyBad, autoFlagged: s.autoFlagged, medianSeconds: med(s.seconds), meanSeconds: Number((s.seconds.reduce((x, y) => x + y, 0) / s.n).toFixed(1)) }));
  }
  fs.writeFileSync(blindFile.replace(/\.json$/, "-joined.json"), JSON.stringify({ stats, worst, disagree }, null, 1));
  console.log(`problems listed: ${worst.length}; auto-check vs my grade disagree on ${disagree.length}`);
}
