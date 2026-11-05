// warmagy.test.js
// Tests the pre-warmed agy against a FAKE agy (a tiny node script that speaks the same stream-json events), so no
// real model is called. The fake takes FAKE_INIT_MS to print "init" and FAKE_THINK_MS to answer.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWarmAgy } = require("./warmagy");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-fakeagy-"));
const fake = path.join(dir, "fake-agy.js");
fs.writeFileSync(fake, `
const args = process.argv.slice(2);
const initMs = Number(process.env.FAKE_INIT_MS || 0);
const thinkMs = Number(process.env.FAKE_THINK_MS || 0);
const mode = process.env.FAKE_MODE || "";
let seen = 0;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
setTimeout(() => {
  out({ event: "init", init: {} });
  if (mode === "exitearly") setTimeout(() => process.exit(0), 20);
}, initMs);
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    seen++;
    const prompt = JSON.parse(line).message.content;
    if (mode === "stuck") return;
    if (mode === "die") return process.exit(1);
    setTimeout(() => {
      if (mode === "status") return out({ event: "result", result: { status: "ERROR" } });
      if (mode === "garbage") return out({ event: "result", result: { status: "SUCCESS", response: "no json here" } });
      if (mode === "textjson") return out({ event: "result", result: { status: "SUCCESS", response: 'sure! {"action":"answer"} done' } });
      out({ event: "result", result: { status: "SUCCESS", structured_output: { seen, prompt, model: args[args.indexOf("--model") + 1], flags: args } } });
    }, thinkMs);
  }
});
`);

const SCHEMA = { type: "object", properties: { a: { type: "string" } } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withEnv = async (env, fn) => {
  const before = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};
const pool = (extra = {}) => createWarmAgy({ command: process.execPath, prefixArgs: [fake], ...extra });
const time = async (fn) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };

test("a cold call (no spare yet) works and then prepares a spare for the next message", async () => {
  const p = pool();
  const out = await p.askStructured("hello", "gemini-3.8-flash-low", SCHEMA);
  assert.strictEqual(out.prompt, "hello");
  assert.strictEqual(out.model, "gemini-3.8-flash-low");
  assert.ok(out.flags.includes("--json-schema") && out.flags.includes("stream-json"));
  assert.ok(!out.flags.includes("--dangerously-skip-permissions"));
  assert.strictEqual(p._spares.size, 1);
  p.closeAll();
});

test("a waiting spare saves the start-up time", async () => {
  await withEnv({ FAKE_INIT_MS: "1500", FAKE_THINK_MS: "20" }, async () => {
    const p = pool();
    p.warmUp("m", SCHEMA);
    await wait(2500); // the spare has printed init by now (generous: other test files run at the same time)
    const warm = await time(() => p.askStructured("q1", "m", SCHEMA));
    assert.ok(warm.ms < 1000, `warm call took ${warm.ms} ms, a cold start would take 1500+`);
    const cold = await time(() => p.askStructured("q2", "m", SCHEMA)); // the spare made after q1 is still starting
    p.closeAll();
  });
});

test("every process serves exactly one message (nothing leaks between messages)", async () => {
  const p = pool();
  const a = await p.askStructured("first secret", "m", SCHEMA);
  const b = await p.askStructured("second", "m", SCHEMA);
  const c = await p.askStructured("third", "m", SCHEMA);
  assert.deepStrictEqual([a.seen, b.seen, c.seen], [1, 1, 1]);
  assert.ok(!b.prompt.includes("first secret"));
  p.closeAll();
});

test("a spare that is too old is thrown away and a fresh process is used", async () => {
  await withEnv({ FAKE_INIT_MS: "300" }, async () => {
    const p = pool({ maxSpareAgeMs: 100 });
    p.warmUp("m", SCHEMA);
    await wait(450);
    const { ms } = await time(() => p.askStructured("q", "m", SCHEMA));
    assert.ok(ms >= 250, `expected a cold start, took ${ms} ms`);
    p.closeAll();
  });
});

test("an unused spare is killed when it gets too old, so an idle Bot leaves no agy running", async () => {
  const p = pool({ maxSpareAgeMs: 150 });
  p.warmUp("m", SCHEMA);
  assert.strictEqual(p._spares.size, 1);
  await wait(400);
  assert.strictEqual(p._spares.size, 0);
});

test("a spare that died while waiting does not break the call", async () => {
  const p = pool();
  await withEnv({ FAKE_MODE: "exitearly" }, async () => { p.warmUp("m", SCHEMA); await wait(400); });
  const out = await p.askStructured("q", "m", SCHEMA); // normal agy now; the dead spare must be skipped
  assert.strictEqual(out.prompt, "q");
  p.closeAll();
});

test("a text reply with JSON inside is accepted; one without JSON is an error", async () => {
  const p = pool();
  // closeAll between the calls: the spare made during one call was started in that call's fake mode
  assert.deepStrictEqual(await withEnv({ FAKE_MODE: "textjson" }, () => p.askStructured("q", "m")), { action: "answer" });
  p.closeAll();
  await assert.rejects(withEnv({ FAKE_MODE: "garbage" }, () => p.askStructured("q", "m")), /valid structured output.*no json here/);
  p.closeAll();
});

test("an agy error status and a process that dies are errors the caller can fall back on", async () => {
  const p = pool();
  await assert.rejects(withEnv({ FAKE_MODE: "status" }, () => p.askStructured("q", "m")), /status ERROR/);
  p.closeAll();
  await assert.rejects(withEnv({ FAKE_MODE: "die" }, () => p.askStructured("q", "m")), /closed before it answered/);
  p.closeAll();
});

test("a time limit and an abort signal both end a stuck call", async () => {
  const p = pool();
  await assert.rejects(withEnv({ FAKE_MODE: "stuck" }, () => p.askStructured("q", "m", SCHEMA, { timeoutMs: 300 })), /timed out/);
  p.closeAll();
  const controller = new AbortController();
  const pending = withEnv({ FAKE_MODE: "stuck" }, () => p.askStructured("q", "m", SCHEMA, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(pending, /aborted/);
  p.closeAll();
});

test("a bad model name is refused before anything starts", async () => {
  const p = pool();
  await assert.rejects(p.askStructured("q", "m; del *", SCHEMA), /Suspicious model name/);
  assert.strictEqual(p._spares.size, 0);
});

test("closeAll empties the pool", async () => {
  const p = pool();
  p.warmUp("m", SCHEMA);
  assert.strictEqual(p._spares.size, 1);
  p.closeAll();
  assert.strictEqual(p._spares.size, 0);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
