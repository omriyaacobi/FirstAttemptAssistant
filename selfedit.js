// selfedit.js
// Lets Bot propose changes to its OWN code, safely. The idea: a model never
// edits your live files. Instead:
//
//   1. start()    makes a private copy of the project (a "git worktree" on a new branch, in a
//                 temp folder) and runs an editor model there. The editor can only read and
//                 edit files in that copy (the claude CLI's --restricted mode).
//   2. checks     code (not the model) inspects the result: protected files, test results,
//                 test count, and whether anything outside the copy was touched.
//   3. you        review the diff and test results in the web page.
//   4. approve()  merges the branch into your project with a fast-forward only and NEVER
//                 pushes to GitHub. reject() just throws the copy away.
//
// Every safety rule below is enforced in code, so it holds even if the editor model ignores
// its instructions.

const { execFile, exec } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ID_PATTERN } = require("./store");

// Files and folders the editor may never change. server.js holds the web security checks,
// store.js validates conversation ids, selfedit.js is this safety gate itself, and the rest
// protect secrets, git, and your private chats.
const PROTECTED_FILES = ["server.js", "selfedit.js", "store.js", ".gitignore", ".gitattributes", "start-web.cmd"];
const PROTECTED_PREFIXES = [".git/", ".github/", "data/", "node_modules/"];

function isProtected(file) {
  const p = file.replace(/\\/g, "/").toLowerCase();
  return PROTECTED_FILES.includes(p) || PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix)) || /(^|\/)\.env/.test(p);
}

const MAX_REQUEST_CHARS = 4000;
const MAX_FILES = 25;
const MAX_DIFF_CHARS = 300000;
const EDITOR_TIMEOUT_MS = 20 * 60 * 1000;

const EDITOR_RULES = `You are improving the source code of a small Node.js project (Bot, a program that routes tasks between Claude and Gemini) in the current folder.

Make the change the user asks for. Keep it as small and clear as you can, in the project's existing style (plain-English comments, no new dependencies, only Node's built-in modules).

You can only read and edit files in this folder. You cannot run commands, so add or update tests for what you change (the project uses Node's built-in test runner; test files end in .test.js) and reason carefully about whether they will pass.

Do not touch these files: server.js, selfedit.js, store.js, .gitignore, start-web.cmd, anything inside data/ or .git/. Changes to them are rejected automatically. Never delete or weaken existing tests. Never add secrets.

When you finish, reply with a short summary (3 to 6 lines): what you changed, why, and anything the user should check.`;

// ---- Small helpers ----

const git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-c", "core.quotepath=false", ...args], { cwd, maxBuffer: 5e7 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`git ${args[0]} failed: ${String(stderr || error.message).trim().slice(0, 300)}`));
      resolve(String(stdout));
    });
  });

function parseTestSummary(output) {
  const num = (name) => {
    const match = output.match(new RegExp(`^ℹ ${name} (\\d+)`, "m"));
    return match ? Number(match[1]) : null;
  };
  return { total: num("tests"), failed: num("fail") };
}

// Runs the project's tests in a folder. Never rejects: failures come back as ok: false.
function nodeTests(cwd) {
  // When this code itself runs inside "node --test", Node marks the environment so that
  // child processes think they are test workers. Remove that mark or the inner run misbehaves.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    execFile(process.execPath, ["--test", "--test-reporter=spec"], { cwd, env, timeout: 240000, maxBuffer: 5e7 }, (error, stdout, stderr) => {
      const output = String(stdout) + String(stderr);
      const { total, failed } = parseTestSummary(output);
      resolve({ ok: !error && failed === 0 && total > 0, total, failed, tail: output.trim().split("\n").slice(-25).join("\n") });
    });
  });
}

// The real editor: the claude CLI in --restricted mode, working inside the private copy.
// --tools limits it to reading and editing files; --permission-prompts none means anything
// not allowed is refused automatically instead of asking.
function claudeEditor({ worktree, request, model }) {
  const { CLAUDE_CMD } = require("./providers");
  if (!/^[\w.-]+$/.test(model)) return Promise.reject(new Error("bad model name"));
  const cmd = `${CLAUDE_CMD} -p --model ${model} --restricted --tools "Read,Glob,Grep,Edit,Write" --permission-mode acceptEdits --permission-prompts none --no-session-persistence`;
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { cwd: worktree, timeout: EDITOR_TIMEOUT_MS, maxBuffer: 1e7 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 300)));
      resolve(String(stdout).trim());
    });
    child.stdin.end(`${EDITOR_RULES}\n\nThe change the user wants:\n${request}`);
  });
}

