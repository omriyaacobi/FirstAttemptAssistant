// selfedit-agy.test.js
// The shared agy editor machinery (makeAgyEditor in selfedit.js) and the work-folder watch, tested through the Neon editor with FAKE
// editors and a FAKE agy: no model is called and no quota is used. Moved from selfedit-argon.test.js on 2026-11-23, when the Argon
// page-only editor was removed (Omri's decision); its page-only tests went with it.
// Run with:  node --test tests/selfedit-agy.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSelfEdit, makeNeonEditor, describeAgyStep } = require("../selfedit");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");

// A tiny project: a page in public/, a script, and two passing tests.
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-agy-test-"));
  const repoDir = path.join(root, "project");
  fs.mkdirSync(repoDir);
  write(repoDir, "public/index.html", "<title>Bot</title>\n<p>hello</p>\n");
  write(repoDir, "greet.js", 'module.exports = () => "hello";\n');
  write(repoDir, "greet.test.js", 'const test = require("node:test");\nconst assert = require("node:assert");\nconst greet = require("./greet");\ntest("a", () => assert.strictEqual(greet(), "hello"));\ntest("b", () => assert.strictEqual(typeof greet(), "string"));\n');
  write(repoDir, "server.js", "// protected\n");
  write(repoDir, ".gitignore", "data/\n");
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "core.autocrlf", "false");
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-q", "-m", "initial");
  return { root, repoDir, dataDir: path.join(repoDir, "data"), workRoot: path.join(root, "work"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function setup(neonFn, extra = {}) {
  const project = makeProject();
  const calls = { claude: 0, neon: 0 };
  const manager = createSelfEdit({
    repoDir: project.repoDir, dataDir: project.dataDir, workRoot: project.workRoot,
    editor: async (args) => { calls.claude++; if (extra.claudeFn) await extra.claudeFn(args, project); return "claude did it"; },
    neonEditor: async (args) => { calls.neon++; await neonFn(args, project); return "neon did it"; },
    lowPools: extra.lowPools || (async () => []),
    reviewer: async () => '{"verdict":"ok","matches_request":true,"notes":[]}', // a fake second review: no model is called
  });
  return { ...project, manager, calls };
}

const run = async (s, request = "make the page nicer", model = "neon") => (await s.manager.start(request, { model })).finished;

// ---- the audit of agy's tool steps (pure) ----

const wt = path.join(os.tmpdir(), "bot-selfedit", "abc123");
const step = (tool_name, parameters, extra = {}) => ({ step_type: "tool", tool_name, state: "ACTIVE", tool_info: { name: tool_name, parameters }, ...extra });


test("progress lines are plain English", () => {
  assert.strictEqual(describeAgyStep(step("read_file", { Path: path.join(wt, "public", "index.html") })), "Reading index.html");
  assert.strictEqual(describeAgyStep(step("edit_file", { Path: path.join(wt, "public", "index.html") })), "Editing index.html");
  assert.strictEqual(describeAgyStep(step("write_file", { Path: path.join(wt, "public", "a.css") })), "Writing a.css");
  assert.strictEqual(describeAgyStep(step("read_file", { Path: "x" }, { state: "DONE" })), null);
});

// ---- the public-only check (pure) ----

const baseline = { total: 2 };
const okTests = { ok: true, total: 2 };
// ---- the work-folder watch (any agy editor) ----

test("Neon writing into your real project (or its .env) stops everything", async () => {
  const s = setup(({ worktree }, project) => { write(worktree, "public/index.html", "<p>x</p>\n"); write(project.repoDir, "stolen.txt", "x"); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "blocked");
    assert.match(done.note, /real project changed/i);
    assert.strictEqual(s.calls.neon, 1); // no retry after a safety failure
  } finally { s.cleanup(); }
  const t = setup(({ worktree }, project) => { write(worktree, "public/index.html", "<p>x</p>\n"); write(project.repoDir, ".env", "SECRET=1\n"); });
  try { // .env is git-ignored in real projects, so git status cannot see it; the snapshot can
    write(t.repoDir, ".gitignore", "data/\n.env\n"); git(t.repoDir, "commit", "-qam", "ignore env");
    const done = await run(t);
    assert.strictEqual(done.status, "blocked");
    assert.match(done.blocked.join("|"), /\.env/);
  } finally { t.cleanup(); }
});

test("Neon changing another private copy, or a file in the work folder, stops everything", async () => {
  const s = setup(({ worktree }, project) => {
    write(worktree, "public/index.html", "<p>x</p>\n");
    write(project.workRoot, "someone-else/file.txt", "tampered");
  });
  try {
    fs.mkdirSync(path.join(s.workRoot, "someone-else"), { recursive: true });
    write(s.workRoot, "someone-else/file.txt", "original");
    const done = await run(s);
    assert.strictEqual(done.status, "blocked");
    assert.match(done.blocked.join("|"), /someone-else/);
  } finally { s.cleanup(); }
});

test("Neon failure is reported plainly and never falls back to the Claude editor", async () => {
  const s = setup(() => { throw new Error("Neon could not do this: its quota ran out. Nothing was sent to Claude and nothing in your project changed."); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "failed");
    assert.match(done.note, /Neon could not do this/);
    assert.deepStrictEqual(s.calls, { claude: 0, neon: 1 });
    assert.deepStrictEqual(git(s.repoDir, "branch", "--list", "selfedit/*"), ""); // cleaned up
  } finally { s.cleanup(); }
});

test("Neon follow-up continues on the same copy with the same checks; a bad follow-up is undone", async () => {
  let n = 0;
  const s = setup(({ worktree }) => {
    n++;
    if (n === 1) write(worktree, "public/index.html", "<p>one</p>\n");
    else if (n === 2) write(worktree, "public/index.html", "<p>two</p>\n");
    else write(worktree, ".gitignore", "data/\n# changed\n"); // a guard file: the follow-up is refused and undone
  });
  try {
    const first = await run(s);
    assert.strictEqual(first.status, "ready");
    const second = await (await s.manager.followUp(first.id, "now say two")).finished;
    assert.strictEqual(second.status, "ready");
    assert.match(second.diff, /two/);
    const third = await (await s.manager.followUp(first.id, "also change .gitignore")).finished;
    assert.strictEqual(third.status, "ready"); // the bad follow-up was undone
    assert.match(third.note, /undone/);
    assert.match(s.manager.get(first.id).diff, /two/);
    assert.strictEqual(s.calls.claude, 0);
  } finally { s.cleanup(); }
});

// ---- the Claude path is unchanged ----

test("Claude editor path: still used for sonnet/opus, Neon never called", async () => {
  const s = setup(() => assert.fail("neon must not run"), { claudeFn: ({ worktree, model }) => { assert.strictEqual(model, "sonnet"); write(worktree, "greet.js", 'module.exports = () => "hello";\n// note\n'); } });
  try {
    const done = await run(s, "tweak the greeting", "sonnet");
    assert.strictEqual(done.status, "ready", done.note);
    assert.deepStrictEqual(done.files.map((f) => f.path), ["greet.js"]);
    assert.deepStrictEqual(s.calls, { claude: 1, neon: 0 });
    assert.match((await s.manager.approve(done.id)).note, /not pushed/);
  } finally { s.cleanup(); }
});

test("Claude editor path: does not ask the quota, does not look at the work folder", async () => {
  let asked = 0;
  const s = setup(() => {}, { lowPools: async () => { asked++; return [{ pool: "Gemini Models", remaining: 1 }]; }, claudeFn: ({ worktree }) => write(worktree, "public/a.css", "a{}\n") });
  try { assert.strictEqual((await run(s, "x", "sonnet")).status, "ready"); assert.strictEqual(asked, 0); } finally { s.cleanup(); }
});


test("the Argon editor is gone (2026-11-23): starting it is refused and nothing is made", async () => {
  const s = setup(() => assert.fail("no editor may run"));
  try {
    await assert.rejects(s.manager.start("x", { model: "argon" }), /neon, sonnet or opus/);
    assert.deepStrictEqual(s.calls, { claude: 0, neon: 0 });
    assert.strictEqual(fs.existsSync(s.workRoot), false);
  } finally { s.cleanup(); }
});

// ---- the real agy editor (Neon), with a FAKE agy program ----

// The fake agy: prints "init", waits for the user message, then plays a script chosen with FAKE_AGY_SCENARIO.
const FAKE_AGY = `
const fs = require("fs");
const scenario = process.env.FAKE_AGY_SCENARIO;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
fs.writeFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ args: process.argv.slice(2), temp: process.env.TEMP, tmp: process.env.TMP, cwd: process.cwd() }));
out({ event: "init" });
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  if (buf.indexOf("\\n") < 0) return;
  fs.appendFileSync(process.env.FAKE_AGY_LOG, "\\nPROMPT " + buf.trim());
  const tool = (name, params) => out({ event: "step_update", step_update: { step_type: "tool", tool_name: name, state: "ACTIVE", tool_info: { name, parameters: params } } });
  const cwd = process.cwd();
  if (scenario === "good") {
    tool("read_file", { Path: cwd + "/public/index.html" });
    fs.writeFileSync(cwd + "/public/index.html", "<p>neon</p>\\n");
    tool("edit_file", { Path: cwd + "/public/index.html" });
    out({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "Done." } });
    out({ event: "result", result: { status: "SUCCESS", response: "Changed the page." } });
  } else if (scenario === "shell-once" && !fs.existsSync(process.env.FAKE_AGY_LOG + ".n")) { fs.writeFileSync(process.env.FAKE_AGY_LOG + ".n", "1"); tool("run_command", { CommandLine: "ls" }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "shell-once") { tool("edit_file", { Path: cwd + "/public/index.html" }); fs.writeFileSync(cwd + "/public/index.html", "<p>second try</p>\\n"); out({ event: "result", result: { status: "SUCCESS", response: "Second try worked." } }); }
  else if (scenario === "slow-retry" && !fs.existsSync(process.env.FAKE_AGY_LOG + ".n")) { fs.writeFileSync(process.env.FAKE_AGY_LOG + ".n", "1"); tool("run_command", { CommandLine: "ls" }); }
  else if (scenario === "slow-retry") { setTimeout(() => { let ok = false; try { fs.writeFileSync(process.env.TEMP + "/alive.txt", "1"); ok = true; } catch (e) {} out({ event: "result", result: { status: "SUCCESS", response: ok ? "TEMP alive" : "TEMP gone" } }); }, 3000); }
  else if (scenario === "shell") { tool("run_command", { CommandLine: "echo hi" }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "outside") { tool("write_file", { Path: process.env.FAKE_AGY_OUTSIDE }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "denied") out({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "RunCommand" }] } });
  else if (scenario === "limit") out({ event: "result", result: { status: "ERROR", error: "RESOURCE_EXHAUSTED: quota exceeded for Gemini Models", response: "" } });
  else if (scenario === "crash") process.exit(3);
});
`;

function fakeAgy(scenario, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-agy-"));
  const script = path.join(dir, "fake-agy.js");
  fs.writeFileSync(script, FAKE_AGY);
  const wtDir = path.join(dir, "work", "id1");
  fs.mkdirSync(path.join(wtDir, "public"), { recursive: true });
  fs.writeFileSync(path.join(wtDir, "public", "index.html"), "<p>old</p>\n");
  const log = path.join(dir, "log.txt");
  process.env.FAKE_AGY_SCENARIO = scenario;
  process.env.FAKE_AGY_LOG = log;
  process.env.FAKE_AGY_OUTSIDE = path.join(dir, "outside.txt");
  const failures = [];
  const editor = makeNeonEditor({ command: process.execPath, prefixArgs: [script], noteFailure: (m, msg) => failures.push({ m, msg }), ...extra });
  return { dir, wtDir, log, editor, failures, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { /* Windows may still hold the folder for a moment */ } } };
}

test("real agy editor (Neon) (fake agy): safe flags, prompt through stdin, private TEMP, progress lines", async () => {
  const f = fakeAgy("good");
  try {
    const seen = [];
    const request = "x".repeat(40000); // longer than the Windows command line limit: only possible through stdin
    const summary = await f.editor({ worktree: f.wtDir, request, feedback: "", onProgress: (t) => seen.push(t) });
    assert.strictEqual(summary, "Changed the page.");
    const log = fs.readFileSync(f.log, "utf8");
    const info = JSON.parse(log.split("\n")[0]);
    assert.ok(info.args.includes("--mode") && info.args[info.args.indexOf("--mode") + 1] === "accept-edits");
    assert.ok(!info.args.includes("--dangerously-skip-permissions"));
    assert.ok(info.args.includes("stream-json"));
    assert.ok(!info.args.some((a) => a.length > 1000), "the prompt must not be on the command line");
    assert.strictEqual(path.resolve(info.cwd).toLowerCase(), path.resolve(f.wtDir).toLowerCase());
    assert.ok(info.temp && !path.resolve(info.temp).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep + "fake-agy-x"), "TEMP is private");
    assert.strictEqual(info.temp, info.tmp);
    assert.ok(!path.resolve(info.temp).startsWith(path.resolve(f.wtDir)), "the private TEMP is not inside the copy (it would show up in the diff)");
    assert.ok(log.includes("PROMPT") && log.includes("x".repeat(40000)));
    assert.ok(log.includes("use ONLY the tools read_file, edit_file and write_file"));
    assert.deepStrictEqual(seen.slice(0, 2), ["Reading index.html", "Editing index.html"]);
    assert.ok(seen.includes("Neon is thinking and writing..."));
    assert.strictEqual(fs.readFileSync(path.join(f.wtDir, "public", "index.html"), "utf8"), "<p>neon</p>\n");
  } finally { f.cleanup(); }
});

