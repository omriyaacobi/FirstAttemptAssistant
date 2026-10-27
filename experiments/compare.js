// Throwaway experiment: same prompts through three routes, record answers, time, tokens, usage.
const { exec, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const AGY = "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const CLAUDE = '"C:\\Users\\User\\npm-global\\claude.cmd"';
const OUT = path.join(__dirname, "compare-results.json");
const WORKDIR = path.join(__dirname, "empty");
fs.mkdirSync(WORKDIR, { recursive: true });

const PROMPTS = [
  { id: "logic", text: "Three boxes are labeled Apples, Oranges, and Mixed, but every label is wrong. You may take one fruit out of one box without looking inside. Which box do you pick from, and how does that one fruit let you fix all three labels? Answer in under 80 words." },
  { id: "bug", text: "Find the bug(s) in this JavaScript function and give the fixed version. Keep your whole answer under 100 words.\n\nfunction average(nums) {\n  let sum = 0;\n  for (let i = 0; i <= nums.length; i++) {\n    sum += nums[i];\n  }\n  return sum / nums.length;\n}" },
  { id: "explain", text: "Explain what an API is to a computer science student who knows front-end web basics but has never done back-end work. Use exactly 3 sentences." },
];

const ROUTES = [
  { id: "agy-gemini-argon", kind: "agy", model: "gemini-4-argon-medium" },
  { id: "agy-claude-sonnet", kind: "agy", model: "claude-sonnet-5-5-medium" },
  { id: "cli-claude-sonnet", kind: "claude", model: "sonnet" },
];

const run = (cmd, args, input) =>
  new Promise((resolve) => {
    const started = Date.now();
    const done = (error, stdout, stderr) =>
      resolve({ ms: Date.now() - started, error: error ? String(stderr || error.message) : null, stdout: String(stdout), stderr: String(stderr) });
    const child = args ? execFile(cmd, args, { cwd: WORKDIR, maxBuffer: 1e7 }, done) : exec(cmd, { cwd: WORKDIR, maxBuffer: 1e7 }, done);
    if (input !== undefined) child.stdin.end(input);
  });

const usage = async () => (await run(AGY, ["-p", "/usage"])).stdout.trim();

(async () => {
  const results = { snapshots: {}, runs: [] };
  results.snapshots.before = await usage();
  for (const route of ROUTES) {
    for (const p of PROMPTS) {
      let r;
      if (route.kind === "agy") r = await run(AGY, ["-p", p.text, "--model", route.model, "--output-format", "json"]);
      else r = await run(`${CLAUDE} -p --model ${route.model} --output-format json`, null, p.text);
      results.runs.push({ route: route.id, prompt: p.id, ...r });
      console.error(`done ${route.id} / ${p.id} (${(r.ms / 1000).toFixed(1)}s)`);
    }
    results.snapshots["after_" + route.id] = await usage();
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.error("saved", OUT);
})();
