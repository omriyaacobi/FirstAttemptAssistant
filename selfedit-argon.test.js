// selfedit-argon.test.js
// Tests the Argon editor (Gemini 4 Argon through agy, page changes only) with FAKE editors and a FAKE agy:
// no model is called and no quota is used. The Claude editor path is checked too: it must not have changed.
// Run with:  node --test selfedit-argon.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSelfEdit, makeArgonEditor, auditAgyStep, describeAgyStep, checkProposal } = require("./selfedit");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");

// A tiny project: a page in public/, a script, and two passing tests.
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-argon-test-"));
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

function setup(argonFn, extra = {}) {
  const project = makeProject();
  const calls = { claude: 0, argon: 0 };
  const manager = createSelfEdit({
    repoDir: project.repoDir, dataDir: project.dataDir, workRoot: project.workRoot,
    editor: async (args) => { calls.claude++; if (extra.claudeFn) await extra.claudeFn(args, project); return "claude did it"; },
    argonEditor: async (args) => { calls.argon++; await argonFn(args, project); return "argon did it"; },
    lowPools: extra.lowPools || (async () => []),
  });
  return { ...project, manager, calls };
}

const run = async (s, request = "make the page nicer", model = "argon") => (await s.manager.start(request, { model })).finished;

// ---- the audit of agy's tool steps (pure) ----

const wt = path.join(os.tmpdir(), "bot-selfedit", "abc123");
const step = (tool_name, parameters, extra = {}) => ({ step_type: "tool", tool_name, state: "ACTIVE", tool_info: { name: tool_name, parameters }, ...extra });

test("audit: reads and edits inside the copy are fine, in either slash style", () => {
  assert.strictEqual(auditAgyStep(step("read_file", { Path: path.join(wt, "public", "index.html") }), wt), null);
  assert.strictEqual(auditAgyStep(step("read_file", { Path: path.join(wt, "greet.js") }), wt), null); // reading code is allowed
  assert.strictEqual(auditAgyStep(step("edit_file", { Path: path.join(wt, "public", "index.html") }), wt), null);
  assert.strictEqual(auditAgyStep(step("write_file", { Path: wt.replace(/\\/g, "/") + "/public/new.css" }), wt), null);
  assert.strictEqual(auditAgyStep(step("write_file", { Path: "file:///" + wt.replace(/\\/g, "/") + "/public/x.css" }), wt), null);
  assert.strictEqual(auditAgyStep({ step_type: "agent_response", text_delta: "hi" }, wt), null);
  assert.strictEqual(auditAgyStep({ step_type: "user_input" }, wt), null);
});

test("audit: any other tool is refused (shell, web, sub-agents, scheduling)", () => {
  for (const name of ["run_command", "search_web", "invoke_subagent", "define_subagent", "schedule", "send_message", "manage_task", "something_new"]) {
    assert.match(auditAgyStep(step(name, {}), wt), /not allowed/, name);
  }
});

test("audit: paths outside the copy are refused, including .. tricks, other drives and sibling folders", () => {
  assert.match(auditAgyStep(step("read_file", { Path: path.join(os.tmpdir(), "elsewhere.txt") }), wt), /outside the private copy/);
  assert.match(auditAgyStep(step("write_file", { Path: path.join(wt, "..", "other", "public", "x.html") }), wt), /outside the private copy/);
  assert.match(auditAgyStep(step("read_file", { Path: path.join(wt, "public", "..", "..", "abc123-evil", "x") }), wt), /outside the private copy/);
  assert.match(auditAgyStep(step("read_file", { Path: wt + "-evil/x" }), wt), /outside the private copy/); // same prefix, different folder
  assert.match(auditAgyStep(step("read_file", { Path: "C:\\Claude Code Project\\FirstAttemptAssistant\\.env" }), wt), /outside the private copy/);
  assert.match(auditAgyStep(step("read_file", { Path: "../../x" }), wt), /outside the private copy/);
});

