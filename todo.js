// todo.js - Omri's to-do list for Bot: ONE file, data/todo.md, that Bot (the brain's tools todo_read / todo_update) and the Claude Code
// sessions both read and change (2026-11-21, Omri's decision). The file is plain Markdown:
//
//   ## Section name
//   - [ ] [t7] The text of an open item (more lines may follow, indented by two spaces)
//   - [x] [t8] A done item
//
// Everything that is not an item line (prose, headings) is kept exactly as it is. Code does the editing by LINES, so a hand edit by
// Claude Code or Omri is never "reformatted". The file is read fresh on every call (someone else may have edited it in between) and
// written atomically (temp file + rename). A model only hands in VALUES (an id, a section name, a text); code checks each one.
// Undo: the file as it was before Bot's last change is kept for 2 hours, and put back only if nobody changed the file since.

const fs = require("node:fs");
const path = require("node:path");

const MAX_TEXT = 1200; // one item's text, in characters
const MAX_FILE = 80000; // the whole file, in characters
const MAX_ITEMS = 300;
const UNDO_MS = 2 * 3600 * 1000;
const ACTIONS = ["add", "done", "undone", "reword", "move", "remove", "undo"];

const ITEM = /^- \[( |x)\] \[t(\d+)\] ?(.*)$/;
const HEADING = /^##\s+(.+?)\s*$/;
// Control characters (a tab or a newline inside one item's text is turned into a space first, anything else is refused).
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const cleanText = (value) => {
  const t = String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").trim();
  if (!t) throw new Error("the text of the item is empty");
  if (CONTROL.test(t)) throw new Error("the text has control characters");
  if (t.length > MAX_TEXT) throw new Error(`the text is ${t.length} characters; one item may have at most ${MAX_TEXT}. Make it shorter`);
  return t;
};

// The file as lines, with the sections and items found in it. Item = its first line + the indented lines under it.
function parse(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const sections = []; // { name, line }
  const items = []; // { id, num, done, text, start, end (exclusive), section }
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]);
    if (h) { section = h[1]; sections.push({ name: h[1], line: i }); continue; }
    const m = ITEM.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && /^\s{2,}\S/.test(lines[end])) end++;
    items.push({ id: "t" + m[2], num: Number(m[2]), done: m[1] === "x", text: m[3], start: i, end, section });
    i = end - 1;
  }
  return { lines, sections, items };
}

const ids = (items) => items.map((i) => i.id).join(", ") || "none";

