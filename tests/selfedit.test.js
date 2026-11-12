// selfedit.test.js
// Tests the self-edit safety gate with REAL temporary git repositories and a FAKE editor
// (so no model is called and no quota is used). Your real project is never touched.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSelfEdit, describeStreamLine, isProtected, parseTestSummary, buildFeedback, MAX_REQUEST_CHARS, MAX_ATTEMPTS } = require("../selfedit");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A tiny project with two passing tests, a protected file (server.js) and a data/ folder.
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-selfedit-test-"));
  const repoDir = path.join(root, "project");
  fs.mkdirSync(repoDir);
  fs.writeFileSync(path.join(repoDir, "greet.js"), 'module.exports = () => "hello";\n');
  fs.writeFileSync(
    path.join(repoDir, "greet.test.js"),
    'const test = require("node:test");\nconst assert = require("node:assert");\nconst greet = require("./greet");\n' +
      'test("greets", () => assert.strictEqual(greet(), "hello"));\ntest("returns a string", () => assert.strictEqual(typeof greet(), "string"));\n'
  );
  fs.writeFileSync(path.join(repoDir, "server.js"), "// protected\n");
  fs.writeFileSync(path.join(repoDir, ".gitignore"), "data/\n");
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "core.autocrlf", "false");
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-q", "-m", "initial");
  return {
    repoDir,
    dataDir: path.join(repoDir, "data"),
    workRoot: path.join(root, "work"),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// Sets up a project and a self-edit manager whose fake editor runs the given function.
function setup(editorFn) {
  const project = makeProject();
  const manager = createSelfEdit({
    repoDir: project.repoDir,
    dataDir: project.dataDir,
    workRoot: project.workRoot,
    editor: async (args) => {
      await editorFn(args, project);
      return "I changed things.";
    },
  });
  return { ...project, manager };
}

const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");
const branches = (repoDir) => git(repoDir, "branch", "--list", "selfedit/*");

// The editor change that is fine: greeting changes and the test is updated to match.
const goodEdit = ({ worktree }) => {
  write(worktree, "greet.js", 'module.exports = () => "hello world";\n');
  write(worktree, "greet.test.js", read(worktree, "greet.test.js").replace('"hello")', '"hello world")'));
};

test("happy path: edit, review, approve merges it without pushing", async () => {
  const s = setup(goodEdit);
  const { record, finished } = await s.manager.start("make the greeting friendlier");
  assert.strictEqual(record.status, "running");
  const done = await finished;

  assert.strictEqual(done.status, "ready", done.note); // the note says why, if it is not ready
  assert.strictEqual(done.tests.ok, true);
  assert.deepStrictEqual(done.files.map((f) => f.path).sort(), ["greet.js", "greet.test.js"]);
  assert.match(done.diff, /\+module\.exports = \(\) => "hello world";/);
  assert.strictEqual(done.summary, "I changed things.");
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello";\n'); // nothing merged yet

  const approved = await s.manager.approve(record.id);
  assert.strictEqual(approved.status, "approved");
  assert.strictEqual(approved.needsRestart, true);
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello world";\n');
  assert.match(git(s.repoDir, "log", "-1", "--format=%s"), /^Self-edit: make the greeting friendlier/);
  assert.strictEqual(git(s.repoDir, "status", "--porcelain"), ""); // clean after the merge
  assert.strictEqual(branches(s.repoDir), ""); // the private branch is gone
  assert.ok(!fs.existsSync(path.join(s.workRoot, record.id))); // and so is the private copy
  assert.strictEqual(git(s.repoDir, "remote"), ""); // there is no remote, so nothing could have been pushed
  s.cleanup();
});

test("a page-only change does not need a restart", async () => {
  const s = setup(({ worktree }) => {
    fs.mkdirSync(path.join(worktree, "public"));
    write(worktree, "public/index.html", "<p>hi</p>\n");
  });
  const { record, finished } = await s.manager.start("add a page");
  await finished;
  assert.strictEqual((await s.manager.approve(record.id)).needsRestart, false);
  s.cleanup();
});

test("SECURITY: changing a protected file blocks the proposal and cleans up", async () => {
  const s = setup(({ worktree }) => write(worktree, "server.js", "// weakened security\n"));
  const { record, finished } = await s.manager.start("tweak the server");
  const done = await finished;
  assert.strictEqual(done.status, "blocked");
  assert.match(done.blocked.join(" "), /Protected files were changed: server\.js/);
  await assert.rejects(s.manager.approve(record.id), /only "ready"/);
  assert.strictEqual(read(s.repoDir, "server.js"), "// protected\n");
  assert.strictEqual(branches(s.repoDir), "");
  s.cleanup();
});

test("SECURITY: a change that makes the tests fail is blocked", async () => {
  const s = setup(({ worktree }) => write(worktree, "greet.js", 'module.exports = () => "oops";\n'));
  const { finished } = await s.manager.start("break it");
  const done = await finished;
  assert.strictEqual(done.status, "blocked");
  assert.match(done.blocked.join(" "), /tests do not pass/);
  s.cleanup();
});

test("SECURITY: deleting a test to make things pass is blocked (the test count may not drop)", async () => {
  const s = setup(({ worktree }) => {
    write(worktree, "greet.js", 'module.exports = () => "oops";\n');
    write(worktree, "greet.test.js", 'const test = require("node:test");\nconst assert = require("node:assert");\ntest("only one left", () => assert.ok(true));\n');
  });
  const { finished } = await s.manager.start("sneaky");
  const done = await finished;
  assert.strictEqual(done.status, "blocked");
  assert.match(done.blocked.join(" "), /number of tests dropped from 2 to 1/);
  s.cleanup();
});

test("SECURITY: if the editor changes files in the real project, nothing is merged and it is not retried", async () => {
  let calls = 0;
  const s = setup(({ worktree }, project) => {
    calls++;
    goodEdit({ worktree });
    write(project.repoDir, "leaked.txt", "written outside the private copy");
  });
  const { finished } = await s.manager.start("escape");
  const done = await finished;
  assert.strictEqual(done.status, "blocked");
  assert.match(done.blocked.join(" "), /Real project changed/);
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello";\n');
  assert.strictEqual(calls, 1); // a safety failure stops at once, no second chance
  s.cleanup();
});

test("retry: a first try that breaks the tests is fixed on the second, using the test output as feedback", async () => {
  const seen = [];
  const s = setup(({ worktree, feedback, attempt }) => {
    seen.push({ attempt, feedback });
    if (attempt === 1) write(worktree, "greet.js", 'module.exports = () => "hello world";\n'); // forgot the test
    else goodEdit({ worktree }); // fixes it
  });
  const { finished } = await s.manager.start("friendlier");
  const done = await finished;
  assert.strictEqual(done.status, "ready", done.note);
  assert.strictEqual(done.attempts.length, 2);
  assert.strictEqual(done.attempts[0].testsOk, false);
  assert.match(done.note, /2 attempts/);
  assert.strictEqual(seen[0].feedback, ""); // the first try gets no feedback
  assert.match(seen[1].feedback, /The tests do not pass/);
  assert.match(seen[1].feedback, /✖ greets/); // the real test output is passed along: which test failed...
  assert.match(seen[1].feedback, /actual: 'hello world'/); // ...and with what value
  s.cleanup();
});

test("retry: a protected file touched by mistake can be undone on the next try", async () => {
  const s = setup(({ worktree, attempt }) => {
    if (attempt === 1) {
      goodEdit({ worktree });
      write(worktree, "server.js", "// oops\n");
    } else {
      write(worktree, "server.js", "// protected\n"); // put it back exactly as it was
    }
  });
  const { finished } = await s.manager.start("friendlier");
  const done = await finished;
  assert.strictEqual(done.status, "ready", done.note);
  assert.deepStrictEqual(done.files.map((f) => f.path).sort(), ["greet.js", "greet.test.js"]);
  s.cleanup();
});

test("retry: it gives up after the last attempt and the editor was asked that many times", async () => {
  let calls = 0;
  const s = setup(({ worktree }) => {
    calls++;
    write(worktree, "greet.js", 'module.exports = () => "never right";\n');
  });
  const { finished } = await s.manager.start("hopeless");
  const done = await finished;
  assert.strictEqual(done.status, "blocked");
  assert.strictEqual(calls, MAX_ATTEMPTS);
  assert.strictEqual(done.attempts.length, MAX_ATTEMPTS);
  assert.match(done.note, new RegExp(`after ${MAX_ATTEMPTS} attempt`));
  s.cleanup();
});

test("buildFeedback lists the problems and includes failing test output", () => {
  const text = buildFeedback(["The tests do not pass"], { ok: false, tail: "ℹ fail 2" });
  assert.match(text, /- The tests do not pass/);
  assert.match(text, /ℹ fail 2/);
  assert.doesNotMatch(buildFeedback(["Protected files were changed: server.js"], { ok: true, tail: "ℹ fail 0" }), /test output/);
});

test("an editor that makes no changes is reported as failed", async () => {
  const s = setup(() => {});
  const { finished } = await s.manager.start("do nothing");
  const done = await finished;
  assert.strictEqual(done.status, "failed");
  assert.match(done.note, /no changes/);
  s.cleanup();
});

test("an editor that throws is reported as failed and cleaned up", async () => {
  const s = setup(() => { throw new Error("editor crashed"); });
  const { finished } = await s.manager.start("crash");
  const done = await finished;
  assert.strictEqual(done.status, "failed");
  assert.match(done.note, /editor crashed/);
  assert.strictEqual(branches(s.repoDir), "");
  assert.strictEqual(s.manager.isActive(), false);
  s.cleanup();
});

test("if the project's tests already fail, editing is not started", async () => {
  const s = setup(goodEdit);
  write(s.repoDir, "greet.js", 'module.exports = () => "broken";\n');
  git(s.repoDir, "commit", "-q", "-am", "break the project");
  const { finished } = await s.manager.start("anything");
  const done = await finished;
  assert.strictEqual(done.status, "failed");
  assert.match(done.note, /fail before any change/);
  s.cleanup();
});

test("starting is refused when the project has uncommitted changes", async () => {
  const s = setup(goodEdit);
  write(s.repoDir, "notes.txt", "uncommitted");
  await assert.rejects(s.manager.start("x"), /uncommitted changes/);
  s.cleanup();
});

test("only one proposal can run at a time", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const s = setup(async ({ worktree }) => { await gate; goodEdit({ worktree }); });
  const first = await s.manager.start("first");
  assert.strictEqual(s.manager.isActive(), true);
  await assert.rejects(s.manager.start("second"), /still running/);
  release();
  await first.finished;
  assert.strictEqual(s.manager.isActive(), false);
  s.cleanup();
});

