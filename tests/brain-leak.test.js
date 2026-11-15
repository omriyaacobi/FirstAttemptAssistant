// tests/brain-leak.test.js
// 2026-11-15: after a photo, the model called a tool Bot does not have ("read_file") and then wrote a page of notes ABOUT the prompt
// ("HOLD ON! Look at <USER_REQUEST> ... ## Tool round 1") before its answer. Now such a reply is never shown: the model is asked once
// more for the reply only, and if that leaks too Bot says so plainly. Fake models; no real call.

const test = require("node:test");
const assert = require("node:assert");
const { createBrain, leaksPrompt } = require("../brain");

const COURSES = [{ id: "c1", name: "Systems Programming" }];
function setup(replies) {
  const prompts = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
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
  });
  return { brain, prompts };
}
const run = (brain, task) => brain.handle(task, { history: [], courses: COURSES });
const LEAK = "Wait. HOLD ON! Look at <USER_REQUEST>:\n## Tool round 1\nYou called: {\"tool\":\"read_file\"}\nLet's write the final reply.Yep, I'm here!";

test("the markers of Bot's own prompt are caught; a normal reply is not", () => {
  assert.ok(leaksPrompt(LEAK));
  assert.ok(leaksPrompt("see <tool-result id=\"ab\"> above"));
  assert.ok(!leaksPrompt("Yep, I'm here! Static binding happens at compile time; CALL me later."));
  assert.ok(!leaksPrompt("A tool round in the lab is at 10:00"));
});

test("a reply that is notes about the prompt is never shown: the model is asked once more for the reply only", async () => {
  const { brain, prompts } = setup([LEAK, "Yep, I'm here! Let's go through 2.5.3."]);
  const r = await run(brain, "are you here ?");
  assert.strictEqual(r.answer, "Yep, I'm here! Let's go through 2.5.3.");
  assert.strictEqual(prompts.length, 2);
  assert.match(prompts[1], /Write ONLY the reply to Omri now/);
});

test("if the second reply leaks too, Bot says so plainly and shows none of the notes", async () => {
  const { brain } = setup([LEAK, LEAK]);
  const r = await run(brain, "are you here ?");
  assert.ok(!leaksPrompt(r.answer));
  assert.match(r.answer, /garbled/);
});
