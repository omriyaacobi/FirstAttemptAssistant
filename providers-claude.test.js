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
  if (args.includes("stream-json") && !args.includes("--json-schema")) { // askClaude: plain answers in stream-json mode
    const ev = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
    if (mode === "stream-text") return process.stdout.write("just text, no JSON\\n");
    ev({ type: "system", subtype: "init" });
    ev({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1793989800, status: "allowed" } } } });
    if (mode === "stream-error") { ev({ type: "result", is_error: true, result: "You've hit your limit" }); process.exit(1); }
    return ev({ type: "result", is_error: false, result: "the answer is 42\\n", echoedPrompt: input });
  }
  if (mode === "stuck") return setInterval(() => {}, 1000);
  if (mode === "garbage") return process.stdout.write("not json at all");
  if (mode === "error") return process.stdout.write(JSON.stringify({ is_error: true, result: "You've hit your limit" }));
  if (mode === "text") return process.stdout.write(JSON.stringify({ is_error: false, result: '{"action":"answer"}' }));
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: { echoedPrompt: input, args, schema: JSON.parse(schema) } }));
});
`);
process.env.CLAUDE_CMD = `"${process.execPath}" "${fake}"`;
const { askClaudeStructured, ask, onClaudeRateLimit, readClaudeStream } = require("./providers");

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

// ---- askClaude in stream-json mode: the answer, and the rate limits that come with it ----
const seen = [];
onClaudeRateLimit((info) => seen.push(info));
onClaudeRateLimit(() => { throw new Error("a broken listener must not matter"); });

test("askClaude: returns the answer text from the result event and hands the rate limits to listeners", async () => {
  process.env.FAKE_MODE = "stream";
  seen.length = 0;
  assert.strictEqual(await ask("claude", "sonnet", "hello"), "the answer is 42");
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].unifiedWindows.five_hour.utilization, 0.5);
});

test("askClaude: a failed call rejects with the error text, and the rate limits are still reported", async () => {
  process.env.FAKE_MODE = "stream-error";
  seen.length = 0;
  await assert.rejects(ask("claude", "sonnet", "hello"), /hit your limit/);
  assert.strictEqual(seen.length, 1);
});

test("askClaude: output that is not stream-json is returned as it is (the old behaviour)", async () => {
  process.env.FAKE_MODE = "stream-text";
  assert.strictEqual(await ask("claude", "sonnet", "hello"), "just text, no JSON");
});

test("readClaudeStream: skips junk lines and keeps the rate_limit_info objects", () => {
  const out = readClaudeStream('junk\n{broken\n{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}\n{"type":"result","is_error":false,"result":"hi"}\n');
  assert.deepStrictEqual(out, { parsed: true, text: "hi", isError: false, infos: [{ status: "allowed" }] });
  assert.deepStrictEqual(readClaudeStream(""), { parsed: false, text: "", isError: false, infos: [] });
});
