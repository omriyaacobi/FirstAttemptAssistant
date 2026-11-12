// tests/quota-max.test.js
// The quota work of 2026-11-12 (experiments/2026-11-12-quota-max.md): the slim agy agent and the token log.
// A FAKE agy (a node script that prints the same stream-json events) and fake models only: no real model is called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyStream, ensureAgent, readUsage, readClaudeStream, BRAIN_AGENT, SANDBOX_DIR } = require("../providers");
const { createWarmAgy } = require("../warmagy");
const { createTokenLog, dayOf } = require("../tokenlog");
const { createBrain, costOf } = require("../brain");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-quota-max-"));
const fake = path.join(dir, "fake-agy.js");
// The fake answers with its own command-line arguments, and reports token numbers like the real agy does.
fs.writeFileSync(fake, `
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ event: "init" });
process.stdin.once("data", () => {
  const step = (step_index, step_type, more) => out({ event: "step_update", step_update: { step_index, step_type, ...more } });
  if (process.env.FAKE_WEB) { step(1, "agent_response", {}); step(2, "tool", { tool_name: "search_web" }); step(2, "tool", { tool_name: "search_web" }); step(3, "agent_response", { text_delta: "x" }); }
  out({ event: "result", result: { status: process.env.FAKE_STATUS || "SUCCESS", response: process.argv.slice(2).join(" "), usage: { input_tokens: 2073, output_tokens: 12, thinking_tokens: 5, cache_read_tokens: 100, total_tokens: 2190 } } });
});
`);
const opts = { command: process.execPath, prefixArgs: [fake] };

test("readUsage: one shape for agy and Claude, junk gives null", () => {
  assert.deepStrictEqual(readUsage({ input_tokens: 2073, output_tokens: 12, thinking_tokens: 5, cache_read_tokens: 100 }), { input: 2073, output: 12, thinking: 5, cacheRead: 100 });
  // Claude's names: cache creation counts as input, cache read stays apart
  assert.deepStrictEqual(readUsage({ input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 400, output_tokens: 7 }), { input: 100, output: 7, thinking: 0, cacheRead: 400 });
  for (const junk of [null, undefined, "x", {}, { input_tokens: "many" }, { input_tokens: -5 }, { input_tokens: 0 }]) assert.strictEqual(readUsage(junk), null);
});

test("readClaudeStream hands the usage of the result event over", () => {
  const out = readClaudeStream(JSON.stringify({ type: "result", result: "hi", usage: { input_tokens: 3, output_tokens: 4 } }));
  assert.deepStrictEqual(out.usage, { input: 3, output: 4, thinking: 0, cacheRead: 0 });
  assert.strictEqual(readClaudeStream(JSON.stringify({ type: "result", result: "hi" })).usage, null);
});

test("ensureAgent writes the agent file once: only search_web, and no shell, browser or file tool", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bot-agent-"));
  assert.strictEqual(ensureAgent(work), BRAIN_AGENT);
  const file = path.join(work, ".agents", "agents", BRAIN_AGENT, "agent.md");
  const text = fs.readFileSync(file, "utf8");
  const head = text.split("---")[1];
  assert.match(head, new RegExp(`name: ${BRAIN_AGENT}`));
  assert.deepStrictEqual(head.split("\n").filter((l) => /^\s+- /.test(l)).map((l) => l.trim()), ["- search_web"]); // the whole tool list
  assert.ok(!/run_command|write_file|browser/.test(head));
  const before = fs.statSync(file).mtimeMs;
  ensureAgent(work); // nothing changed: not written again
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
  fs.writeFileSync(file, "tampered");
  ensureAgent(work); // a changed file is put back
  assert.strictEqual(fs.readFileSync(file, "utf8"), text);
  fs.rmSync(work, { recursive: true, force: true });
});

test("askAgyStream: agent adds --agent, onUsage gets the tokens; without agent the arguments are as before", async () => {
  let cost = null;
  const withAgent = await askAgyStream("q", "gemini-4-argon-low", () => {}, { ...opts, agent: true, onUsage: (u) => { cost = u; } });
  assert.ok(withAgent.endsWith(`--model gemini-4-argon-low --agent ${BRAIN_AGENT}`));
  assert.deepStrictEqual(cost, { input: 2073, output: 12, thinking: 5, cacheRead: 100, turns: 1, inner: [] });
  assert.ok(fs.existsSync(path.join(SANDBOX_DIR, ".agents", "agents", BRAIN_AGENT, "agent.md"))); // written where agy runs
  const plain = await askAgyStream("q", "gemini-4-argon-low", () => {}, opts);
  assert.ok(!plain.includes("--agent"));
  assert.ok(!withAgent.includes("--dangerously-skip-permissions"));
});

