// search.js
// Finds the pages of ONE course that match a question. No model, no packages: plain BM25.
// BM25 is a classic scoring formula: a page scores higher when it holds the query's terms, rare terms
// count more than common ones, and a long page does not win just for being long.
//
// A "term" is a overlapping 3-letter piece of a word ("דייקסטרה" -> דיי, ייק, יקס ...). In my test
// (experiments/2026-11-05-study-notebooks-bm25.js) this found the right page far more often than whole
// words, because Hebrew words carry prefixes and endings (עץ / עצים, תהליך / תהליכים).
// Known weakness: synonyms (אינטגרל vs אינטגרציה). The reading step adds a KEYWORDS line per page to help.

const NIQQUD = /[֑-ׇ]/g; // Hebrew vowel marks
const FINALS = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

function terms(text) {
  const clean = String(text).toLowerCase().replace(NIQQUD, "").replace(/["'״׳]/g, "").replace(/[ךםןףץ]/g, (c) => FINALS[c]);
  const out = [];
  for (const word of clean.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 && !/\d/.test(word)) continue; // a single digit counts ("theorem 5")
    if (word.length <= 3) out.push(word);
    else for (let i = 0; i + 3 <= word.length; i++) out.push(word.slice(i, i + 3));
  }
  return out;
}

// pages: [{ text, keywords? }]. The keywords count as part of the page text.
function createIndex(pages) {
  const docs = pages.map((p) => terms(`${p.keywords || ""} ${p.text || ""}`));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const total = docs.reduce((a, d) => a + d.length, 0);
  return { docs, df, avg: docs.length ? total / docs.length || 1 : 1, n: docs.length };
}

// The best `k` pages as [{ index, score }], best first. Pages that match nothing are left out.
function search(index, query, k = 6, k1 = 1.4, b = 0.75) {
  const q = terms(query);
  const scored = [];
  index.docs.forEach((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const dfT = index.df.get(t);
      const idf = Math.log(1 + (index.n - dfT + 0.5) / (dfT + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avg));
    }
    if (score > 0) scored.push({ index: i, score });
  });
  return scored.sort((a, z) => z.score - a.score).slice(0, k);
}

module.exports = { terms, createIndex, search };