test("approve is refused if the project got new commits after the proposal started", async () => {
  const s = setup(goodEdit);
  const { record, finished } = await s.manager.start("friendlier");
  await finished;
  write(s.repoDir, "other.txt", "new work");
  git(s.repoDir, "add", "-A");
  git(s.repoDir, "commit", "-q", "-m", "someone committed");
  await assert.rejects(s.manager.approve(record.id), /new commits/);
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello";\n');
  s.cleanup();
});

test("approve is refused if the private copy changed after it was tested", async () => {
  const s = setup(goodEdit);
  const { record, finished } = await s.manager.start("friendlier");
  await finished;
  write(path.join(s.workRoot, record.id), "greet.js", 'module.exports = () => "tampered";\n');
  await assert.rejects(s.manager.approve(record.id), /changed after it was tested/);
  s.cleanup();
});

test("reject throws the copy away and changes nothing", async () => {
  const s = setup(goodEdit);
  const { record, finished } = await s.manager.start("friendlier");
  await finished;
  const rejected = await s.manager.reject(record.id);
  assert.strictEqual(rejected.status, "rejected");
  assert.strictEqual(branches(s.repoDir), "");
  assert.ok(!fs.existsSync(path.join(s.workRoot, record.id)));
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello";\n');
  await assert.rejects(s.manager.approve(record.id), /only "ready"/);
  s.cleanup();
});