test("askAgyStream: a failed call still reports what it cost, and a throwing onUsage never breaks the answer", async () => {
  let cost = null;
  process.env.FAKE_STATUS = "ERROR";
  try { await assert.rejects(askAgyStream("q", "m", () => {}, { ...opts, onUsage: (u) => { cost = u; } }), /agy status ERROR/); } finally { delete process.env.FAKE_STATUS; }
  assert.strictEqual(cost.input, 2073);
  assert.ok(await askAgyStream("q", "m", () => {}, { ...opts, onUsage: () => { throw new Error("boom"); } }));
});

test("the warm pool: agent pools start agy with --agent (the spare too) and report tokens", async () => {
  const slim = createWarmAgy({ ...opts, agent: true });
  let cost = null;
  slim.warmUp("m", null);
  assert.ok((await slim.askText("q", "m", () => {}, { onUsage: (u) => { cost = u; } })).endsWith(`--agent ${BRAIN_AGENT}`)); // the waiting spare
  assert.ok((await slim.askText("q", "m", () => {})).endsWith(`--agent ${BRAIN_AGENT}`));
  assert.deepStrictEqual(cost, { input: 2073, output: 12, thinking: 5, cacheRead: 100, turns: 1, inner: [] });
  slim.closeAll(); // the waiting spare was started before the fake was switched to web-search mode
  process.env.FAKE_WEB = "1";
  try { await slim.askText("q", "m", () => {}, { onUsage: (u) => { cost = u; } }); } finally { delete process.env.FAKE_WEB; }
  assert.deepStrictEqual([cost.turns, cost.inner], [2, ["search_web"]]);
  slim.closeAll();
  const plain = createWarmAgy(opts);
  assert.ok(!(await plain.askText("q", "m", () => {})).includes("--agent"));
  plain.closeAll();
});

test("tokenlog: adds up per day and per model, keeps numbers only, drops old days, never throws", () => {
  const file = path.join(dir, "token-log.json");
  let now = new Date(2026, 10, 12, 10).getTime();
  const log = createTokenLog({ file, now: () => now, keepDays: 2 });
  log.add([{ model: "gemini-4-argon-low", input: 16000, output: 60, thinking: 0, cacheRead: 0 }, { model: "gemini-4-argon-low", input: 18000, output: 300, thinking: 10, cacheRead: 0 }]);
  log.add([{ model: "claude-sonnet-5-5-low", input: 9000, output: 100, cacheRead: 3400 }, { model: "bad name!", input: 5 }, null]);
  log.add([]); // a message without a model call is not counted
  const day = log.read().days[dayOf(now)];
  assert.strictEqual(day.messages, 2);
  assert.deepStrictEqual(day.models["gemini-4-argon-low"], { calls: 2, input: 34000, output: 360, thinking: 10, cacheRead: 0 });
  assert.deepStrictEqual(day.models["claude-sonnet-5-5-low"], { calls: 1, input: 9000, output: 100, thinking: 0, cacheRead: 3400 });
  assert.deepStrictEqual(Object.keys(day.models).sort(), ["claude-sonnet-5-5-low", "gemini-4-argon-low"]);
  assert.match(log.report().join("\n"), /2 message\(s\), 3 model call\(s\), 46,870 tokens \(23,435 per message\)/);
  for (let i = 0; i < 3; i++) { now += 24 * 3600 * 1000; log.add([{ model: "m", input: 1 }]); }
  assert.strictEqual(Object.keys(log.read().days).length, 2); // only the newest 2 days are kept
  assert.doesNotThrow(() => createTokenLog({ file: path.join(dir, "no", "such", "\0bad") }).add([{ model: "m", input: 1 }]));
  assert.deepStrictEqual(createTokenLog({ file: path.join(dir, "missing.json") }).report(), ["No answers were counted yet."]);
});