test("audit: writes only inside public/, and never .git", () => {
  assert.match(auditAgyStep(step("write_file", { Path: path.join(wt, "greet.js") }), wt), /outside public/);
  assert.match(auditAgyStep(step("edit_file", { Path: path.join(wt, "server.js") }), wt), /outside public/);
  assert.match(auditAgyStep(step("edit_file", { Path: path.join(wt, "PUBLIC-evil", "x") }), wt), /outside public/);
  assert.match(auditAgyStep(step("write_file", { Path: path.join(wt, ".git") }), wt), /\.git/);
  assert.match(auditAgyStep(step("read_file", { Path: path.join(wt, ".git", "config") }), wt), /\.git/);
});

test("progress lines are plain English", () => {
  assert.strictEqual(describeAgyStep(step("read_file", { Path: path.join(wt, "public", "index.html") })), "Reading index.html");
  assert.strictEqual(describeAgyStep(step("edit_file", { Path: path.join(wt, "public", "index.html") })), "Editing index.html");
  assert.strictEqual(describeAgyStep(step("write_file", { Path: path.join(wt, "public", "a.css") })), "Writing a.css");
  assert.strictEqual(describeAgyStep(step("read_file", { Path: "x" }, { state: "DONE" })), null);
});

// ---- the public-only check (pure) ----

const baseline = { total: 2 };
const okTests = { ok: true, total: 2 };
test("publicOnly: new, deleted and renamed-out files outside public/ are refused; the Claude path is not affected", () => {
  const f = (status, p, mode = "100644") => ({ status, path: p, mode });
  assert.deepStrictEqual(checkProposal({ files: [f("M", "public/index.html"), f("A", "public/new.css")], diff: "", tests: okTests, baseline, publicOnly: true }), []);
  for (const bad of [f("A", "evil.js"), f("D", "greet.js"), f("A", "publicity/x.html"), f("A", "Public/x.html"), f("M", "greet.test.js")]) {
    const problems = checkProposal({ files: [f("M", "public/index.html"), bad], diff: "", tests: okTests, baseline, publicOnly: true });
    assert.ok(problems.some((p) => /only change files under public\//.test(p) && p.includes(bad.path)), bad.path);
    // the same change from the Claude editor is allowed, exactly as before
    assert.deepStrictEqual(checkProposal({ files: [bad], diff: "", tests: okTests, baseline }), [], bad.path);
  }
  assert.ok(checkProposal({ files: [f("A", "public/link", "120000")], diff: "", tests: okTests, baseline, publicOnly: true }).some((p) => /Links/.test(p)));
  assert.ok(checkProposal({ files: [f("A", "public/mod", "160000")], diff: "", tests: okTests, baseline, publicOnly: true }).some((p) => /submodules/.test(p)));
  // protected files stay protected for Argon too
  assert.ok(checkProposal({ files: [f("M", "server.js")], diff: "", tests: okTests, baseline, publicOnly: true }).some((p) => /Protected/.test(p)));
});

// ---- the whole flow with a fake Argon editor ----

test("Argon happy path: a page-only change is ready, uses the Argon editor only, and approve merges without pushing", async () => {
  const s = setup(({ worktree, onProgress }) => { onProgress("Editing index.html"); write(worktree, "public/index.html", "<title>Bot</title>\n<p>hello!</p>\n"); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "ready", done.note);
    assert.deepStrictEqual(done.files.map((f) => f.path), ["public/index.html"]);
    assert.deepStrictEqual(s.calls, { claude: 0, argon: 1 });
    assert.strictEqual(done.model, "argon");
    const approved = await s.manager.approve(done.id);
    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.needsRestart, false);
    assert.match(read(s.repoDir, "public/index.html"), /hello!/);
    assert.match(git(s.repoDir, "log", "-1", "--format=%B"), /Gemini 4 Argon, page only/);
  } finally { s.cleanup(); }
});

test("Argon result touching a file outside public/ is blocked after the retries, and cannot be approved", async () => {
  const s = setup(({ worktree }) => { write(worktree, "public/index.html", "<p>x</p>\n"); write(worktree, "greet.js", 'module.exports = () => "changed";\n'); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "blocked");
    assert.ok(done.blocked.some((p) => /only change files under public\/.*greet\.js/.test(p)), done.blocked.join("|"));
    assert.strictEqual(s.calls.argon, 3); // it gets its normal retries
    await assert.rejects(s.manager.approve(done.id), /blocked|ready/);
    assert.match(read(s.repoDir, "greet.js"), /hello/);
  } finally { s.cleanup(); }
});

test("Argon: a retry that undoes the outside change passes (feedback names public/ only)", async () => {
  let n = 0, feedback = "";
  const s = setup(({ worktree, feedback: fb }) => {
    n++;
    if (n === 1) { write(worktree, "public/index.html", "<p>x</p>\n"); write(worktree, "evil.js", "1\n"); }
    else { feedback = fb; fs.rmSync(path.join(worktree, "evil.js")); }
  });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "ready", done.note);
    assert.match(feedback, /only change files under public\//);
    assert.deepStrictEqual(done.files.map((f) => f.path), ["public/index.html"]);
  } finally { s.cleanup(); }
});

