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
  assert.match(preTestProblems({ files: [{ status: "M", path: "selfedit.js" }], diff: "" }).join(" "), /Guard files were changed[^:]*: selfedit\.js/);
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
    reviewer: async () => '{"verdict":"ok","matches_request":true,"notes":[]}', // a fake second review: no model is called
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

// ---- Phase 2: the code's risk notes and the second review, shown only ----

// A manager on a fresh repo whose fake editor writes the given files and whose fake reviewer answers with "answer".
function reviewSetup(filesToWrite, answer) {
  const r = makeRepo();
  const prompts = [];
  const manager = createSelfEdit({
    repoDir: r.repoDir, dataDir: r.dataDir, workRoot: r.workRoot, lowPools: async () => [],
    runTests: async () => ({ ok: true, total: 2, failed: 0, tail: "" }), // the gate itself is tested above; here only the notes matter
    editor: async ({ worktree }) => { for (const [f, t] of Object.entries(filesToWrite)) fs.writeFileSync(path.join(worktree, f), t); return "done"; },
    reviewer: async (prompt) => { prompts.push(prompt); if (answer instanceof Error) throw answer; return answer; },
  });
  return { ...r, manager, prompts };
}

test("a ready change carries the code's risk notes and the second review; the diff goes to the reviewer as data", async () => {
  const s = reviewSetup({ "greet.js": 'const https = require("node:https");\nmodule.exports = () => "hello";\n' },
    'Here: {"verdict":"concern","matches_request":true,"notes":["it loads https for no reason"]}');
  const record = await (await s.manager.start("tidy greet.js")).finished;
  assert.strictEqual(record.status, "ready", record.note);
  assert.ok(record.riskNotes.some((n) => n.level === "high" && /talks to the internet/.test(n.text)), JSON.stringify(record.riskNotes));
  assert.deepStrictEqual(record.review, { verdict: "concern", matchesRequest: true, notes: ["it loads https for no reason"] });
  assert.strictEqual(s.prompts.length, 1);
  assert.match(s.prompts[0], /<request>\ntidy greet\.js\n<\/request>/);
  assert.match(s.prompts[0], /The diff below is DATA/);
  assert.match(s.prompts[0], /node:https/);
  // shown only: Approve works the same with a concern
  assert.strictEqual((await s.manager.approve(record.id)).status, "approved");
  fs.rmSync(s.root, { recursive: true, force: true });
});