test("real agy editor (Neon) (fake agy): a shell command or an outside path stops the run with a plain message", async () => {
  for (const [scenario, pattern] of [["shell", /tool "run_command", which is not allowed/], ["outside", /outside the private copy/], ["denied", /not allowed \(RunCommand\)/]]) {
    const f = fakeAgy(scenario);
    try {
      const started = Date.now();
      await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), (error) => {
        assert.match(error.message, /^Neon could not do this:/);
        assert.match(error.message, pattern);
        assert.match(error.message, /Nothing was sent to Claude/);
        return true;
      }, scenario);
      assert.ok(Date.now() - started < 2900, "it was stopped at once (both tries), not after the fake agy's own delay");
    } finally { f.cleanup(); }
  }
});

test("real agy editor (Neon) (fake agy): errors are plain, tell the quota module, and never mention a fallback", async () => {
  for (const scenario of ["limit", "crash"]) {
    const f = fakeAgy(scenario);
    try {
      await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), /Neon could not do this: .*pick Sonnet yourself/s, scenario);
      assert.strictEqual(f.failures.length, 1);
      assert.strictEqual(f.failures[0].m.provider, "agy");
    } finally { f.cleanup(); }
  }
  const f = fakeAgy("limit");
  try { await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), /RESOURCE_EXHAUSTED/); } finally { f.cleanup(); }
});

