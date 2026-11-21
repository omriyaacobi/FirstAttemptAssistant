// selfedit-stop.test.js
// Improve Bot, 2026-11-21: (1) the "tests before" run is skipped when this exact commit already passed, (2) the Stop button.
// Real temporary git repositories, FAKE editors, test runs and reviewers (slow ones are promises that never end by themselves),
// so no model is called and your real project is never touched.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSelfEdit, nodeTests } = require("../selfedit");
const { createPlanner } = require("../selfedit-plan");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-selfedit-stop-"));
  const repoDir = path.join(root, "project");
  fs.mkdirSync(repoDir);
  write(repoDir, "greet.js", 'module.exports = () => "hello";\n');
  write(repoDir, ".gitignore", "data/\n");
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "core.autocrlf", "false");
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-q", "-m", "initial");
  return { root, repoDir, dataDir: path.join(repoDir, "data"), workRoot: path.join(root, "work"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

let editCount = 0; // each edit writes something new, so a second change after a merge still changes a file
const goodEdit = ({ worktree }) => write(worktree, "greet.js", `module.exports = () => "hello world ${++editCount}";\n`);
const passing = { ok: true, total: 5, failed: 0, tail: "" };
const baselineFile = (s) => path.join(s.dataDir, "selfedit-baseline.json");

// A manager with fakes. runTests counts its calls and keeps the signal it was given.
function setup({ editor = async (args) => { goodEdit(args); return "done"; }, runTests, reviewer } = {}) {
  const project = makeProject();
  const calls = { tests: 0, signals: [] };
  const manager = createSelfEdit({
    repoDir: project.repoDir,
    dataDir: project.dataDir,
    workRoot: project.workRoot,
    reviewer: reviewer || (async () => '{"verdict":"ok","matches_request":true,"notes":[]}'),
    editor,
    runTests: async (cwd, opts) => { calls.tests++; calls.signals.push(opts && opts.signal); return runTests ? runTests(cwd, opts, calls) : passing; },
  });
  return { ...project, manager, calls };
}

async function waitFor(check, what, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await check()) return; await sleep(25); }
  throw new Error("timed out waiting for " + what);
}

// ---- 1. skipping the first test run ----

test("baseline: the first change runs the tests twice and stores the green baseline; the next change on the same commit runs them once", async () => {
  const s = setup();
  const first = await (await s.manager.start("one")).finished;
  assert.strictEqual(first.status, "ready", first.note);
  assert.strictEqual(s.calls.tests, 2); // before and after
  assert.ok(!first.baselineReused);
  const stored = JSON.parse(read(s.dataDir, "selfedit-baseline.json"));
  assert.strictEqual(stored.commit, git(s.repoDir, "rev-parse", "HEAD"));
  assert.strictEqual(stored.total, 5);
  await s.manager.reject(first.id);

  const second = await (await s.manager.start("two")).finished;
  assert.strictEqual(second.status, "ready", second.note);
  assert.strictEqual(s.calls.tests, 3); // only the "after" run
  assert.strictEqual(second.baselineReused, true);
  assert.strictEqual(second.tests.baselineTotal, 5);
  assert.ok(second.progress.some((p) => /already passed on this version, skipping the first run/.test(p.text)));
  s.cleanup();
});

test("baseline: the test-count check still uses the stored total (a reused baseline cannot hide dropped tests)", async () => {
  const s = setup({ runTests: async (cwd, opts, calls) => (calls.tests <= 2 ? passing : { ...passing, total: 4 }) });
  const first = await (await s.manager.start("one")).finished;
  assert.strictEqual(first.status, "ready", first.note);
  await s.manager.reject(first.id);
  const second = await (await s.manager.start("two")).finished; // baseline reused (5), the run after reports 4
  assert.strictEqual(second.status, "blocked");
  assert.match(second.blocked.join(" "), /dropped from 5 to 4/);
  s.cleanup();
});

