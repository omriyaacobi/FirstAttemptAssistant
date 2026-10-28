// gitops.test.js
// Tests showing and pushing commits, with REAL temporary git repositories: a "remote" folder
// plays the part of GitHub. Your real project and your real GitHub are never touched.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createGitOps } = require("./gitops");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// A fake GitHub (a bare repository) and a local project linked to it, already in sync.
function makeRepos() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-gitops-test-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  fs.mkdirSync(remote);
  fs.mkdirSync(work);
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(work, "a.txt"), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "first");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  const commit = (file, text, message) => {
    fs.writeFileSync(path.join(work, file), text);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", message);
  };
  return { root, remote, work, commit, ops: createGitOps({ repoDir: work }), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const remoteSubjects = (remote) => git(remote, "log", "--format=%s", "main").split("\n");

test("status: in sync means nothing to push", async () => {
  const r = makeRepos();
  const s = await r.ops.status();
  assert.strictEqual(s.branch, "main");
  assert.strictEqual(s.upstream, "origin/main");
  assert.strictEqual(s.ahead, 0);
  assert.strictEqual(s.clean, true);
  r.cleanup();
});

test("status lists the commits that are not on the remote yet", async () => {
  const r = makeRepos();
  r.commit("a.txt", "two\n", "second");
  r.commit("b.txt", "x\n", "third");
  const s = await r.ops.status();
  assert.strictEqual(s.ahead, 2);
  assert.deepStrictEqual(s.commits.map((c) => c.subject), ["third", "second"]);
  r.cleanup();
});

test("push sends the commits and afterwards nothing is left to push", async () => {
  const r = makeRepos();
  r.commit("a.txt", "two\n", "second");
  const result = await r.ops.push();
  assert.deepStrictEqual(result.pushed.map((c) => c.subject), ["second"]);
  assert.strictEqual((await r.ops.status()).ahead, 0);
  assert.deepStrictEqual(remoteSubjects(r.remote), ["second", "first"]);
  r.cleanup();
});

test("push refuses when there is nothing to push", async () => {
  const r = makeRepos();
  await assert.rejects(r.ops.push(), /nothing to push/);
  r.cleanup();
});

test("push refuses on a branch that has no remote branch", async () => {
  const r = makeRepos();
  git(r.work, "checkout", "-q", "-b", "experiment");
  r.commit("a.txt", "x\n", "on a new branch");
  assert.strictEqual((await r.ops.status()).upstream, null);
  await assert.rejects(r.ops.push(), /no GitHub branch/);
  r.cleanup();
});

test("SECURITY: push refuses when a tracked file looks like a secret", async () => {
  const r = makeRepos();
  r.commit(".env", "API_KEY=abc\n", "oops, a secret");
  await assert.rejects(r.ops.push(), /look like secrets: \.env/);
  assert.deepStrictEqual(remoteSubjects(r.remote), ["first"]); // nothing reached the remote
  r.cleanup();
});

test("SECURITY: push never forces, so it cannot overwrite history on the remote", async () => {
  const r = makeRepos();
  // Someone else pushes a commit to the remote...
  const other = path.join(r.root, "other");
  execFileSync("git", ["clone", "-q", r.remote, other]);
  git(other, "config", "user.name", "Other");
  git(other, "config", "user.email", "other@example.com");
  fs.writeFileSync(path.join(other, "c.txt"), "theirs\n");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "their commit");
  git(other, "push", "-q");
  // ...while we make a different one. Our push must be refused, not overwrite theirs.
  r.commit("a.txt", "ours\n", "our commit");
  await assert.rejects(r.ops.push());
  assert.deepStrictEqual(remoteSubjects(r.remote), ["their commit", "first"]);
  r.cleanup();
});
