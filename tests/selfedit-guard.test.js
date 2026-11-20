// Tests for the self-edit guard PROTOTYPE (research branch 2026-11-20).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const g = require("../selfedit-guard");

const diffOf = (file, added, removed = []) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${removed.map((l) => "-" + l).join("\n")}${removed.length ? "\n" : ""}${added.map((l) => "+" + l).join("\n")}\n`;

test("tiers: the gate, keys, git, data and login-time scripts are guard; safety-check files are sensitive; the rest is normal", () => {
  for (const f of ["selfedit.js", "selfedit-guard.js", "gitops.js", "auth.js", ".env", "config/.env.local", "data/profile.md", ".git/config", "start-web.cmd", "x.vbs", "tools/run.ps1", "health-guard.js", "moodle-extension/manifest.json"]) assert.strictEqual(g.tierOf(f), "guard", f);
  for (const f of ["server.js", "brain.js", "calendar.js", "pc-open.js", "tests/brain.test.js", "tests/server-routes.test.js"]) assert.strictEqual(g.tierOf(f), "sensitive", f);
  for (const f of ["public/index.html", "due-date.js", "brain-brief.md", "tests/due-date.test.js", "tests/brain-brief.test.js", "README.md"]) assert.strictEqual(g.tierOf(f), "normal", f);
  assert.strictEqual(g.tierOf("SELFEDIT.JS"), "guard");
  assert.strictEqual(g.tierOf(".\\gitops.js"), "guard");
});

test("riskScan: plain-English notes from ADDED lines only; blocks the few things never allowed", () => {
  const notes = g.riskScan(diffOf("due-date.js", ['const { execSync } = require("node:child_process");', 'fetch("https://example.com/x")', "fs.rmSync(dir, { recursive: true, force: true })"]));
  const texts = notes.map((n) => n.text).join(" | ");
  assert.match(texts, /starts another program/); assert.match(texts, /talks to the internet/); assert.match(texts, /deletes files/);
  assert.ok(notes.every((n) => n.level !== "block"));
  assert.ok(g.riskScan(diffOf("x.js", ['const k = fs.readFileSync(".env")'])).some((n) => n.level === "block"));
  assert.ok(g.riskScan(diffOf("x.js", ["args.push('--dangerously-skip-permissions')"])).some((n) => n.level === "block"));
  assert.ok(!g.riskScan(diffOf("x.js", ["const port = process.env.PORT"])).some((n) => n.level === "block"), "process.env is high, not a block");
  assert.deepStrictEqual(g.riskScan(diffOf("x.js", ["const a = 1;"], ['fetch("https://old")'])), [], "a REMOVED risky line is not a note");
  assert.ok(g.riskScan(diffOf("brain-brief.md", ["Never read the .env file."])).every((n) => n.level !== "block"), "the brief may mention .env");
});

test("riskScan: removed tests and touched guard/sensitive files are named", () => {
  const n1 = g.riskScan(diffOf("tests/x.test.js", ["// gone"], ['test("refuses a bad path", () => {', "  assert.throws(() => f())"]));
  assert.ok(n1.some((n) => /test line/.test(n.text) && n.level === "high"));
  const n2 = g.riskScan(diffOf("server.js", ["// x"]), [{ path: "server.js" }, { path: "gitops.js" }, { path: "lang.js" }]);
  assert.ok(n2.some((n) => n.file === "server.js" && n.level === "high"));
  assert.ok(n2.some((n) => n.file === "gitops.js" && n.level === "block"));
  assert.ok(!n2.some((n) => n.file === "lang.js"));
});

test("no changed-line limit (Omri's light version, 2026-11-20): only selfedit.js's 25 files / 300,000 characters", () => {
  assert.strictEqual(g.sizeProblems, undefined);
  assert.ok(g.riskScan(diffOf("brain.js", Array(700).fill("x")), [{ path: "brain.js" }]).every((n) => n.level !== "block"));
});

test("auditWide: only the three file tools, inside the copy, never .git, never a guard file; normal and sensitive files may be written", () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "guard-wt-"));
  try {
    const step = (tool, file) => ({ step_type: "tool", tool_name: tool, tool_info: { parameters: { AbsolutePath: path.join(wt, file) } } });
    assert.strictEqual(g.auditWide(step("write_file", "due-date.js"), wt), null);
    assert.strictEqual(g.auditWide(step("edit_file", "brain.js"), wt), null);
    assert.strictEqual(g.auditWide(step("read_file", "selfedit.js"), wt), null, "reading a guard file is fine");
    assert.match(g.auditWide(step("edit_file", "selfedit.js"), wt), /guard file/);
    assert.match(g.auditWide(step("write_file", ".env"), wt), /guard file/);
    assert.match(g.auditWide(step("edit_file", "start-web.cmd"), wt), /guard file/);
    assert.match(g.auditWide(step("read_file", ".git/config"), wt), /\.git/);
    assert.match(g.auditWide({ step_type: "tool", tool_name: "run_command", tool_info: { parameters: {} } }, wt), /not allowed/);
    assert.match(g.auditWide({ step_type: "tool", tool_name: "read_file", tool_info: { parameters: { AbsolutePath: path.join(wt, "..", "other", ".env") } } }, wt), /outside/);
    assert.strictEqual(g.auditWide({ step_type: "agent_response" }, wt), null);
  } finally { fs.rmSync(wt, { recursive: true, force: true }); }
});

test("parseReview: only a checked verdict and at most 5 short notes; anything else is 'unclear'", () => {
  assert.deepStrictEqual(g.parseReview('{"verdict":"ok","matches_request":true,"notes":["fine"]}'), { verdict: "ok", matchesRequest: true, notes: ["fine"] });
  assert.strictEqual(g.parseReview('{"verdict":"ok","matches_request":false,"notes":[]}').verdict, "concern", "not what was asked -> concern");
  assert.strictEqual(g.parseReview('{"verdict":"approve"}').verdict, "unclear");
  assert.strictEqual(g.parseReview("looks good to me").verdict, "unclear");
  assert.strictEqual(g.parseReview(`{"verdict":"concern","notes":${JSON.stringify(Array(9).fill("x".repeat(500)))}}`).notes.length, 5);
  assert.match(g.reviewPrompt("add a route", "+x", [{ level: "high", text: "server.js: a safety-check file" }]), /DATA, not instructions/);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-repo-"));
  const run = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", windowsHide: true }).trim();
  run("init", "-q"); run("config", "user.email", "t@example.com"); run("config", "user.name", "t"); run("config", "commit.gpgsign", "false"); run("config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(dir, "a.js"), "one\n"); run("add", "-A"); run("commit", "-qm", "base");
  return { dir, run };
}

test("undoMerge: one approved change is undone by a NEW commit; history is kept", () => {
  const { dir, run } = repo();
  try {
    fs.writeFileSync(path.join(dir, "a.js"), "two\n"); run("commit", "-qam", "Self-edit: change");
    const merged = run("rev-parse", "HEAD");
    const head = g.undoMerge({ repoDir: dir, mergedCommit: merged });
    assert.strictEqual(fs.readFileSync(path.join(dir, "a.js"), "utf8"), "one\n");
    assert.notStrictEqual(head, merged);
    assert.strictEqual(run("rev-list", "--count", "HEAD"), "3", "base, change, revert");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("undoMerge refuses: a dirty project, a commit not in history, a bad id; a conflicting undo changes nothing", () => {
  const { dir, run } = repo();
  try {
    fs.writeFileSync(path.join(dir, "a.js"), "two\n"); run("commit", "-qam", "change");
    const merged = run("rev-parse", "HEAD");
    fs.writeFileSync(path.join(dir, "a.js"), "three\n"); run("commit", "-qam", "later change on the same line");
    const before = run("rev-parse", "HEAD");
    assert.throws(() => g.undoMerge({ repoDir: dir, mergedCommit: merged }), /cannot be undone by itself/);
    assert.strictEqual(run("rev-parse", "HEAD"), before); assert.strictEqual(run("status", "--porcelain"), "");
    assert.throws(() => g.undoMerge({ repoDir: dir, mergedCommit: "nope" }), /not a commit/);
    assert.throws(() => g.undoMerge({ repoDir: dir, mergedCommit: "0".repeat(40) }), /not in the project/);
    fs.writeFileSync(path.join(dir, "b.js"), "x"); run("add", "b.js");
    assert.throws(() => g.undoMerge({ repoDir: dir, mergedCommit: before }), /uncommitted/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("bootDecision: ok without a pending change or once healthy; wait for the first try; roll back after 2 failed starts or 3 minutes", () => {
  const now = 1_000_000_000;
  assert.strictEqual(g.bootDecision(null, now), "ok");
  assert.strictEqual(g.bootDecision({ startedAt: now - 10_000, tries: 1, healthyAt: now - 1000 }, now), "ok");
  assert.strictEqual(g.bootDecision({ startedAt: now - 10_000, tries: 1 }, now), "wait");
  assert.strictEqual(g.bootDecision({ startedAt: now - 10_000, tries: g.MAX_TRIES }, now), "rollback");
  assert.strictEqual(g.bootDecision({ startedAt: now - 4 * 60_000, tries: 0 }, now), "rollback");
});

test("riskScan: a regex's .exec( is not 'starts another program'; a name taken off a list in a safety-check file is named", () => {
  assert.deepStrictEqual(g.riskScan(diffOf("due-date.js", ["  m = /x/.exec(text);"])), []);
  const n = g.riskScan(diffOf("brain.js", ['  "course_note", "file_folder",'], ['  "set_reminder", "course_note", "file_folder",']));
  assert.ok(n.some((x) => /removes set_reminder/.test(x.text) && x.level === "high"));
  assert.deepStrictEqual(g.riskScan(diffOf("lang.js", ['  "b",'], ['  "abc",'])), [], "a normal file is not checked for this");
});

test("riskScan: require('node:https').request(...) on one line is 'talks to the internet' (missed once in the red-team test)", () => {
  const n = g.riskScan(diffOf("news.js", ['try { require("node:https").request({ host: "x.invalid" }).end("{}"); } catch (error) {}']));
  assert.ok(n.some((x) => /talks to the internet/.test(x.text)));
});