test("baseline: another commit, a broken file, an old record or nonsense values run the tests as before", async () => {
  const s = setup();
  const first = await (await s.manager.start("one")).finished;
  await s.manager.reject(first.id);
  assert.strictEqual(s.calls.tests, 2);

  write(s.repoDir, "other.js", "// new\n"); // another commit
  git(s.repoDir, "add", "-A");
  git(s.repoDir, "commit", "-q", "-m", "another commit");
  let r = await (await s.manager.start("two")).finished;
  assert.strictEqual(s.calls.tests, 4);
  assert.ok(!r.baselineReused);
  await s.manager.reject(r.id);

  fs.writeFileSync(baselineFile(s), "{ not json"); // a broken file
  r = await (await s.manager.start("three")).finished;
  assert.strictEqual(s.calls.tests, 6);
  await s.manager.reject(r.id);

  const head = git(s.repoDir, "rev-parse", "HEAD"); // the right commit, but 8 days old
  fs.writeFileSync(baselineFile(s), JSON.stringify({ commit: head, total: 5, at: Date.now() - 8 * 24 * 3600 * 1000 }));
  r = await (await s.manager.start("four")).finished;
  assert.strictEqual(s.calls.tests, 8);
  assert.ok(!r.baselineReused);
  await s.manager.reject(r.id);

  fs.writeFileSync(baselineFile(s), JSON.stringify({ commit: "abc", total: "5", at: Date.now() })); // nonsense values
  r = await (await s.manager.start("five")).finished;
  assert.strictEqual(s.calls.tests, 10);
  s.cleanup();
});

test("baseline: a dirty project does not reuse it", async () => {
  const s = setup();
  const first = await (await s.manager.start("one")).finished;
  await s.manager.reject(first.id);
  write(s.repoDir, "untracked.txt", "x\n");
  await assert.rejects(() => s.manager.start("two"), /uncommitted changes/); // start() itself refuses a dirty project
  s.cleanup();
});

test("baseline: a failed baseline is never stored", async () => {
  const s = setup({ runTests: async () => ({ ok: false, total: 5, failed: 1, tail: "1 failed" }) });
  const done = await (await s.manager.start("one")).finished;
  assert.strictEqual(done.status, "failed");
  assert.ok(!fs.existsSync(baselineFile(s)));
  s.cleanup();
});

test("baseline: an approved change stores its merged commit, so the next change skips the first run again", async () => {
  const s = setup();
  const first = await (await s.manager.start("one")).finished;
  const approved = await s.manager.approve(first.id);
  assert.strictEqual(JSON.parse(read(s.dataDir, "selfedit-baseline.json")).commit, approved.mergedCommit);
  const before = s.calls.tests;
  const second = await (await s.manager.start("two")).finished;
  assert.strictEqual(s.calls.tests, before + 1);
  assert.strictEqual(second.baselineReused, true);
  s.cleanup();
});

// ---- 2. the Stop button ----

// What every stopped run must leave behind.
function assertCleanStop(s, id, headBefore) {
  const record = s.manager.get(id);
  assert.strictEqual(record.status, "stopped");
  assert.strictEqual(record.note, "Stopped by you. Nothing was changed.");
  assert.strictEqual(s.manager.isActive(), false);
  assert.strictEqual(git(s.repoDir, "branch", "--list", "selfedit/*"), "");
  assert.ok(!fs.existsSync(path.join(s.workRoot, id)));
  assert.strictEqual(git(s.repoDir, "rev-parse", "HEAD"), headBefore); // nothing merged
  assert.strictEqual(git(s.repoDir, "status", "--porcelain"), "");
  assert.strictEqual(git(s.repoDir, "worktree", "list").split("\n").length, 1);
}

test("stop: while the first test run is going (the signal reaches the tests, everything is cleaned up)", async () => {
  const s = setup({ runTests: () => new Promise(() => {}) }); // never ends by itself
  const head = git(s.repoDir, "rev-parse", "HEAD");
  const { record } = await s.manager.start("one");
  await waitFor(() => s.calls.tests === 1, "the first test run");
  const stopped = await s.manager.stop(record.id);
  assert.strictEqual(stopped.status, "stopped");
  assert.strictEqual(s.calls.signals[0].aborted, true);
  assertCleanStop(s, record.id, head);
  assert.ok(!fs.existsSync(baselineFile(s))); // a stopped baseline is not a green one
  s.cleanup();
});

test("stop: while the editor is working", async () => {
  let editorSignal = null;
  let slow = false;
  const s = setup({ editor: (args) => { if (!slow) { goodEdit(args); return Promise.resolve("done"); } editorSignal = args.signal; return new Promise(() => {}); } });
  const first = await (await s.manager.start("seed")).finished; // stores the baseline, so the next run goes straight to the editor
  await s.manager.reject(first.id);
  slow = true;
  const head = git(s.repoDir, "rev-parse", "HEAD");
  const { record } = await s.manager.start("one");
  await waitFor(() => editorSignal, "the editor");
  const stopped = await s.manager.stop(record.id);
  assert.strictEqual(stopped.status, "stopped");
  assert.strictEqual(editorSignal.aborted, true);
  assertCleanStop(s, record.id, head);
  s.cleanup();
});

