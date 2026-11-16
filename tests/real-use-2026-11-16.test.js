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

// ---- which course the talk is in ----
const TWO = [{ id: "c1", name: "Linear Algebra" }, { id: "c2", name: "Operating Systems" }];
const aboutC1 = () => ({ role: "assistant", text: "A basis is a set of independent vectors that spans the space.", courseId: "c1", at: Date.now() - 60000 });

test("course: the brain can say the talk left the courses; the answer is then filed under no course", async () => {
  const { brain, prompts } = fakeBrain(['CALL {"tool":"talk_course","course":"none"}\nSocks go in the normal way round.'], { courses: TWO });
  const r = await brain.handle("should socks go in the wash inside out?", { history: [aboutC1()], courses: TWO });
  assert.match(prompts[0], /The course this talk is in: Linear Algebra/); // code's guess from the last answer
  assert.strictEqual(r.answer, "Socks go in the normal way round.");
  assert.strictEqual(r.courseId, undefined);
  assert.strictEqual(r.noCourse, true);
  assert.strictEqual(prompts.length, 1, "no extra model round: the reply came under the CALL line");
});

test("course: after a no-course answer, older course answers do not pull the next message back into the course", async () => {
  const { brain, prompts } = fakeBrain(["And sweaters go inside out."], { courses: TWO });
  const history = [aboutC1(), { role: "user", text: "should socks go in the wash inside out?" }, { role: "assistant", text: "Socks go in the normal way round.", noCourse: true, at: Date.now() - 1000 }];
  const r = await brain.handle("and sweaters?", { history, courses: TWO });
  assert.doesNotMatch(prompts[0], /## The course this talk is in/);
  assert.strictEqual(r.courseId, undefined);
});

test("course: the brain can move the talk to another real course; a made-up course is refused", async () => {
  const a = fakeBrain(['CALL {"tool":"talk_course","course":"Operating Systems"}\nA thread shares its process\'s memory.'], { courses: TWO });
  const r = await a.brain.handle("so back to what we did yesterday, what does a thread share?", { history: [aboutC1()], courses: TWO });
  assert.strictEqual(r.courseId, "c2");
  assert.strictEqual(r.courseName, "Operating Systems");
  const b = fakeBrain(['CALL {"tool":"talk_course","course":"Basket Weaving"}\nDone.', "Which course do you mean?"], { courses: TWO });
  const r2 = await b.brain.handle("continue", { history: [aboutC1()], courses: TWO });
  assert.strictEqual(r2.answer, "Which course do you mean?"); // the reply written under a failed call is never shown
  assert.match(b.prompts[1], /FAILED, nothing was done: there is no course called "Basket Weaving"/);
  assert.strictEqual(r2.courseId, "c1");
});

test("course: a reply to a marked part of an answer is in that answer's course, not in the newest one", async () => {
  const { brain, prompts } = fakeBrain(["It shares the heap."], { courses: TWO });
  const r = await brain.handle("what does this part mean?", { history: [aboutC1()], courses: TWO, quote: { id: "m_aaaaaaaaaaaa", text: "shares its memory", role: "assistant", at: Date.now() - 9e6, courseId: "c2" } });
  assert.match(prompts[0], /The course this talk is in: Operating Systems/);
  assert.strictEqual(r.courseId, "c2");
});

test("course: the quote check hands over the quoted answer's course, and the memory keeps the no-course mark", () => {
  const { checkQuote } = require("../quote");
  const { buildHistory } = require("../thread-context");
  const messages = [
    { id: "m_aaaaaaaaaaaa", role: "assistant", text: "a thread shares its memory", at: 5, result: { brain: true, courseId: "c2", courseName: "Operating Systems" } },
    { id: "m_bbbbbbbbbbbb", role: "assistant", text: "socks go in normally", at: 6, result: { brain: true, noCourse: true } },
  ];
  const thread = { find: (id) => messages.find((m) => m.id === id) || null, page: () => ({ messages }) };
  assert.strictEqual(checkQuote(thread, { messageId: "m_aaaaaaaaaaaa", text: "shares its memory" }).courseId, "c2");
  assert.strictEqual(checkQuote(thread, { messageId: "m_bbbbbbbbbbbb", text: "socks" }).courseId, undefined);
  const history = buildHistory(thread, { entryOf: (m) => ({ role: m.role, text: m.text }) });
  assert.strictEqual(history[0].courseId, "c2");
  assert.strictEqual(history[1].noCourse, true);
});

// ---- the "You" part of the morning brief ----
test("brief: a long line is never cut in the middle of a word or sentence part", () => {
  const { fitLine, checkLines, MAX_LINE, prompt } = require("../brief-me");
  const ledger = [{ n: 1, part: "done", text: "In the talk: worked on the matrix exercise", understood: false }];
  const medium = "Yesterday you finished the row reduction exercise, fixed the sign mistake in the third pivot and wrote the first half of the proof about the rank of a product, and then you started the next sheet.";
  assert.ok(medium.length > 180 && medium.length < MAX_LINE);
  assert.deepStrictEqual(checkLines({ lines: [{ text: medium, refs: [1] }] }, ledger), [medium]); // 180 used to cut this one at "...and"
  const long = "You worked through the first exercise sheet. " + "Then you repeated the long computation with the bigger matrix and checked every step against the notes ".repeat(4);
  const cut = fitLine(long);
  assert.ok(cut.length <= MAX_LINE);
  assert.ok(cut.endsWith("...") || cut.endsWith("."));
  assert.ok(long.startsWith(cut.replace(/\.\.\.$/, "")));
  assert.match(long.slice(cut.replace(/\.\.\.$/, "").length), /^(\s|$|\.)/, "the cut is at a word end");
  assert.strictEqual(fitLine("short line"), "short line");
  assert.match(prompt(ledger), /each under \d+ characters/);
});

test("brief and nudge: a course Omri studies alone gets no 'lectures not checked' count and no lecture nudge", () => {
  const os = require("node:os");
  const { buildLedger } = require("../brief-me");
  const { createTracker } = require("../study-tracker");
  const { createNudges } = require("../study-nudges");
  // the brief's ledger
  const course = (mode) => ({ name: "Made-up Calculus", tracked: true, behind: [{ date: "2026-11-04" }, { date: "2026-11-06" }], assignments: [], topicsDue: 0, position: mode ? { mode, said: "I study it alone from the notes" } : {} });
  const ledger = (mode) => buildLedger({ log: { day: () => [] }, tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, name: c.name })), progress: () => course(mode) }, courseList: [{ id: "c1", name: "Made-up Calculus" }], today: "2026-11-13" });
  assert.ok(ledger(null).some((l) => l.part === "behind"), "nothing said about the course: the count stays");
  assert.ok(ledger("attending").some((l) => l.part === "behind"));
  for (const mode of ["selfStudy", "notStarted", "revising", "paused"]) assert.ok(!ledger(mode).some((l) => l.part === "behind"), mode);
  assert.ok(ledger("selfStudy").some((l) => l.part === "said"), "Omri's own words stay in the ledger");
  // the morning nudge
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-audit-"));
  const now = new Date("2026-11-08T08:30:00+02:00").getTime();
  const COURSES = [{ id: "a".repeat(16), name: "Systems Programming" }];
  const tracker = createTracker({ dir, now: () => now });
  const nudges = createNudges({ tracker, courseList: () => COURSES, now: () => now });
  const sp = tracker.refsFor(COURSES)[0];
  tracker.attachMaterial(sp, "2026-10-25", [{ fileId: "f", from: 1, to: 2 }]);
  assert.ok(nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setStanding(sp, { mode: "selfStudy", said: "I study this one alone from the notes" });
  assert.ok(!nudges.candidates().some((c) => c.kind === "lecture"));
  tracker.setStanding(sp, { mode: "attending", said: "I go to the lectures again" });
  assert.ok(nudges.candidates().some((c) => c.kind === "lecture"));
  fs.rmSync(dir, { recursive: true, force: true });
});