// A brain with fake stores. Each fake model call "costs" 1,000 input tokens and 10 output tokens.
function brainWith({ replies, tokenLog = null }) {
  let i = 0;
  const logs = [];
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [], create: (r) => ({ id: "r1", ...r }) }, memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }), poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {}, tokenLog,
    askOne: async (provider, model, prompt, onText, extra = {}) => { const r = replies[i++]; if (extra.onUsage) extra.onUsage({ input: 1000, output: 10, thinking: 0, cacheRead: 0 }); if (r instanceof Error) throw r; return r; },
  });
  return { brain, logs, handle: (text) => brain.handle(text, { history: [], courses: [], log: (l) => logs.push(l) }) };
}

test("a web search inside agy is counted: two model turns, one tool step, and the brain's cost line says so", async () => {
  let cost = null;
  process.env.FAKE_WEB = "1";
  try { await askAgyStream("q", "m", () => {}, { ...opts, onUsage: (u) => { cost = u; } }); } finally { delete process.env.FAKE_WEB; }
  assert.deepStrictEqual([cost.turns, cost.inner], [2, ["search_web"]]); // the same tool step reported twice counts once
  assert.strictEqual(costOf([{ input: 5000, inner: ["search_web"] }, { input: 100 }]).text, "2 model calls, 5,100 tokens, 1 web search step inside agy");
});

test("costOf: calls and tokens in plain words", () => {
  assert.deepStrictEqual(costOf([]), { calls: 0, tokens: 0, text: "" });
  assert.strictEqual(costOf([{ input: 16000, output: 60 }]).text, "1 model call, 16,060 tokens");
  assert.strictEqual(costOf([{ input: 1000, cacheRead: 500 }, { input: 2000, output: 5, thinking: 5 }]).text, "2 model calls, 3,510 tokens");
});

test("the brain prints what an answer cost next to the model that answered, and adds it to the day's log", async () => {
  const added = [];
  const { handle, logs } = brainWith({ replies: ['CALL {"tool":"reminders_list"}', "Nothing is waiting."], tokenLog: { add: (calls) => added.push(calls) } });
  const r = await handle("what reminders do I have?");
  assert.strictEqual(r.answer, "Nothing is waiting.");
  assert.strictEqual(r.tokens, 2020);
  assert.ok(logs.some((l) => /^\[brain\] answered by gemini-4-argon-low in [\d.]+ s, tools: reminders_list, 2 model calls, 2,020 tokens$/.test(l)), logs.join("\n"));
  assert.strictEqual(added.length, 1);
  assert.deepStrictEqual(added[0], [{ model: "gemini-4-argon-low", input: 1000, output: 10, thinking: 0, cacheRead: 0 }, { model: "gemini-4-argon-low", input: 1000, output: 10, thinking: 0, cacheRead: 0 }]);
});

test("a failed model call is counted too (it was paid for), and a broken token log never breaks an answer", async () => {
  const added = [];
  const a = brainWith({ replies: [new Error("boom"), "Fine."], tokenLog: { add: (calls) => added.push(calls) } });
  assert.strictEqual((await a.handle("hello")).answer, "Fine.");
  assert.deepStrictEqual(added[0].map((c) => c.model), ["gemini-4-argon-low", "claude-sonnet-5-5-low"]);
  const b = brainWith({ replies: ["Fine."], tokenLog: { add: () => { throw new Error("disk full"); } } });
  assert.strictEqual((await b.handle("hello")).answer, "Fine.");
});

// ---- pacing the week (quota.js paceOf, paceOrder) ----
const { paceOf, paceOrder, PACE_MARGIN, createQuota } = require("../quota");
const { MODELS } = require("../router");
const { CHAIN, chainFor } = require("../brain");
const NOW = Date.parse("2026-11-12T00:00:00Z");
const inDays = (d) => new Date(NOW + d * 24 * 3600 * 1000).toISOString();
const week = (pool, remaining, daysLeft) => ({ pool, window: "Weekly Limit Remaining", remaining, resets: inDays(daysLeft) });
const ARGON_POOL = MODELS.argonLow.pool, SONNET_POOL = MODELS.sonnetInAgy.pool;
const firstOf = (r) => r.chain.map((m) => m.model);

