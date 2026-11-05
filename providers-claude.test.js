// providers-claude.test.js
// Tests askClaudeStructured and the abort signal against a FAKE `claude` program (a tiny node script), so no real
// Claude is called and no plan quota is used. The fake prints what the test tells it to through the FAKE_MODE env var.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-fakeclaude-"));
const fake = path.join(dir, "fake-claude.js");
fs.writeFileSync(fake, `
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const schema = args[args.indexOf("--json-schema") + 1];
  const mode = process.env.FAKE_MODE;
  if (mode === "stuck") return setInterval(() => {}, 1000);
  if (mode === "garbage") return process.stdout.write("not json at all");
  if (mode === "error") return process.stdout.write(JSON.stringify({ is_error: true, result: "You've hit your limit" }));
  if (mode === "text") return process.stdout.write(JSON.stringify({ is_error: false, result: '{"action":"answer"}' }));
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: { echoedPrompt: input, args, schema: JSON.parse(schema) } }));
});
`);
process.env.CLAUDE_CMD = `"${process.execPath}" "${fake}"`;
const { askClaudeStructured } = require("./providers");

const SCHEMA = { type: "object", properties: { a: { type: "string", enum: ["x", "y"] } }, required: ["a"] };
const withMode = async (mode, fn) => { process.env.FAKE_MODE = mode; try { return await fn(); } finally { delete process.env.FAKE_MODE; } };

test("askClaudeStructured: sends the prompt on stdin and the schema as a real JSON argument, with no tools", async () => {
  const out = await askClaudeStructured("hello <b>there</b>", "haiku", SCHEMA);
  assert.strictEqual(out.echoedPrompt, "hello <b>there</b>");
  assert.deepStrictEqual(out.schema, SCHEMA); // the quotes survived the shell
  assert.ok(out.args.includes("--tools") && out.args.includes("") && out.args.includes("--no-session-persistence"));
  assert.ok(out.args.includes("haiku") && out.args.includes("json"));
});

test("askClaudeStructured: a reply with the result as text is parsed too", async () => {
  assert.deepStrictEqual(await withMode("text", () => askClaudeStructured("q", "haiku", SCHEMA)), { action: "answer" });
});

test("askClaudeStructured: claude's own error (a used-up plan, an expired login) becomes an error to fall back on", async () => {
  await assert.rejects(withMode("error", () => askClaudeStructured("q", "haiku", SCHEMA)), /hit your limit/);
});

test("askClaudeStructured: output that is not JSON is an error", async () => {
  await assert.rejects(withMode("garbage", () => askClaudeStructured("q", "haiku", SCHEMA)), /not json/);
});

test("askClaudeStructured: a bad model name is refused before anything runs", () => {
  assert.throws(() => askClaudeStructured("q", "haiku; del *", SCHEMA), /Suspicious model name/);
});

test("askClaudeStructured: a time limit and an abort signal both end a stuck call", async () => {
  await assert.rejects(withMode("stuck", () => askClaudeStructured("q", "haiku", SCHEMA, { timeoutMs: 400 })), /timed out/);
  const controller = new AbortController();
  const pending = withMode("stuck", () => askClaudeStructured("q", "haiku", SCHEMA, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(pending, /aborted/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