function createTodo({ file, undoFile = null, now = Date.now } = {}) {
  if (!file) throw new Error("todo: a file is needed");
  const undoPath = undoFile || path.join(path.dirname(file), "todo-undo.json");
  const readFile = () => { try { return fs.readFileSync(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
  const writeAtomic = (target, text) => {
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, text, "utf8");
    try { fs.renameSync(tmp, target); } catch (error) { try { fs.unlinkSync(tmp); } catch (e) { /* nothing to clean */ } throw error; }
  };

  // The whole list (as the file has it), or one item with its lines. A lookup.
  function read({ id } = {}) {
    const text = readFile();
    if (text === null) return "There is no to-do list file yet.";
    const p = parse(text);
    if (id !== undefined && id !== null && String(id).trim() !== "") {
      const want = String(id).trim().toLowerCase().replace(/^\[|\]$/g, "");
      const it = p.items.find((x) => x.id === want);
      if (!it) throw new Error(`no item "${String(id).slice(0, 20)}" in the list. The ids: ${ids(p.items)}`);
      return `${p.lines.slice(it.start, it.end).join("\n")}\n(in "${it.section || "no section"}")`;
    }
    return text.replace(/\r\n/g, "\n");
  }

  const pickSection = (p, name) => {
    const q = String(name == null ? "" : name).trim().toLowerCase();
    if (!q) throw new Error(`which section? The sections: ${p.sections.map((s) => `"${s.name}"`).join("; ") || "none"}`);
    const exact = p.sections.filter((s) => s.name.toLowerCase() === q);
    const hits = exact.length ? exact : p.sections.filter((s) => s.name.toLowerCase().includes(q));
    if (hits.length !== 1) throw new Error(`${hits.length ? "more than one section fits" : "no section fits"} "${q.slice(0, 40)}". The sections: ${p.sections.map((s) => `"${s.name}"`).join("; ") || "none"}`);
    return hits[0];
  };
  // The line after the last line of a section (before the next heading), without trailing blank lines.
  const sectionEnd = (p, section) => {
    const next = p.sections.find((s) => s.line > section.line);
    let end = next ? next.line : p.lines.length;
    while (end > section.line + 1 && !p.lines[end - 1].trim()) end--;
    return end;
  };
  const pickItem = (p, id) => {
    const want = String(id == null ? "" : id).trim().toLowerCase().replace(/^\[|\]$/g, "");
    const it = p.items.find((x) => x.id === want);
    if (!it) throw new Error(`no item "${String(id == null ? "" : id).slice(0, 20)}". The ids: ${ids(p.items)}`);
    return it;
  };

  // One change. Returns one line for Omri. Nothing is written unless every check passed.
  function update({ action, id, text, section } = {}) {
    const act = String(action == null ? "" : action).trim().toLowerCase();
    if (!ACTIONS.includes(act)) throw new Error(`"action" must be one of: ${ACTIONS.join(", ")}`);
    if (act === "undo") return undo();
    const before = readFile();
    if (before === null) throw new Error("there is no to-do list file to change");
    const p = parse(before);
    const lines = p.lines.slice();
    let said;
    if (act === "add") {
      if (p.items.length >= MAX_ITEMS) throw new Error(`the list already has ${MAX_ITEMS} items`);
      const body = cleanText(text);
      const sec = pickSection(p, section);
      const num = p.items.reduce((m, i) => Math.max(m, i.num), 0) + 1;
      lines.splice(sectionEnd(p, sec), 0, `- [ ] [t${num}] ${body}`);
      said = `Added [t${num}] to "${sec.name}": ${body}`;
    } else {
      const it = pickItem(p, id);
      const count = it.end - it.start;
      if (act === "done" || act === "undone") {
        if (it.done === (act === "done")) return `[${it.id}] was already ${act === "done" ? "done" : "open"}. Nothing changed.`;
        lines[it.start] = lines[it.start].replace(/^- \[[ x]\]/, act === "done" ? "- [x]" : "- [ ]");
        said = act === "done" ? `Marked [${it.id}] done: ${it.text}` : `Marked [${it.id}] open again: ${it.text}`;
      } else if (act === "reword") {
        const body = cleanText(text);
        lines.splice(it.start, count, `- [${it.done ? "x" : " "}] [${it.id}] ${body}`);
        said = `Reworded [${it.id}]: ${body}`;
      } else if (act === "move") {
        const sec = pickSection(p, section);
        if (sec.name === it.section) return `[${it.id}] is already in "${sec.name}". Nothing changed.`;
        const block = lines.slice(it.start, it.end);
        const at = sectionEnd(p, sec);
        // Insert first or remove first, whichever keeps the other position right.
        if (at >= it.end) { lines.splice(at, 0, ...block); lines.splice(it.start, count); } else { lines.splice(it.start, count); lines.splice(at, 0, ...block); }
        said = `Moved [${it.id}] to "${sec.name}": ${it.text}`;
      } else { // remove
        lines.splice(it.start, count);
        said = `Removed [${it.id}]: ${it.text}`;
      }
    }
    const after = lines.join("\n");
    if (after.length > MAX_FILE) throw new Error(`the list would be ${after.length} characters; the most is ${MAX_FILE}`);
    // Undo record first (what the file was, and what Bot made of it), then the change.
    writeAtomic(undoPath, JSON.stringify({ at: now(), before, after, said }));
    writeAtomic(file, after);
    return said + " (Omri can say \"undo\" to take it back.)";
  }

  // Puts the file back as it was before Bot's last change: only within 2 hours and only if nobody changed the file since.
  function undo() {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(undoPath, "utf8")); } catch (error) { rec = null; }
    if (!rec || typeof rec.before !== "string" || typeof rec.after !== "string") return "There is no change of Bot's to undo.";
    if (now() - rec.at > UNDO_MS) return "Bot's last change to the list is more than 2 hours old, so it cannot be undone.";
    const current = readFile();
    if (current === null || current.replace(/\r\n/g, "\n") !== rec.after.replace(/\r\n/g, "\n")) return "The list was changed after Bot's last change (by someone else), so Bot will not undo it: that would lose their edit. Say which item to change instead.";
    writeAtomic(file, rec.before);
    try { fs.unlinkSync(undoPath); } catch (error) { /* already gone */ }
    return `Undone: ${rec.said}`;
  }

  return { read, update, undo, sections: () => parse(readFile() || "").sections.map((s) => s.name) };
}

module.exports = { createTodo, parse, ACTIONS, MAX_TEXT, MAX_FILE, UNDO_MS };