test("paceOf: quota left minus week left; unknown, five-hour and out-of-date rows say nothing", () => {
  assert.strictEqual(paceOf([week(ARGON_POOL, 50, 3.5)], ARGON_POOL, NOW), 0); // half the quota, half the week: on pace
  assert.strictEqual(paceOf([week(ARGON_POOL, 20, 1.4)], ARGON_POOL, NOW), 0);
  assert.strictEqual(paceOf([week(ARGON_POOL, 80, 1.4)], ARGON_POOL, NOW), 60); // lots left, the week nearly over
  assert.strictEqual(paceOf([week(ARGON_POOL, 30, 5.6)], ARGON_POOL, NOW), -50); // used up too fast
  assert.strictEqual(paceOf([week(ARGON_POOL, 100, 9)], ARGON_POOL, NOW), 0); // never more than a whole week
  assert.strictEqual(paceOf([week(SONNET_POOL, 50, 3)], ARGON_POOL, NOW), null);
  assert.strictEqual(paceOf([{ pool: ARGON_POOL, window: "Five Hour Limit Remaining", remaining: 50, resets: inDays(0.1) }], ARGON_POOL, NOW), null);
  assert.strictEqual(paceOf([week(ARGON_POOL, 50, -1)], ARGON_POOL, NOW), null); // that week is over
  assert.strictEqual(paceOf([{ pool: ARGON_POOL, window: "Weekly", remaining: NaN, resets: inDays(2) }, null], ARGON_POOL, NOW), null);
  assert.strictEqual(paceOf(null, ARGON_POOL, NOW), null);
});

test("paceOrder: the pool that is clearly ahead of its week answers first; Claude Code stays last", () => {
  const order = (argon, sonnet, lead = null) => paceOrder(CHAIN, [week(ARGON_POOL, ...argon), week(SONNET_POOL, ...sonnet)], { now: NOW, lead });
  assert.deepStrictEqual(firstOf(order([100, 7], [100, 7])), ["gemini-4-argon-low", "claude-sonnet-5-5-low", "sonnet"]); // equal: the chain's own order
  assert.deepStrictEqual(firstOf(order([60, 5.6], [100, 7])), ["claude-sonnet-5-5-low", "gemini-4-argon-low", "sonnet"]); // Argon 20 behind
  assert.match(order([60, 5.6], [100, 7]).note, /^pacing the week: Claude and GPT models is 20 points ahead of Gemini 4 Argon/);
  assert.strictEqual(order([100, 7], [100, 7]).note, "");
  // a small gap changes nothing
  assert.deepStrictEqual(firstOf(order([75, 5.6], [100, 7]))[0], "gemini-4-argon-low");
  // exactly the margin switches
  assert.strictEqual(PACE_MARGIN, 10);
  assert.strictEqual(firstOf(order([70, 5.6], [100, 7]))[0], "claude-sonnet-5-5-low");
});

test("paceOrder: the model in the lead keeps it until the other is the margin ahead (no flipping per message)", () => {
  const rows = (argon, sonnet) => [week(ARGON_POOL, argon, 3.5), week(SONNET_POOL, sonnet, 3.5)];
  let r = paceOrder(CHAIN, rows(50, 60), { now: NOW }); // Sonnet 10 ahead: it takes the lead
  assert.strictEqual(r.lead, "claude-sonnet-5-5-low");
  r = paceOrder(CHAIN, rows(50, 52), { now: NOW, lead: r.lead }); // Sonnet spent some: still in the lead
  assert.strictEqual(firstOf(r)[0], "claude-sonnet-5-5-low");
  r = paceOrder(CHAIN, rows(50, 45), { now: NOW, lead: r.lead }); // Argon 5 ahead: not enough
  assert.strictEqual(firstOf(r)[0], "claude-sonnet-5-5-low");
  r = paceOrder(CHAIN, rows(50, 40), { now: NOW, lead: r.lead }); // Argon 10 ahead: back to Argon
  assert.strictEqual(firstOf(r)[0], "gemini-4-argon-low");
  assert.strictEqual(r.lead, "gemini-4-argon-low");
  assert.strictEqual(r.note, "");
});