// ---- The self-edit manager ----

function createSelfEdit({
  repoDir,
  dataDir,
  workRoot = path.join(os.tmpdir(), "bot-selfedit"),
  editor = claudeEditor,
  runTests = nodeTests,
} = {}) {
  const recordsDir = path.join(dataDir, "selfedit");
  let active = null; // id of the proposal being worked on right now (one at a time)

  const fileFor = (id) => path.join(recordsDir, id + ".json");
  const workDir = (id) => path.join(workRoot, id);
  const branchFor = (id) => `selfedit/${id}`;

  function save(record) {
    fs.mkdirSync(recordsDir, { recursive: true });
    const temp = fileFor(record.id) + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(record));
    fs.renameSync(temp, fileFor(record.id));
    return record;
  }

  function load(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null; // the id becomes part of a path
    try {
      return JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
    } catch (error) {
      return null;
    }
  }

  // Removes the private copy and its branch. Errors are ignored: it may already be gone.
  async function cleanup(id) {
    await git(repoDir, ["worktree", "remove", "--force", workDir(id)]).catch(() => {});
    await git(repoDir, ["branch", "-D", branchFor(id)]).catch(() => {});
    await git(repoDir, ["worktree", "prune"]).catch(() => {});
    fs.rmSync(workDir(id), { recursive: true, force: true });
  }

  const mainTreeStatus = async () => (await git(repoDir, ["status", "--porcelain", "--untracked-files=all"])).trim();

  // Does the actual work in the background, then saves the outcome on the record.
  async function work(record) {
    const id = record.id;
    const wt = workDir(id);
    const finish = (changes) => save(Object.assign(record, changes, { finishedAt: Date.now() }));
    try {
      fs.mkdirSync(workRoot, { recursive: true });
      await git(repoDir, ["worktree", "add", "-b", branchFor(id), wt, "HEAD"]);

      // The tests must pass BEFORE the edit, otherwise we cannot tell who broke what.
      const baseline = await runTests(wt);
      if (!baseline.ok) {
        await cleanup(id);
        return finish({ status: "failed", note: "The project's own tests fail before any change, so editing was not started.", tests: { baseline } });
      }

      const started = Date.now();
      const summary = await editor({ worktree: wt, request: record.request, model: record.model });
      const editorSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

      // The editor was only supposed to touch its private copy. Check that it did.
      const leaked = await mainTreeStatus();
      if (leaked) {
        await cleanup(id);
        return finish({ status: "blocked", note: "Files in your real project changed while the editor ran. Nothing was merged. Check with git status.", blocked: [`Real project changed: ${leaked.split("\n").slice(0, 5).join("; ")}`], summary, editorSeconds });
      }

      await git(wt, ["add", "-A"]);
      const nameStatus = (await git(wt, ["diff", "--cached", "--name-status", "--no-renames", "HEAD"])).trim();
      if (!nameStatus) {
        await cleanup(id);
        return finish({ status: "failed", note: "The editor made no changes.", summary, editorSeconds });
      }
      const files = nameStatus.split("\n").map((line) => {
        const [status, ...rest] = line.split("\t");
        return { status, path: rest.join("\t") };
      });
      const diff = await git(wt, ["diff", "--cached", "--no-renames", "HEAD"]);
      const treeHash = (await git(wt, ["write-tree"])).trim();

      const tests = await runTests(wt);
      tests.baselineTotal = baseline.total;

      // Rules enforced by code. Any of these makes the proposal impossible to approve.
      const blocked = [];
      const touched = files.filter((f) => isProtected(f.path)).map((f) => f.path);
      if (touched.length) blocked.push(`Protected files were changed: ${touched.join(", ")}`);
      if (files.length > MAX_FILES) blocked.push(`Too many files changed (${files.length}, the limit is ${MAX_FILES})`);
      if (diff.length > MAX_DIFF_CHARS) blocked.push("The change is too large to review in the page");
      if (!tests.ok) blocked.push("The tests do not pass");
      else if (tests.total < baseline.total) blocked.push(`The number of tests dropped from ${baseline.total} to ${tests.total}`);

      const result = { files, diff: diff.slice(0, MAX_DIFF_CHARS), treeHash, tests, summary, editorSeconds, blocked };
      if (blocked.length) {
        await cleanup(id);
        return finish({ ...result, status: "blocked", note: "The change cannot be approved (see the reasons)." });
      }
      return finish({ ...result, status: "ready", note: "Ready for your review." });
    } catch (error) {
      await cleanup(id);
      return finish({ status: "failed", note: String(error.message).slice(0, 500) });
    } finally {
      active = null;
    }
  }

  // Starts a proposal. Returns { record, finished } where "finished" resolves when the work ends.
  async function start(request, { model = "sonnet" } = {}) {
    if (typeof request !== "string" || !request.trim()) throw new Error("describe the change you want");
    if (request.length > MAX_REQUEST_CHARS) throw new Error(`the request is longer than ${MAX_REQUEST_CHARS} characters`);
    if (!/^[\w.-]+$/.test(model)) throw new Error("bad model name");
    if (active) throw new Error("another proposal is still running");
    if (await mainTreeStatus()) throw new Error("your project has uncommitted changes; commit or stash them first so the proposal starts from a clean state");

    const id = crypto.randomBytes(8).toString("hex");
    const record = save({
      id,
      request: request.trim(),
      model,
      status: "running",
      note: "The editor is working in a private copy...",
      baseCommit: (await git(repoDir, ["rev-parse", "HEAD"])).trim(),
      createdAt: Date.now(),
    });
    active = id;
    const finished = work(record);
    finished.catch(() => {}); // a failure is saved on the record; never let it crash the server
    return { record, finished };
  }

  function get(id) {
    const record = load(id);
    if (record && record.status === "running" && active !== id) {
      // the server was restarted while this one was running
      return save(Object.assign(record, { status: "failed", note: "The server restarted while this was running.", finishedAt: Date.now() }));
    }
    return record;
  }

  function list() {
    if (!fs.existsSync(recordsDir)) return [];
    return fs
      .readdirSync(recordsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => get(name.slice(0, -5)))
      .filter(Boolean)
      .map(({ id, request, status, note, createdAt, files }) => ({ id, request: request.slice(0, 120), status, note, createdAt, fileCount: files ? files.length : 0 }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Merges an approved proposal into the project. Never pushes anything.
  async function approve(id) {
    const record = get(id);
    if (!record) throw new Error("proposal not found");
    if (record.status !== "ready") throw new Error(`this proposal is "${record.status}", only "ready" ones can be approved`);
    if (record.blocked && record.blocked.length) throw new Error("this proposal is blocked");
    if (active) throw new Error("another proposal is still running");

    // The project must be exactly where the proposal started, and clean.
    const head = (await git(repoDir, ["rev-parse", "HEAD"])).trim();
    if (head !== record.baseCommit) throw new Error("your project has new commits since this proposal started; reject it and start again");
    if (await mainTreeStatus()) throw new Error("your project has uncommitted changes; commit or stash them first");

    // What gets merged must be exactly what was reviewed and tested.
    const wt = workDir(id);
    await git(wt, ["add", "-A"]);
    if ((await git(wt, ["write-tree"])).trim() !== record.treeHash) throw new Error("the private copy changed after it was tested; reject it and start again");

    const title = record.request.replace(/\s+/g, " ").slice(0, 60);
    await git(wt, ["commit", "-q", "-m", `Self-edit: ${title}\n\nProposed by Bot (Claude ${record.model}), reviewed and approved by the user in the web page.\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`]);
    await git(repoDir, ["merge", "--ff-only", "-q", branchFor(id)]);
    const mergedCommit = (await git(repoDir, ["rev-parse", "HEAD"])).trim();
    await cleanup(id);

    const needsRestart = record.files.some((f) => !f.path.startsWith("public/") && !f.path.endsWith(".md"));
    return save(Object.assign(record, { status: "approved", note: "Merged into your project (not pushed to GitHub).", mergedCommit, needsRestart, finishedAt: Date.now() }));
  }

  async function reject(id) {
    const record = get(id);
    if (!record) throw new Error("proposal not found");
    if (record.status === "running") throw new Error("it is still running");
    await cleanup(id);
    return save(Object.assign(record, { status: "rejected", note: "Thrown away. Nothing was changed.", finishedAt: Date.now() }));
  }

  return { start, get, list, approve, reject, isActive: () => active !== null };
}

module.exports = { createSelfEdit, isProtected, parseTestSummary, PROTECTED_FILES, PROTECTED_PREFIXES, MAX_REQUEST_CHARS, EDITOR_RULES };
