// selfedit-gate.test.js
// The Improve Bot gate added on 2026-11-20 (experiments/2026-11-20-selfedit-full-access.md): the test run's time limit,
// the git fence and the checks BEFORE a test run. Real temporary git repositories and FAKE editors: no model is called.
// Run with:  node --test tests/selfedit-gate.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nodeTests, TEST_TIMEOUT_MS } = require("../selfedit");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// A folder with one test that takes about 1.5 seconds.
function slowProject() {
  const dir = tmp("bot-gate-slow-");
  fs.writeFileSync(path.join(dir, "slow.test.js"), 'const test = require("node:test");\ntest("slow", () => new Promise((r) => setTimeout(r, 1500)));\n');
  return dir;
}

test("the test run's limit is 15 minutes (the full suite takes up to about 6 on a busy PC)", () => {
  assert.strictEqual(TEST_TIMEOUT_MS, 15 * 60 * 1000);
});

test("a slow test run is not cut off with the normal limit", async () => {
  const dir = slowProject();
  const result = await nodeTests(dir);
  assert.strictEqual(result.ok, true, result.tail);
  assert.strictEqual(result.timedOut, false);
  assert.strictEqual(result.total, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a run longer than its limit is stopped and says so", async () => {
  const dir = slowProject();
  const result = await nodeTests(dir, { timeoutMs: 300 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.timedOut, true);
  assert.match(result.tail, /stopped after/);
  fs.rmSync(dir, { recursive: true, force: true });
});
