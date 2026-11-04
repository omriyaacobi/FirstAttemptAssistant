// experiments/argon-ab.js
// Runs ~6 genuinely hard tasks on Gemini 4 Argon low and medium, one after the other, and saves
// the answers and times. Usage: node experiments/argon-ab.js <out.json>
// Not part of Bot itself. Runs in an empty folder, like Bot's model calls.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const AGY = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const DIR = path.join(os.tmpdir(), "bot-empty");
fs.mkdirSync(DIR, { recursive: true });

const TASKS = [
  ["proof", "Prove that for every integer n >= 1, the sum of the first n odd cubes 1^3 + 3^3 + ... + (2n-1)^3 equals n^2 (2n^2 - 1). Give a complete, rigorous proof."],
  ["logic", "Five people (Ann, Ben, Cy, Dana, Eli) sit in a row of five seats. Ann is not at either end. Ben sits somewhere to the left of Cy, but not adjacent. Dana sits next to Eli. Cy is not next to Ann. Find ALL valid seatings and show how you know there are no others."],
  ["algorithm", "You are given an array of n positive integers and a target T. Design an algorithm that finds the number of contiguous subarrays whose sum is exactly T, in O(n) time, and explain why a two-pointer approach is enough here. Then explain what changes (and the new complexity) if the array may contain negative numbers and zeros."],
  ["debug", "This JavaScript is meant to return the number of distinct paths in an m x n grid moving only right/down, but it returns wrong values for m=3, n=7 (should be 28). Find ALL the bugs and give the corrected code.\n\nfunction paths(m, n) {\n  const dp = Array(m).fill(Array(n).fill(0));\n  for (let i = 0; i < m; i++) dp[i][0] = 1;\n  for (let j = 0; j < n; j++) dp[0][j] = 1;\n  for (let i = 1; i < m; i++)\n    for (let j = 1; j < n; j++)\n      dp[i][j] = dp[i-1][j] + dp[i][j-1];\n  return dp[m][n];\n}"],
  ["reasoning", "A bat and a ball problem variant: A shop sells pens and notebooks. 3 pens and 2 notebooks cost 19 shekels. 2 pens and 3 notebooks cost 21 shekels. A student has 40 shekels and wants to buy as many items as possible, but must buy at least 2 of each. What is the maximum number of items, what exactly should they buy, and how much change is left? Show the reasoning."],
  ["hebrew", "הסבר מדוע אלגוריתם דייקסטרה אינו עובד נכון על גרפים עם קשתות בעלות משקל שלילי. תן דוגמה קטנה קונקרטית (עם צמתים ומשקלים) שבה הוא נכשל, ועקוב אחרי ריצת האלגוריתם צעד אחר צעד."],
];
const MODELS = ["gemini-4-argon-low", "gemini-4-argon-medium"];

function run(model, question) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(AGY, ["-p", question, "--model", model], { cwd: DIR, maxBuffer: 1e7, timeout: 600000 }, (error, stdout, stderr) => {
      resolve({ seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), answer: String(stdout).trim(), error: error ? String(stderr || error.message).slice(0, 200) : null });
    });
  });
}

(async () => {
  const out = process.argv[2];
  const results = [];
  for (const [label, question] of TASKS) {
    const row = { label, question };
    const order = results.length % 2 ? [...MODELS].reverse() : MODELS;
    for (const model of order) row[model] = await run(model, question);
    results.push(row);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.error(label, MODELS.map((m) => `${row[m].seconds}s${row[m].error ? " ERR" : ""} ${row[m].answer.length}ch`).join("  |  "));
  }
})();
