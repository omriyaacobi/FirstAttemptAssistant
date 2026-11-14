// summary-endofday.test.js
// The END-OF-DAY review (Omri, 2026-11-14): at 23:45 Flash high sums up the day, with "done" notes that point at real messages;
// a day that went on after its note is made again later without losing the state of facts already shown; the next morning
// catches up when the PC was off. Fake model, made-up messages. (Times are local: the thread store and the timer use this PC's zone.)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore } = require("../thread-store");
const { createSummaries, checkSummary, transcriptOf, END_OF_DAY } = require("../thread-summary");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-eod-"));
const T = (h, m = 0, d = 14) => new Date(2026, 10, d, h, m).getTime();
const ANSWER = (n = 1) => JSON.stringify({
  summary: "The user worked on a made-up C assignment and fixed a crash.",
  facts: [{ text: "The user studies at a made-up university", quote: "I study at a made-up university", msg: 1 }],
  tasks: [],
  openQuestions: [],
  done: [{ text: "Fixed the crash in the made-up Stage B tests", msg: n }, { text: "Points at no real message", msg: 99 }, { text: "x", msg: 1 }],
});

function setup() {
  const thread = createThreadStore(tmp());
  const clock = { now: T(10) };
  const asked = [];
  const answers = [];
  const summaries = createSummaries({ thread, dir: tmp(), now: () => clock.now, askChain: async (chain, prompt) => { asked.push({ chain: chain.map((m) => m.model), prompt }); return { answer: answers.shift() || ANSWER(), used: chain[0] }; } });
  const say = (role, text, at) => thread.append({ role, text, at, topic: "general" });
  return { thread, clock, asked, answers, summaries, say };
}

test("done notes must point at a real message of the day; they need no quote and never become facts", () => {
  const s = setup();
  s.say("user", "I study at a made-up university", T(10));
  s.say("assistant", "Great, the made-up Stage B tests pass now", T(11));
  const { byNumber } = transcriptOf(s.thread.readDay("2026-11-14"));
  const c = checkSummary(JSON.parse(ANSWER(2)), { byNumber });
  assert.deepStrictEqual(c.done.map((d) => d.text), ["Fixed the crash in the made-up Stage B tests"]);
  assert.ok(c.done[0].msg.startsWith("m_"));
  assert.strictEqual(c.dropped, 2);
  assert.ok(!c.facts.some((f) => /crash/.test(f.text)));
});

test("end of day: nothing before 23:45; at 23:45 today's review is made once with Flash high; a later message makes it again and keeps the facts' state", async () => {
  const s = setup();
  s.say("user", "I study at a made-up university", T(10));
  s.say("assistant", "Noted, good luck with the made-up course", T(10, 1));
  s.clock.now = T(23, 0);
  assert.strictEqual(await s.summaries.endOfDay(), null);
  assert.strictEqual(END_OF_DAY, 23 * 60 + 45);
  s.clock.now = T(23, 46);
  const first = await s.summaries.endOfDay();
  assert.strictEqual(first.done.length, 1);
  assert.deepStrictEqual(s.asked[0].chain, ["gemini-3.8-flash-high", "gemini-3.8-flash-medium"]);
  assert.strictEqual(await s.summaries.endOfDay(), null, "not twice");
  s.summaries.accept(first.facts[0].id); // Omri tapped Save on the fact card
  s.say("user", "one more made-up question before bed", T(23, 50));
  s.say("assistant", "a made-up answer", T(23, 51));
  s.clock.now = T(23, 55);
  const again = await s.summaries.endOfDay();
  assert.strictEqual(s.asked.length, 2);
  assert.strictEqual(again.facts.length, 1, "the same fact is not proposed twice");
  assert.strictEqual(again.facts[0].state, "accepted", "a fact already saved stays saved");
});

test("the PC was off at night: the next morning catches up yesterday, also when it went on after its note", async () => {
  const s = setup();
  s.say("user", "I study at a made-up university", T(10, 0, 13));
  s.say("assistant", "a made-up reply", T(10, 1, 13));
  s.clock.now = T(8, 30, 14);
  assert.deepStrictEqual(await s.summaries.catchUp(), ["2026-11-13"]);
  assert.strictEqual(s.summaries.doneOf("2026-11-13").length, 1);
  assert.deepStrictEqual(await s.summaries.catchUp(), [], "made once");
  // the other case: the end-of-day note was made at 23:46, then a message came at 23:59: the next morning it is made again
  const t = setup();
  t.say("user", "I study at a made-up university", T(10, 0, 13));
  t.say("assistant", "a made-up reply", T(10, 1, 13));
  t.clock.now = T(23, 46, 13);
  assert.ok(await t.summaries.endOfDay());
  t.say("user", "late made-up message", T(23, 59, 13));
  t.clock.now = T(8, 30, 14);
  assert.deepStrictEqual(t.summaries.missingDays(), ["2026-11-13"]);
  assert.deepStrictEqual(await t.summaries.catchUp(), ["2026-11-13"]);
  assert.deepStrictEqual(s.summaries.doneOf("2099-01-01"), []);
});

test("after a failed run the models are not asked again for 30 minutes (the timer ticks every minute)", async () => {
  const s = setup();
  s.say("user", "I study at a made-up university", T(10, 0, 13));
  s.say("assistant", "Noted", T(10, 1, 13));
  s.answers.push("not json at all");
  s.clock.now = T(9);
  await s.summaries.catchUp(); // fails: no JSON
  assert.strictEqual(s.asked.length, 1);
  s.clock.now = T(9, 10);
  await s.summaries.catchUp();
  assert.strictEqual(s.asked.length, 1); // still waiting
  s.clock.now = T(9, 31);
  await s.summaries.catchUp();
  assert.strictEqual(s.asked.length, 2); // tried again after the wait, and this time it worked
  assert.ok(s.summaries.read("2026-11-13").summary);
});
