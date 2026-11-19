// tests/brain-sticky.test.js
// 2026-11-19: answers took long and the log showed "Hydrogen failed (agy status ERROR) > Argon asked for course_read > Hydrogen".
// Every tool round started the model order from the top again. Now the model that answered a round answers the next rounds of the
// same message too. Made-up data only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const DB = { id: "b".repeat(16), name: "Databases Demo" };

test("after the first model fails, the model that answered keeps the next tool rounds of that message", async () => {
  const { createStudyCoach } = require("../study-coach");
  const { createBrain } = require("../brain");
  const courses = { list: () => [DB], allPages: () => [] };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-sticky-")), courses, askChain: async () => ({ answer: "x", used: { model: "f" } }), now: () => NOW });
  const asked = [];
  const askOne = async (provider, model) => {
    asked.push(model);
    if (model === "first") throw new Error("agy status ERROR");
    return asked.filter((m) => m === "second").length === 1 ? 'CALL {"tool":"course_files","course":"Databases Demo"}' : "Here is the answer.";
  };
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [DB], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({}), askOne,
    chain: [{ provider: "agy", model: "first" }, { provider: "agy", model: "second" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const r = await brain.handle("which files does Databases Demo have?", { history: [], courses: [DB] });
  assert.strictEqual(r.answer, "Here is the answer.");
  assert.deepStrictEqual(asked, ["first", "second", "second"], "round 2 went straight to the model that answered round 1");
});
