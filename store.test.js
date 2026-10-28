// store.test.js
// Tests saving conversations to disk. Everything happens in a temporary folder that is
// deleted afterwards, so your real chats are never touched.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore, ID_PATTERN, MAX_MESSAGES } = require("./store");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-store-"));
  return { dir, store: createStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("create makes a conversation with a safe id and a title from the first message", () => {
  const { store, cleanup } = tempStore();
  const c = store.create("  How do   I reverse a string?  ");
  assert.match(c.id, ID_PATTERN);
  assert.strictEqual(c.title, "How do I reverse a string?");
  assert.deepStrictEqual(c.messages, []);
  cleanup();
});

test("long titles are cut", () => {
  const { store, cleanup } = tempStore();
  assert.strictEqual(store.create("x".repeat(500)).title.length, 60);
  cleanup();
});

test("append saves messages and get reads them back", () => {
  const { store, cleanup } = tempStore();
  const c = store.create("hi");
  store.append(c.id, [{ role: "user", text: "a" }, { role: "assistant", text: "b" }]);
  const loaded = store.get(c.id);
  assert.deepStrictEqual(loaded.messages.map((m) => m.text), ["a", "b"]);
  cleanup();
});

test("a conversation keeps only the newest messages", () => {
  const { store, cleanup } = tempStore();
  const c = store.create("hi");
  const many = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => ({ role: "user", text: String(i) }));
  store.append(c.id, many);
  const loaded = store.get(c.id);
  assert.strictEqual(loaded.messages.length, MAX_MESSAGES);
  assert.strictEqual(loaded.messages.at(-1).text, String(MAX_MESSAGES + 9));
  cleanup();
});

test("list returns newest first and only summary fields", () => {
  const { store, cleanup } = tempStore();
  const first = store.create("first");
  const second = store.create("second");
  store.append(first.id, [{ role: "user", text: "touch" }]); // makes "first" the most recently updated
  const list = store.list();
  assert.deepStrictEqual(list.map((c) => c.title), ["first", "second"]);
  assert.deepStrictEqual(Object.keys(list[0]).sort(), ["id", "title", "updated"]);
  assert.ok(second.id);
  cleanup();
});

test("remove deletes the file", () => {
  const { store, cleanup } = tempStore();
  const c = store.create("bye");
  assert.strictEqual(store.remove(c.id), true);
  assert.strictEqual(store.get(c.id), null);
  assert.strictEqual(store.remove(c.id), false);
  cleanup();
});

test("SECURITY: ids that are not 16 hex characters never touch the disk", () => {
  const { dir, store, cleanup } = tempStore();
  // a file just outside the store folder that a path-traversal attack would try to reach
  const secret = path.join(path.dirname(dir), "orch-secret.json");
  fs.writeFileSync(secret, JSON.stringify({ id: "x", title: "SECRET", messages: [] }));
  for (const bad of ["../orch-secret", "..\\orch-secret", "../../etc/passwd", "", "short", "ZZZZZZZZZZZZZZZZ", 42, null, undefined]) {
    assert.strictEqual(store.get(bad), null);
    assert.strictEqual(store.remove(bad), false);
  }
  assert.ok(fs.existsSync(secret)); // still there: remove() did not reach it
  fs.rmSync(secret);
  cleanup();
});

test("a corrupted file is treated as missing, not a crash", () => {
  const { dir, store, cleanup } = tempStore();
  const c = store.create("ok");
  fs.writeFileSync(path.join(dir, c.id + ".json"), "{ this is not json");
  assert.strictEqual(store.get(c.id), null);
  assert.deepStrictEqual(store.list(), []);
  cleanup();
});

test("append to a missing conversation throws", () => {
  const { store, cleanup } = tempStore();
  assert.throws(() => store.append("0123456789abcdef", [{ role: "user", text: "x" }]), /not found/);
  cleanup();
});