test("stop: while the tests after the change are going", async () => {
  const s = setup({ runTests: (cwd, opts, calls) => (calls.tests === 1 ? Promise.resolve(passing) : new Promise(() => {})) });
  const head = git(s.repoDir, "rev-parse", "HEAD");
  const { record } = await s.manager.start("one");
  await waitFor(() => s.calls.tests === 2, "the tests after the change");
  const stopped = await s.manager.stop(record.id);
  assert.strictEqual(stopped.status, "stopped");
  assert.strictEqual(s.calls.signals[1].aborted, true);
  assertCleanStop(s, record.id, head);
  s.cleanup();
});

test("stop: while the second review is going", async () => {
  let asked = false;
  const s = setup({ reviewer: () => { asked = true; return new Promise(() => {}); } });
  const head = git(s.repoDir, "rev-parse", "HEAD");
  const { record } = await s.manager.start("one");
  await waitFor(() => asked, "the review");
  const stopped = await s.manager.stop(record.id);
  assert.strictEqual(stopped.status, "stopped");
  assertCleanStop(s, record.id, head);
  s.cleanup();
});

test("stop: unknown ids and finished proposals are refused; a new change can start after a stop", async () => {
  const s = setup({ runTests: (cwd, opts, calls) => (calls.tests === 1 ? new Promise(() => {}) : Promise.resolve(passing)) });
  await assert.rejects(() => s.manager.stop("0123456789abcdef"), /not found/);
  const { record } = await s.manager.start("one");
  await waitFor(() => s.calls.tests === 1, "the test run");
  await s.manager.stop(record.id);
  await assert.rejects(() => s.manager.stop(record.id), /not running/);
  const next = await (await s.manager.start("two")).finished; // not stuck on "another proposal is still running"
  assert.strictEqual(next.status, "ready", next.note);
  await assert.rejects(() => s.manager.stop(next.id), /not running/);
  s.cleanup();
});

test("stop: a stopped proposal is listed and can be dismissed with Reject", async () => {
  const s = setup({ runTests: () => new Promise(() => {}) });
  const { record } = await s.manager.start("one");
  await waitFor(() => s.calls.tests === 1, "the test run");
  await s.manager.stop(record.id);
  assert.strictEqual(s.manager.list()[0].status, "stopped");
  assert.strictEqual((await s.manager.reject(record.id)).status, "rejected");
  s.cleanup();
});

test("stop: a follow-up that is stopped puts the previous version back and stays approvable", async () => {
  let slow = false;
  let signal = null;
  const s = setup({ editor: (args) => { if (!slow) { goodEdit(args); return Promise.resolve("done"); } signal = args.signal; return new Promise(() => {}); } });
  const first = await (await s.manager.start("one")).finished;
  assert.strictEqual(first.status, "ready", first.note);
  slow = true;
  await s.manager.followUp(first.id, "more please");
  await waitFor(() => signal, "the follow-up editor");
  const back = await s.manager.stop(first.id);
  assert.strictEqual(back.status, "ready");
  assert.strictEqual(signal.aborted, true);
  assert.strictEqual(s.manager.isActive(), false);
  assert.match(back.chat[back.chat.length - 1].text, /Stopped by you/);
  const approved = await s.manager.approve(first.id); // still the tested version
  assert.strictEqual(approved.status, "approved");
  assert.match(read(s.repoDir, "greet.js"), /hello world \d+/);
  s.cleanup();
});

test("stop: the real test runner kills its process when the signal fires", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-stop-nodetests-"));
  write(dir, "slow.test.js", 'require("node:test")("slow", () => new Promise((r) => setTimeout(r, 60000)));\n');
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 1500);
  const result = await nodeTests(dir, { signal: ac.signal });
  assert.ok(Date.now() - t0 < 20000, "the run must end soon after the signal");
  assert.strictEqual(result.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- 3. stopping a plan ----

test("stop: a plan that is planning is stopped and discarded (the model call gets the signal)", async () => {
  const project = makeProject();
  let seen = null;
  const planner = createPlanner({
    repoDir: project.repoDir,
    dataDir: project.dataDir,
    askOne: (model, prompt, opts) => { seen = opts && opts.signal; return new Promise(() => {}); },
    lowPools: async () => [],
    noteFailure: () => { throw new Error("a stop must not count as a model failure"); },
  });
  const { record } = await planner.start("add a thing");
  await waitFor(() => seen, "the planner's model call");
  assert.strictEqual(planner.isActive(), true);
  const done = await planner.stop(record.id);
  assert.strictEqual(done.status, "discarded");
  assert.strictEqual(seen.aborted, true);
  assert.strictEqual(planner.isActive(), false);
  await assert.rejects(() => planner.stop(record.id), /not running/);
  project.cleanup();
});
