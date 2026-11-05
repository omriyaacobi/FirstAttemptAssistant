// Experiment: can plain BM25 keyword search (no packages) find the right page of course notes,
// including Hebrew? Run: node experiments/2026-11-05-study-notebooks-bm25.js
// BM25 = a classic scoring formula: a page scores higher when it contains the query words, rare words
// count more than common ones, and very long pages are not favoured. The corpus below is made up by me.

// ---- three ways to cut text into search "terms" ----
const NIQQUD = /[֑-ׇ]/g; // Hebrew vowel marks and cantillation
const clean = (s) => s.toLowerCase().replace(NIQQUD, "").replace(/["'״׳]/g, "")
  .replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ"); // final letters -> normal
const words = (s) => clean(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

const tokPlain = words;
// strip one leading Hebrew prefix letter (the, and, in, to, from, that, as) when the word is long enough
const PREFIX = /^[הוובלמשכ]/;
const tokPrefix = (s) => words(s).flatMap((w) => (/^[א-ת]/.test(w) && w.length > 3 && PREFIX.test(w) ? [w, w.slice(1)] : [w]));
// overlapping 3-letter pieces of every word: "דייקסטרה" -> דיי, ייק, יקס ...  (copes with prefixes and endings)
const tokGram = (s) => words(s).flatMap((w) => (w.length <= 3 ? [w] : Array.from({ length: w.length - 2 }, (_, i) => w.slice(i, i + 3))));

function buildIndex(pages, tok) {
  const docs = pages.map((p) => tok(p.text));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  return { docs, df, avg, n: docs.length, tok };
}
function search(index, query, k1 = 1.4, b = 0.75) {
  const q = index.tok(query);
  return index.docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (index.n - index.df.get(t) + 0.5) / (index.df.get(t) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avg));
    }
    return { i, score };
  }).sort((a, z) => z.score - a.score);
}

// ---- made-up course pages ----
const pages = [
  "אלגוריתם דייקסטרה מוצא מסלולים קצרים ביותר מצומת מקור בגרף עם משקלים אי-שליליים. הסיבוכיות עם ערימת מינימום היא O((V+E) log V).", // 0
  "אלגוריתם בלמן-פורד מטפל בקשתות עם משקל שלילי ומזהה מעגל שלילי. הסיבוכיות היא O(VE).", // 1
  "תכנות דינמי: בעיית התרמיל. נגדיר טבלה T[i][w] שהיא הערך המקסימלי בעזרת i הפריטים הראשונים ומשקל w. נוסחת הנסיגה בוחרת אם לקחת את הפריט או לא.", // 2
  "אלגוריתמים חמדנים: עץ פורש מינימלי. האלגוריתם של קרוסקל ממיין את הקשתות ומשתמש במבנה union-find כדי להימנע ממעגלים.", // 3
  "Dynamic programming: longest common subsequence. Let L[i][j] be the length of the LCS of the first i and j characters. Recurrence: if x_i = y_j then L[i-1][j-1]+1 else max.", // 4
  "Heap buffer overflow: strcpy into a malloc'd buffer that is too small overwrites the neighbouring chunk metadata. Use strncpy or snprintf and always check sizes.", // 5
  "Dangling pointer: returning the address of a local variable. The stack frame is destroyed when the function returns, so the pointer refers to dead memory.", // 6
  "תהליכים וחוטים: fork יוצר תהליך בן כפול של האב. pthread_create יוצר חוט חדש באותו מרחב כתובות. חוטים חולקים זיכרון ולכן נדרש נעילה.", // 7
  "Deadlock requires four conditions: mutual exclusion, hold and wait, no preemption, circular wait. Break any one to prevent it.", // 8
  "False sharing: two threads write different variables that live on the same cache line, so the line bounces between cores and performance collapses. Pad the data to 64 bytes.", // 9
  "אינטגרציה בחלקים: ∫u dv = uv − ∫v du. דוגמה: ∫x e^x dx = x e^x − e^x + C. בוחרים את u כפונקציה שהנגזרת שלה פשוטה יותר.", // 10
  "טורים: מבחן המנה (ד'אלמבר) קובע התכנסות של טור לפי הגבול של |a_{n+1}/a_n|. אם הגבול קטן מ-1 הטור מתכנס בהחלט.", // 11
  "Taylor series: f(x) = sum f^(n)(a)/n! (x-a)^n. The remainder term bounds the error of the polynomial approximation.", // 12
  "נגזרות חלקיות ופונקציות בשני משתנים: הגרדיאנט מצביע לכיוון העלייה התלולה ביותר. נקודת קיצון מקומית דורשת שהגרדיאנט יתאפס.", // 13
  "SIMD and vectorization: AVX2 processes eight 32-bit floats per instruction. The compiler can auto-vectorize simple loops without aliasing.", // 14
  "מודל הזיכרון של המטמון: מטמון L1 קטן ומהיר, וגישה סדרתית למערך מנצלת את הלוקליות המרחבית. מעבר על עמודות של מטריצה בסדר שורות הוא איטי.", // 15
].map((text, i) => ({ id: i, text }));

// [query, index of the page that really answers it]
const queries = [
  ["מה הסיבוכיות של דייקסטרה", 0],
  ["דייקסטרה ומשקלים שליליים", 1], // the page says "משקל שלילי"; Dijkstra is not on it, Bellman-Ford is
  ["איך פותרים את התרמיל", 2], // word form: התרמיל vs "בעיית התרמיל" (same) -> easy
  ["עצים פורשים", 3], // plural vs "עץ פורש": word form problem
  ["LCS recurrence", 4],
  ["why is strcpy dangerous", 5], // "dangerous" is not on the page: meaning, not words
  ["pointer to local variable returned from function", 6],
  ["חוטים וזיכרון משותף", 7], // "חולקים זיכרון"
  ["circular wait", 8],
  ["cache line performance two threads", 9],
  ["אינטגרל של x כפול e בחזקת x", 10], // "אינטגרל" vs "אינטגרציה": different word, same meaning
  ["התכנסות טורים", 11], // "התכנסות" and "טורים" appear in the page -> easy
  ["taylor remainder error", 12],
  ["גרדיאנט נקודת קיצון", 13],
  ["vectorization avx", 14],
  ["למה לעבור על מטריצה לפי שורות", 15],
  ["מה ההבדל בין תהליך לחוט", 7], // "תהליך" vs "תהליכים", "חוט" vs "חוטים"
  ["אלגוריתם שמוצא מסלול קצר", 0], // "מסלול" vs "מסלולים"
];

for (const [name, tok] of [["plain words", tokPlain], ["words + strip prefix letter", tokPrefix], ["3-letter pieces", tokGram]]) {
  const index = buildIndex(pages, tok);
  let top1 = 0, top3 = 0;
  const misses = [];
  for (const [q, want] of queries) {
    const rank = search(index, q).findIndex((r) => r.i === want);
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 3) top3++;
    else misses.push(`${q}  (right page was rank ${rank + 1})`);
  }
  console.log(`${name.padEnd(30)} right page first: ${top1}/${queries.length}   in top 3: ${top3}/${queries.length}`);
  for (const m of misses) console.log("     missed top 3:", m);
}
