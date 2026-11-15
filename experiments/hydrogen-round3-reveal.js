// Joins the blind grades (hydrogen-round3-grades.json, written first) with the key (hydrogen-round3-key.json) and prints the totals.
// No model calls. Run: node experiments/hydrogen-round3-reveal.js
const key = require("./hydrogen-round3-key.json");
const grades = require("./hydrogen-round3-grades.json");
const by = {};
for (const [label, g] of Object.entries(grades)) {
  if (label.startsWith("_")) continue;
  const k = key[label];
  if (!k) { console.log("no key for", label); continue; }
  const m = (by[k.model] = by[k.model] || { n: 0, q: 0, hard: 0, hardQ: 0, correct: 0, graded: 0, hints: 0, hintQ: 0, lines: [] });
  m.n++; m.q += g.q;
  if (label.startsWith("hint")) { m.hints++; m.hintQ += g.q; } else { m.hard++; m.hardQ += g.q; if (g.correct !== undefined) { m.graded++; if (g.correct === true) m.correct++; } }
  if (g.why) m.lines.push(`${label} (${g.q}): ${g.why}`);
}
for (const [model, m] of Object.entries(by)) {
  console.log(`${model}: hard answers ${m.hard}, quality ${(m.hardQ / m.hard).toFixed(2)}, correct ${m.correct}/${m.graded}` + (m.hints ? `; hints ${m.hints}, quality ${(m.hintQ / m.hints).toFixed(2)}` : ""));
  for (const l of m.lines) console.log("   " + l);
}
