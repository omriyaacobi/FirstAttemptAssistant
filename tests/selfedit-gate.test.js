// selfedit-gate.test.js
// The Improve Bot gate added on 2026-11-20 (experiments/2026-11-20-selfedit-full-access.md): the test run's time limit,
// the git fence and the checks BEFORE a test run. Real temporary git repositories and FAKE editors: no model is called.
// Run with:  node --test tests/selfedit-gate.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nodeTests, TEST_TIMEOUT_MS } = require("../selfedit");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// A folder with one test that takes about 1.5 seconds.
function slowProject() {
  const dir = tmp("bot-gate-slow-");
  fs.writeFileSync(path.join(dir, "slow.test.js"), 'const test = require("node:test");\ntest("slow", () => new Promise((r) => setTimeout(r, 1500)));\n');
  return dir;
}

test("the test run's limit is 15 minutes (the full suite takes up to about 6 on a busy PC)", () => {
  assert.strictEqual(TEST_TIMEOUT_MS, 15 * 60 * 1000);
});

test("a slow test run is not cut off with the normal limit", async () => {
  const dir = slowProject();
  const result = await nodeTests(dir);
  assert.strictEqual(result.ok, true, result.tail);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.total, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a run longer than its limit is stopped and says so", async () => {
  const dir = slowProject();
  const result = await nodeTests(dir, { timeoutMs: 300 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, true);
  assert.match(result.tail, /stopped after/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Phase 1: the git fence and the checks before any test run ----

const { execFileSync, spawnSync } = require("node:child_process");
const { createSelfEdit, preTestProblems } = require("../selfedit");
const { fencedEnv } = require("../selfedit-guard");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A tiny git project with two passing tests and a (fake) GitHub remote.
function makeRepo() {
  const root = tmp("bot-gate-repo-");
  const repoDir = path.join(root, "project");
  fs.mkdirSync(repoDir);
  fs.writeFileSync(path.join(repoDir, "greet.js"), 'module.exports = () => "hello";\n');
  fs.writeFileSync(path.join(repoDir, "greet.test.js"), 'const test = require("node:test");\nconst assert = require("node:assert");\nconst greet = require("./greet");\n' +
    'test("greets", () => assert.strictEqual(greet(), "hello"));\ntest("returns a string", () => assert.strictEqual(typeof greet(), "string"));\n');
  fs.writeFileSync(path.join(repoDir, ".gitignore"), "data/\n");
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "core.autocrlf", "false");
  git(repoDir, "remote", "add", "origin", "https://github.com/example-owner/example-repo.git");
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-q", "-m", "initial");
  return { root, repoDir, dataDir: path.join(repoDir, "data"), workRoot: path.join(root, "work") };
}

test("SECURITY: inside the fence a push to GitHub fails at once (https and ssh), and the repo's own settings are untouched", () => {
  const r = makeRepo();
  const before = fs.readFileSync(path.join(r.repoDir, ".git", "config"), "utf8");
  const https = spawnSync("git", ["push", "origin", "HEAD:refs/heads/fence-check"], { cwd: r.repoDir, env: fencedEnv(), encoding: "utf8", timeout: 30000 });
  assert.notStrictEqual(https.status, 0);
  assert.match(https.stderr, /no-such-folder/);
  git(r.repoDir, "remote", "set-url", "origin", "git@github.com:example-owner/example-repo.git");
  const ssh = spawnSync("git", ["push", "origin", "HEAD:refs/heads/fence-check"], { cwd: r.repoDir, env: fencedEnv(), encoding: "utf8", timeout: 30000 });
  assert.notStrictEqual(ssh.status, 0);
  assert.match(ssh.stderr, /no-such-folder/);
  git(r.repoDir, "remote", "set-url", "origin", "https://github.com/example-owner/example-repo.git");
  assert.strictEqual(fs.readFileSync(path.join(r.repoDir, ".git", "config"), "utf8"), before);
  assert.strictEqual(fencedEnv({ PATH: "x" }).PATH, "x"); // the rest of the environment is kept
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("SECURITY: the test run itself is fenced: a test that tries to push cannot reach GitHub", async () => {
  const r = makeRepo();
  // This test, run by nodeTests, tries a push from the project and passes only if the fence stopped it.
  fs.writeFileSync(path.join(r.repoDir, "push.test.js"), 'const test = require("node:test");\nconst assert = require("node:assert");\n' +
    'test("push is fenced", () => { const p = require("node:child_process").spawnSync("git", ["push", "origin", "HEAD:refs/heads/x"], { encoding: "utf8", timeout: 30000 });\n' +
    '  assert.notStrictEqual(p.status, 0); assert.match(p.stderr, /no-such-folder/); });\n');
  const result = await nodeTests(r.repoDir);
  assert.strictEqual(result.ok, true, result.tail);
  assert.strictEqual(result.total, 3);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("preTestProblems: .env mentions, permission flags and force-pushes are refused before any test run", () => {
  const diffOf = (file, line) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,2 @@\n x\n+${line}\n`;
  const files = [{ status: "M", path: "news.js" }];
  assert.match(preTestProblems({ files, diff: diffOf("news.js", 'const k = fs.readFileSync("../.env", "utf8");') }).join(" "), /\.env file/);
  assert.match(preTestProblems({ files, diff: diffOf("news.js", 'args.push("--dangerously-skip-permissions");') }).join(" "), /permission checks/);
  assert.match(preTestProblems({ files, diff: diffOf("news.js", 'git(["push", "--force"]);') }).join(" "), /overwrite history/);
  assert.match(preTestProblems({ files: [{ status: "M", path: "selfedit.js" }], diff: "" }).join(" "), /Protected files were changed: selfedit\.js/);
  assert.deepStrictEqual(preTestProblems({ files, diff: diffOf("news.js", "const n = 1;") }), []);
  assert.deepStrictEqual(preTestProblems({ files, diff: diffOf("news.js", "if (process.env.PORT) x();") }), []); // process.env is a note, not a block
  assert.deepStrictEqual(preTestProblems({ files: [{ status: "M", path: "README.md" }], diff: diffOf("README.md", "Keys live in .env") }), []); // notes may name it
});

test("SECURITY: a change whose new test mentions .env is never run, and it ends blocked", async () => {
  const r = makeRepo();
  const mark = path.join(r.root, "it-ran.txt");
  let runs = 0;
  const manager = createSelfEdit({
    repoDir: r.repoDir, dataDir: r.dataDir, workRoot: r.workRoot, lowPools: async () => [],
    runTests: (cwd) => { runs++; return nodeTests(cwd); },
    editor: async ({ worktree }) => {
      fs.writeFileSync(path.join(worktree, "leak.test.js"), `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(mark)}, "ran");\nconst keys = fs.existsSync("../../.env");\n`);
      return "added a test";
    },
  });
  const record = await (await manager.start("add a test")).finished;
  assert.strictEqual(record.status, "blocked");
  assert.ok(record.blocked.some((p) => /\.env file/.test(p)), record.blocked.join("; "));
  assert.ok(record.blocked.some((p) => /tests were not run/.test(p)), record.blocked.join("; "));
  assert.strictEqual(fs.existsSync(mark), false, "the planted test never ran");
  assert.strictEqual(runs, 1, "only the run BEFORE the edit happened");
  fs.rmSync(r.root, { recursive: true, force: true });
});
