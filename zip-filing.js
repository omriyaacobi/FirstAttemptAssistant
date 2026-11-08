// zip-filing.js
// What happens to the files of an opened zip once a course is known, shared by the chat upload (thread-files.js) and the course page
// upload (course-routes.js), so the wording and the rules are in ONE place:
//   fileMany    each file takes the single-upload road (addUpload: real first bytes, 50 MB, course size, no duplicate); one that fails is
//               SKIPPED with its reason and the others go on.
//   zipSummary  ONE short message, in the user's language. The numbers add up: filed + already in the course + compiled leftovers +
//               small images + other skipped (+ waiting) = every file seen, and the last line says that total. Only the "other
//               skipped" files are listed (at most 5); duplicates, leftovers and small images are each ONE counted line.
//   filedName   the name a file is filed under (a code file keeps the end of its path).
// Names from a zip are untrusted: only ever shown as text, never used as paths.

const { say: words, bet } = require("./lang");
const { cleanName } = require("./upload");

const showName = (n) => cleanName(n, "file");

// A name or a path is English/LTR text: in a Hebrew sentence it is wrapped in isolate marks (LRI ... PDI), so it cannot scramble the
// punctuation or the order around it. English text gets no marks.
const iso = (lang, s) => (lang === "he" ? `⁦${s}⁩` : s);
const inCourse = (c) => (/^[א-ת]/.test(c) ? bet(c) : `ב-⁦${c}⁩`); // "in <course>" (Hebrew)
const REASON_HE = { type: "סוג קובץ לא נתמך", name: "שם לא בטוח", link: "קישור סימבולי", nested: "zip בתוך zip לא נפתח", password: "מוגן בסיסמה", compression: "דחיסה לא מוכרת", toomany: "יותר מדי קבצים", codebig: "קובץ קוד גדול מדי", big: "קובץ גדול מדי", damaged: "קובץ פגום", empty: "קובץ ריק", notext: "לא טקסט אמיתי (נראה בינארי)", dup: "כבר בקורס", refused: "הקובץ לא התקבל", other: "לא נתמך" };
const MAX_SKIP_LINES = 5;
const plural = (n, lang, one, many, oneHe, manyHe) => (lang === "he" ? (n === 1 ? oneHe : `${n} ${manyHe}`) : `${n} ${n === 1 ? one : many}`);

function zipSummary(lang, zipName, filed, skipped, waiting) {
  const junk = skipped.filter((s) => s.code === "junk").length; // compiled / tool leftovers: only counted
  const small = skipped.filter((s) => s.code === "small").length; // tiny, blank or repeated pictures: only counted
  const dup = skipped.filter((s) => s.code === "dup").length; // already in the course: only counted
  const listed = skipped.filter((s) => s.code !== "junk" && s.code !== "small" && s.code !== "dup");
  const extra = Math.max(0, listed.length - MAX_SKIP_LINES);
  const skipLines = listed.slice(0, MAX_SKIP_LINES).map((s) => `- ${iso(lang, showName(s.name))}: ${lang === "he" ? REASON_HE[s.code] || REASON_HE.other : s.reason}`).join("\n");
  const count = (k) => filed.filter((f) => (f.kind || (f.group === "code" ? "code" : "text")) === k).length;
  const kinds = [
    [count("text"), "text file", "text files", "קובץ טקסט אחד", "קבצי טקסט"],
    [count("pdf"), "PDF", "PDFs", "קובץ PDF אחד", "קבצי PDF"],
    [count("office"), "Word/PowerPoint file", "Word/PowerPoint files", "קובץ Word/PowerPoint אחד", "קבצי Word/PowerPoint"],
    [count("image"), "image", "images", "תמונה אחת", "תמונות"],
    [count("code"), "code file", "code files", "קובץ קוד אחד", "קבצי קוד"],
  ].filter(([n]) => n).map(([n, one, many, oneHe, manyHe]) => plural(n, lang, one, many, oneHe, manyHe)).join(", ");
  const byCourse = new Map();
  for (const f of filed) byCourse.set(f.courseName, (byCourse.get(f.courseName) || 0) + 1);
  const split = byCourse.size > 1;
  const whereEn = [...byCourse].map(([c, n]) => `${split ? `${n} ` : ""}in ${c}`).join(", ");
  const whereHe = [...byCourse].map(([c, n]) => `${split ? `${n} ` : ""}${inCourse(c)}`).join(", ");
  const parts = [];
  if (filed.length) parts.push(words(lang, `From "${zipName}" I filed ${plural(filed.length, "en", "file", "files")} (${kinds}) ${whereEn}. Bot is reading them now.`, `מתוך "${iso(lang, zipName)}" תייקתי ${plural(filed.length, "he", "", "", "קובץ אחד", "קבצים")} (${kinds}) ${whereHe}. Bot קורא אותם עכשיו.`));
  else parts.push(words(lang, `Nothing from "${zipName}" was filed.`, `שום דבר מתוך "${iso(lang, zipName)}" לא תויק.`));
  if (waiting) parts.push(words(lang, `${waiting} more file${waiting === 1 ? "" : "s"} wait for you: which course are they for? Tap one below. Nothing is saved until you choose.`, `עוד ${waiting} קבצים מחכים: לאיזה קורס הם שייכים? אפשר ללחוץ על אחד למטה. שום דבר לא נשמר לפני הבחירה.`));
  if (dup) parts.push(words(lang, `${dup} ${dup === 1 ? "was" : "were"} already in the course.`, dup === 1 ? "קובץ אחד כבר היה בקורס." : `${dup} קבצים כבר היו בקורס.`));
  if (listed.length) parts.push(words(lang, `Skipped ${listed.length}:\n${skipLines}${extra ? `\n...and ${extra} more` : ""}`, `דולגו ${listed.length}:\n${skipLines}${extra ? `\n...ועוד ${extra}` : ""}`));
  if (junk) parts.push(words(lang, `Also skipped ${junk} compiled/binary file${junk === 1 ? "" : "s"}.`, `בנוסף דולגו ${junk} קבצים מקומפלים/בינאריים.`));
  if (small) parts.push(words(lang, `Skipped ${small} small, empty or repeated image${small === 1 ? "" : "s"} (icons, lines, formulas).`, small === 1 ? "תמונה אחת קטנה, ריקה או כפולה דולגה." : `דולגו ${small} תמונות קטנות, ריקות או כפולות (אייקונים, קווים, נוסחאות).`));
  const all = filed.length + waiting + skipped.length; // everything the zip held that Bot looked at
  if (skipped.length) parts.push(words(lang, `That is ${all} files in the zip in all.`, `בסך הכול ${all} קבצים ב-zip.`));
  return parts.join("\n\n");
}

// Files from a zip, into one course. Adds to `filed` and `skipped`. addUpload(courseId, bytes, name) throws a status error when refused.
function fileMany(addUpload, courseId, courseName, items, filed, skipped) {
  for (const item of items) {
    try {
      addUpload(courseId, item.bytes, item.name);
      filed.push({ name: item.name, courseName, group: item.group, kind: item.kind });
    } catch (error) {
      skipped.push({ name: item.name, reason: error.status === 409 ? "already in the course" : String(error.message).slice(0, 120), code: error.status === 409 ? "dup" : "refused" });
    }
  }
}

// The name a zip file is filed under. A code file keeps the end of its path (src/parser.c), because many projects have several
// files with the same short name (Makefile, main.c). Only shown as text, never a path.
const filedName = (item) => (item.group === "code" ? showName(String(item.path || item.name).split("/").slice(-3).join("/")) : showName(item.name));

module.exports = { zipSummary, fileMany, filedName, showName };