test("Argon: deleting or renaming a file out of public/ is refused", async () => {
  const s = setup(({ worktree }) => { const from = path.join(worktree, "public", "index.html"); if (fs.existsSync(from)) fs.renameSync(from, path.join(worktree, "moved.html")); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "blocked", done.note);
    assert.ok(done.blocked.some((p) => /moved\.html/.test(p) && /index\.html/.test(p) === false || /moved\.html/.test(p)), done.blocked.join("|"));
  } finally { s.cleanup(); }
  const t = setup(({ worktree }) => { fs.rmSync(path.join(worktree, "greet.js"), { force: true }); write(worktree, "public/ok.css", "a{}\n"); });
  try {
    const done = await run(t);
    assert.strictEqual(done.status, "blocked");
    assert.ok(done.blocked.some((p) => /greet\.js/.test(p)));
  } finally { t.cleanup(); }
});

test("Argon: a new file in public/ is fine", async () => {
  const s = setup(({ worktree }) => write(worktree, "public/extra.css", "body{}\n"));
  try { assert.strictEqual((await run(s)).status, "ready"); } finally { s.cleanup(); }
});

test("Argon writing into your real project (or its .env) stops everything", async () => {
  const s = setup(({ worktree }, project) => { write(worktree, "public/index.html", "<p>x</p>\n"); write(project.repoDir, "stolen.txt", "x"); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "blocked");
    assert.match(done.note, /real project changed/i);
    assert.strictEqual(s.calls.argon, 1); // no retry after a safety failure
  } finally { s.cleanup(); }
  const t = setup(({ worktree }, project) => { write(worktree, "public/index.html", "<p>x</p>\n"); write(project.repoDir, ".env", "SECRET=1\n"); });
  try { // .env is git-ignored in real projects, so git status cannot see it; the snapshot can
    write(t.repoDir, ".gitignore", "data/\n.env\n"); git(t.repoDir, "commit", "-qam", "ignore env");
    const done = await run(t);
    assert.strictEqual(done.status, "blocked");
    assert.match(done.blocked.join("|"), /\.env/);
  } finally { t.cleanup(); }
});

