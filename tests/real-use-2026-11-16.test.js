// tests/real-use-2026-11-16.test.js
// Fixes from the audit of Omri's real use (experiments/2026-11-16-real-use-audit.md). All data here is made up.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { languageLine } = require("../brain");

const HEBREW_TURN = { role: "user", text: "אני לא מבין איך בוחרים את ההצבה באינטגרל הזה" };
const ENGLISH_TURN = { role: "user", text: "why does my loop never stop on the last element?" };

test("language: a formula-only message after a Hebrew message keeps Hebrew, it does not force English", () => {
  const line = languageLine("u=x dv=e^x", [HEBREW_TURN, { role: "assistant", text: "מה תבחר בתור u?" }]);
  assert.match(line, /keep replying in Hebrew/);
  assert.doesNotMatch(line, /write the reply in English/);
  assert.match(languageLine("PDF", [HEBREW_TURN]), /keep replying in Hebrew/);
  assert.match(languageLine("15/4", [HEBREW_TURN]), /keep replying in Hebrew/);
});

test("language: the page's words for a photo sent without text do not force English in a Hebrew talk", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const m = /attached \? "([^"]+)" : ""\)/.exec(page);
  assert.ok(m, "the page has its own words for a photo without text");
  assert.match(languageLine(m[1], [HEBREW_TURN]), /keep replying in Hebrew/);
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8").includes(m[1]), "the briefing explains those words");
});

test("language: a real English sentence still gets the English line, also after a Hebrew message", () => {
  assert.match(languageLine("why did you answer in Hebrew just now?", [HEBREW_TURN]), /write the reply in English/);
  assert.match(languageLine("check again", [ENGLISH_TURN]), /write the reply in English/); // the talk was English anyway
  assert.match(languageLine("compilation error"), /write the reply in English/); // no history: as before
  assert.match(languageLine("למה זה לא עובד?", [ENGLISH_TURN]), /write the reply in Hebrew/);
  assert.doesNotMatch(languageLine("ok", [HEBREW_TURN]), /write the reply in English/);
});
