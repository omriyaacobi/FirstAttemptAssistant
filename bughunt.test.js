// bughunt.test.js
// Regression tests for bugs found by reading the one-conversation code (night of 2026-11-07). Each test failed before its fix.
// Temporary folders and fakes only.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, dayOf } = require("./thread-store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-bughunt-"));
const T = new Date("2026-11-07T12:00:00").getTime();

test("a half-written last line (a crash while saving) does not swallow the NEXT message", () => {
  const dir = tmp();
  const store = createThreadStore(dir);
  store.append({ role: "user", text: "one", at: T });
  fs.appendFileSync(path.join(dir, dayOf(T) + ".jsonl"), '{"id":"m_abcdef012345","at":1,"role":"us'); // power cut: no newline at the end
  const two = store.append({ role: "user", text: "two", at: T + 1 });
  assert.deepStrictEqual(store.readDay(dayOf(T)).map((m) => m.text), ["one", "two"]);
  assert.strictEqual(store.find(two.id).text, "two");
  // and a trash tombstone after the damage is not swallowed either
  assert.strictEqual(store.trash(two.id), true);
  assert.deepStrictEqual(store.readDay(dayOf(T)).map((m) => m.text), ["one"]);
});