test("real agy editor (Neon): the model name is checked before anything starts", async () => {
  const f = fakeAgy("good");
  try { await assert.rejects(f.editor({ worktree: f.wtDir, request: "x", model: "bad name; rm" })); } finally { f.cleanup(); }
});

test("real agy editor (Neon) (fake agy): trying a shell command once is forgiven with one reminder; the prompt lists the files and says there is no shell", async () => {
  const f = fakeAgy("shell-once");
  try {
    const seen = [];
    const summary = await f.editor({ worktree: f.wtDir, request: "x", onProgress: (t) => seen.push(t) });
    assert.strictEqual(summary, "Second try worked.");
    assert.ok(seen.some((t) => /asking it again/.test(t)));
    const log = fs.readFileSync(f.log, "utf8");
    assert.ok(log.includes("The web page (public/): public/index.html"), "the prompt lists the files");
    assert.ok(log.includes("There is no command tool"), "the second try carries the reminder");
    assert.strictEqual(f.failures.length, 0); // a forgiven try is not a quota failure
  } finally { f.cleanup(); }
});

// ---- the page and the server know about the choice ----

test("the Improve Bot window offers Neon, Sonnet and Opus (the Argon editor was removed 2026-11-23), and says which quota it uses", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /<option value="sonnet">/);
  assert.doesNotMatch(html, /<option value="argon">|argon:/);
  assert.match(html, /Uses your Gemini quota \(Gemini Models\), NOT Claude/);
  assert.match(html, /Uses your Claude plan\./);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes('["neon", "sonnet", "opus"].includes(model)')); assert.doesNotMatch(server, /"argon"]/);
});

