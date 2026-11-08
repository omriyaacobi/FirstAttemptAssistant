// Tests that cleaning up agy's private work folder can never replace the real result (Windows EPERM), and that old folders are swept.
// A fake agy: child_process.execFile is replaced (before providers.js loads) by a function that answers with the question text.
const cp = require("node:child_process");
cp.execFile = (cmd, args, options, callback) => {
  const closers = [];
  setImmediate(() => { callback(null, args[1], ""); closers.forEach((f) => f()); });
  return { on(event, fn) { if (event === "close") closers.push(fn); }, kill() {}, pid: 0 };
};
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyWithFile, askAgyWithImage, cleanWorkDir, removeStaleWorkDirs } = require("../providers");

function withBrokenDelete(fn) {
  const real = fs.rmSync;
  let attempts = 0;
  fs.rmSync = (target, options) => {
    if (/bot-(file|photo)-/.test(String(target))) { attempts++; throw Object.assign(new Error(`EPERM, Permission denied: '${target}'`), { code: "EPERM" }); }
    return real(target, options);
  };
  return fn(() => attempts).finally(() => { fs.rmSync = real; });
}

test("a good answer survives a work folder Windows refuses to delete (file and photo)", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wd-"));
  const file = path.join(base, "m.pdf");
  fs.writeFileSync(file, "x");
  const realTmp = os.tmpdir;
  os.tmpdir = () => base; // a private folder: the real Temp folder may hold work folders that a running Bot is using
  try {
    await withBrokenDelete(async (attempts) => {
      assert.strictEqual(await askAgyWithFile("gemini-3.8-flash-medium", "real answer", file), "real answer");
      assert.strictEqual(await askAgyWithImage("gemini-3.8-flash-medium", "real photo answer", file), "real photo answer");
      assert.ok(attempts() >= 2); // it did try to delete
    });
  } finally {
    os.tmpdir = realTmp;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("cleanWorkDir never throws and says what it could not delete", async () => {
  const logged = [];
  await withBrokenDelete(async () => { cleanWorkDir(path.join(os.tmpdir(), "bot-file-abcdef"), (l) => logged.push(l)); });
  assert.match(logged[0], /could not delete/);
});

test("removeStaleWorkDirs removes only old bot-file / bot-photo folders", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
  const old = path.join(base, "bot-file-AAAAAA"), fresh = path.join(base, "bot-photo-BBBBBB"), other = path.join(base, "keep-me");
  for (const d of [old, fresh, other]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, "f"), "x"); }
  const longAgo = new Date(Date.now() - 3 * 3600 * 1000);
  fs.utimesSync(old, longAgo, longAgo);
  fs.utimesSync(other, longAgo, longAgo);
  assert.strictEqual(removeStaleWorkDirs({ dir: base }), 1);
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other));
  fs.rmSync(base, { recursive: true, force: true });
});
