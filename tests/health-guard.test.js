// Tests for health-guard.js: a merged change that keeps Bot from coming up is undone (start-web.cmd runs it before every start).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { runGuard } = require("../health-guard");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hg-"));
  const repoDir = path.join(dir, "repo"), dataDir = path.join(dir, "data");
  fs.mkdirSync(repoDir); fs.mkdirSync(dataDir);
  const run = (...a) => execFileSync("git", a, { cwd: repoDir, encoding: "utf8", windowsHide: true }).trim();
  run("init", "-q"); run("config", "user.email", "t@example.com"); run("config", "user.name", "t"); run("config", "core.autocrlf", "false"); run("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repoDir, "server.js"), "good\n"); run("add", "-A"); run("commit", "-qm", "base");
  fs.writeFileSync(path.join(repoDir, "server.js"), "broken\n"); run("commit", "-qam", "Self-edit: broken");
  const pending = (p) => fs.writeFileSync(path.join(dataDir, "selfedit-pending.json"), JSON.stringify(p));
  return { dir, repoDir, dataDir, run, pending, merged: run("rev-parse", "HEAD") };
}

test("no pending change: nothing happens", () => {
  const s = setup();
  try { assert.deepStrictEqual(runGuard({ repoDir: s.repoDir, dataDir: s.dataDir }), { decision: "ok" }); }
  finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("first failed start waits; the second rolls the change back with a new commit and says so", () => {
  const s = setup();
  try {
    const now = Date.now();
    s.pending({ mergedCommit: s.merged, startedAt: now, tries: 0 });
    assert.strictEqual(runGuard({ repoDir: s.repoDir, dataDir: s.dataDir, now }).decision, "wait");
    assert.strictEqual(fs.readFileSync(path.join(s.repoDir, "server.js"), "utf8"), "broken\n");
    s.pending({ mergedCommit: s.merged, startedAt: now, tries: 1 });
    assert.strictEqual(runGuard({ repoDir: s.repoDir, dataDir: s.dataDir, now }).decision, "wait");
    const r = runGuard({ repoDir: s.repoDir, dataDir: s.dataDir, now });
    assert.strictEqual(r.decision, "rollback"); assert.strictEqual(r.undone, true);
    assert.strictEqual(fs.readFileSync(path.join(s.repoDir, "server.js"), "utf8"), "good\n");
    assert.ok(!fs.existsSync(path.join(s.dataDir, "selfedit-pending.json")));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.dataDir, "selfedit-rollback.json"), "utf8")).undone, true);
    assert.strictEqual(s.run("rev-list", "--count", "HEAD"), "3", "base, change, revert: history kept");
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("a healthy start clears the pending file and keeps the change", () => {
  const s = setup();
  try {
    s.pending({ mergedCommit: s.merged, startedAt: Date.now(), tries: 1, healthyAt: Date.now() });
    assert.strictEqual(runGuard({ repoDir: s.repoDir, dataDir: s.dataDir }).decision, "ok");
    assert.strictEqual(fs.readFileSync(path.join(s.repoDir, "server.js"), "utf8"), "broken\n");
    assert.ok(!fs.existsSync(path.join(s.dataDir, "selfedit-pending.json")));
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("a rollback that cannot be done (uncommitted work) changes nothing and says why", () => {
  const s = setup();
  try {
    s.pending({ mergedCommit: s.merged, startedAt: Date.now() - 10 * 60_000, tries: 0 });
    fs.writeFileSync(path.join(s.repoDir, "server.js"), "omri was editing\n");
    const r = runGuard({ repoDir: s.repoDir, dataDir: s.dataDir });
    assert.strictEqual(r.undone, false); assert.match(r.why, /uncommitted/);
    assert.strictEqual(fs.readFileSync(path.join(s.repoDir, "server.js"), "utf8"), "omri was editing\n");
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});