test("Argon changing another private copy, or a file in the work folder, stops everything", async () => {
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

test("Argon pool low: nothing starts, the message says so, no fallback to Claude", async () => {
  const s = setup(() => {}, { lowPools: async () => [{ pool: "Gemini 4 Argon", remaining: 9 }] });
  try {
    await assert.rejects(s.manager.start("x", { model: "argon" }), /Argon is nearly used up \(9% left\).*Nothing was sent to Claude/s);
    assert.deepStrictEqual(s.calls, { claude: 0, argon: 0 });
    assert.strictEqual(s.manager.isActive(), false);
    assert.strictEqual(fs.existsSync(s.workRoot), false); // not even a private copy was made
  } finally { s.cleanup(); }
  // a low CLAUDE pool does not stop Argon (that is the point)
  const t = setup(({ worktree }) => write(worktree, "public/a.css", "a{}\n"), { lowPools: async () => [{ pool: "Claude plan", remaining: 1 }] });
  try { assert.strictEqual((await run(t)).status, "ready"); } finally { t.cleanup(); }
});

test("Argon failure is reported plainly and never falls back to the Claude editor", async () => {
  const s = setup(() => { throw new Error("Argon could not do this: its quota ran out. Nothing was sent to Claude and nothing in your project changed."); });
  try {
    const done = await run(s);
    assert.strictEqual(done.status, "failed");
    assert.match(done.note, /Argon could not do this/);
    assert.deepStrictEqual(s.calls, { claude: 0, argon: 1 });
    assert.deepStrictEqual(git(s.repoDir, "branch", "--list", "selfedit/*"), ""); // cleaned up
  } finally { s.cleanup(); }
});

test("Argon follow-up continues on the same copy with the same checks; a bad follow-up is undone", async () => {
  let n = 0;
  const s = setup(({ worktree }) => {
    n++;
    if (n === 1) write(worktree, "public/index.html", "<p>one</p>\n");
    else if (n === 2) write(worktree, "public/index.html", "<p>two</p>\n");
    else write(worktree, "greet.js", "// outside\nmodule.exports = () => 'hello';\n");
  });
  try {
    const first = await run(s);
    assert.strictEqual(first.status, "ready");
    const second = await (await s.manager.followUp(first.id, "now say two")).finished;
    assert.strictEqual(second.status, "ready");
    assert.match(second.diff, /two/);
    const third = await (await s.manager.followUp(first.id, "also change greet.js")).finished;
    assert.strictEqual(third.status, "ready"); // the bad follow-up was undone
    assert.match(third.note, /undone/);
    assert.match(s.manager.get(first.id).diff, /two/);
    assert.strictEqual(s.calls.claude, 0);
  } finally { s.cleanup(); }
});

// ---- the Claude path is unchanged ----

test("Claude editor path: still used for sonnet/opus, still may change files outside public/, Argon never called", async () => {
  const s = setup(() => assert.fail("argon must not run"), { claudeFn: ({ worktree, model }) => { assert.strictEqual(model, "sonnet"); write(worktree, "greet.js", 'module.exports = () => "hello";\n// note\n'); } });
  try {
    const done = await run(s, "tweak the greeting", "sonnet");
    assert.strictEqual(done.status, "ready", done.note);
    assert.deepStrictEqual(done.files.map((f) => f.path), ["greet.js"]);
    assert.deepStrictEqual(s.calls, { claude: 1, argon: 0 });
    assert.match((await s.manager.approve(done.id)).note, /not pushed/);
  } finally { s.cleanup(); }
});

test("Claude editor path: does not ask the quota, does not look at the work folder", async () => {
  let asked = 0;
  const s = setup(() => {}, { lowPools: async () => { asked++; return [{ pool: "Gemini 4 Argon", remaining: 1 }]; }, claudeFn: ({ worktree }) => write(worktree, "public/a.css", "a{}\n") });
  try { assert.strictEqual((await run(s, "x", "sonnet")).status, "ready"); assert.strictEqual(asked, 0); } finally { s.cleanup(); }
});

// ---- the real Argon editor, with a FAKE agy program ----

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
    fs.writeFileSync(cwd + "/public/index.html", "<p>argon</p>\\n");
    tool("edit_file", { Path: cwd + "/public/index.html" });
    out({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "Done." } });
    out({ event: "result", result: { status: "SUCCESS", response: "Changed the page." } });
  } else if (scenario === "shell-once" && !fs.existsSync(process.env.FAKE_AGY_LOG + ".n")) { fs.writeFileSync(process.env.FAKE_AGY_LOG + ".n", "1"); tool("run_command", { CommandLine: "ls" }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "shell-once") { tool("edit_file", { Path: cwd + "/public/index.html" }); fs.writeFileSync(cwd + "/public/index.html", "<p>second try</p>\\n"); out({ event: "result", result: { status: "SUCCESS", response: "Second try worked." } }); }
  else if (scenario === "shell") { tool("run_command", { CommandLine: "echo hi" }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "outside") { tool("write_file", { Path: process.env.FAKE_AGY_OUTSIDE }); setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "oops" } }), 3000); }
  else if (scenario === "denied") out({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "RunCommand" }] } });
  else if (scenario === "limit") out({ event: "result", result: { status: "ERROR", error: "RESOURCE_EXHAUSTED: quota exceeded for Gemini 4 Argon", response: "" } });
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
  const editor = makeArgonEditor({ command: process.execPath, prefixArgs: [script], noteFailure: (m, msg) => failures.push({ m, msg }), ...extra });
  return { dir, wtDir, log, editor, failures, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { /* Windows may still hold the folder for a moment */ } } };
}

