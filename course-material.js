// course-material.js
// What the brain (brain.js) attaches up front for the course a talk is in, picked by CODE from the course's own files:
//   pickAssignment  the assignment the message is about (a file named like one, a file the message names, or a saved assignment)
//   fitAssignment   a very long assignment cut to its beginning, its section titles and the section the message names
//   notesFor        the pages of the notes that best match the message (a named section number first, then the page search)
// Everything here is DATA for a prompt: text is scrubbed so it cannot close its block, and nothing is an instruction.
// (These lived in study-chat.js, the old "study chat" mode, which was removed when the brain became the only way Bot works.)

const { defang, pickPages } = require("./study");
const outlineLib = require("./outline");
const catchup = require("./catchup");

const LIMITS = {
  assignment: 60000, // the assignment text, in full up to this
  notes: 12000, // all pieces of the course notes together
  notePage: 4000, // one page of the notes
  noteK: 4, // pages picked by the search
};

const noCtl = (s) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
const clip = (s, n) => { const t = String(s); return t.length <= n ? t : t.slice(0, n); };
const BLOCK_TAGS = "assignment|course-notes|course-material|pasted-code|earlier-turns|about-the-user|ai-rule|web-result|student-message";
const scrub = (s) => defang(noCtl(s)).replace(new RegExp(`<\\/?\\s*(?:${BLOCK_TAGS})[^>]*>`, "gi"), "");
const SECTION_NUM = /(?:\bsection\s*|\bsec\.?\s*|סעיף\s*|פרק\s*|§\s*)?(\d{1,2}(?:\.\d{1,2}){1,3})\b|\b(?:section|chapter|סעיף|פרק)\s*(\d{1,2})\b/i;
const sectionNumber = (text) => { const m = SECTION_NUM.exec(String(text)); return m ? (m[1] || m[2]) : null; };

// ---- picking the assignment ----
const looksLikeAssignmentName = (n) => /assign|exercis|homework|\bhw\b|(^|[^a-z])ex[ _-]?\d|תרגיל|מטלה|עבודה/i.test(String(n));
const normText = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

// pages: all pages of the course. saved: the assignments saved in the tracker [{ title, text, status }].
// Returns { title, text, fileId, source } or null. The assignment file in the course wins over the saved copy (the saved copy is cut at 8,000 characters).
function pickAssignment({ pages, saved = [], message }) {
  const byFile = new Map();
  for (const p of Array.isArray(pages) ? pages : []) { if (!p || !p.fileName) continue; if (!byFile.has(p.fileId)) byFile.set(p.fileId, { fileId: p.fileId, name: String(p.fileName), pages: [] }); byFile.get(p.fileId).pages.push(p); }
  const files = [...byFile.values()].map((f) => ({ ...f, pages: f.pages.sort((a, b) => a.page - b.page) }));
  const textOf = (f) => f.pages.map((p) => String(p.text || "")).join("\n");
  const low = String(message || "").toLowerCase();
  const asg = files.filter((f) => looksLikeAssignmentName(f.name));
  const named = files.filter((f) => { const base = f.name.replace(/\.\w{2,4}$/, "").toLowerCase(); return base.length >= 4 && low.includes(base); });
  const fileHit = (f, title) => ({ title: title || f.name.replace(/\.\w{2,4}$/, ""), text: textOf(f), fileId: f.fileId, source: "file", pagesOfFile: f.pages });
  const savedTitled = saved.find((a) => a && a.title && low.includes(String(a.title).toLowerCase()));
  const open = saved.filter((a) => a && a.status !== "done");
  const fileOfSaved = (a) => { const head = normText(a.text || "").slice(0, 120); return head.length >= 40 ? files.find((f) => normText(textOf(f)).includes(head)) : null; };
  const pickSaved = (a) => { const f = fileOfSaved(a); return f ? fileHit(f, a.title) : { title: a.title, text: String(a.text || a.title || ""), fileId: null, source: "saved", pagesOfFile: [] }; };
  if (named.length) return fileHit(named.sort((a, b) => a.name.localeCompare(b.name)).reverse()[0]);
  if (savedTitled) return pickSaved(savedTitled);
  if (asg.length) return fileHit(asg.sort((a, b) => a.name.localeCompare(b.name)).reverse()[0]);
  if (open.length) return pickSaved(open[0]);
  return null;
}

// An assignment longer than the cap keeps its first part, a list of its section titles, and the sections the message names. Returns { text, note }.
function fitAssignment(a, message, cap = LIMITS.assignment) {
  const full = scrub(a.text);
  if (full.length <= cap) return { text: full, note: "" };
  let toc = "", extra = "";
  if (a.pagesOfFile && a.pagesOfFile.length) {
    try {
      const outline = outlineLib.buildOutline(a.pagesOfFile);
      const f = outline.files[0];
      if (f) {
        toc = clip(f.sections.slice(0, 120).map((s) => `${"  ".repeat(Math.max(0, (s.level || 1) - 1))}${String(s.title).slice(0, 80)}`).join("\n"), 6000);
        const num = sectionNumber(message);
        const hits = num ? catchup.sectionByNumber(outline, `section ${num}`) : [];
        extra = clip(hits.slice(0, 2).map((u) => scrub(outlineLib.sectionText(a.pagesOfFile, f.fileId, u, 9000))).join("\n\n"), 12000);
      }
    } catch (error) { /* a failed outline only means the plain cut below */ }
  }
  // the beginning gets all the room that the titles and the named section leave
  const head = Math.max(Math.floor(cap * 0.1), cap - toc.length - extra.length - 400);
  const body = [full.slice(0, head), toc ? `[Section titles of the whole assignment]
${toc}` : "", extra ? `[The section the student named]
${extra}` : ""].filter(Boolean).join("\n\n...\n\n");
  return { text: clip(body, cap), note: `The assignment is ${full.length} characters long, so it is SHORTENED here: its beginning, its section titles and the section the student named. Say so if the answer may depend on a part you do not have.` };
}

// ---- the course notes ----
// pages: the notes (the assignment file left out). Returns { picked, block } where picked is in prompt order (for the source chips).
function notesFor({ pages, message, cap = LIMITS.notes }) {
  const picked = [];
  let total = 0;
  const add = (p, text) => { if (picked.some((x) => x.fileId === p.fileId && x.page === p.page && x.text === text)) return; picked.push({ fileId: p.fileId, fileName: p.fileName, page: p.page, text }); total += text.length; };
  const num = sectionNumber(message);
  if (num && pages.length) {
    try {
      const outline = outlineLib.buildOutline(pages);
      const hits = catchup.sectionByNumber(outline, `section ${num}`).slice(0, 1);
      for (const u of hits) {
        const text = scrub(outlineLib.sectionText(pages, u.fileId, u, 5000));
        if (text.trim()) add({ fileId: u.fileId, fileName: `${u.fileName} - section ${num}`, page: u.fromPage || 1 }, text);
      }
    } catch (error) { /* the plain search below still runs */ }
  }
  const query = clip(String(message).replace(/\[pasted block \d+\]/g, " "), 400);
  for (const p of pickPages(pages, query, { k: LIMITS.noteK })) {
    const text = clip(scrub(p.text), LIMITS.notePage);
    if (total + text.length > cap && picked.length) break;
    add(p, text);
  }
  return picked;
}

module.exports = { pickAssignment, fitAssignment, notesFor, sectionNumber, LIMITS };
