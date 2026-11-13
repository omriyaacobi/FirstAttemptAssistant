// agy's own web search (search_web inside one agy call) counts as reading a web page: after it, no doing-tool runs in that message.
const test = require("node:test");
const assert = require("node:assert");
const { createBrain, usedWebSearch } = require("../brain");

test("usedWebSearch: only a search_web step counts", () => {
  assert.strictEqual(usedWebSearch(["search_web"]), true);
  assert.strictEqual(usedWebSearch(["view_file", "SEARCH_WEB"]), true);
  assert.strictEqual(usedWebSearch(["view_file"]), false);
  assert.strictEqual(usedWebSearch([]), false);
  assert.strictEqual(usedWebSearch(undefined), false);
});

// A brain whose fake model replies from a script; each reply can report which agy tools ran inside that call.
function brainWith(script) {
  let i = 0;
  const reminders = [];
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [], create: (r) => { reminders.push(r); return { id: "r1", ...r, at: Date.parse(r.at), status: "pending" }; } },
    memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    chain: [{ provider: "agy", model: "fake-model" }], now: () => Date.parse("2026-11-10T12:00:00Z"),
    askOne: async (provider, model, prompt, onText, extra = {}) => {
      const step = script[i++];
      if (!step) throw new Error("no more scripted replies");
      if (extra.onUsage) extra.onUsage({ input: 100, output: 10, inner: step.inner || [] });
      return step.reply;
    },
  });
  return { reminders, handle: (text) => brain.handle(text, { history: [], courses: [] }) };
}

const REMIND = 'CALL {"tool":"set_reminder","text":"buy tickets","when":"2030-01-01T10:00"}';

test("after agy's own web search in a call, set_reminder is refused in the same message", async () => {
  const { reminders, handle } = brainWith([{ reply: REMIND, inner: ["search_web"] }, { reply: "I could not set that after a web search." }]);
  const r = await handle("look up the concert date and remind me");
  assert.strictEqual(reminders.length, 0);
  assert.strictEqual(r.answer, "I could not set that after a web search.");
});

test("without a web search the same reminder is set", async () => {
  const { reminders, handle } = brainWith([{ reply: REMIND + "\nReminder set.", inner: [] }, { reply: "Reminder set." }]);
  await handle("remind me to buy tickets");
  assert.strictEqual(reminders.length, 1);
});
