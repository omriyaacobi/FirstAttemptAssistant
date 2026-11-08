// outline.js
// The OUTLINE of a course's uploaded text: a list of sections found by CODE (no model), so that "section 5", "page 38" or "about halfway"
// can be mapped to a real place in the notes, and checked (a section or page that is not there is simply not found).
//
//   buildOutline(pages)  pages: [{ fileId, fileName, page, text }] (what courses.allPages gives)  ->
//     { files: [{ fileId, fileName, pageCount, realPages, chars, kind, sections: [...] }] }
//     kind: "headings" (real headings / "lecture N" lines / numbered titles) or "parts" (no headings: equal slices by size).
//     section: { id, title, kind: "lecture" | "heading" | "numbered" | "part", level, lecture?, index?, of?, start, end, fromPage, toPage, chars }
//     start/end are character offsets in the file text (pages joined by one newline).
//   sectionByName(outline, name, fileId?)      an exact title (case, spaces and a leading "#" ignored), or "lecture 5" / "הרצאה 5"; else null
//   sectionAtFraction(outline, f, fileId?)     f in 0..1 -> the section that contains that part of the text (default: the biggest file); else null
//   sectionAtPage(outline, fileId, page)       the section that holds the start of a page, only when the file has real pages; else null
//   validPages(outline, fileId, from, to)      true only for a file with REAL pages (more than one) and 1 <= from <= to <= pageCount
//
// A file converted from a web page, or any single-page document, has no real pages: pages are not accepted for it, but sections and
// fractions still work. Text is untrusted data; nothing here runs or renders it. Every pattern is applied to one line at a time (no
// nested repeats), and lines are cut at LINE_MAX, so a hostile file cannot make this slow.

const LINE_MAX = 200;
const MAX_SECTIONS = 400;
const PART_TARGET = 10, PART_MIN_CHARS = 1500; // no headings: up to 10 slices, none smaller than about this
const MAX_JUMP = 3; // "lecture 9" right after "lecture 2" is a mention, not the next heading (same rule as study.js lectureIndex)

const LECTURE_LINE = /^(?:הרצאה|שיעור|lecture|lesson)\s*(?:מס(?:פר|')?\.?\s*|number\s*|#\s*)?(\d{1,2})(?![\d])(?:\s*[:.\-–—)]\s*\S.{0,100})?\s*$/i;
const CHAPTER_LINE = /^(?:chapter|section|part|unit|פרק|חלק|יחידה|נושא)\s+(\d{1,2}|[ivx]{1,5})(?![\p{L}\d])(?:\s*[:.\-–—)]\s*\S.{0,100})?\s*$/iu;
const MD_HEADING = /^(#{1,3})\s+(\S.{0,150})$/;
const NUMBERED = /^(\d{1,2})(?:\.(\d{1,2}))?[.)]?\s+([\p{L}][^\n]{1,70})$/u;

const clean = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).replace(/^#+\s*/, "").toLowerCase();

// All lines of a text with their start offsets (the last line may have no newline).
function* linesOf(text) {
  let pos = 0;
  while (pos <= text.length) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = text.length;
    yield { raw: text.slice(pos, Math.min(end, pos + LINE_MAX)), start: pos, blankBefore: pos === 0 || text[pos - 1] === "\n" && (pos < 2 || text[pos - 2] === "\n") };
    pos = end + 1;
  }
}

function fileText(list) {
  const sorted = [...list].sort((a, b) => a.page - b.page);
  const pageStarts = [];
  let text = "";
  sorted.forEach((p, i) => { if (i) text += "\n"; pageStarts.push({ page: p.page, offset: text.length }); text += String(p.text == null ? "" : p.text); }); // a page starts after the line break that joins it
  return { text, pageStarts, pageCount: sorted.length, lastPage: sorted.length ? sorted[sorted.length - 1].page : 0 };
}
const pageAt = (pageStarts, offset) => { let page = pageStarts.length ? pageStarts[0].page : 1; for (const p of pageStarts) { if (p.offset <= offset) page = p.page; else break; } return page; };

// Explicit headings: markdown, "lecture N" lines (numbers must go up), "chapter N" lines.
function explicitHeadings(text) {
  const out = [];
  let lastLecture = 0;
  for (const { raw, start } of linesOf(text)) {
    const line = raw.trim();
    if (!line || line.length > 160) continue;
    const md = MD_HEADING.exec(line);
    const body = md ? clean(md[2]) : line;
    const lec = LECTURE_LINE.exec(body);
    if (lec) {
      const n = Number(lec[1]);
      if (n > lastLecture && n <= lastLecture + MAX_JUMP) { lastLecture = n; out.push({ start, title: clean(body), kind: "lecture", level: 1, lecture: n }); }
      continue;
    }
    if (md) { out.push({ start, title: clean(md[2]), kind: "heading", level: md[1].length }); continue; }
    if (CHAPTER_LINE.test(line)) out.push({ start, title: clean(line), kind: "heading", level: 1 });
  }
  return out;
}

