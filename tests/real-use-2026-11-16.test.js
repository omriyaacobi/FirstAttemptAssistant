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
  const course = (mode) => ({ name: "Made-up Calculus", tracked: true, quizzed: true, behind: [{ date: "2026-11-04" }, { date: "2026-11-06" }], assignments: [], topicsDue: 0, position: mode ? { mode, said: "I study it alone from the notes" } : {} });
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

// ---- the Moodle watch: new files of one course can be turned off ----
test("moodle watch: with a course's files turned off, its new files are not posted; messages and other items still are", async () => {
  const os = require("node:os");
  const { createMoodleWatch } = require("../moodle-watch");
  const { createMoodleTools } = require("../moodle-tools");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-audit-watch-"));
  const BOTS = [{ id: "c1", name: "Linear Algebra" }, { id: "c2", name: "Operating Systems" }];
  const tools = createMoodleTools({ bridge: { connected: () => true }, courseRoutes: { list: () => BOTS }, dataDir: dir });
  const world = {
    courses: [{ id: 5, name: "Linear Algebra" }, { id: 6, name: "Operating Systems" }],
    items: { 5: [{ id: 100, name: "Announcements", module: "forum" }, { id: 101, name: "Lecture 1", module: "resource", files: 1 }, { id: 102, name: "Sheets", module: "folder", files: 2 }], 6: [{ id: 200, name: "Syllabus", module: "resource", files: 1 }] },
    talks: { 100: [{ d: 1, title: "Welcome", time: 1700000000 }] },
  };
  const source = { connected: () => true, ask: async (kind, args = {}) => {
    if (kind === "courses") return { data: world.courses };
    if (kind === "course") return { data: { sections: [], items: world.items[args.courseid] || [] } };
    if (kind === "forum") return { data: world.talks[args.cmid] || [] };
    if (kind === "posts") return { data: [{ subject: "Room change", author: "Dr. B", message: "We meet in room 7 from now on." }] };
    if (kind === "events") return { data: [] };
    throw new Error("not asked in this test: " + kind);
  } };
  const posted = [], logs = [];
  const watch = createMoodleWatch({ source, tools: { autoMap: () => ({ 5: "c1", 6: "c2" }), quietFiles: tools.quietFiles }, courseRoutes: { list: () => BOTS }, file: path.join(dir, "watch.json"), thread: { append: (m) => { posted.push(m); return { id: "x" }; } }, now: () => Date.parse("2026-11-16T10:00:00Z"), log: (l) => logs.push(l) });
  await watch.check(); // the first look is silent
  assert.match(tools.watchFiles("c1", false), /no longer post new files of "Linear Algebra"/);
  assert.throws(() => tools.watchFiles("zz", false), /not one of Bot's courses/);
  world.items[5].push({ id: 103, name: "Lecture 2", module: "resource", files: 1 }, { id: 104, name: "Homework 3", module: "assign" });
  world.items[5][2].files = 5;
  world.items[6].push({ id: 201, name: "Slides week 2", module: "resource", files: 1 });
  world.talks[100].unshift({ d: 2, title: "Room change", time: 1700000900 });
  const r = await watch.check();
  assert.deepStrictEqual(r.counts, { files: 1, items: 1, talks: 1, deadlines: 0 }); // only the other course's file is counted
  const text = posted[0].text;
  assert.doesNotMatch(text, /Lecture 2|Sheets/);
  assert.match(text, /new assignment \[104\] Homework 3/);
  assert.match(text, /Room change/);
  assert.match(text, /new file \[201\] Slides week 2/);
  assert.ok(logs.some((l) => /4 new files not posted/.test(l)));
  // the quiet course's files are known now: turning the switch back on does not flood Omri with the old ones
  assert.match(tools.watchFiles("c1", true), /again/);
  world.items[5].push({ id: 105, name: "Lecture 3", module: "resource", files: 1 });
  await watch.check();
  assert.match(posted[1].text, /Lecture 3/);
  assert.doesNotMatch(posted[1].text, /Lecture 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("moodle watch: the brain's tool takes a real course and on/off only, and is refused in a message with a photo", async () => {
  const calls = [];
  const mk = (replies) => {
    const b = fakeBrain(replies, { courses: TWO });
    return b;
  };
  // the fake brain above has no Moodle tools: the call fails honestly and the reply written under it is not shown
  const none = mk(['CALL {"tool":"moodle_watch","course":"Linear Algebra","files":"off"}\nDone, no more files from that course.', "I could not change that: the Moodle watch is not set up."]);
  const r0 = await none.brain.handle("stop telling me about new files in linear algebra", { history: [], courses: TWO });
  assert.strictEqual(r0.answer, "I could not change that: the Moodle watch is not set up.");
  assert.match(none.prompts[1], /FAILED, nothing was done/);
  // with Moodle tools: checked values
  const { createBrain } = require("../brain");
  const make = (replies) => { let i = 0; const prompts = []; return { prompts, brain: createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => TWO, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    moodle: { watchFiles: (id, on) => { calls.push([id, on]); return on ? "on again" : "The Moodle watch will no longer post new files."; }, explain: () => "" },
    coach: { tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), course: (r) => ({ key: r.key, assignments: [], position: {} }), save: () => {}, getSession: () => null, timetable: () => ({ courses: [] }) }, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) }, memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); return replies[i++]; }, askImage: async (m, prompt) => { prompts.push(prompt); return replies[i++]; },
    chain: [{ provider: "agy", model: "fake-model" }], photoChain: [{ provider: "agy", model: "fake-model" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {}, folderRules: { system: [] },
  }) }; };
  const ok = make(['CALL {"tool":"moodle_watch","course":"Operating Systems","files":"off"}\nOK, no more new files from Operating Systems.']);
  const r1 = await ok.brain.handle("no need to offer me new files in operating systems", { history: [], courses: TWO });
  assert.strictEqual(r1.answer, "OK, no more new files from Operating Systems.");
  assert.deepStrictEqual(calls, [["c2", false]]);
  const bad = make(['CALL {"tool":"moodle_watch","course":"Operating Systems","files":"sometimes"}\nDone.', "Do you want them off?"]);
  await bad.brain.handle("hmm", { history: [], courses: TWO });
  assert.strictEqual(calls.length, 1, "a value that is not on or off changes nothing");
  const photo = make(['CALL {"tool":"moodle_watch","course":"Operating Systems","files":"off"}\nDone.', "I cannot change that from a photo; tell me in words."]);
  const r3 = await photo.brain.handle("(photo only)", { history: [], courses: TWO, image: { path: path.join(os_tmp(), "photo.jpg") } });
  assert.strictEqual(calls.length, 1, "nothing changes in a message with a photo");
  assert.match(photo.prompts[1], /does not change the Moodle watch in a message with a photo/);
  assert.match(r3.answer, /cannot change that/);
});
function os_tmp() { return require("node:os").tmpdir(); }

