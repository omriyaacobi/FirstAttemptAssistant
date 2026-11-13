// paste.test.js
// Pasting a picture (PrintScreen, Win+Shift+S, then Ctrl+V) or a copied file, and dropping a file on the page (2026-11-13):
// the page's code runs in a sandbox with a fake document. What it must do: hand the FIRST file to the paperclip's own input
// (so the photo road and the upload road keep all their checks), leave plain text and the other boxes alone, send nothing.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8").replace(/\r\n/g, "\n");
const code = html.match(/ {4}function firstFile\(list\) \{[\s\S]*?\n {4}function setupPasteAndDrop\(\) \{[\s\S]*?\n {4}\}\n/)[0];

function page({ shown = true } = {}) {
  const listeners = {};
  const task = { tagName: "TEXTAREA", offsetParent: shown ? {} : null };
  const other = { tagName: "TEXTAREA", offsetParent: {} }; // Improve Bot's box
  const photoInput = { files: null, events: [], dispatchEvent(e) { this.events.push(e.type); } };
  const status = { textContent: "" };
  class DataTransfer { constructor() { this.list = []; this.items = { add: (f) => this.list.push(f) }; } get files() { return this.list; } }
  const sandbox = {
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    $: (id) => ({ task, photoInput, status }[id]),
    DataTransfer, Event: class { constructor(type) { this.type = type; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(code + "\nsetupPasteAndDrop();", sandbox);
  const event = (extra) => { const e = { prevented: false, preventDefault() { this.prevented = true; }, ...extra }; return e; };
  return { listeners, task, other, photoInput, status, event };
}
const file = (name, type) => ({ name, type, size: 10 });

test("a pasted screenshot goes to the paperclip's input and nothing else happens", () => {
  const p = page();
  const shot = file("image.png", "image/png");
  const e = p.event({ target: p.task, clipboardData: { files: [shot] } });
  p.listeners.paste(e);
  assert.strictEqual(e.prevented, true);
  assert.deepStrictEqual(p.photoInput.files, [shot]);
  assert.deepStrictEqual(p.photoInput.events, ["change"]); // the same change event the paperclip sends: photo road or pickFile
});

test("pasting with the focus outside any box (on the page) works too; only the first of many files is used, and the page says so", () => {
  const p = page();
  const a = file("a.pdf", "application/pdf"), b = file("b.pdf", "application/pdf");
  p.listeners.paste(p.event({ target: { tagName: "DIV" }, clipboardData: { files: [a, b] } }));
  assert.deepStrictEqual(p.photoInput.files, [a]);
  assert.match(p.status.textContent, /only the first pasted file/);
});

test("plain text pastes as usual, and other boxes (Improve Bot, the login) keep their own paste", () => {
  const p = page();
  const text = p.event({ target: p.task, clipboardData: { files: [] } });
  p.listeners.paste(text);
  assert.strictEqual(text.prevented, false);
  const elsewhere = p.event({ target: p.other, clipboardData: { files: [file("x.png", "image/png")] } });
  p.listeners.paste(elsewhere);
  assert.strictEqual(elsewhere.prevented, false);
  assert.strictEqual(p.photoInput.files, null);
});

test("nothing is taken while the message box is not on screen (another view is open)", () => {
  const p = page({ shown: false });
  const e = p.event({ target: { tagName: "DIV" }, clipboardData: { files: [file("x.png", "image/png")] } });
  p.listeners.paste(e);
  assert.strictEqual(e.prevented, false);
  assert.strictEqual(p.photoInput.files, null);
});

test("a dropped file takes the same road; dragging text is left to the browser", () => {
  const p = page();
  const over = p.event({ dataTransfer: { types: ["Files"] } });
  p.listeners.dragover(over);
  assert.strictEqual(over.prevented, true); // without this Chrome would open the file in the tab
  const doc = file("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const drop = p.event({ dataTransfer: { types: ["Files"], files: [doc] } });
  p.listeners.drop(drop);
  assert.strictEqual(drop.prevented, true);
  assert.deepStrictEqual(p.photoInput.files, [doc]);
  const textDrag = p.event({ dataTransfer: { types: ["text/plain"] } });
  p.listeners.dragover(textDrag);
  assert.strictEqual(textDrag.prevented, false);
});

test("the paste code never sends or uploads by itself, and it is switched on with the thread", () => {
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|upload|threadSend|send\(/);
  assert.match(html, /\$\("photoRemove"\)\.addEventListener\("click", clearFile\);\n\s*setupPasteAndDrop\(\);/);
});