test("list shows proposals newest first, and a proposal left 'running' by a dead server becomes failed", async () => {
  const s = setup(goodEdit);
  const { finished } = await s.manager.start("first one");
  await finished;
  const staleId = "0123456789abcdef";
  fs.writeFileSync(path.join(s.dataDir, "selfedit", staleId + ".json"), JSON.stringify({ id: staleId, request: "old", status: "running", createdAt: Date.now() + 1000 }));
  const list = s.manager.list();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, staleId);
  assert.strictEqual(list[0].status, "failed");
  assert.match(list[0].note, /restarted/);
  s.cleanup();
});

test("SECURITY: bad ids never touch the disk", async () => {
  const s = setup(goodEdit);
  for (const bad of ["../x", "..\\x", "", "short", 42, null, undefined]) {
    assert.strictEqual(s.manager.get(bad), null);
    await assert.rejects(s.manager.approve(bad), /not found/);
    await assert.rejects(s.manager.reject(bad), /not found/);
  }
  s.cleanup();
});

test("requests are validated", async () => {
  const s = setup(goodEdit);
  await assert.rejects(s.manager.start("   "), /describe the change/);
  await assert.rejects(s.manager.start("x".repeat(MAX_REQUEST_CHARS + 1)), /longer than/);
  await assert.rejects(s.manager.start("fine", { model: "sonnet; rm -rf /" }), /bad model/);
  s.cleanup();
});

