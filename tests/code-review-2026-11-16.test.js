// tests/code-review-2026-11-16.test.js
// Tests for what the code review of 2026-11-16 fixed (experiments/2026-11-16-code-review.md). Made-up data only: no model, no network,
// no real window (a fake spawn records what would start).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

// Windows keeps a second, SHORT name for many files ("QUARTE~1.DOC" for "quarterly report.docm"). Returns it, or null when this disk
// keeps none (then the tests that need one are skipped: the trick does not exist there).
function shortNameOf(dir, longName) {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("cmd.exe", ["/d", "/c", "dir", "/x", dir], { encoding: "utf8", windowsHide: true });
    const line = out.split(/\r?\n/).find((l) => l.endsWith(longName));
    const m = line && /\s(\S+~\d+\S*)\s+/.exec(line.slice(0, line.length - longName.length));
    return m ? m[1] : null;
  } catch (error) { return null; }
}

// ---- pc-open.js: the type is judged on the file's full real name ----

test("open_on_pc: a macro file reached through its short Windows name is still refused", (t) => {
  const { checkLocal } = require("../pc-open");
  const dir = tmp("bot-review-open-");
  fs.writeFileSync(path.join(dir, "quarterly report.docm"), "x");
  assert.throws(() => checkLocal(path.join(dir, "quarterly report.docm")), /does not open/);
  const short = shortNameOf(dir, "quarterly report.docm");
  if (!short) return t.skip("this disk keeps no short names");
  assert.match(short, /\.DOC$/i, "the short name ends like a plain document");
  assert.throws(() => checkLocal(path.join(dir, short)), /does not open/, "judged on the real name (.docm), not on the short one");
});

test("open_on_pc: a normal document and a folder still open, and the real name is what is handed on", () => {
  const { checkLocal } = require("../pc-open");
  const dir = tmp("bot-review-open-");
  fs.writeFileSync(path.join(dir, "Lecture 3.pdf"), "x");
  const c = checkLocal(path.join(dir, "lecture 3.PDF")); // typed in another case
  assert.strictEqual(c.kind, "default");
  assert.strictEqual(c.name, "Lecture 3.pdf", "the name on the disk, not the one that was typed");
  assert.strictEqual(checkLocal(dir).kind, "folder");
});

// ---- project-folder.js: a secret stays a secret under its short name ----

test("linked folder: a secret file cannot be read or located through its short Windows name", (t) => {
  const projectFolder = require("../project-folder");
  const dir = tmp("bot-review-folder-");
  fs.writeFileSync(path.join(dir, "credentials-backup.json"), '{"made":"up"}');
  fs.writeFileSync(path.join(dir, "main.c"), "int main(void) { return 0; }\n");
  assert.strictEqual(projectFolder.readFile(dir, "main.c").text.includes("int main"), true, "normal files are read as before");
  assert.throws(() => projectFolder.readFile(dir, "credentials-backup.json"), /secrets/);
  const short = shortNameOf(dir, "credentials-backup.json");
  if (!short) return t.skip("this disk keeps no short names");
  assert.doesNotMatch(short, /credential/i, "the short name hides the word the rule looks for");
  assert.throws(() => projectFolder.readFile(dir, short), /secrets/);
  assert.throws(() => projectFolder.locate(dir, short), /secrets/);
});

// ---- linkfetch.js: only public IPv6 addresses ----

test("links: only real public IPv6 addresses pass; wrapped IPv4 and odd ranges are refused", () => {
  const { isPublicIp } = require("../linkfetch");
  for (const ip of ["2a00:1450:4001:81b::200e", "2606:4700::6810:84e5", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) assert.strictEqual(isPublicIp(ip), true, ip);
  for (const ip of ["::127.0.0.1", "::7f00:1", "::1", "::", "64:ff9b::7f00:1", "100::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002:7f00:1::", "2001::1", "2001:0:1::", "::ffff:10.0.0.1", "::ffff:7f00:1"]) {
    assert.strictEqual(isPublicIp(ip), false, ip);
  }
});

// ---- unzip.js: a type is read from a real ending, with its dot ----

test("zip: a name that only ENDS in the letters of a type is not taken for that type", () => {
  const { classify } = require("../unzip");
  assert.strictEqual(classify("notes/page.html"), "html");
  assert.strictEqual(classify("notes/page.HTM"), "html");
  assert.strictEqual(classify("notes/ahtml"), null, "no dot: not a web page");
  assert.strictEqual(classify("bin/xhtm"), null);
});

// (2026-11-23) The two Argon page-only tests were removed with the Argon editor (Omri's decision); see tests/selfedit-agy.test.js.
