// course-pages.js
// Small helpers for the pages of a course, used by the brain (brain.js, course-material.js), the tutor (tutor.js) and the study
// coach (study-coach.js). They came out of the old study.js on 2026-11-17, when the course chats' own answering code (askCourse, its
// web check and crosslang.js) was deleted: nothing could reach it since the brain answers every message (code review question 5).
//   pickPages     the best-matching pages for a question (search.js, no model), within a size cap
//   lectureIndex  the pages of each lecture, found by its heading in the notes
//   askedLectures the lecture numbers a message names ("lecture 5", "הרצאה חמישית")
//   sourcesFor    which of the sent pages an answer cited, built in code
//   labelOutside  the fixed "Outside your files:" label for [OUT]
//   defang        strips our own fence markers out of page text

const { createIndex, search } = require("./search");

const TOP_PAGES = 12;
const MAX_MATERIAL_CHARS = 30000; // all pages together, for a normal search
const MAX_PAGE_SHOWN = 6000; // one page, in the prompt

// Strips anything that looks like our fence, so a page cannot "close" the block and pretend to be instructions.
const defang = (text) => String(text).replace(/<\/?\s*(?:course-material|web-result)[^>]*>/gi, "").replace(/=== ?END ?[A-Z0-9]+ ?===/g, "");

// Picks the pages to send: the best matches for the question, within the size cap. Returns the pages in
// the order they will be numbered [1], [2], ...
function pickPages(pages, question, { k = TOP_PAGES } = {}) {
  if (pages.length === 0) return [];
  const hits = search(createIndex(pages), question, k);
  const picked = [];
  let total = 0;
  for (const { index } of hits) {
    const p = pages[index];
    const text = defang(p.text).slice(0, MAX_PAGE_SHOWN);
    if (total + text.length > MAX_MATERIAL_CHARS && picked.length > 0) break;
    picked.push({ fileId: p.fileId, fileName: p.fileName, page: p.page, text });
    total += text.length;
  }
  return picked;
}

// ---- Finding a lecture by its number ----
// A search cannot do this: "lecture 5" has only one useful word, and that word is on every lecture's first page.
// Lecture notebooks have headings, so code finds them. Numbers must go up, which skips a later "as we saw in lecture 3".
const LECTURE_HEADING = /(?:הרצאה|שיעור|lecture|lesson)\s*(?:מס(?:פר|')?\.?\s*|number\s*|#\s*)?(\d{1,2})/gi;
const MAX_HEADING_JUMP = 3; // a bigger jump is a mention of a far-away lecture, not the next heading

// pages -> [{ lecture, fileId, from, to, pages }]. A lecture ends on the page where the next one starts, because it may end mid-page.
function lectureIndex(pages) {
  const out = [];
  const byFile = new Map();
  for (const p of pages) byFile.set(p.fileId, [...(byFile.get(p.fileId) || []), p]);
  for (const [fileId, list] of byFile) {
    const sorted = [...list].sort((a, b) => a.page - b.page);
    const starts = [];
    for (const p of sorted) {
      for (const m of String(p.text).matchAll(LECTURE_HEADING)) {
        const n = Number(m[1]);
        const last = starts.length ? starts[starts.length - 1].lecture : 0;
        if (n > last && n <= last + MAX_HEADING_JUMP) starts.push({ lecture: n, from: p.page });
      }
    }
    starts.forEach((s, i) => {
      const to = i + 1 < starts.length ? starts[i + 1].from : sorted[sorted.length - 1].page;
      out.push({ lecture: s.lecture, fileId, from: s.from, to, pages: sorted.filter((p) => p.page >= s.from && p.page <= to) });
    });
  }
  return out;
}

const ORDINALS = { ראשונה: 1, שניה: 2, שנייה: 2, שלישית: 3, רביעית: 4, חמישית: 5, שישית: 6, שביעית: 7, שמינית: 8, תשיעית: 9, עשירית: 10 };
const ASKED = /(?:הרצא(?:ה|ות|ת)|שיעור(?:ים)?|lectures?|lessons?)\s*(?:מס(?:פר|')?\.?\s*|number\s*|#\s*)?(\d{1,2})((?:\s*(?:-|–|—|,|&|ו-?|and|to|until|עד)\s*\d{1,2}(?!\s*(?:שאלות|תרגילים|דקות|ימים|questions?|exercises?|minutes|days)))*)/gi;
const ASKED_WORD = new RegExp(`(?:הרצאה|שיעור)\\s*ה?(${Object.keys(ORDINALS).join("|")})`, "g");

// The lecture numbers a message names: "הרצאה 5", "lectures 4-6", "lecture 4 and 5", "הרצאה חמישית".
function askedLectures(text) {
  const out = new Set();
  for (const m of String(text).matchAll(ASKED)) {
    let last = Number(m[1]);
    out.add(last);
    for (const part of m[2].matchAll(/\s*(-|–|—|to|until|עד)?[^\d]*?(\d{1,2})/gi)) {
      const n = Number(part[2]);
      if (part[1] && n > last) for (let i = last + 1; i < n; i++) out.add(i);
      if (!part[1] || n > last) out.add(n); // "lecture 5 - 3 questions" is not lectures 5 to 3
      last = n;
    }
  }
  for (const m of String(text).matchAll(ASKED_WORD)) out.add(ORDINALS[m[1]]);
  return [...out];
}

// Which of the sent pages did the answer cite ([S2], [S1, S3])? If none, show them all: they were all in front of the model.
function sourcesFor(answer, picked) {
  const cited = new Set();
  for (const bracket of String(answer).matchAll(/\[([^\]]{1,40})\]/g)) {
    for (const s of bracket[1].matchAll(/S(\d{1,3})\b/g)) cited.add(Number(s[1]));
  }
  const used = picked.map((p, i) => ({ n: i + 1, ...p })).filter((p) => cited.has(p.n));
  return (used.length ? used : picked.map((p, i) => ({ n: i + 1, ...p }))).map(({ n, fileId, fileName, page }) => ({ n, fileId, file: fileName, page }));
}

// Replaces the [OUT] tags by a fixed label, in the language of the question. Done in code so the label is always there and always the same.
function labelOutside(answer, question) {
  const label = /[\u0590-\u05ff]/.test(question) ? "מחוץ לקבצים:" : "Outside your files:";
  return String(answer).replace(/\[OUT\][ \t]*/g, `${label} `);
}

module.exports = { pickPages, lectureIndex, askedLectures, sourcesFor, labelOutside, defang, TOP_PAGES, MAX_MATERIAL_CHARS };
