// tests/multi-photo-page.test.js
// The page's row of picture thumbnails (photoTray in public/index.html, 2026-11-22), run in a sandbox with a fake document:
// pictures are added up to the limit the server gives (/api/session maxPhotos), each has its own remove button, the page says
// plainly what was left out, and only textContent is used. The conversation and Improve Bot planning use the same row.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8").replace(/\r\n/g, "\n");
const code = html.match(/ {2}const maxPhotos = [\s\S]*?\n {2}function photoTray\([\s\S]*?\n {2}\}\n/)[0];

function fakeEl(tag) {
  const node = {
    tag, children: [], attrs: {}, listeners: {}, hidden: false,
    set textContent(v) { node.text = v; if (v === "") node.children = []; },
    get textContent() { return node.text; },
    append: (...kids) => node.children.push(...kids),
    appendChild: (kid) => node.children.push(kid),
    setAttribute: (k, v) => { node.attrs[k] = v; },
    addEventListener: (type, fn) => { node.listeners[type] = fn; },
  };
  return node;
}

function tray(session = { maxPhotos: 4 }, what = "photo") {
  const box = fakeEl("div");
  const sandbox = {
    session, box,
    $: (id) => (id === "box" ? box : null),
    el: (tag, cls, text) => { const n = fakeEl(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; },
    document: { createElement: (tag) => fakeEl(tag) },
    shrinkPhoto: async (file) => { if (file.broken) throw new Error("bad"); return "data:image/jpeg;base64," + file.name; },
  };
  vm.createContext(sandbox);
  vm.runInContext(code + `\nvar t = photoTray("box", ${JSON.stringify(what)});`, sandbox);
  return { t: sandbox.t, box };
}
const pic = (name, extra = {}) => ({ name, type: "image/png", ...extra });

test("pictures are added up to the server's limit and the page says how many were left out", async () => {
  const { t, box } = tray();
  const note = await t.add([pic("a"), pic("b"), pic("c"), pic("d"), pic("e"), pic("f")]);
  assert.strictEqual(t.count(), 4);
  assert.deepStrictEqual([...t.dataUrls()], ["a", "b", "c", "d"].map((n) => "data:image/jpeg;base64," + n));
  assert.strictEqual(note, "2 photos were left out: Bot takes 4 at most in one message.");
  assert.strictEqual(box.hidden, false);
  assert.strictEqual(box.children.length, 4);
  // a later add when full: still said plainly
  assert.strictEqual(await t.add([pic("g")]), "One photo was left out: Bot takes 4 at most in one message.");
});

test("each thumbnail has its own remove button that removes exactly that picture", async () => {
  const { t, box } = tray({ maxPhotos: 4 }, "screenshot");
  await t.add([pic("a"), pic("b"), pic("c")]);
  const second = box.children[1];
  const [img, remove] = second.children;
  assert.strictEqual(img.alt, "screenshot 2");
  assert.strictEqual(remove.attrs["aria-label"], "Remove screenshot 2");
  assert.strictEqual(remove.type, "button");
  remove.listeners.click();
  assert.deepStrictEqual([...t.dataUrls()], ["a", "c"].map((n) => "data:image/jpeg;base64," + n));
  assert.strictEqual(box.children.length, 2);
  t.clear();
  assert.strictEqual(t.count(), 0);
  assert.strictEqual(box.hidden, true);
});

test("files that are not pictures and pictures that cannot be read are named, not silently dropped", async () => {
  const { t } = tray();
  const note = await t.add([pic("a"), { name: "x.pdf", type: "application/pdf" }, pic("b", { broken: true })]);
  assert.strictEqual(t.count(), 1);
  assert.match(note, /Could not read one photo\./);
  assert.match(note, /One file that is not a picture was left out\./);
  assert.strictEqual(await tray().t.add([pic("a")]), ""); // nothing to say when everything fits
});

test("an older Bot that does not tell the page its limit gets one picture, as before", async () => {
  const { t } = tray({});
  assert.match(await t.add([pic("a"), pic("b")]), /One photo was left out: Bot takes 1 at most/);
  assert.strictEqual(t.count(), 1);
});

test("the row is built with textContent and elements only, and both places use it", () => {
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(html, /const photos = photoTray\("photoTray", "photo"\);/);
  assert.match(html, /const improvePhotos = photoTray\("improvePhotoChip", "screenshot"\);/);
  assert.match(html, /<div class="photo-tray" id="photoTray" hidden aria-label="Attached photos"><\/div>/);
  assert.match(html, /<input type="file" id="improvePhotoInput" accept="image\/\*" multiple hidden>/);
  assert.match(html, /\.photo-tray \.shot button \{ height: 44px; \}/); // a thumb-sized remove button on the phone
  assert.match(html, /session\.maxPhotos/); // the limit comes from the server (photo.js MAX_PHOTOS)
});