test("paceOrder: nothing known, or one pool unknown, leaves the chain alone; BOT_BRAIN_FIRST=claude keeps Claude Code first", () => {
  assert.deepStrictEqual(firstOf(paceOrder(CHAIN, [], { now: NOW })), firstOf({ chain: CHAIN }));
  assert.deepStrictEqual(firstOf(paceOrder(CHAIN, [week(SONNET_POOL, 100, 7)], { now: NOW })), firstOf({ chain: CHAIN }));
  const claudeFirst = chainFor("claude");
  const r = paceOrder(claudeFirst, [week(ARGON_POOL, 30, 5.6), week(SONNET_POOL, 100, 7)], { now: NOW });
  assert.deepStrictEqual(firstOf(r), ["sonnet", "claude-sonnet-5-5-low", "gemini-4-argon-low"]); // only the two agy models change places
  assert.deepStrictEqual(firstOf(paceOrder([MODELS.argonLow, MODELS.claudeSonnet], [week(ARGON_POOL, 1, 7)], { now: NOW })), ["gemini-4-argon-low", "sonnet"]);
  assert.strictEqual(CHAIN[0].model, "gemini-4-argon-low"); // the input chain is never changed
});

test("createQuota.rows hands out the raw rows the pacing needs", async () => {
  const q = createQuota({ fetchRows: async () => [week(ARGON_POOL, 40, 2)], fetchClaude: async () => ({ rows: [], errorText: "" }), now: () => NOW });
  await q.refresh();
  assert.deepStrictEqual((await q.rows()).map((r) => [r.pool, r.remaining]), [[ARGON_POOL, 40]]);
});

// The brain with fake pools: which model is asked first, and what the log says about it.
function pacedBrain() {
  const state = { rows: [], levels: [], asked: [], logs: [] };
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    poolRows: async () => state.rows, poolLevels: async () => state.levels, refreshPools: () => {}, notePoolFailure: () => {},
    askOne: async (provider, model) => { state.asked.push(model); return "Fine."; }, now: () => NOW,
  });
  const send = async () => { state.asked.length = 0; state.logs.length = 0; await brain.handle("hello", { history: [], courses: [], log: (l) => state.logs.push(l) }); return state.asked[0]; };
  return { state, send };
}

test("the brain paces the week: the agy pool that is ahead answers first, says why, and keeps the lead for a stretch", async () => {
  const { state, send } = pacedBrain();
  assert.strictEqual(await send(), "gemini-4-argon-low"); // nothing known: the chain as written
  state.rows = [week(ARGON_POOL, 60, 5.6), week(SONNET_POOL, 100, 7)]; // Argon is 20 points behind its week
  assert.strictEqual(await send(), "claude-sonnet-5-5-low");
  assert.ok(state.logs.some((l) => /^\[brain\] pacing the week: Claude and GPT models is 20 points ahead of Gemini 4 Argon .*: asking claude-sonnet-5-5-low first$/.test(l)), state.logs.join("\n"));
  state.rows = [week(ARGON_POOL, 60, 5.6), week(SONNET_POOL, 85, 7)]; // the gap shrank to 5: Sonnet keeps the lead
  assert.strictEqual(await send(), "claude-sonnet-5-5-low");
  state.rows = [week(ARGON_POOL, 60, 5.6), week(SONNET_POOL, 70, 7)]; // Argon is now 10 ahead: back to Argon, and nothing to explain
  assert.strictEqual(await send(), "gemini-4-argon-low");
  assert.ok(!state.logs.some((l) => /pacing the week/.test(l)));
});

test("pacing never beats the safety rules: Argon in its reserve steps back even when its pace is better", async () => {
  const { state, send } = pacedBrain();
  state.rows = [week(ARGON_POOL, 20, 1.2), week(SONNET_POOL, 29, 5.7)]; // the real numbers of 2026-11-12: Argon +3, Sonnet -52
  state.levels = [{ pool: ARGON_POOL, remaining: 20 }, { pool: SONNET_POOL, remaining: 29 }];
  assert.strictEqual(await send(), "claude-sonnet-5-5-low"); // Argon is under its 25% reserve
  assert.ok(state.logs.some((l) => /Gemini 4 Argon 20% left: asking claude-sonnet-5-5-low first/.test(l)), state.logs.join("\n"));
  state.levels = [{ pool: ARGON_POOL, remaining: 60 }, { pool: SONNET_POOL, remaining: 10 }]; // agy's Claude pool under 15%
  state.rows = [week(ARGON_POOL, 60, 6.5), week(SONNET_POOL, 10, 0.2)]; // ...although its week is nearly over (pace +7 against -33)
  assert.strictEqual(await send(), "gemini-4-argon-low");
});