// Numbered titles ("3 Memory management", "3.2 Paging"): only trusted when there are several and the top numbers rise.
function numberedHeadings(text) {
  const out = [];
  let top = 0, rises = 0;
  for (const { raw, start, blankBefore } of linesOf(text)) {
    const line = raw.trim();
    const m = NUMBERED.exec(line);
    if (!m || !blankBefore || /[.,;:]$/.test(line)) continue;
    const major = Number(m[1]);
    if (m[2] === undefined) { if (major > top && major <= top + MAX_JUMP) { top = major; rises++; out.push({ start, title: clean(line), kind: "numbered", level: 1 }); } }
    else if (major === top) out.push({ start, title: clean(line), kind: "numbered", level: 2 });
  }
  return rises >= 3 ? out : [];
}

// No headings at all: equal slices by size, cut at a line break.
function partsOf(text) {
  const k = Math.max(1, Math.min(PART_TARGET, Math.floor(text.length / PART_MIN_CHARS)));
  const out = [];
  for (let i = 0; i < k; i++) {
    let start = Math.round((text.length * i) / k);
    if (i > 0) { const nl = text.indexOf("\n", start); if (nl !== -1 && nl < text.length) start = nl + 1; }
    if (i > 0 && start <= out[out.length - 1].start) continue;
    out.push({ start, title: `Part ${out.length + 1} of ${k}`, kind: "part", level: 1, index: out.length + 1, of: k });
  }
  return out.map((p) => ({ ...p, of: out.length, title: `Part ${p.index} of ${out.length}` }));
}

function finish(heads, text, pageStarts) {
  const list = heads.sort((a, b) => a.start - b.start).filter((h, i, a) => i === 0 || h.start !== a[i - 1].start).slice(0, MAX_SECTIONS);
  return list.map((h, i) => {
    let end = text.length;
    for (let j = i + 1; j < list.length; j++) if (list[j].level <= h.level || h.kind === "part") { end = list[j].start; break; }
    return { id: `s${i + 1}`, ...h, end, fromPage: pageAt(pageStarts, h.start), toPage: pageAt(pageStarts, Math.max(h.start, end - 1)), chars: end - h.start };
  });
}

function buildOutline(pages) {
  const byFile = new Map();
  for (const p of Array.isArray(pages) ? pages : []) {
    if (!p || typeof p.fileId !== "string" || !Number.isFinite(p.page)) continue;
    byFile.set(p.fileId, [...(byFile.get(p.fileId) || []), p]);
  }
  const files = [];
  for (const [fileId, list] of byFile) {
    const { text, pageStarts, pageCount } = fileText(list);
    if (!text.trim()) continue;
    let heads = explicitHeadings(text);
    let kind = "headings";
    if (heads.length < 2) heads = numberedHeadings(text);
    if (heads.length < 2) { heads = partsOf(text); kind = "parts"; }
    files.push({ fileId, fileName: clean(list[0].fileName || ""), pageCount, realPages: pageCount > 1, chars: text.length, kind, sections: finish(heads, text, pageStarts) });
  }
  return { files };
}

const pickFile = (outline, fileId) => (fileId ? outline.files.find((f) => f.fileId === fileId) : [...outline.files].sort((a, b) => b.chars - a.chars)[0]) || null;

function sectionByName(outline, name, fileId) {
  const want = norm(name);
  if (!want) return null;
  const files = fileId ? [pickFile(outline, fileId)].filter(Boolean) : outline.files;
  for (const f of files) {
    const hit = f.sections.find((s) => norm(s.title) === want);
    if (hit) return { ...hit, fileId: f.fileId };
  }
  const lec = LECTURE_LINE.exec(want);
  if (lec) for (const f of files) { const hit = f.sections.find((s) => s.lecture === Number(lec[1])); if (hit) return { ...hit, fileId: f.fileId }; }
  return null;
}

function sectionAtFraction(outline, fraction, fileId) {
  const f = pickFile(outline, fileId);
  if (!f || !f.sections.length || typeof fraction !== "number" || !(fraction >= 0 && fraction <= 1)) return null;
  const offset = Math.min(f.chars - 1, Math.floor(fraction * f.chars));
  let hit = f.sections[0];
  for (const s of f.sections) { if (s.start <= offset) hit = s; else break; }
  // the deepest section that contains the offset is the nearest heading; a top-level one is returned when no sub-heading holds it
  return { ...hit, fileId: f.fileId };
}

function validPages(outline, fileId, from, to) {
  const f = pickFile(outline, fileId);
  return !!f && f.realPages && Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= f.pageCount;
}

function sectionAtPage(outline, fileId, page) {
  const f = pickFile(outline, fileId);
  if (!f || !validPages(outline, fileId, page, page)) return null;
  let hit = null;
  for (const s of f.sections) { if (s.fromPage <= page) hit = s; else break; }
  return hit ? { ...hit, fileId: f.fileId } : null;
}

module.exports = { buildOutline, sectionByName, sectionAtFraction, sectionAtPage, validPages, MAX_SECTIONS };