test("parseTestSummary reads node's test summary", () => {
  assert.deepStrictEqual(parseTestSummary("x\nℹ tests 75\nℹ suites 0\nℹ pass 75\nℹ fail 0\n"), { total: 75, failed: 0 });
  assert.deepStrictEqual(parseTestSummary("nothing"), { total: null, failed: null });
});

// ---- Improve Bot as a chat: progress, follow-ups, preview ----

test("describeStreamLine turns the editor's stream into plain words", () => {
  const line = (content) => JSON.stringify({ type: "assistant", message: { content } });
  assert.strictEqual(describeStreamLine(line([{ type: "tool_use", name: "Read", input: { file_path: "C:\\x\\public\\index.html" } }])), "Reading index.html");
  assert.strictEqual(describeStreamLine(line([{ type: "tool_use", name: "Edit", input: { file_path: "/a/b/core.js" } }])), "Editing core.js");
  assert.strictEqual(describeStreamLine(line([{ type: "tool_use", name: "Grep", input: { pattern: "x" } }])), "Looking through the code");
  assert.match(describeStreamLine(line([{ type: "text", text: "Now I will fix the colors\nmore" }])), /^Editor: Now I will fix the colors$/);
  assert.strictEqual(describeStreamLine('{"type":"system"}'), null);
  assert.strictEqual(describeStreamLine("not json"), null);
});

test("progress and chat are recorded while the editor works", async () => {
  const s = setup(({ worktree, onProgress }) => {
    onProgress("Editing greet.js");
    goodEdit({ worktree });
  });
  const { record, finished } = await s.manager.start("friendlier");
  assert.strictEqual(record.chat[0].text, "friendlier");
  const done = await finished;
  assert.ok(done.progress.some((p) => /private copy/.test(p.text)), "says it makes a private copy");
  assert.ok(done.progress.some((p) => /Running the tests/.test(p.text)), "says it runs the tests");
  assert.strictEqual(done.chat[done.chat.length - 1].role, "bot");
  assert.strictEqual(done.chat[done.chat.length - 1].text, "I changed things.");
  s.cleanup();
});

test("a follow-up continues in the SAME private copy and the result can be approved", async () => {
  let call = 0;
  const feedbacks = [];
  const s = setup(({ worktree, feedback }) => {
    feedbacks.push(feedback);
    if (call++ === 0) goodEdit({ worktree });
    else {
      write(worktree, "greet.js", 'module.exports = () => "hello world!";\n');
      write(worktree, "greet.test.js", read(worktree, "greet.test.js").replace('"hello world")', '"hello world!")'));
    }
  });
  const { record, finished } = await s.manager.start("friendlier");
  const first = await finished;
  const treeBefore = first.treeHash;
  const { record: running, finished: finished2 } = await s.manager.followUp(record.id, "add an exclamation mark");
  assert.strictEqual(running.status, "running");
  const second = await finished2;
  assert.strictEqual(second.status, "ready", second.note);
  assert.notStrictEqual(second.treeHash, treeBefore);
  assert.match(feedbacks[1], /add an exclamation mark/);
  assert.match(feedbacks[1], /friendlier/); // the editor is reminded of the conversation
  assert.deepStrictEqual(second.chat.map((m) => m.role), ["user", "bot", "user", "bot"]);
  assert.match(second.diff, /hello world!/);
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello";\n'); // still nothing merged
  await s.manager.approve(record.id);
  assert.strictEqual(read(s.repoDir, "greet.js"), 'module.exports = () => "hello world!";\n');
  s.cleanup();
});

