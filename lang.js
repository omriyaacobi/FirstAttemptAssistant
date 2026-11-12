// lang.js
// Which language a reply should be in. Omri writes Hebrew and English, often mixed, and a reply follows the message.
// A message counts as Hebrew when it has at least as many Hebrew WORDS as Latin ones (letters would get it wrong: in "מה זה pointer?"
// the one English word has more letters), so an English sentence with one Hebrew course name in it stays English.

const mostlyHebrew = (text) => {
  const s = String(text).replace(/https?:\/\/\S+/gi, " "); // a link is not English words: "תוריד את https://example.edu/a.pdf" is Hebrew
  const hebrew = (s.match(/[\u05d0-\u05ea]{2,}/g) || []).length;
  const latin = (s.match(/[A-Za-z]{2,}/g) || []).length;
  return hebrew > 0 && hebrew >= latin;
};
const langOf = (text) => (mostlyHebrew(text) ? "he" : "en");

// Code-written sentences come in two versions, chosen here: say("he", "Saved.", "נשמר.")
const say = (lang, en, he) => (lang === "he" ? he : en);

// "in <name>": the Hebrew letter ב joins a Hebrew name directly, and takes a hyphen before an English one (ב-Calculus).
const bet = (name) => (/^[\u05d0-\u05ea]/.test(name) ? `ב${name}` : `ב-${name}`);

module.exports = { mostlyHebrew, langOf, say, bet };