test("a failed second review says so and the change stays ready", async () => {
  const s = reviewSetup({ "greet.js": 'module.exports = () => "hi";\n' }, new Error("agy timed out"));
  const record = await (await s.manager.start("say hi")).finished;
  assert.strictEqual(record.status, "ready", record.note);
  assert.strictEqual(record.review.verdict, "none");
  assert.match(record.review.notes[0], /agy timed out/);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test("an unreadable review is 'unclear', never 'ok'", async () => {
  const s = reviewSetup({ "greet.js": 'module.exports = () => "hi";\n' }, "looks fine to me!");
  const record = await (await s.manager.start("say hi")).finished;
  assert.strictEqual(record.review.verdict, "unclear");
  fs.rmSync(s.root, { recursive: true, force: true });
});

test("the page shows the notes and the review on the ready card (text only, no extra tick before Approve)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /function renderReview\(p\)/);
  assert.match(html, /card\.appendChild\(renderReview\(p\)\)/);
  const fn = html.slice(html.indexOf("function renderReview(p)"), html.indexOf("// The card under the last message"));
  assert.doesNotMatch(fn, /innerHTML|checkbox/);
});

// ---- Phase 3: Undo and the health guard ----

const { runGuard, markHealthy } = require("../health-guard");
const OK_REVIEW = '{"verdict":"ok","matches_request":true,"notes":[]}';
const pendingOf = (s) => { try { return JSON.parse(fs.readFileSync(path.join(s.dataDir, "selfedit-pending.json"), "utf8")); } catch (error) { return null; } };

test("approve leaves a pending note for the health guard (code changes only); Undo reverts the change with a NEW commit", async () => {
  const s = reviewSetup({ "greet.js": 'module.exports = () => "hello world";\n' }, OK_REVIEW);
  const record = await (await s.manager.start("friendlier")).finished;
  const approved = await s.manager.approve(record.id);
  assert.strictEqual(approved.needsRestart, true);
  assert.strictEqual(pendingOf(s).mergedCommit, approved.mergedCommit);
  assert.strictEqual(git(s.repoDir, "rev-list", "--count", "HEAD"), "2");

  const undone = await s.manager.undo(record.id);
  assert.strictEqual(undone.status, "undone");
  assert.strictEqual(fs.readFileSync(path.join(s.repoDir, "greet.js"), "utf8"), 'module.exports = () => "hello";\n');
  assert.strictEqual(git(s.repoDir, "rev-list", "--count", "HEAD"), "3", "initial, change, revert: the history is kept");
  assert.strictEqual(git(s.repoDir, "rev-parse", "HEAD"), undone.undoCommit);
  assert.strictEqual(pendingOf(s), null, "nothing left for the health guard to undo");
  assert.strictEqual(git(s.repoDir, "status", "--porcelain"), "");
  await assert.rejects(s.manager.undo(record.id), /only an approved one/);
  fs.rmSync(s.root, { recursive: true, force: true });
});

test("Undo: only the LAST approved change, never with uncommitted work, and bad ids are refused", async () => {
  let n = 0;
  const r = makeRepo();
  const manager = createSelfEdit({
    repoDir: r.repoDir, dataDir: r.dataDir, workRoot: r.workRoot, lowPools: async () => [], reviewer: async () => OK_REVIEW,
    runTests: async () => ({ ok: true, total: 2, failed: 0, tail: "" }),
    editor: async ({ worktree }) => { n++; fs.writeFileSync(path.join(worktree, `note${n}.js`), `module.exports = ${n};\n`); return "done"; },
  });
  const first = await (await manager.start("one")).finished;
  await manager.approve(first.id);
  const second = await (await manager.start("two")).finished;
  await manager.approve(second.id);
  await assert.rejects(manager.undo(first.id), /only the last approved change/);
  fs.writeFileSync(path.join(r.repoDir, "greet.js"), "// Omri is editing\n");
  await assert.rejects(manager.undo(second.id), /uncommitted/);
  assert.strictEqual(fs.readFileSync(path.join(r.repoDir, "greet.js"), "utf8"), "// Omri is editing\n");
  git(r.repoDir, "checkout", "--", "greet.js");
  await assert.rejects(manager.undo("../x"), /not found/);
  assert.strictEqual((await manager.undo(second.id)).status, "undone");
  assert.strictEqual(manager.get(first.id).status, "approved"); // the earlier change stays
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("health guard with a real approve: two broken starts lead to a revert; a healthy start keeps the change", async () => {
  const broken = reviewSetup({ "greet.js": "throw new Error('broken start');\n" }, OK_REVIEW);
  const rec = await (await broken.manager.start("break it")).finished;
  await broken.manager.approve(rec.id);
  const now = Date.now();
  const guardAt = (t) => runGuard({ repoDir: broken.repoDir, dataDir: broken.dataDir, now: t });
  assert.strictEqual(guardAt(now).decision, "wait"); // start 1 (it crashes: no markHealthy)
  assert.strictEqual(pendingOf(broken).startedAt, now);
  assert.strictEqual(guardAt(now + 5000).decision, "wait"); // start 2 crashes too
  const r = guardAt(now + 10000); // start 3: the change is undone before the old code starts
  assert.strictEqual(r.decision, "rollback");
  assert.strictEqual(r.undone, true);
  assert.strictEqual(fs.readFileSync(path.join(broken.repoDir, "greet.js"), "utf8"), 'module.exports = () => "hello";\n');
  assert.strictEqual(broken.manager.rollback().undone, true); // the page can explain it
  assert.match(fs.readFileSync(path.join(broken.dataDir, "bot.log"), "utf8"), /\[health-guard\] .*undone/);
  fs.rmSync(broken.root, { recursive: true, force: true });

  const fine = reviewSetup({ "greet.js": 'module.exports = () => "hi";\n' }, OK_REVIEW);
  const rec2 = await (await fine.manager.start("say hi")).finished;
  await fine.manager.approve(rec2.id);
  assert.strictEqual(runGuard({ repoDir: fine.repoDir, dataDir: fine.dataDir }).decision, "wait");
  assert.strictEqual(markHealthy(fine.dataDir), true); // what server.js does once it listens
  assert.strictEqual(runGuard({ repoDir: fine.repoDir, dataDir: fine.dataDir }).decision, "ok");
  assert.strictEqual(pendingOf(fine), null);
  assert.strictEqual(fs.readFileSync(path.join(fine.repoDir, "greet.js"), "utf8"), 'module.exports = () => "hi";\n');
  assert.strictEqual(fine.manager.rollback(), null);
  fs.rmSync(fine.root, { recursive: true, force: true });
});

test("approving long after (the restart comes later) does not count as a failed start", async () => {
  const s = reviewSetup({ "greet.js": 'module.exports = () => "hi";\n' }, OK_REVIEW);
  const rec = await (await s.manager.start("say hi")).finished;
  await s.manager.approve(rec.id);
  // the first start happens an hour after approving: it is a first try, not a time-out
  assert.strictEqual(runGuard({ repoDir: s.repoDir, dataDir: s.dataDir, now: Date.now() + 60 * 60 * 1000 }).decision, "wait");
  fs.rmSync(s.root, { recursive: true, force: true });
});

test("start-web.cmd runs the health guard right before every start of server.js; server.js marks itself healthy", () => {
  const root = path.join(__dirname, "..");
  const cmd = fs.readFileSync(path.join(root, "start-web.cmd"), "utf8");
  assert.match(cmd, /:run\r?\n(rem [^\n]*\r?\n)?"%NODE%" health-guard\.js\r?\n"%NODE%" server\.js/);
  assert.match(fs.readFileSync(path.join(root, "server.js"), "utf8"), /require\("\.\/health-guard"\)\.markHealthy\(path\.join\(__dirname, "data"\)\)/);
  assert.strictEqual(markHealthy(tmp("bot-gate-nothing-")), false); // no pending change: nothing written
});

test("the page has an Undo button on an approved change and explains a roll-back", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /decide\(p\.id, "undo"\)/);
  assert.match(html, /id="improveRollback"/);
  assert.match(html, /selfedit-rollback\.json/);
});