test("real Argon editor (fake agy): safe flags, prompt through stdin, private TEMP, progress lines", async () => {
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
    assert.ok(log.includes("only read files in this folder and change files INSIDE public/"));
    assert.deepStrictEqual(seen.slice(0, 2), ["Reading index.html", "Editing index.html"]);
    assert.ok(seen.includes("Argon is thinking and writing..."));
    assert.strictEqual(fs.readFileSync(path.join(f.wtDir, "public", "index.html"), "utf8"), "<p>argon</p>\n");
  } finally { f.cleanup(); }
});

test("real Argon editor (fake agy): a shell command or an outside path stops the run with a plain message", async () => {
  for (const [scenario, pattern] of [["shell", /tool "run_command", which is not allowed/], ["outside", /outside the private copy/], ["denied", /not allowed \(RunCommand\)/]]) {
    const f = fakeAgy(scenario);
    try {
      const started = Date.now();
      await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), (error) => {
        assert.match(error.message, /^Argon could not do this:/);
        assert.match(error.message, pattern);
        assert.match(error.message, /Nothing was sent to Claude/);
        return true;
      }, scenario);
      assert.ok(Date.now() - started < 2900, "it was stopped at once (both tries), not after the fake agy's own delay");
    } finally { f.cleanup(); }
  }
});

test("real Argon editor (fake agy): errors are plain, tell the quota module, and never mention a fallback", async () => {
  for (const scenario of ["limit", "crash"]) {
    const f = fakeAgy(scenario);
    try {
      await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), /Argon could not do this: .*pick Sonnet yourself/s, scenario);
      assert.strictEqual(f.failures.length, 1);
      assert.strictEqual(f.failures[0].m.provider, "agy");
    } finally { f.cleanup(); }
  }
  const f = fakeAgy("limit");
  try { await assert.rejects(f.editor({ worktree: f.wtDir, request: "x" }), /RESOURCE_EXHAUSTED/); } finally { f.cleanup(); }
});

test("real Argon editor: the model name is checked before anything starts", async () => {
  const f = fakeAgy("good");
  try { await assert.rejects(f.editor({ worktree: f.wtDir, request: "x", model: "bad name; rm" })); } finally { f.cleanup(); }
});

test("real Argon editor (fake agy): trying a shell command once is forgiven with one reminder; the prompt lists the files and says there is no shell", async () => {
  const f = fakeAgy("shell-once");
  try {
    const seen = [];
    const summary = await f.editor({ worktree: f.wtDir, request: "x", onProgress: (t) => seen.push(t) });
    assert.strictEqual(summary, "Second try worked.");
    assert.ok(seen.some((t) => /asking it again/.test(t)));
    const log = fs.readFileSync(f.log, "utf8");
    assert.ok(log.includes("Files in public/ (these you may change): public/index.html"), "the prompt lists the files");
    assert.ok(log.includes("There is no command tool"), "the second try carries the reminder");
    assert.strictEqual(f.failures.length, 0); // a forgiven try is not a quota failure
  } finally { f.cleanup(); }
});
