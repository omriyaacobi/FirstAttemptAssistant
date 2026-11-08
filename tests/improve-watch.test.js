// improve-watch.test.js: the checks the daily Improve Bot review does in code.
const test = require("node:test");
const assert = require("node:assert");
const { checkChange, pageProblems } = require("../improve-watch");

const diffOf = (file, ...lines) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...lines].join("\n");

test("a plain page change gives no warning", () => {
  assert.deepStrictEqual(checkChange(["public/index.html"], diffOf("public/index.html", "+  box.textContent = text;", "-  old();")), []);
});

test("protected files, raw HTML, outside scripts and secrets are all flagged", () => {
  assert.match(checkChange(["server.js"], "")[0], /PROTECTED FILE CHANGED: server\.js/);
  assert.match(checkChange([".env"], "")[0], /PROTECTED/);
  assert.match(checkChange(["public/index.html"], diffOf("public/index.html", "+  box.innerHTML = text;"))[0], /raw HTML/);
  assert.match(checkChange(["public/index.html"], diffOf("public/index.html", '+<script src="https://evil.example/x.js"></script>'))[0], /external/);
  assert.match(checkChange(["a.js"], diffOf("a.js", '+const api_key = "abcdefghijklmnop";'))[0], /secret/);
});

test("removing more test checks than were added is flagged; adding is fine, and removing code is not a test", () => {
  assert.match(checkChange(["a.test.js"], diffOf("a.test.js", "-  assert.ok(x);", "-  assert.ok(y);", "+  assert.ok(z);"))[0], /tests got weaker: 2 checks removed, 1 added/);
  assert.deepStrictEqual(checkChange(["a.test.js"], diffOf("a.test.js", "+  assert.ok(z);")), []);
  assert.deepStrictEqual(checkChange(["a.js"], diffOf("a.js", "-  assert.ok(x);")), []);
});

test("a page script that does not parse is found, and scripts with a src are skipped", () => {
  assert.deepStrictEqual(pageProblems('<script>const a = 1;</script><script src="/x.js"></script>'), []);
  assert.deepStrictEqual(pageProblems("<script>await fetch('/');</script>"), []);
  assert.strictEqual(pageProblems("<script>const = ;</script>").length, 1);
});
