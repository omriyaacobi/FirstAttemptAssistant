// lecture-parts.js
// WHAT WAS WORKED ON INSIDE A LECTURE (2026-11-17). Until now Bot kept only "lectures 1-3 done, now on lecture 4". On 2026-11-16
// Omri worked on lecture 4 of Calculus 2 for hours; when he asked "is anything left of lecture 4?" Bot had nothing to answer from,
// said the part done first was still open, and offered two exercises again. This file gives that question a real answer:
//
//   lecturesOf(outline)                      the lectures of the course notes: the "lecture N" sections the outline found (code)
//   partsOf(pages, outline, n)               the PARTS of lecture n: the topics of its pages, in order, each with an id ("4.2")
//   worked(record)                           what the course record keeps: { "4": [{ page, topic, at }] }
//   mark(record, n, parts, at) / unmark(...) a new `worked` field with those parts added / removed (the caller saves it)
//   view(pages, outline, record, n)          the parts of lecture n, each with when it was worked on (or null), and what is left
//   lines(view, { timeZone })                that view as short text lines (for the brain's context and the tool results)
//
// Where the parts come from: a lecture is a section of the notes (outline.js), so its pages are known exactly. Each page carries the
// topic words Bot stored when it READ the file (courses.js `keywords`, for example "integration by parts, Wallis formula"). The
// parts of a lecture are those stored topics, page by page. A model never writes this list at answer time: it can only hand back
// IDS from it, and code checks every id. A page with no stored topics is one part, named by its page number.
// "Worked on" means Omri practised that part with Bot. It is never "understood" (only a graded quiz sets that) and it can be undone.

const MAX_TOPICS_PER_PAGE = 5;
const MAX_PARTS = 24; // per lecture
const MAX_KEPT = 40; // marks kept per lecture
const MAX_TOPIC = 80;

const clean = (s, n = MAX_TOPIC) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => clean(s, 200).toLowerCase();
const isHebrew = (s) => /[֐-׿]/.test(s);

function lecturesOf(outline) {
  const files = (outline && outline.files) || [];
  // the file with the most lecture sections is the lecture notebook
  const best = files.map((f) => ({ f, list: f.sections.filter((s) => s.kind === "lecture" && Number.isInteger(s.lecture)) })).sort((a, b) => b.list.length - a.list.length)[0];
  if (!best || !best.list.length) return [];
  return best.list.map((s) => ({ n: s.lecture, fileId: best.f.fileId, fileName: best.f.fileName, title: s.title, start: s.start, end: s.end, fromPage: s.fromPage, toPage: s.toPage }));
}

// The stored topic words of one page -> topics. The reader usually writes each topic twice, Hebrew then English ("אינטגרציה
// בחלקים, integration by parts, נוסחת וואליס, Wallis formula"), but not always in step, so code does not pair them: when the page
// has Hebrew topics, those are the topics (the English ones repeat them); otherwise all of them are.
function topicsOfPage(page, fileName) {
  const raw = String((page && page.keywords) || "").split(/[,;\n]/).map((t) => clean(t)).filter((t) => t.length >= 2 && norm(t) !== norm(fileName));
  const hebrew = raw.filter(isHebrew);
  const list = hebrew.length >= 2 ? hebrew : raw;
  return [...new Map(list.map((t) => [norm(t), t])).values()].slice(0, MAX_TOPICS_PER_PAGE);
}

// A page belongs to the lecture that holds most of its text (a lecture may end in the middle of a page).
function pagesOfLecture(pages, lec) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && p.fileId === lec.fileId && Number.isFinite(p.page)).sort((a, b) => a.page - b.page);
  const out = [];
  let offset = 0;
  list.forEach((p, i) => {
    if (i) offset += 1; // pages are joined by one line break (outline.js fileText)
    const from = offset, to = offset + String(p.text == null ? "" : p.text).length;
    offset = to;
    const inside = Math.max(0, Math.min(to, lec.end) - Math.max(from, lec.start));
    if (inside > 0 && inside * 2 >= to - from) out.push(p);
  });
  return out;
}

