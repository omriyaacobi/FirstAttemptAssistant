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
// gitops.js is protected because it pushes to GitHub.
const PROTECTED_FILES = ["server.js", "selfedit.js", "store.js", "gitops.js", "auth.js", "preview.js", ".gitignore", ".gitattributes", "start-web.cmd"];
const PROTECTED_PREFIXES = [".git/", ".github/", "data/", "node_modules/"];

function isProtected(file) {
  const p = file.replace(/\\/g, "/").toLowerCase();
  return PROTECTED_FILES.includes(p) || PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix)) || /(^|\/)\.env/.test(p);
}

const MAX_REQUEST_CHARS = 4000;
const MAX_FILES = 25;
const MAX_DIFF_CHARS = 300000;
const EDITOR_TIMEOUT_MS = 20 * 60 * 1000;
// The editor cannot run the tests itself, so its first try often has a mistake. After each try
// the code checks it and, if something is wrong, sends the problems back for another round.
const MAX_ATTEMPTS = 3;

const EDITOR_RULES = `You are improving the source code of a small Node.js project (Bot, a program that routes tasks between Claude and Gemini) in the current folder.

Make the change the user asks for. Keep it as small and clear as you can, in the project's existing style (plain-English comments, no new dependencies, only Node's built-in modules).

You can only read and edit files in this folder. You cannot run commands, so add or update tests for what you change (the project uses Node's built-in test runner; test files end in .test.js) and reason carefully about whether they will pass.

Do not touch these files: server.js, selfedit.js, store.js, gitops.js, .gitignore, start-web.cmd, anything inside data/ or .git/. Changes to them are rejected automatically. Never delete or weaken existing tests. Never add secrets.

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

// Turns one line of the claude CLI's stream (--output-format stream-json) into a short plain-English
// progress line, or null when the line says nothing a person would care about.
function describeStreamLine(line) {
  let event;
  try { event = JSON.parse(line); } catch (error) { return null; }
  if (!event || event.type !== "assistant" || !event.message || !Array.isArray(event.message.content)) return null;
  const parts = [];
  for (const block of event.message.content) {
    const file = String((block.input || {}).file_path || "").split(/[\\/]/).pop();
    if (block.type === "tool_use") {
      if (block.name === "Read") parts.push(`Reading ${file}`);
      else if (block.name === "Edit") parts.push(`Editing ${file}`);
      else if (block.name === "Write") parts.push(`Writing ${file}`);
      else if (block.name === "Glob" || block.name === "Grep") parts.push("Looking through the code");
    } else if (block.type === "text" && block.text && block.text.trim()) {
      parts.push(`Editor: ${block.text.trim().split("\n")[0].slice(0, 140)}`);
    }
  }
  return parts.length ? parts.join(". ") : null;
}

// The real editor: the claude CLI in --restricted mode, working inside the private copy.
// --tools limits it to reading and editing files; --permission-prompts none means anything
// not allowed is refused automatically instead of asking. The stream output lets the page show
// what the editor is doing right now (onProgress), so you can tell it is alive.
function claudeEditor({ worktree, request, model, feedback = "", onProgress = () => {} }) {
  const { CLAUDE_CMD, claudeEnv } = require("./providers");
  if (!/^[\w.-]+$/.test(model)) return Promise.reject(new Error("bad model name"));
  const cmd = `${CLAUDE_CMD} -p --model ${model} --output-format stream-json --verbose --restricted --tools "Read,Glob,Grep,Edit,Write" --permission-mode acceptEdits --permission-prompts none --no-session-persistence`;
  return new Promise((resolve, reject) => {
    let buffer = "";
    let finalText = "";
    let lastText = "";
    const handleLine = (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "result" && typeof event.result === "string") finalText = event.result;
        if (event.type === "assistant" && event.message && Array.isArray(event.message.content)) {
          const text = event.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
          if (text) lastText = text;
        }
      } catch (error) { /* not JSON: ignore */ }
      const said = describeStreamLine(line);
      if (said) onProgress(said);
    };
    const child = exec(cmd, { cwd: worktree, env: claudeEnv(), timeout: EDITOR_TIMEOUT_MS, maxBuffer: 5e7 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 300)));
      if (buffer.trim()) handleLine(buffer);
      resolve((finalText || lastText).trim());
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      lines.forEach(handleLine);
    });
    child.stdin.end(`${EDITOR_RULES}\n\nThe change the user wants:\n${request}${feedback ? "\n\n" + feedback : ""}`);
  });
}

// What the editor is told when its previous try did not pass the checks.
function buildFeedback(problems, tests) {
  let text = "Your previous attempt was checked automatically and has these problems:\n" + problems.map((p) => "- " + p).join("\n");
  if (tests && !tests.ok && tests.tail) text += "\n\nThe end of the test output:\n" + tests.tail;
  return text + "\n\nYour changes so far are still in the files. Fix these problems (undo any change to protected files) while keeping the change the user asked for.";
}

// The rules enforced by code. Returns the list of problems (empty means it passes).
function checkProposal({ files, diff, tests, baseline }) {
  const problems = [];
  const touched = files.filter((f) => isProtected(f.path)).map((f) => f.path);
  if (touched.length) problems.push(`Protected files were changed: ${touched.join(", ")}`);
  if (files.length > MAX_FILES) problems.push(`Too many files changed (${files.length}, the limit is ${MAX_FILES})`);
  if (diff.length > MAX_DIFF_CHARS) problems.push("The change is too large to review in the page");
  if (!tests.ok) problems.push("The tests do not pass");
  else if (tests.total < baseline.total) problems.push(`The number of tests dropped from ${baseline.total} to ${tests.total}`);
  return problems;
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

  // ---- Live progress and the chat ----
  // `progress` is a short list of plain-English lines ("Editing index.html") that the page shows while the
  // editor works, so you can tell it is alive. `chat` is the conversation: your messages and the editor's replies.
  const MAX_PROGRESS = 40;
  const MAX_CHAT_TEXT = 3000;

  function say(record, text) {
    const list = record.progress || (record.progress = []);
    list.push({ at: Date.now(), text });
    if (list.length > MAX_PROGRESS) list.splice(0, list.length - MAX_PROGRESS);
    record.phase = text;
    record.updatedAt = Date.now();
    save(record);
  }

  const addChat = (record, role, text) => (record.chat || (record.chat = [])).push({ role, text: String(text).slice(0, MAX_CHAT_TEXT), at: Date.now() });

  // The editor reports often; saving at most about once a second is plenty.
  function editorSayer(record) {
    let last = 0;
    return (text) => {
      if (Date.now() - last < 800) return;
      last = Date.now();
      say(record, text);
    };
  }

  // One round of editing in the private copy: the editor works, code checks the result, and if
  // something is wrong the editor gets up to MAX_ATTEMPTS tries. Returns one of
  //   { end }      the proposal must stop (a safety failure, or nothing was changed on the first round)
  //   { noChange } a follow-up that changed nothing
  //   { result }   the files, diff, tests and verdict of the last try
  async function editRounds(record, wt, baseline, firstFeedback, { followUp = false } = {}) {
    const id = record.id;
    const started = Date.now();
    const seconds = () => Number(((Date.now() - started) / 1000).toFixed(1));
    const attempts = [];
    let feedback = firstFeedback;
    let summary, files, diff, treeHash, tests, blocked;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        record.note = `Attempt ${attempt} of ${MAX_ATTEMPTS}: the editor is fixing problems found in its last try.`;
        record.attempts = attempts;
        say(record, record.note);
      } else say(record, followUp ? "The editor is reading your message and working on it..." : "The editor is reading the code and making the change...");
      summary = await editor({ worktree: wt, request: record.request, model: record.model, feedback, attempt, onProgress: editorSayer(record) });

      // The editor was only supposed to touch its private copy. If it did not, stop at once:
      // this is a safety failure, not a mistake to retry.
      const leaked = await mainTreeStatus();
      if (leaked) {
        await cleanup(id);
        return { end: { status: "blocked", note: "Files in your real project changed while the editor ran. Nothing was merged. Check with git status.", blocked: [`Real project changed: ${leaked.split("\n").slice(0, 5).join("; ")}`], summary, editorSeconds: seconds(), attempts } };
      }

      say(record, "Checking which files changed...");
      await git(wt, ["add", "-A"]);
      const nameStatus = (await git(wt, ["diff", "--cached", "--name-status", "--no-renames", "HEAD"])).trim();
      if (!nameStatus) {
        if (followUp) return { noChange: true, summary };
        await cleanup(id);
        return { end: { status: "failed", note: "The editor made no changes.", summary, editorSeconds: seconds(), attempts } };
      }
      files = nameStatus.split("\n").map((line) => {
        const [status, ...rest] = line.split("\t");
        return { status, path: rest.join("\t") };
      });
      diff = await git(wt, ["diff", "--cached", "--no-renames", "HEAD"]);
      treeHash = (await git(wt, ["write-tree"])).trim();
      say(record, `Running the tests on the change (${files.length} file${files.length === 1 ? "" : "s"} changed)... this takes a minute or two.`);
      tests = await runTests(wt);
      tests.baselineTotal = baseline.total;

      // Rules enforced by code. Any of these makes the proposal impossible to approve.
      blocked = checkProposal({ files, diff, tests, baseline });
      attempts.push({ attempt, problems: blocked, testsOk: tests.ok, testsTotal: tests.total });
      if (!blocked.length) break;
      feedback = buildFeedback(blocked, tests);
    }
    return { result: { files, diff: diff.slice(0, MAX_DIFF_CHARS), treeHash, tests, summary, editorSeconds: seconds(), blocked, attempts } };
  }

  // Does the first round of work in the background, then saves the outcome on the record.
  async function work(record) {
    const id = record.id;
    const wt = workDir(id);
    const finish = (changes) => save(Object.assign(record, changes, { finishedAt: Date.now() }));
    try {
      fs.mkdirSync(workRoot, { recursive: true });
      say(record, "Making a private copy of Bot to work in...");
      await git(repoDir, ["worktree", "add", "-b", branchFor(id), wt, "HEAD"]);

      // The tests must pass BEFORE the edit, otherwise we cannot tell who broke what.
      say(record, "Running Bot's tests before changing anything...");
      const baseline = await runTests(wt);
      if (!baseline.ok) {
        await cleanup(id);
        return finish({ status: "failed", note: "The project's own tests fail before any change, so editing was not started.", tests: { baseline } });
      }

      const out = await editRounds(record, wt, baseline, "");
      if (out.end) return finish(out.end);
      const { result } = out;
      if (result.blocked.length) {
        await cleanup(id);
        return finish({ ...result, status: "blocked", note: `The change still has problems after ${result.attempts.length} attempt(s), so it cannot be approved (see the reasons).` });
      }
      const tries = result.attempts.length > 1 ? ` (it took the editor ${result.attempts.length} attempts)` : "";
      addChat(record, "bot", result.summary || "Done.");
      say(record, "Done. Ready for you to look at.");
      return finish({ ...result, status: "ready", note: `Ready for your review${tries}.` });
    } catch (error) {
      await cleanup(id);
      return finish({ status: "failed", note: String(error.message).slice(0, 500) });
    } finally {
      active = null;
    }
  }

  // A follow-up message: the editor works on the SAME private copy, so you can steer it like a chat.
  // If the new round breaks the rules, the last good version is put back (it stays approvable).
  async function continueWork(record, message) {
    const id = record.id;
    const wt = workDir(id);
    const good = { treeHash: record.treeHash };
    const finish = (changes) => save(Object.assign(record, changes, { finishedAt: Date.now() }));
    const putBack = async () => {
      await git(wt, ["add", "-A"]);
      await git(wt, ["read-tree", "--reset", "-u", good.treeHash]);
    };
    const recent = (record.chat || []).slice(-8).map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`).join("\n\n");
    const feedback = `You already worked on this request and your changes are still in the files. The conversation so far:\n\n${recent}\n\nThe user has looked at your work and now asks for this further change (keep what they did not ask to change):\n${message}`;
    try {
      const out = await editRounds(record, wt, { total: record.tests.baselineTotal }, feedback, { followUp: true });
      if (out.end) return finish(out.end);
      if (out.noChange) {
        addChat(record, "bot", `I did not change anything. ${out.summary || ""}`.trim());
        say(record, "The editor made no changes this time.");
        return finish({ status: "ready", note: "Ready for your review." });
      }
      const { result } = out;
      if (result.blocked.length) {
        await putBack();
        addChat(record, "bot", `That change did not pass the safety checks, so I put your previous version back. Problems: ${result.blocked.join("; ")}`);
        say(record, "That try failed the checks. Your previous version is back.");
        return finish({ status: "ready", note: "The last follow-up failed the checks and was undone; the version before it is still ready." });
      }
      addChat(record, "bot", result.summary || "Done.");
      say(record, "Done. Ready for you to look at.");
      return finish({ ...result, status: "ready", note: "Ready for your review." });
    } catch (error) {
      try {
        await putBack();
      } catch (restoreError) {
        await cleanup(id);
        return finish({ status: "failed", note: `${String(error.message).slice(0, 300)} (and the previous version could not be restored)` });
      }
      addChat(record, "bot", `Something went wrong: ${String(error.message).slice(0, 300)}. Your previous version is back.`);
      say(record, "That try failed. Your previous version is back.");
      return finish({ status: "ready", note: "The last follow-up failed and was undone; the version before it is still ready." });
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
      roundStartedAt: Date.now(),
      chat: [{ role: "user", text: request.trim(), at: Date.now() }],
      progress: [],
    });
    active = id;
    const finished = work(record);
    finished.catch(() => {}); // a failure is saved on the record; never let it crash the server
    return { record, finished };
  }

  // Sends a follow-up message to a proposal that is ready. Returns { record, finished } like start().
  async function followUp(id, message) {
    if (typeof message !== "string" || !message.trim()) throw new Error("write what you want changed");
    if (message.length > MAX_REQUEST_CHARS) throw new Error(`the message is longer than ${MAX_REQUEST_CHARS} characters`);
    const record = get(id);
    if (!record) throw new Error("proposal not found");
    if (active) throw new Error("another proposal is still running");
    if (record.status !== "ready") throw new Error(`this proposal is "${record.status}", only "ready" ones can continue`);
    if ((await git(repoDir, ["rev-parse", "HEAD"])).trim() !== record.baseCommit) throw new Error("your project has new commits since this proposal started; reject it and start again");
    if (await mainTreeStatus()) throw new Error("your project has uncommitted changes; commit or stash them first");

    addChat(record, "user", message.trim());
    record.status = "running";
    record.note = "The editor is working on your message...";
    record.progress = [];
    record.roundStartedAt = Date.now();
    delete record.finishedAt;
    save(record);
    active = id;
    const finished = continueWork(record, message.trim());
    finished.catch(() => {});
    return { record, finished };
  }

  // The folder holding the changed page, for the Preview button. Only while the copy is ready and untouched.
  function previewDir(id) {
    const record = get(id);
    if (!record || record.status !== "ready") return null;
    const dir = path.join(workDir(id), "public");
    return fs.existsSync(dir) ? dir : null;
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

  return { start, followUp, previewDir, get, list, approve, reject, isActive: () => active !== null };
}

module.exports = { createSelfEdit, describeStreamLine, isProtected, parseTestSummary, buildFeedback, PROTECTED_FILES, PROTECTED_PREFIXES, MAX_REQUEST_CHARS, MAX_ATTEMPTS, EDITOR_RULES };
