// tests/pc-find.test.js
// Finding folders and files by name (pc-find.js): only under the roots, never into links, hidden or tool folders, never secrets,
// and a later action can only PICK a number from the last list Omri saw.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFinder, tokens } = require("../pc-find");

function disk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bot-find-"));
  const root = path.join(base, "Documents");
  const outside = path.join(base, "Elsewhere");
  for (const d of ["SP/Assignment3", "SP/ex2", "OS/ex3_threads", "OS/.git", "OS/node_modules/ex3pkg", "Bot"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.mkdirSync(path.join(outside, "ex3_far_place"), { recursive: true });
  fs.writeFileSync(path.join(root, "SP", "Assignment3", "main.cpp"), "x");
  fs.writeFileSync(path.join(root, "OS", "ex3_threads", "report.pdf"), "x");
  fs.writeFileSync(path.join(root, "OS", "ex3_threads", "ex3.env"), "x");
  fs.writeFileSync(path.join(root, "OS", "ex3_threads", "password_ex3.txt"), "x");
  fs.symlinkSync(outside, path.join(root, "OS", "ex3_link"), "junction");
  const dataDir = path.join(base, "data");
  const finder = createFinder({ dataDir, system: [], appDataRule: false, home: base, forbidden: [path.join(root, "Bot")] });
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "pc-roots.json"), JSON.stringify({ roots: [root] }));
  return { base, root, outside, finder, dataDir };
}

test("words of names: letters and numbers split, Hebrew kept", () => {
  assert.deepStrictEqual(tokens("OS_ex3-final"), ["os", "ex", "3", "final"]);
  assert.deepStrictEqual(tokens("מטלה 3"), ["מטלה", "3"]);
});

test("finds a folder by what Omri calls it; the best fit comes first", () => {
  const { finder, root } = disk();
  const r = finder.find(["OS", "ex", "3"], { kind: "folder" });
  assert.strictEqual(r.items[0].path, path.join(root, "OS", "ex3_threads"));
  const sp = finder.find(["SP", "assignment", "3"]);
  assert.strictEqual(sp.items[0].path, path.join(root, "SP", "Assignment3"));
});

test("never into links, .git, node_modules or Bot's own folder; never secrets by name", () => {
  const { finder } = disk();
  const all = finder.find(["ex3", "ex", "3", "bot", "secret", "password", "env"]).items.map((x) => x.path).join("\n");
  assert.doesNotMatch(all, /ex3_link|ex3_far_place|node_modules|\.git|[\\/]Bot$|ex3\.env|password_ex3/m);
});

test("pick: only a number of the last list, checked again; it expires after 2 hours", () => {
  let t = 1000;
  const base = disk();
  const finder = createFinder({ dataDir: base.dataDir, system: [], appDataRule: false, home: base.base, now: () => t });
  assert.throws(() => finder.pick(1), /no recent search/);
  finder.find(["SP"], { kind: "folder" });
  assert.ok(finder.pick(1).path.endsWith("SP"));
  assert.throws(() => finder.pick(99), /only/);
  assert.throws(() => finder.pick("C:\\Windows"), /which number/);
  t += 3 * 3600 * 1000;
  assert.throws(() => finder.pick(1), /no recent search/);
});

test("list: the inside of a found folder becomes the new numbered list", () => {
  const { finder } = disk();
  finder.find(["ex3", "threads"], { kind: "folder" });
  const l = finder.list(1);
  assert.deepStrictEqual(l.items.map((x) => x.name), ["report.pdf"]); // the secret-looking names are not listed
  assert.ok(finder.pick(1).path.endsWith("report.pdf"));
});

test("roots: Omri can add and remove; the system drive, home, system folders and Bot's folder are refused", () => {
  const { finder, outside, base, root } = disk();
  assert.strictEqual(finder.addRoot(outside).added, true);
  assert.ok(finder.find(["far", "place"]).items.length >= 1);
  finder.removeRoot(outside);
  assert.strictEqual(finder.find(["far", "place"]).items.length, 0);
  assert.throws(() => finder.addRoot(base), /home folder/);
  assert.throws(() => finder.addRoot(path.join(root, "Bot")), /system folder|Bot's own/);
  assert.throws(() => finder.addRoot("relative\\x"), /full folder path/);
  const sys = createFinder({ dataDir: base, system: [outside], appDataRule: false, home: base });
  assert.throws(() => sys.addRoot(outside), /system folder/);
  if (process.platform === "win32") assert.throws(() => finder.addRoot(path.parse(process.env.SystemRoot || "C:\\Windows").root), /system drive/);
});

test("the walk stops at its limits", () => {
  const { dataDir, base } = disk();
  const tiny = createFinder({ dataDir, system: [], appDataRule: false, home: base, limits: { dirs: 1 } });
  assert.strictEqual(tiny.find(["ex3"]).cut, true);
});
