// tests/pc-open.test.js
// Opening things on the PC (pc-open.js): documents, code, folders and https pages only; never a program, a script or a shortcut.
// A FAKE spawn records what would start, so no test opens a real window.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOpener, checkLocal, checkWeb, moodleUrl } = require("../pc-open");

const PROGRAMS = { chrome: "C:\\fake\\chrome.exe", code: "C:\\fake\\Code.exe", notepad: "C:\\fake\\notepad.exe", explorer: "C:\\fake\\explorer.exe" };
function fake() {
  const started = [];
  const spawn = (exe, args, opts) => { started.push({ exe, args, opts }); return { on() {}, unref() {} }; };
  return { started, opener: createOpener({ spawn, programs: PROGRAMS, tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), "bot-open-test-")) }) };
}
function dir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-pcopen-"));
  for (const n of ["lecture.pdf", "main.py", "notes.md", "Makefile", "evil.exe", "run.cmd", "go.bat", "x.ps1", "y.vbs", "setup.msi", "link.lnk", "site.url", "s.scr", "macro.docm", "noext", "weird.xyz"]) fs.writeFileSync(path.join(root, n), "x");
  fs.mkdirSync(path.join(root, "ex3"));
  return root;
}

test("documents open in their normal app, code only in VS Code, folders in Explorer; never through a shell", () => {
  const root = dir();
  const { started, opener } = fake();
  assert.strictEqual(opener.openLocal(path.join(root, "lecture.pdf")).how, "its normal app");
  assert.strictEqual(opener.openLocal(path.join(root, "main.py")).how, "VS Code"); // the default action of .py could RUN it
  assert.strictEqual(opener.openLocal(path.join(root, "Makefile")).how, "VS Code");
  assert.strictEqual(opener.openLocal(path.join(root, "ex3")).how, "Explorer");
  assert.deepStrictEqual(started.map((s) => s.exe), [PROGRAMS.explorer, PROGRAMS.code, PROGRAMS.code, PROGRAMS.explorer]);
  for (const s of started) {
    assert.strictEqual(s.opts.shell, false);
    assert.strictEqual(s.args.length, 1); // the target is ONE argument, nothing built around it
  }
});

test("programs, scripts, shortcuts, macro files and unknown types are refused, and nothing starts", () => {
  const root = dir();
  const { started, opener } = fake();
  for (const n of ["evil.exe", "run.cmd", "go.bat", "x.ps1", "y.vbs", "setup.msi", "link.lnk", "site.url", "s.scr", "macro.docm", "noext", "weird.xyz"]) {
    assert.throws(() => opener.openLocal(path.join(root, n)), /does not open/, n);
  }
  assert.strictEqual(started.length, 0);
});

test("path tricks are refused: relative, network, a hidden stream, quotes, missing files", () => {
  const root = dir();
  assert.throws(() => checkLocal("lecture.pdf"), /full local path/);
  assert.throws(() => checkLocal("\\\\server\\share\\a.pdf"), /full local path/);
  assert.throws(() => checkLocal(path.join(root, "lecture.pdf") + ":evil.exe"), /hidden part/);
  assert.throws(() => checkLocal(path.join(root, 'a".pdf')), /character/);
  assert.throws(() => checkLocal(path.join(root, "nothere.pdf")), /does not exist/);
});

test("a link called .pdf that really points to a program is judged by where it really points", (t) => {
  const root = dir();
  const fake1 = path.join(root, "trick.pdf");
  try { fs.symlinkSync(path.join(root, "evil.exe"), fake1, "file"); } catch (error) { t.skip("this Windows user may not create file links"); return; }
  assert.throws(() => checkLocal(fake1), /does not open/);
});

test("a folder junction is opened only as the real folder it points to", () => {
  const root = dir();
  const j = path.join(root, "jump");
  fs.symlinkSync(path.join(root, "ex3"), j, "junction");
  assert.strictEqual(checkLocal(j).real, fs.realpathSync(path.join(root, "ex3")));
});

test("web pages: https only, public sites only, always in Chrome", () => {
  const { started, opener } = fake();
  assert.strictEqual(opener.openUrl("https://moodle.bgu.ac.il/moodle/course/view.php?id=5").how, "Chrome");
  assert.strictEqual(started[0].exe, PROGRAMS.chrome);
  assert.strictEqual(started[0].args[0], "https://moodle.bgu.ac.il/moodle/course/view.php?id=5");
  for (const bad of ["http://example.com", "file:///C:/Windows/System32/cmd.exe", "https://localhost/x", "https://10.0.0.1/", "https://user:pw@example.com/", "javascript:alert(1)", "https://example.com/a b", "--disable-web-security"]) {
    assert.throws(() => checkWeb(bad), undefined, bad);
  }
  assert.strictEqual(started.length, 1);
});

test("a course file opens from a COPY with its real name, in a private temp folder", () => {
  const root = dir();
  const { started, opener } = fake();
  const original = path.join(root, "a1b2c3.pdf");
  fs.writeFileSync(original, "%PDF");
  const r = opener.openCopy(original, "Lecture 7, part \"2\".pdf");
  assert.match(r.target, /^Lecture 7_ part _2_\.pdf$/);
  assert.notStrictEqual(started[0].args[0], original);
  assert.ok(fs.existsSync(started[0].args[0]));
  assert.throws(() => opener.openCopy(path.join(root, "evil.exe"), "evil.exe"), /does not open/);
});

test("Moodle addresses are built by code from whole numbers and a plain module name", () => {
  assert.strictEqual(moodleUrl({ courseId: 68510 }), "https://moodle.bgu.ac.il/moodle/course/view.php?id=68510");
  assert.strictEqual(moodleUrl({ cmid: 9, module: "assign" }), "https://moodle.bgu.ac.il/moodle/mod/assign/view.php?id=9");
  assert.throws(() => moodleUrl({ cmid: 9, module: "../../evil" }), /not a real item/);
  assert.throws(() => moodleUrl({ cmid: "9", module: "assign" }), /not a real item/);
  assert.throws(() => moodleUrl({ courseId: -1 }), /not a real course/);
});