test("SECURITY: a follow-up that breaks the rules is undone and the earlier version stays approvable", async () => {
  let call = 0;
  const s = setup(({ worktree }) => {
    if (call++ === 0) goodEdit({ worktree });
    else write(worktree, "server.js", "// hacked\n"); // protected, on every retry
  });
  const { record, finished } = await s.manager.start("friendlier");
  const first = await finished;
  const second = await (await s.manager.followUp(record.id, "also change server.js")).finished;
  assert.strictEqual(second.status, "ready");
  assert.strictEqual(second.treeHash, first.treeHash);
  assert.match(second.chat[second.chat.length - 1].text, /put your previous version back/);
  assert.strictEqual(read(path.join(s.workRoot, record.id), "server.js"), "// protected\n"); // the bad file is gone again
  const approved = await s.manager.approve(record.id);
  assert.strictEqual(approved.status, "approved");
  assert.strictEqual(read(s.repoDir, "server.js"), "// protected\n");
  s.cleanup();
});

test("a follow-up is refused unless the proposal is ready, while another runs, or with an empty message", async () => {
  const s = setup(goodEdit);
  const { record, finished } = await s.manager.start("friendlier");
  await assert.rejects(s.manager.followUp(record.id, "more"), /still running/);
  await finished;
  await assert.rejects(s.manager.followUp(record.id, "   "), /write what you want/);
  await assert.rejects(s.manager.followUp(record.id, "x".repeat(MAX_REQUEST_CHARS + 1)), /longer than/);
  await assert.rejects(s.manager.followUp("../etc", "more"), /not found/);
  await s.manager.reject(record.id);
  await assert.rejects(s.manager.followUp(record.id, "more"), /only "ready"/);
  s.cleanup();
});

test("previewDir exists only while the copy is ready", async () => {
  const s = setup(({ worktree }) => {
    fs.mkdirSync(path.join(worktree, "public"));
    write(worktree, "public/index.html", "<p>hi</p>\n");
  });
  const { record, finished } = await s.manager.start("add a page");
  assert.strictEqual(s.manager.previewDir(record.id), null); // still running
  await finished;
  const dir = s.manager.previewDir(record.id);
  assert.strictEqual(read(dir, "index.html"), "<p>hi</p>\n");
  assert.strictEqual(s.manager.previewDir("../x"), null);
  await s.manager.reject(record.id);
  assert.strictEqual(s.manager.previewDir(record.id), null);
  s.cleanup();
});

test("the protected list still names files that exist, and a moved file would be noticed", () => {
  const root = path.join(__dirname, "..");
  const { PROTECTED_FILES } = require("../selfedit");
  // .gitattributes is listed on purpose even though the project has none today.
  for (const f of PROTECTED_FILES.filter((x) => x !== ".gitattributes")) assert.ok(fs.existsSync(path.join(root, f)), `${f} is in PROTECTED_FILES but is not at the project root any more`);
  // The pieces the self-edit and the watch depend on stay at the root, where start-web.cmd and the scheduled task run them.
  for (const f of ["server.js", "start-web.cmd", "improve-watch.js", "selfedit.js"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  // Test files live in tests/ and are not protected (Improve Bot may add tests, the watch flags removed checks).
  assert.strictEqual(isProtected("tests/core.test.js"), false);
});

test("isProtected: security files, secrets, git and data are protected; normal files are not", () => {
  for (const file of ["server.js", "SERVER.JS", "selfedit.js", "store.js", "gitops.js", ".gitignore", "start-web.cmd", "data/conversations/a.json", ".git/config", ".env", "config/.env.local", ".github/workflows/x.yml", "node_modules/x/index.js", "data\\x"]) {
    assert.strictEqual(isProtected(file), true, file);
  }
  for (const file of ["public/index.html", "router-brief.md", "router.js", "frontdesk.js", "core.js", "PROGRESS.md", "planner.test.js", "public/server.js", "environment.js"]) {
    assert.strictEqual(isProtected(file), false, file);
  }
});
