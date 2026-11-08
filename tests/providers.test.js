// providers.test.js
// Tests the parts of providers.js that need no real model: time limits, the Claude command line,
// the timing of chain attempts, and that a stuck child process really gets killed.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFile } = require("node:child_process");
const {
  askChain, timeoutFor, withTimeout, claudeCommand, SANDBOX_DIR,
  FLASH_TIMEOUT_MS, SONNET_TIMEOUT_MS, ARGON_TIMEOUT_MS, OPUS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS,
} = require("../providers");

test("timeoutFor: every model family has its own limit", () => {
  assert.strictEqual(timeoutFor("gemini-3.8-flash-medium"), FLASH_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("gemini-4-argon-low"), ARGON_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("gemini-4-argon-medium"), ARGON_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("opus"), OPUS_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("sonnet"), SONNET_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("claude-sonnet-5-5-medium"), SONNET_TIMEOUT_MS);
  assert.strictEqual(timeoutFor("something-new"), DEFAULT_TIMEOUT_MS);
  assert.ok(FLASH_TIMEOUT_MS < ARGON_TIMEOUT_MS && ARGON_TIMEOUT_MS <= OPUS_TIMEOUT_MS); // quick models fail over sooner
});

test("claudeCommand: no tools, no saved session, and a bad model name is refused", () => {
  const cmd = claudeCommand("sonnet");
  assert.ok(cmd.includes('--tools ""'));
  assert.ok(cmd.includes("--no-session-persistence"));
  assert.ok(cmd.includes("--model sonnet"));
  assert.throws(() => claudeCommand("sonnet; del *"), /Suspicious model name/);
});

test("model calls run in an empty folder outside the project", () => {
  assert.ok(!path.resolve(SANDBOX_DIR).startsWith(path.resolve(__dirname)));
});

test("withTimeout: a stuck process is rejected and really killed", async () => {
  const child = execFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], () => {});
  const result = await new Promise((resolve, reject) => withTimeout(child, 150, reject, "fake-model")).then(() => "finished", (e) => e.message);
  assert.strictEqual(result, "fake-model timed out after 0 s"); // 150 ms rounds to 0 s
  await new Promise((r) => child.once("close", r)); // closes only if the kill worked
  assert.ok(child.killed || child.exitCode !== null || child.signalCode !== null);
});

test("withTimeout: a process that finishes in time is left alone", async () => {
  const child = execFile(process.execPath, ["-e", "1"], () => {});
  let rejected = false;
  withTimeout(child, 5000, () => { rejected = true; }, "fast");
  await new Promise((r) => child.once("close", r));
  assert.strictEqual(rejected, false);
});

test("askChain: times every attempt, and reports the failed ones too", async () => {
  let time = 0;
  const askOne = async (provider, model) => {
    time += model === "a" ? 4000 : 1500;
    if (model === "a") throw new Error("boom");
    return "answer";
  };
  const fails = [];
  const chain = [{ provider: "agy", model: "a" }, { provider: "claude", model: "b" }];
  const result = await askChain(chain, "q", { askOne, clock: () => time, onFail: (m) => fails.push(m) });
  assert.strictEqual(result.answer, "answer");
  assert.deepStrictEqual(result.attempts, [
    { provider: "agy", model: "a", seconds: 4, ok: false },
    { provider: "claude", model: "b", seconds: 1.5, ok: true },
  ]);
  assert.strictEqual(fails[0].seconds, 4);
});

test("Claude reading a course file may only use Read: nothing else, no prompts, no skipped permissions", () => {
  const { claudeFileCommand } = require("../providers");
  const command = claudeFileCommand("sonnet");
  assert.match(command, /--restricted --tools "Read" --permission-prompts none --no-session-persistence/);
  assert.doesNotMatch(command, /dangerously|Bash|Edit|Write/);
  assert.throws(() => claudeFileCommand("sonnet; del x"), /Suspicious/);
});