function partsOf(pages, outline, n) {
  const lec = lecturesOf(outline).find((l) => l.n === Number(n));
  if (!lec) return [];
  const out = [];
  const seen = new Set(); // a topic that goes on over two pages is one part (its first page)
  for (const p of pagesOfLecture(pages, lec)) {
    const topics = topicsOfPage(p, lec.fileName).filter((t) => !seen.has(norm(t)));
    for (const topic of topics.length ? topics : [`page ${p.page}`]) { seen.add(norm(topic)); out.push({ n: lec.n, page: p.page, topic }); }
  }
  return out.slice(0, MAX_PARTS).map((x, i) => ({ ...x, id: `${lec.n}.${i + 1}` }));
}

const sameMark = (m, part) => m.page === part.page && norm(m.topic) === norm(part.topic);

function worked(record) {
  const w = record && record.worked && typeof record.worked === "object" ? record.worked : {};
  const out = {};
  for (const [k, list] of Object.entries(w)) {
    if (!/^\d{1,2}$/.test(k) || !Array.isArray(list)) continue;
    const ok = list.filter((m) => m && Number.isInteger(m.page) && typeof m.topic === "string" && Number.isFinite(m.at)).map((m) => ({ page: m.page, topic: clean(m.topic), at: m.at }));
    if (ok.length) out[k] = ok;
  }
  return out;
}
// parts: items of partsOf (already checked against the real list by the caller).
function mark(record, n, parts, at) {
  const all = worked(record);
  const old = all[String(n)] || [];
  const fresh = parts.filter((p) => !old.some((m) => sameMark(m, p))).map((p) => ({ page: p.page, topic: p.topic, at }));
  return { ...all, [String(n)]: [...old, ...fresh].slice(-MAX_KEPT) };
}
function unmark(record, n, parts) {
  const all = worked(record);
  const left = (all[String(n)] || []).filter((m) => !parts.some((p) => sameMark(m, p)));
  const out = { ...all };
  if (left.length) out[String(n)] = left; else delete out[String(n)];
  return out;
}

// The parts of lecture n with their marks. null when the notes have no such lecture.
function view(pages, outline, record, n) {
  const lec = lecturesOf(outline).find((l) => l.n === Number(n));
  if (!lec) return null;
  const marks = worked(record)[String(lec.n)] || [];
  const parts = partsOf(pages, outline, lec.n).map((p) => { const m = marks.find((x) => sameMark(x, p)); return { ...p, at: m ? m.at : null }; });
  return { n: lec.n, title: lec.title, fromPage: lec.fromPage, toPage: lec.toPage, parts, done: parts.filter((p) => p.at !== null), left: parts.filter((p) => p.at === null) };
}

function lines(v, { timeZone, now = Date.now() } = {}) {
  if (!v) return "";
  const when = (ms) => {
    const day = (t) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
    return `${day(ms) === day(now) ? "today" : day(ms)} ${time}`;
  };
  const head = `Lecture ${v.n} (pages ${v.fromPage}-${v.toPage} of the notes): ${v.done.length} of ${v.parts.length} parts worked on.`;
  const rows = v.parts.map((p) => `  ${p.id} ${p.topic} (page ${p.page}): ${p.at === null ? "NOT YET" : "worked on " + when(p.at)}`);
  const left = !v.parts.length ? "  (no parts found for this lecture)" : v.left.length ? `  Left of lecture ${v.n}: ${v.left.map((p) => p.id).join(", ")}` : `  Nothing is left of lecture ${v.n}: every part was worked on.`;
  return [head, ...rows, left].join("\n");
}

module.exports = { lecturesOf, partsOf, worked, mark, unmark, view, lines, topicsOfPage, MAX_PARTS, MAX_KEPT };
