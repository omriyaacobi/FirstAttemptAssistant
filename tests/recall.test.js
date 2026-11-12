// recall.test.js
// Searching earlier chats, and "what do you know about me?". All chats and facts are made up.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../store");
const { findInChats, recallPrompt, listFound } = require("../recall");
const { describeProgress } = require("../jobs");

const used = { provider: "fake", model: "fake" };
const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), "bot-recall-")));
function chat(store, title, question, answer, { result, error, courseId } = {}) {
  const c = store.create(title, courseId ? { courseId } : {});
  store.append(c.id, [{ role: "user", text: question, at: 1000 }, { role: "assistant", text: answer, at: 2000, ...(result ? { result } : {}), ...(error ? { error: true } : {}) }]);
  return c;
}
const fakes = (overrides) => ({
  decide: async () => ({ action: "recall", destination: null, answer: "", reason: "t", query: "laptop" }),
  chainForDestination: () => [used], chainForType: () => [used], lowPools: async () => [], refreshQuota: () => {},
  askChain: async () => ({ answer: "You chose the Lenovo on 3 Nov.", used }), about: () => "", facts: () => [], addFact: () => { throw new Error("no save"); },
  searchChats: () => [],
  ...overrides,
});

test("findInChats finds the right exchange, in English and Hebrew", () => {
  const store = tmpStore();
  chat(store, "Which laptop", "which laptop should I buy for university", "Take the Lenovo T14, it has the best keyboard");
  chat(store, "Pasta", "how long do I boil pasta", "About nine minutes");
  chat(store, "קניות", "איזה מקרר כדאי לקנות למעונות", "מקרר קטן של 90 ליטר יספיק");
  assert.match(findInChats(store, "laptop")[0].answer, /Lenovo/);
  assert.match(findInChats(store, "מקרר")[0].answer, /90 ליטר/);
  assert.deepStrictEqual(findInChats(store, "xyzzy"), []);
});

test("findInChats leaves out course chats, failed answers, calendar replies and morning briefs", () => {
  const store = tmpStore();
  chat(store, "dentist", "dentist appointment", "Something went wrong", { error: true });
  chat(store, "calendar", "dentist tomorrow?", "09:00 made-up dentist", { result: { rule: "calendar (read-only)" } });
  chat(store, "Morning brief", "x", "made-up dentist at 09:00", { result: { rule: "morning brief" } });
  chat(store, "course", "dentist question", "course text", { courseId: "0123456789abcdef" });
  assert.deepStrictEqual(findInChats(store, "dentist"), []);
});

test("a question with no reply yet (the one being answered right now) is not found", () => {
  const store = tmpStore();
  const c = store.create("laptop");
  store.append(c.id, [{ role: "user", text: "what did we say about the laptop", at: 1 }]);
  assert.deepStrictEqual(findInChats(store, "laptop"), []);
});

test("one long chat cannot fill the list, and the list has a limit", () => {
  const store = tmpStore();
  const c = store.create("Laptops");
  for (let i = 0; i < 10; i++) store.append(c.id, [{ role: "user", text: `laptop question ${i}`, at: i }, { role: "assistant", text: "laptop answer", at: i }]);
  chat(store, "Other", "another laptop thought", "fine");
  const found = findInChats(store, "laptop");
  assert.ok(found.filter((f) => f.conversationId === c.id).length <= 2);
  assert.ok(found.length <= 4);
});

