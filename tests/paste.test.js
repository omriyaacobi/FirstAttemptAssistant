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

test("several pasted or dropped pictures ALL go to the photo road (it keeps them up to the limit); a file that is not first goes along and is left out there", () => {
  const p = page();
  const a = file("a.png", "image/png"), b = file("b.jpg", "image/jpeg"), c = file("c.pdf", "application/pdf");
  p.listeners.paste(p.event({ target: p.task, clipboardData: { files: [a, b, c] } }));
  assert.deepStrictEqual(p.photoInput.files, [a, b, c]);
  assert.deepStrictEqual(p.photoInput.events, ["change"]);
  assert.strictEqual(p.status.textContent, ""); // the photo road says what it left out
  const d = page();
  d.listeners.drop(d.event({ dataTransfer: { types: ["Files"], files: [b, a] } }));
  assert.deepStrictEqual(d.photoInput.files, [b, a]);
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

// ---- Improve Bot Planning Mode paste (scoped so it never touches the main chat's photoInput) ----
const improvePasteCode = html.match(/ {2}function canImprovePhoto\(\) \{[\s\S]*?\n {2}function setupImprovePaste\(\) \{[\s\S]*?\n {2}\}\n/)[0];

function improvePage({ improveHidden = false, planMode = true, inPlan = false, running = false } = {}) {
  const listeners = {};
  const improveView = { hidden: improveHidden };
  const improveText = { tagName: "TEXTAREA" };
  const improvePlanMode = { checked: planMode };
  const improvePhotoInput = { files: null, events: [], dispatchEvent(e) { this.events.push(e.type); } };
  const photoInput = { files: null, events: [], dispatchEvent(e) { this.events.push(e.type); } };
  const statuses = [];
  class DataTransfer { constructor() { this.list = []; this.items = { add: (f) => this.list.push(f) }; } get files() { return this.list; } }
  const sandbox = {
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    $: (id) => ({ improveView, improveText, improvePlanMode, improvePhotoInput, photoInput }[id]),
    currentPlan: inPlan ? { id: "p1", status: "open" } : null,
    openChange: () => (running ? { id: "c1", status: "running" } : null),
    setStatus: (id, text, bad) => statuses.push({ id, text, bad: Boolean(bad) }),
    isPicture: (f) => Boolean(f && f.type && f.type.startsWith("image/")),
    DataTransfer,
    Event: class { constructor(type) { this.type = type; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(improvePasteCode + "\nsetupImprovePaste();", sandbox);
  const event = (extra) => ({ prevented: false, preventDefault() { this.prevented = true; }, ...extra });
  return { listeners, improveText, improvePhotoInput, photoInput, statuses, event };
}

test("pasting a screenshot in Improve Bot Planning Mode attaches to improvePhotoInput and never touches main chat photoInput", () => {
  const p = improvePage();
  const shot = file("ui.png", "image/png");
  const e = p.event({ target: p.improveText, clipboardData: { files: [shot] } });
  p.listeners.paste(e);
  assert.strictEqual(e.prevented, true);
  assert.deepStrictEqual(p.improvePhotoInput.files, [shot]);
  assert.deepStrictEqual(p.improvePhotoInput.events, ["change"]);
  assert.strictEqual(p.photoInput.files, null);
  assert.deepStrictEqual(p.photoInput.events, []);
});

test("several screenshots pasted in Improve Bot all go to improvePhotoInput, without the non-picture files", () => {
  const p = improvePage();
  const a = file("a.png", "image/png"), b = file("b.pdf", "application/pdf"), c = file("c.png", "image/png");
  const e = p.event({ target: p.improveText, clipboardData: { files: [a, b, c] } });
  p.listeners.paste(e);
  assert.strictEqual(e.prevented, true);
  assert.deepStrictEqual(p.improvePhotoInput.files, [a, c]);
  assert.strictEqual(p.photoInput.files, null);
});

test("Improve Bot paste ignores plain text, non-image files, hidden Improve view, and non-plan edit mode", () => {
  const p = improvePage();
  const plain = p.event({ target: p.improveText, clipboardData: { files: [] } });
  p.listeners.paste(plain);
  assert.strictEqual(plain.prevented, false);
  assert.strictEqual(p.improvePhotoInput.files, null);

  const pdf = p.event({ target: p.improveText, clipboardData: { files: [file("doc.pdf", "application/pdf")] } });
  p.listeners.paste(pdf);
  assert.strictEqual(pdf.prevented, false);
  assert.strictEqual(p.improvePhotoInput.files, null);
  assert.match(p.statuses[0].text, /Only image screenshots/);

  // Hidden Improve view (user is in main chat): does nothing
  const hidden = improvePage({ improveHidden: true });
  const eHidden = hidden.event({ target: { tagName: "DIV" }, clipboardData: { files: [file("a.png", "image/png")] } });
  hidden.listeners.paste(eHidden);
  assert.strictEqual(eHidden.prevented, false);
  assert.strictEqual(hidden.improvePhotoInput.files, null);

  // Plan first unchecked (direct edit mode): does nothing
  const direct = improvePage({ planMode: false });
  const eDirect = direct.event({ target: direct.improveText, clipboardData: { files: [file("a.png", "image/png")] } });
  direct.listeners.paste(eDirect);
  assert.strictEqual(eDirect.prevented, false);
  assert.strictEqual(direct.improvePhotoInput.files, null);

  // Never sends by itself
  assert.doesNotMatch(improvePasteCode, /fetch\(|XMLHttpRequest|sendImprove/);
});
