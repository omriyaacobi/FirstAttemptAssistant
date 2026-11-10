// tests/project-folder.test.js
// The linked folder (project-folder.js): read-only, stays inside the folder, never reads secrets or binaries.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkFolder, listFiles, readFile, numbered } = require("../project-folder");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-proj-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "Makefile"), "all:\n\tg++ src/Main.cpp\n");
  fs.writeFileSync(path.join(root, "src", "Main.cpp"), "int main() {\n  return 0;\n}\n");
  fs.writeFileSync(path.join(root, ".env"), "KEY=123");
  fs.writeFileSync(path.join(root, ".git", "config"), "x");
  fs.writeFileSync(path.join(root, "node_modules", "a.js"), "x");
  fs.writeFileSync(path.join(root, "prog.o"), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, "data.txt"), Buffer.from([65, 0, 66])); // text name, binary bytes
  return root;
}

test("checkFolder: a real folder is accepted; roots, home, missing, files and Bot's own folder are refused", () => {
  const root = project();
  assert.strictEqual(checkFolder(root, { system: [] }), fs.realpathSync(root));
  assert.throws(() => checkFolder(root, { system: [path.dirname(root)] }), /system folder/);
  assert.throws(() => checkFolder("src"), /full folder path/);
  assert.throws(() => checkFolder(path.join(root, "nope")), /does not exist/);
  assert.throws(() => checkFolder(path.join(root, "Makefile"), { system: [] }), /a file, not a folder/);
  assert.throws(() => checkFolder(path.parse(root).root), /whole drive/);
  assert.throws(() => checkFolder(os.homedir()), /home folder/);
  assert.throws(() => checkFolder(root, { forbidden: [root], system: [] }), /Bot's own folder/);
  assert.throws(() => checkFolder(path.join(root, "src"), { forbidden: [root], system: [] }), /Bot's own folder/);
});

test("listFiles: source files only; no .git, node_modules, binaries or secrets", () => {
  const { files } = listFiles(project());
  assert.deepStrictEqual(files.map((f) => f.rel).sort(), ["Makefile", "data.txt", "src/Main.cpp"]);
});

test("readFile: by path or by a unique name; never outside the folder, never a secret, never binary", () => {
  const root = project();
  assert.match(readFile(root, "src/Main.cpp").text, /int main/);
  assert.strictEqual(readFile(root, "main.cpp").rel, "src/Main.cpp");
  assert.throws(() => readFile(root, "../../etc/passwd"), /no file/);
  assert.throws(() => readFile(root, ".env"), /no file|secrets/);
  assert.throws(() => readFile(root, "data.txt"), /not text/);
  assert.throws(() => readFile(root, "missing.cpp"), /no file/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bot-out-"));
  fs.writeFileSync(path.join(outside, "x.txt"), "private");
  assert.throws(() => readFile(root, path.join(outside, "x.txt")), /no file|outside/);
});

test("numbered adds line numbers", () => {
  assert.strictEqual(numbered("a\r\nb"), "1: a\n2: b");
});
