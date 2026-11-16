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

// ---- the brain's notes about its own instructions, and its time limit ----
const { createBrain, leaksPrompt, brainTimeout, BRAIN_TIMEOUT_MS } = require("../brain");
const BRIEF = fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8").replace(/\r\n/g, "\n");
const ONE_COURSE = [{ id: "c1", name: "Linear Algebra" }];
function fakeBrain(replies, extra = {}) {
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => extra.courses || ONE_COURSE, courseFiles: () => ({ files: extra.files || [] }), linkFiles: () => [] },
    coach: { tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), course: (r) => ({ key: r.key, assignments: [], position: {} }), save: () => {}, getSession: () => null, timetable: () => ({ courses: [] }) }, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    askOne: async (provider, model, prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.now(),
    folderRules: { system: [] },
    waitPollMs: 5, waitLimitMs: 60,
  });
  return { brain, prompts };
}

test("leak: a reply that quotes a sentence of Bot's own briefing is caught; ordinary text is not", () => {
  const quoted = "Wait no! Read the prompt carefully: \"To use tools, reply with ONLY tool lines and nothing else, one per line, exactly like this:\" So I answer now. Yes, that works.";
  assert.ok(leaksPrompt(quoted, BRIEF));
  assert.ok(leaksPrompt("Hmm. It says: open and look at that one file (the only file you may read). Fine.", BRIEF));
  assert.ok(!leaksPrompt(quoted), "without the briefing only the old markers are checked");
  assert.ok(!leaksPrompt("To use a pointer, write * before its name. A reminder is set for 17:30, and the card waits for your tap.", BRIEF));
  assert.ok(!leaksPrompt("כן, זה פתרון מצוין. השדה דועך מהר מאוד עם המרחק, אז מספיק להרחיק את המטען מהראש.", BRIEF));
});

test("leak: the brain asks once more instead of showing a reply that quotes the briefing", async () => {
  const leak = "Let me think. The rule: \"Be honest about actions. Things only happen through the tools below.\" OK.\nYes, both are fine.";
  const { brain, prompts } = fakeBrain([leak, "Yes, both are fine."]);
  const r = await brain.handle("is a short cable fine?", { history: [], courses: ONE_COURSE });
  assert.strictEqual(r.answer, "Yes, both are fine.");
  assert.strictEqual(prompts.length, 2);
});

test("time limit: a brain call through agy gets at most two minutes, whatever the model's general limit", () => {
  assert.strictEqual(BRAIN_TIMEOUT_MS, 120000);
  assert.strictEqual(brainTimeout("gemini-4-argon-low"), 120000); // 240 s for reading files, 120 s here
  assert.strictEqual(brainTimeout("gemini-4-hydrogen-medium"), 120000);
  assert.strictEqual(brainTimeout("gemini-3.8-flash-medium"), 90000); // a shorter general limit is kept
});
