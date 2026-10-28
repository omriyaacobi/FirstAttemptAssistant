// gitops.js
// The only place where Bot talks to GitHub: it can show what is not pushed yet, and push it.
// It is protected from the self-edit editor (see selfedit.js), because pushing makes things
// public: your repo on GitHub is public.
//
// Safety rules, enforced here:
//   - status() only reads; nothing leaves your computer.
//   - push() runs a plain "git push": your current branch to its own GitHub branch. Never
//     --force, so it can never overwrite history on GitHub.
//   - push() refuses if a tracked file looks like a secret (.env, .env.local, ...).
//   - The web page asks you to confirm and shows the exact commits first.

const { execFile } = require("node:child_process");

function createGitOps({ repoDir }) {
  const git = (args, timeout = 30000) =>
    new Promise((resolve, reject) => {
      execFile("git", ["-c", "core.quotepath=false", ...args], { cwd: repoDir, timeout, maxBuffer: 1e7 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 400)));
        resolve(String(stdout) + String(stderr)); // git push reports its progress on stderr
      });
    });

  // What is on this computer but not on GitHub yet.
  async function status() {
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    let upstream = null;
    try {
      upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
    } catch (error) {
      // this branch has no GitHub branch linked to it
    }
    const clean = !(await git(["status", "--porcelain"])).trim();
    let commits = [];
    if (upstream) {
      const log = (await git(["log", "--format=%h%x09%s", `${upstream}..HEAD`])).trim();
      commits = log ? log.split("\n").map((line) => {
        const [hash, ...subject] = line.split("\t");
        return { hash, subject: subject.join("\t") };
      }) : [];
    }
    return { branch, upstream, clean, ahead: commits.length, commits };
  }

  async function push() {
    const before = await status();
    if (!before.upstream) throw new Error("this branch has no GitHub branch to push to");
    if (!before.ahead) throw new Error("nothing to push, GitHub is already up to date");
    const tracked = (await git(["ls-files"])).split("\n").map((f) => f.trim()).filter(Boolean);
    const secrets = tracked.filter((f) => /(^|\/)\.env/i.test(f));
    if (secrets.length) throw new Error(`refusing to push: these tracked files look like secrets: ${secrets.join(", ")}`);
    const output = await git(["push"], 120000);
    return { pushed: before.commits, output: output.trim().slice(-500) };
  }

  return { status, push };
}

module.exports = { createGitOps };
