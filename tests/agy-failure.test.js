// 2026-11-20: a failed agy call must say WHY (agy's own "error" field, or the end of its stderr), not only "agy status ERROR".
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { agyFailure, askAgyStream } = require("../providers");
const { createWarmAgy } = require("../warmagy");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-agy-failure-"));
const fake = path.join(dir, "fake-agy.js");
fs.writeFileSync(fake, `
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ event: "init" });
process.stdin.once("data", () => {
  if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);
  const result = { status: "ERROR" };
  if (process.env.FAKE_ERROR) result.error = process.env.FAKE_ERROR;
  out({ event: "result", result });
});
`);
const opts = { command: process.execPath, prefixArgs: [fake] };
const withEnv = async (env, fn) => { Object.assign(process.env, env); try { return await fn(); } finally { for (const k of Object.keys(env)) delete process.env[k]; } };

test("agyFailure: the reason comes from error (text or object), else stderr; it is one short line; nothing known keeps the old text", () => {
  assert.strictEqual(agyFailure({ status: "ERROR" }).message, "agy status ERROR");
  assert.strictEqual(agyFailure({ status: "ERROR", error: "model\n overloaded" }).message, "agy status ERROR: model overloaded");
  assert.strictEqual(agyFailure({ status: "ERROR", error: { message: "quota used up" } }).message, "agy status ERROR: quota used up");
  assert.strictEqual(agyFailure({ status: "ERROR" }, "  boom \n on stderr ").message, "agy status ERROR: boom on stderr");
  assert.strictEqual(agyFailure({ status: "ERROR", error: "x".repeat(900) }).message.length, "agy status ERROR: ".length + 200);
});

test("askAgyStream and the warm pool both carry agy's reason", async () => {
  await withEnv({ FAKE_ERROR: "resource exhausted" }, async () => {
    await assert.rejects(askAgyStream("q", "m", () => {}, opts), /agy status ERROR: resource exhausted/);
    const pool = createWarmAgy(opts);
    try { await assert.rejects(pool.askText("q", "m", () => {}), /agy status ERROR: resource exhausted/); } finally { pool.closeAll(); }
  });
  await withEnv({ FAKE_STDERR: "internal server error 500" }, async () => {
    await assert.rejects(askAgyStream("q", "m", () => {}, opts), /agy status ERROR: internal server error 500/);
  });
});
