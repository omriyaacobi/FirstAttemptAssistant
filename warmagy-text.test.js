// warmagy-text.test.js
// Tests askText of the pre-warmed agy (the ANSWER step: a plain text answer written piece by piece) with a FAKE agy that
// speaks the same stream-json events. No real model is called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWarmAgy } = require("./warmagy");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-fakeagy-text-"));
const fake = path.join(dir, "fake-agy.js");
fs.writeFileSync(fake, `
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE || "";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ event: "init", init: {} });
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    if (mode === "dieonce" && !require("fs").existsSync(process.env.FAKE_DIE_FLAG)) { require("fs").writeFileSync(process.env.FAKE_DIE_FLAG, "x"); return process.exit(1); }
    const second = mode === "twosteps" ? 3 : 1;
    const send = (step, text) => out({ event: "step_update", step_update: { step_index: step, state: "ACTIVE", step_type: "agent_response", text_delta: text } });
    setTimeout(() => send(1, "Hello "), 10);
    setTimeout(() => send(second, "wor"), 20);
    setTimeout(() => send(second, "ld"), 30);
    setTimeout(() => out({ event: "result", result: mode === "noresponse" || mode === "twosteps" ? { status: "SUCCESS" } : mode === "error" ? { status: "ERROR" } : { status: "SUCCESS", response: "Hello world (final) pid " + process.pid + " flags " + args.join(" ") } }), 60);
  }
});
`);

const pool = () => createWarmAgy({ command: process.execPath, prefixArgs: [fake] });
const withEnv = async (env, fn) => {
  const before = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("askText: pieces arrive while the answer is written, and the final result is the answer", async () => {
  const p = pool();
  const seen = [];
  const answer = await p.askText("what is 2+2?", "gemini-3.8-flash-medium", (t) => seen.push(t));
  assert.deepStrictEqual(seen, ["Hello ", "Hello wor", "Hello world"]);
  assert.match(answer, /^Hello world \(final\) pid \d+/); // the result event wins over the pieces
  assert.ok(answer.includes("stream-json") && answer.includes("gemini-3.8-flash-medium"));
  assert.ok(!answer.includes("--dangerously-skip-permissions")); // same flags as the normal call, nothing extra
  p.closeAll();
});

test("askText: without a result text the pieces are the answer; a second reply step starts a new paragraph", async () => {
  const p = pool();
  assert.strictEqual(await withEnv({ FAKE_MODE: "noresponse" }, () => p.askText("q", "m", () => {})), "Hello world");
  p.closeAll();
  const seen = [];
  await withEnv({ FAKE_MODE: "twosteps" }, () => p.askText("q", "m", (t) => seen.push(t)));
  assert.strictEqual(seen[seen.length - 1], "Hello \n\nworld");
  p.closeAll();
});

test("askText: a broken onText breaks nothing, and an agy error status is an error", async () => {
  const p = pool();
  assert.match(await p.askText("q", "m", () => { throw new Error("page bug"); }), /^Hello world/);
  p.closeAll();
  await assert.rejects(withEnv({ FAKE_MODE: "error" }, () => p.askText("q", "m", () => {})), /status ERROR/);
  p.closeAll();
});

test("askText: the waiting spare answers, and each process serves exactly one message", async () => {
  const p = pool();
  p.warmUp("m", null);
  const sparePid = p._spares.values().next().value.pid;
  const first = await p.askText("q1", "m", () => {});
  assert.ok(first.includes(`pid ${sparePid} `));
  const second = await p.askText("q2", "m", () => {});
  assert.ok(!second.includes(`pid ${sparePid} `));
  p.closeAll();
});

test("askText: a spare that dies at the moment the prompt arrives is replaced at once", async () => {
  const flag = path.join(dir, "died-once");
  fs.rmSync(flag, { force: true });
  await withEnv({ FAKE_MODE: "dieonce", FAKE_DIE_FLAG: flag }, async () => {
    const p = pool();
    p.warmUp("m", null);
    await wait(500);
    assert.match(await p.askText("q", "m", () => {}), /^Hello world/);
    assert.ok(fs.existsSync(flag), "the first process really did die");
    p.closeAll();
  });
});

test("askText: a time limit and an abort signal both end a stuck call", async () => {
  const stuck = path.join(dir, "stuck.js");
  fs.writeFileSync(stuck, 'process.stdout.write(JSON.stringify({ event: "init" }) + "\\n"); setInterval(() => {}, 1000);');
  const p = createWarmAgy({ command: process.execPath, prefixArgs: [stuck] });
  await assert.rejects(p.askText("q", "m", () => {}, { timeoutMs: 300 }), /timed out/);
  p.closeAll();
  const controller = new AbortController();
  const pending = p.askText("q", "m", () => {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(pending, /aborted/);
  p.closeAll();
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