// ---- follow-up, 2026-11-16 (Omri approved): the quiz line only after a graded quiz; a whole Moodle course can be turned off ----
test("brief: 'not checked by a quiz' is shown only for a course where a graded quiz was taken", () => {
  const os = require("node:os");
  const { buildLedger } = require("../brief-me");
  const { createTracker } = require("../study-tracker");
  const ledger = (quizzed) => buildLedger({ log: { day: () => [] }, tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, name: c.name })), progress: () => ({ name: "Made-up Physics", tracked: true, quizzed, behind: [{ date: "2026-11-04" }], assignments: [{ title: "Sheet 2", due: "2026-11-15", status: "todo" }], topicsDue: 0, position: {} }) }, courseList: [{ id: "c1", name: "Made-up Physics" }], today: "2026-11-13" });
  assert.ok(!ledger(false).some((l) => l.part === "behind"), "no quiz ever taken: no line");
  assert.ok(!ledger(undefined).some((l) => l.part === "behind"));
  assert.ok(ledger(false).some((l) => l.part === "todo"), "the assignment is still listed");
  assert.ok(ledger(true).some((l) => l.part === "behind"));
  // the real tracker: the flag turns on with the first graded quiz, never before
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-audit-quiz-"));
  const now = new Date("2026-11-08T08:30:00+02:00").getTime();
  const COURSES = [{ id: "b".repeat(16), name: "Systems Programming" }];
  const tracker = createTracker({ dir, now: () => now });
  const ref = tracker.refsFor(COURSES)[0];
  tracker.attachMaterial(ref, "2026-10-25", [{ fileId: "f", from: 1, to: 2 }]);
  tracker.markTaught(ref, "2026-10-25");
  assert.strictEqual(tracker.progress(ref).quizzed, false, "material and a lesson are not a quiz");
  tracker.recordCheck(ref, { type: "lecture", date: "2026-10-25" }, [{ topic: "pointers", verdict: "wrong" }, { topic: "arrays", verdict: "right" }, { topic: "structs", verdict: "partly" }]);
  assert.strictEqual(tracker.progress(ref).quizzed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("moodle watch: a whole Moodle course can be turned off, also one with no Bot course, and back on without a flood", async () => {
  const os = require("node:os");
  const { createMoodleWatch } = require("../moodle-watch");
  const { createMoodleTools } = require("../moodle-tools");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-audit-off-"));
  const BOTS = [{ id: "c1", name: "Linear Algebra" }];
  const world = {
    courses: [{ id: 5, name: "Linear Algebra" }, { id: 9, name: "Student Union Notices" }],
    items: { 5: [{ id: 101, name: "Lecture 1", module: "resource", files: 1 }], 9: [{ id: 300, name: "Announcements", module: "forum" }, { id: 301, name: "Rules", module: "resource", files: 1 }] },
    talks: { 300: [{ d: 1, title: "Welcome", time: 1700000000 }] },
    events: [],
  };
  let postReads = 0;
  const source = { connected: () => true, ask: async (kind, args = {}) => {
    if (kind === "courses") return { data: world.courses };
    if (kind === "course") return { data: { sections: [], items: world.items[args.courseid] || [] } };
    if (kind === "forum") return { data: world.talks[args.cmid] || [] };
    if (kind === "posts") { postReads++; return { data: [{ subject: "Party on Thursday", author: "The union", message: "Everyone is invited." }] }; }
    if (kind === "events") return { data: world.events };
    throw new Error("not asked in this test: " + kind);
  } };
  const tools = createMoodleTools({ bridge: source, courseRoutes: { list: () => BOTS }, dataDir: dir });
  const posted = [], logs = [];
  const nowMs = Date.parse("2026-11-16T10:00:00Z");
  const watch = createMoodleWatch({ source, tools, courseRoutes: { list: () => BOTS }, file: path.join(dir, "watch.json"), thread: { append: (m) => { posted.push(m); return { id: "x" }; } }, now: () => nowMs, log: (l) => logs.push(l) });
  await watch.check(); // the first look is silent
  // checked: only a real Moodle course of the list
  await assert.rejects(() => tools.watchCourse("Basket Weaving", false), /no Moodle course like/);
  assert.deepStrictEqual(tools.quietCourses(), {});
  const said = await tools.watchCourse("Student Union Notices", false);
  assert.match(said, /no longer post ANYTHING about the Moodle course "Student Union Notices"/);
  assert.match(said, /deadlines/);
  assert.deepStrictEqual(Object.keys(tools.quietCourses()), ["9"]);
  world.items[9].push({ id: 302, name: "Party poster", module: "resource", files: 1 }, { id: 303, name: "Survey", module: "assign" });
  world.talks[300].unshift({ d: 2, title: "Party on Thursday", time: 1700000900 });
  world.events.push({ courseId: 9, due: Math.floor(nowMs / 1000) + 86400, name: "Survey closes" });
  world.items[5].push({ id: 102, name: "Lecture 2", module: "resource", files: 1 });
  const r = await watch.check();
  assert.deepStrictEqual(r.counts, { files: 1, items: 0, talks: 0, deadlines: 0 });
  assert.match(posted[0].text, /Lecture 2/);
  assert.doesNotMatch(posted[0].text, /Party|Survey|Student Union/);
  assert.strictEqual(postReads, 0, "the messages of a course that is off are not even read");
  assert.ok(logs.some((l) => /4 new things not posted/.test(l)));
  // only that course is new: no message at all
  world.items[9].push({ id: 304, name: "More rules", module: "resource", files: 1 });
  assert.strictEqual((await watch.check()).posted, false);
  assert.strictEqual(posted.length, 1);
  // back on (by the Bot-less course's Moodle id): only what comes after is posted
  assert.match(await tools.watchCourse("9", true), /again/);
  world.items[9].push({ id: 305, name: "Election dates", module: "resource", files: 1 });
  await watch.check();
  assert.match(posted[1].text, /Election dates/);
  assert.doesNotMatch(posted[1].text, /Party poster|More rules|Survey/);
  // a linked course can be named by its Bot name
  assert.match(await tools.watchCourse("Linear Algebra", false), /Bot's course "Linear Algebra"/);
  assert.deepStrictEqual(Object.keys(tools.quietCourses()), ["5"]);
  assert.deepStrictEqual(tools.quietFiles(), {}, "the files switch is a different switch");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("moodle watch: the brain's tool turns a whole course off only with on/off, never with both switches, never with a photo", async () => {
  const { createBrain } = require("../brain");
  const calls = [];
  const make = (replies) => { let i = 0; const prompts = []; return { prompts, brain: createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => TWO, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    moodle: { watchFiles: () => { calls.push("files"); return "files changed"; }, watchCourse: async (name, on) => { if (/basket/i.test(name)) throw Object.assign(new Error('no Moodle course like "Basket Weaving". Moodle courses: Student Union Notices (id 9)'), { code: "tool" }); calls.push([name, on]); return "The Moodle watch will no longer post ANYTHING about that course."; }, explain: () => "" },
    coach: { tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), course: (r) => ({ key: r.key, assignments: [], position: {} }), save: () => {}, getSession: () => null, timetable: () => ({ courses: [] }) }, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) }, memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); return replies[i++]; }, askImage: async (m, prompt) => { prompts.push(prompt); return replies[i++]; },
    chain: [{ provider: "agy", model: "fake-model" }], photoChain: [{ provider: "agy", model: "fake-model" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {}, folderRules: { system: [] },
  }) }; };
  const ok = make(['CALL {"tool":"moodle_watch","course":"Student Union Notices","all":"off"}\nDone: nothing from the student union any more, deadlines included.']);
  const r1 = await ok.brain.handle("I do not want to hear anything from the student union course", { history: [], courses: TWO });
  assert.strictEqual(r1.answer, "Done: nothing from the student union any more, deadlines included.");
  assert.deepStrictEqual(calls, [["Student Union Notices", false]]);
  const wrong = make(['CALL {"tool":"moodle_watch","course":"Basket Weaving","all":"off"}\nDone.', "Which course do you mean?"]);
  const r2 = await wrong.brain.handle("mute that course", { history: [], courses: TWO });
  assert.strictEqual(r2.answer, "Which course do you mean?", "a course that is not real: the reply under the call is not shown");
  const both = make(['CALL {"tool":"moodle_watch","course":"Operating Systems","all":"off","files":"off"}\nDone.', "Files only, or everything?"]);
  await both.brain.handle("hmm", { history: [], courses: TWO });
  const odd = make(['CALL {"tool":"moodle_watch","course":"Operating Systems","all":"mostly"}\nDone.', "On or off?"]);
  await odd.brain.handle("hmm", { history: [], courses: TWO });
  const photo = make(['CALL {"tool":"moodle_watch","course":"Student Union Notices","all":"off"}\nDone.', "I cannot change that from a photo; tell me in words."]);
  await photo.brain.handle("(photo only)", { history: [], courses: TWO, image: { path: path.join(os_tmp(), "photo.jpg") } });
  assert.strictEqual(calls.length, 1, "none of the bad calls changed anything");
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "brain-brief.md"), "utf8").includes('"all":"off"'), "the briefing explains the switch");
});
