// brief-me.test.js
// The "You" part of the morning brief: code builds the ledger from real records, the model only words it, and code drops any line
// that invents a number, claims "understood" without a passed graded quiz, or cites nothing. Fake model, made-up courses.
const test = require("node:test");
const assert = require("node:assert");
const { aboutMeBlock, buildLedger, checkLines, plainLines, CHAIN } = require("../brief-me");

const TODAY = "2026-11-13";
const log = (lines) => ({ day: (d) => (d === "2026-11-12" ? lines : []) });
const course = (over = {}) => ({ name: "Made-up Calculus", tracked: true, behind: [], assignments: [], topicsDue: 0, position: {}, ...over });
const tracker = (progressByKey) => ({ refsFor: (list) => list.map((c) => ({ key: c.id, name: c.name })), progress: (ref) => progressByKey[ref.key] });
const COURSES = [{ id: "c1", name: "Made-up Calculus" }];

const YESTERDAY = [
  { kind: "quiz", course: "Made-up Calculus", text: "Graded quiz on the lecture of Mon 9 Nov: 3 questions, 83%, passed: now Understood", understood: true },
  { kind: "lesson", course: "Made-up Calculus", text: "Lesson from the notes on the lecture of Wed 11 Nov", understood: false },
];
const PROGRESS = { c1: course({ behind: [{ date: "2026-11-04" }, { date: "2026-11-06" }], assignments: [{ title: "Exercise 4", due: "2026-11-15", status: "todo" }, { title: "Far away", due: "2026-12-30", status: "todo" }], topicsDue: 2, position: { said: "behind on the series part" } }) };

test("the ledger is code only: yesterday's log, due work, review topics, held lectures not checked, Omri's own words", () => {
  const ledger = buildLedger({ log: log(YESTERDAY), tracker: tracker(PROGRESS), courseList: COURSES, today: TODAY });
  const parts = ledger.map((l) => l.part);
  assert.deepStrictEqual(parts, ["done", "done", "todo", "todo", "behind", "said"]);
  assert.strictEqual(ledger[0].understood, true);
  assert.strictEqual(ledger[1].understood, false);
  assert.match(ledger[2].text, /"Exercise 4" is due .*in 2 days/);
  assert.ok(!ledger.some((l) => /Far away/.test(l.text)), "only the next 7 days");
  assert.match(ledger[4].text, /2 held lectures not checked by a graded quiz yet/);
});

test("revising or paused courses get no 'behind' line, and paused study reminders leave only yesterday", () => {
  const revising = { c1: course({ behind: [{ date: "2026-11-04" }], position: { mode: "revising" } }) };
  assert.ok(!buildLedger({ log: log([]), tracker: tracker(revising), courseList: COURSES, today: TODAY }).some((l) => l.part === "behind"));
  const paused = buildLedger({ log: log(YESTERDAY), tracker: tracker(PROGRESS), courseList: COURSES, today: TODAY, paused: true });
  assert.deepStrictEqual(paused.map((l) => l.part), ["done", "done"]);
});

test("checked lines: an invented number, an unearned 'understood' and a line without real citations are dropped", () => {
  const ledger = buildLedger({ log: log(YESTERDAY), tracker: tracker(PROGRESS), courseList: COURSES, today: TODAY });
  const kept = checkLines({ lines: [
    { text: "Yesterday you passed the quiz on Monday's lecture with 83% [1]", refs: [1] },
    { text: "You understood the lecture of Wed 11 Nov", refs: [2] }, // a lesson is not a passed quiz
    { text: "You scored 95% on the quiz", refs: [1] }, // 95 is not in item 1
    { text: "Exercise 4 is due in 2 days", refs: [3] },
    { text: "No citation at all", refs: [] },
    { text: "Citing an item that does not exist", refs: [42] },
    { text: "Two held lectures are still not checked", refs: [5] },
  ] }, ledger);
  assert.deepStrictEqual(kept, ["Yesterday you passed the quiz on Monday's lecture with 83%", "Exercise 4 is due in 2 days", "Two held lectures are still not checked"]);
  assert.deepStrictEqual(checkLines("nonsense", ledger), []);
});

test("the block: Flash only, the ledger inside the prompt, and the code ledger when the model fails", async () => {
  const asked = [];
  const ok = await aboutMeBlock({ log: log(YESTERDAY), tracker: tracker(PROGRESS), courseList: COURSES, today: TODAY, askChain: async (chain, prompt) => { asked.push({ chain, prompt }); return { answer: '{"lines":[{"text":"You finished a lesson yesterday","refs":[2]}]}', used: chain[0] }; } });
  assert.strictEqual(ok.text, "You\n  You finished a lesson yesterday");
  assert.ok(asked[0].chain.every((m) => /flash/.test(m.model)) && CHAIN.length === 2);
  assert.match(asked[0].prompt, /\[1\] \(done\) Made-up Calculus: Graded quiz/);
  const failed = await aboutMeBlock({ log: log([]), tracker: tracker(PROGRESS), courseList: COURSES, today: TODAY, askChain: async () => { throw new Error("quota"); } });
  assert.match(failed.text, /^You\n {2}Yesterday: nothing was recorded with Bot\.\n {2}To do: /);
  assert.match(failed.text, /Behind: Made-up Calculus: 2 held lectures/);
});

test("nothing to say: no block; paused with nothing done: one honest line", async () => {
  const empty = { c1: course() };
  const never = async () => { throw new Error("must not be asked"); };
  assert.strictEqual(await aboutMeBlock({ log: log([]), tracker: tracker(empty), courseList: COURSES, today: TODAY, askChain: never }), null);
  assert.deepStrictEqual(await aboutMeBlock({ log: log([]), tracker: tracker(empty), courseList: COURSES, today: TODAY, paused: true, askChain: never }), { text: "You\n  Study reminders are paused." });
  assert.deepStrictEqual(plainLines([]), []);
});
