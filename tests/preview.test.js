// preview.test.js
// Tests the page builder for the Improve Bot "Preview" button (see preview.js).
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { buildPreviewHtml, fakeApi, PREVIEW_CSP } = require("../preview");

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-preview-test-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test("the page gets the fake API first, and its own scripts are put inline", () => {
  const dir = makeDir({
    "index.html": '<!doctype html><html><head><title>x</title></head><body><script src="/study.js"></script><script src="/missing.js"></script></body></html>',
    "study.js": 'window.x = "</script>";',
  });
  const html = buildPreviewHtml(dir);
  assert.ok(html.indexOf("fakeApi") < html.indexOf("window.x"), "the fake API comes before the page's scripts");
  assert.match(html, /window\.x = "<\\\/script>";/); // a closing tag inside the file cannot end the script early
  assert.doesNotMatch(html, /src="\/study\.js"/);
  assert.doesNotMatch(html, /missing\.js/); // a sandboxed page could not load it anyway
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a folder without index.html gives no preview", () => {
  const dir = makeDir({ "other.js": "1" });
  assert.strictEqual(buildPreviewHtml(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the fake API answers with sample data and refuses anything that changes something", async () => {
  const context = { window: {}, location: { href: "http://localhost/preview" }, Response, URL, Navigator: function () {}, Promise, Date, JSON };
  vm.createContext(context);
  vm.runInContext(`(${fakeApi.toString()})()`, context);
  const get = async (url, options) => {
    const res = await context.window.fetch(url, options);
    return { status: res.status, body: await res.json() };
  };
  assert.strictEqual((await get("/api/conversations")).body.conversations[0].title, "Sample chat (preview)");
  assert.strictEqual((await get("/api/session")).body.remote, false);
  assert.strictEqual((await get("/api/selfedit/0123456789abcdef/approve", { method: "POST", body: "{}" })).status, 403);
  assert.strictEqual((await get("/api/selfedit")).status, 404); // nothing about the real proposals is available
});

test("SECURITY: the preview header sandboxes the page and shuts off the network", () => {
  assert.match(PREVIEW_CSP, /^sandbox allow-scripts;/);
  assert.doesNotMatch(PREVIEW_CSP, /allow-same-origin|allow-forms|allow-top-navigation|allow-popups/);
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /default-src 'none'/);
});