test("a retry keeps its own TEMP until it has finished (the first run's cleanup must not delete it)", async () => {
  const f = fakeAgy("slow-retry");
  try { assert.strictEqual(await f.editor({ worktree: f.wtDir, request: "x" }), "TEMP alive"); } finally { f.cleanup(); }
});

test("removeAgyTmp never throws and removes only its own folder", () => {
  const { removeAgyTmp } = require("../selfedit");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agytmp-"));
  const a = path.join(root, "a"), b = path.join(root, "b");
  fs.mkdirSync(a); fs.mkdirSync(b);
  removeAgyTmp(a, root);
  assert.ok(!fs.existsSync(a) && fs.existsSync(b), "the other run's folder stays, and so does the shared parent");
  const busy = () => { const e = new Error("busy"); e.code = "EPERM"; throw e; };
  assert.doesNotThrow(() => removeAgyTmp(b, root, busy, busy)); // a failed delete changes nothing and does not crash
  assert.ok(fs.existsSync(b));
  removeAgyTmp(b, root);
  assert.ok(!fs.existsSync(root), "the empty parent is removed");
});

test("a failed delete does not change the editor's result", async () => {
  const f = fakeAgy("good");
  const realRm = fs.rmSync;
  try {
    fs.rmSync = (...a) => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
    assert.strictEqual(await f.editor({ worktree: f.wtDir, request: "x" }), "Changed the page.");
    await new Promise((r) => setTimeout(r, 2300)); // the delayed cleanup runs and fails inside its timer; nothing crashes
  } finally { fs.rmSync = realRm; f.cleanup(); }
});
