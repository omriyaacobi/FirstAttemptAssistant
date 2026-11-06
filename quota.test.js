// quota.test.js
// Tests the quota logic with fake usage data. No model and no agy are ever called.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const { parseUsage, parseClaudeStream, rowFromRateLimitInfo, parseResetTime, limitError, lowPools, prioritize, describeLow, createQuota, LOW_THRESHOLD } = require("./quota");

const row = (pool, remaining, window = "Five Hour Limit Remaining") => ({ pool, window, remaining, resets: "x" });
const A = { provider: "agy", model: "a", pool: "Pool A" };
const B = { provider: "agy", model: "b", pool: "Pool B" };
const C = { provider: "claude", model: "c", pool: null };

test("parseUsage reads agy's tab-separated lines and skips noise", () => {
  const rows = parseUsage("Gemini Models\tFive Hour Limit Remaining\t99%\t2026-10-28T01:41:40Z\n\nnoise\n");
  assert.deepStrictEqual(rows, [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 99, resets: "2026-10-28T01:41:40Z" }]);
});

test("lowPools: uses the lowest window of each pool and the threshold", () => {
  const rows = [row("Pool A", 100, "Weekly"), row("Pool A", 10), row("Pool B", LOW_THRESHOLD), row("Pool C", 3)];
  assert.deepStrictEqual(lowPools(rows), [{ pool: "Pool A", remaining: 10 }, { pool: "Pool C", remaining: 3 }]);
  assert.deepStrictEqual(lowPools(rows, 5), [{ pool: "Pool C", remaining: 3 }]);
});

test("lowPools: unreadable numbers and missing data mean 'not low'", () => {
  assert.deepStrictEqual(lowPools([row("Pool A", NaN)]), []);
  assert.deepStrictEqual(lowPools(null), []);
  assert.deepStrictEqual(lowPools([]), []);
});

test("prioritize: a low pool's models go last, order kept, nothing removed", () => {
  const result = prioritize([A, B, C], [{ pool: "Pool A", remaining: 4 }]);
  assert.deepStrictEqual(result.chain, [B, C, A]);
  assert.deepStrictEqual(result.moved, [A]);
});

test("prioritize: models without a pool (the Claude CLI) are never moved", () => {
  const result = prioritize([C, A], [{ pool: "Pool A", remaining: 4 }]);
  assert.deepStrictEqual(result.chain, [C, A]);
  assert.deepStrictEqual(result.moved, []); // A was already last, so nothing changed
});

test("prioritize: if every model is low, the chain is left alone", () => {
  const low = [{ pool: "Pool A", remaining: 4 }, { pool: "Pool B", remaining: 2 }];
  const result = prioritize([A, B], low);
  assert.deepStrictEqual(result.chain, [A, B]);
  assert.deepStrictEqual(result.moved, []);
});

test("prioritize: no low pools means no change, and the input is not modified", () => {
  const chain = [A, B];
  const result = prioritize(chain, []);
  assert.deepStrictEqual(result.chain, [A, B]);
  assert.deepStrictEqual(chain, [A, B]);
});

const noClaude = async () => ({ rows: [], errorText: "" }); // tests never run the real Claude probe
const settle = () => new Promise((r) => setImmediate(r));

test("createQuota: the flag starts as 'nothing is low' and get() never starts a lookup", async () => {
  let calls = 0;
  const q = createQuota({ fetchClaude: noClaude, fetchRows: async () => { calls++; return [row("Pool A", 5)]; } });
  assert.deepStrictEqual(await q.get(), []);
  assert.strictEqual(calls, 0); // even the very first message does not look anything up
});

test("createQuota: get() answers at once even while a lookup is still running", async () => {
  const q = createQuota({ fetchClaude: noClaude, fetchRows: () => new Promise(() => {}) }); // never finishes
  q.refresh();
  assert.deepStrictEqual(await q.get(), []);
});

test("createQuota: refresh() updates the flag for the next message", async () => {
  const q = createQuota({ fetchClaude: noClaude, fetchRows: async () => [row("Pool A", 5)] });
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
});

test("createQuota: a failed refresh leaves the flag as it was", async () => {
  let calls = 0;
  const q = createQuota({ fetchClaude: noClaude, fetchRows: async () => { if (++calls > 1) throw new Error("agy is down"); return [row("Pool A", 5)]; } });
  await q.refresh();
  await q.refresh(); // fails, and does not throw
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
});

test("createQuota: no new lookup starts while one is running", async () => {
  let calls = 0, release;
  const q = createQuota({ fetchClaude: noClaude, fetchRows: () => { calls++; return new Promise((r) => { release = () => r([row("Pool A", 90)]); }); } });
  q.refresh(); q.refresh(); q.refresh();
  assert.strictEqual(calls, 1);
  release();
  await settle();
  q.refresh(); // the first one is done, so a new one may start
  assert.strictEqual(calls, 2);
});

// ---- the Claude plan (fake CLI output; the real claude is never run) ----
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const inHours = (h) => Math.floor((NOW + h * 3600000) / 1000); // resetsAt is in SECONDS
const event = (info) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info, uuid: "u", session_id: "s" });
const HIT = "You've hit your limit · resets 3pm (Asia/Jerusalem)";

test("rowFromRateLimitInfo: utilization is the share USED (0..1), so 0.93 used means 7% left", () => {
  const r = rowFromRateLimitInfo({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.93, resetsAt: inHours(2) }, NOW);
  assert.deepStrictEqual(r, { pool: "Claude plan", window: "Five Hour Limit Remaining", remaining: 7, resets: new Date(NOW + 2 * 3600000).toISOString(), source: "claude" });
});

test("rowFromRateLimitInfo: weekly windows, Opus has its own pool, rejected means 0 left", () => {
  assert.strictEqual(rowFromRateLimitInfo({ status: "allowed", rateLimitType: "seven_day", utilization: 0.2, resetsAt: inHours(50) }, NOW).remaining, 80);
  assert.strictEqual(rowFromRateLimitInfo({ status: "allowed", rateLimitType: "seven_day_opus", utilization: 0.5, resetsAt: inHours(50) }, NOW).pool, "Claude plan (Opus)");
  assert.strictEqual(rowFromRateLimitInfo({ status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: inHours(1) }, NOW).remaining, 0);
});

test("rowFromRateLimitInfo: a warning without a number counts as low; unknown or malformed input is ignored", () => {
  assert.ok(rowFromRateLimitInfo({ status: "allowed_warning", rateLimitType: "five_hour", resetsAt: inHours(1) }, NOW).remaining < LOW_THRESHOLD);
  assert.strictEqual(rowFromRateLimitInfo({ status: "allowed", rateLimitType: "overage" }, NOW), null);
  assert.strictEqual(rowFromRateLimitInfo({ status: "allowed", rateLimitType: "five_hour; rm -rf" }, NOW), null);
  assert.strictEqual(rowFromRateLimitInfo("nope", NOW), null);
  assert.strictEqual(rowFromRateLimitInfo(null, NOW), null);
  // a rejected event with an unknown window still marks the plan as used up, with a default reset time
  const r = rowFromRateLimitInfo({ status: "rejected" }, NOW);
  assert.strictEqual(r.pool, "Claude plan");
  assert.strictEqual(r.remaining, 0);
  assert.ok(Date.parse(r.resets) > NOW);
});

test("parseClaudeStream: reads rate_limit_event lines, skips junk, and returns an error result's text", () => {
  const text = [
    "not json", "{broken",
    JSON.stringify({ type: "system", subtype: "init" }),
    event({ status: "allowed", rateLimitType: "five_hour", utilization: 0.4, resetsAt: inHours(3) }),
    JSON.stringify({ type: "result", is_error: true, result: HIT }),
  ].join("\n");
  const out = parseClaudeStream(text, NOW);
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].remaining, 60);
  assert.match(out.errorText, /hit your limit/);
  assert.deepStrictEqual(parseClaudeStream("", NOW), { rows: [], errorText: "" });
});

test("parseResetTime: epoch seconds after a pipe, ISO times, and 'resets 3pm (zone)'", () => {
  assert.strictEqual(parseResetTime("Claude AI usage limit reached|1793000000", NOW), 1793000000 * 1000);
  assert.strictEqual(parseResetTime("limit, try again after 2026-11-06T18:00:00Z", NOW), Date.UTC(2026, 10, 6, 18));
  // 12:00 UTC is 14:00 in Jerusalem (UTC+2 in November), so the next 3pm there is 13:00 UTC, one hour away
  assert.strictEqual(parseResetTime(HIT, NOW), Date.UTC(2026, 10, 6, 13));
  // 1pm Jerusalem has passed today, so it means tomorrow
  assert.strictEqual(parseResetTime("resets 1pm (Asia/Jerusalem)", NOW), Date.UTC(2026, 10, 7, 11));
  assert.strictEqual(parseResetTime("resets 15:30 (UTC)", NOW), Date.UTC(2026, 10, 6, 15, 30));
  assert.strictEqual(parseResetTime("no time here", NOW), null);
  assert.strictEqual(parseResetTime("resets 3pm (Not/AZone)", NOW) > NOW, true); // a bad zone falls back to this computer's
});

test("limitError: recognises limit messages and gives a reset time (30 minutes when the message has none)", () => {
  assert.strictEqual(limitError(HIT, NOW).resetsAt, Date.UTC(2026, 10, 6, 13));
  assert.strictEqual(limitError("RESOURCE_EXHAUSTED: quota exceeded", NOW).resetsAt, NOW + 30 * 60000);
  assert.strictEqual(limitError("HTTP 429 too many requests", NOW).resetsAt, NOW + 30 * 60000);
  assert.strictEqual(limitError("OAuth session expired", NOW), null);
  assert.strictEqual(limitError("claude timed out after 180 s", NOW), null);
  assert.strictEqual(limitError("", NOW), null);
});

test("lowPools: a row whose reset time has passed is out of date and ignored", () => {
  const stale = { pool: "Pool A", window: "W", remaining: 2, resets: new Date(NOW - 1000).toISOString() };
  const fresh = { pool: "Pool B", window: "W", remaining: 2, resets: new Date(NOW + 1000).toISOString() };
  assert.deepStrictEqual(lowPools([stale, fresh], LOW_THRESHOLD, NOW), [{ pool: "Pool B", remaining: 2 }]);
});

test("prioritize: a model with several pools is moved when ANY of them is low", () => {
  const both = { provider: "claude", model: "opus", pool: ["Claude plan", "Claude plan (Opus)"] };
  const plan = { provider: "claude", model: "sonnet", pool: "Claude plan" };
  const r = prioritize([both, plan, A], [{ pool: "Claude plan (Opus)", remaining: 3 }]);
  assert.deepStrictEqual(r.chain, [plan, A, both]); // only Opus is affected, Sonnet stays in front of it
  assert.deepStrictEqual(r.moved, [both]);
});

test("prioritize: when EVERY model is low, the one with the most room goes first and allLow is true", () => {
  const low = [{ pool: "Pool A", remaining: 2 }, { pool: "Pool B", remaining: 9 }];
  const r = prioritize([A, B], low);
  assert.deepStrictEqual(r.chain, [B, A]);
  assert.strictEqual(r.allLow, true);
  assert.strictEqual(prioritize([A, B], []).allLow, false);
  assert.strictEqual(prioritize([A, B], [{ pool: "Pool A", remaining: 2 }]).allLow, false);
});

test("describeLow writes the pools and what is left", () => {
  assert.strictEqual(describeLow([{ pool: "Pool A", remaining: 4 }, { pool: "Claude plan", remaining: 0 }]), "Pool A 4% left, Claude plan 0% left");
});

// ---- createQuota with Claude ----
const claudeStream = (info) => async () => parseClaudeStream(event(info), NOW);
const nearlyFull = { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.95, resetsAt: inHours(2) };

test("createQuota: the Claude probe makes 'Claude plan' low, for the next message", async () => {
  const q = createQuota({ fetchRows: async () => [], fetchClaude: claudeStream(nearlyFull), now: () => NOW });
  assert.deepStrictEqual(await q.get(), []); // the very first message knows nothing yet
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Claude plan", remaining: 5 }]);
});

test("createQuota: Claude and Gemini are judged the same way and together", async () => {
  const q = createQuota({ fetchRows: async () => [row("Gemini Models", 8)], fetchClaude: claudeStream(nearlyFull), now: () => NOW });
  await q.refresh();
  assert.deepStrictEqual((await q.get()).map((p) => p.pool).sort(), ["Claude plan", "Gemini Models"]);
});

test("createQuota: the Claude probe runs at most once a minute and never twice at once", async () => {
  let calls = 0, time = NOW;
  const q = createQuota({ fetchRows: async () => [], fetchClaude: async () => { calls++; return { rows: [], errorText: "" }; }, now: () => time, claudeEveryMs: 60000 });
  await q.refresh(); await q.refresh();
  assert.strictEqual(calls, 1);
  time += 59000; await q.refresh();
  assert.strictEqual(calls, 1);
  time += 1000; await q.refresh();
  assert.strictEqual(calls, 2);
  let release;
  const slow = createQuota({ fetchRows: async () => [], fetchClaude: () => { calls++; return new Promise((r) => { release = r; }); }, now: () => time });
  slow.refresh(); slow.refresh(); slow.refresh();
  await settle();
  assert.strictEqual(calls, 3);
  release({ rows: [], errorText: "" });
});

test("createQuota: a failing Claude probe changes nothing and does not stop the agy lookup", async () => {
  const q = createQuota({ fetchRows: async () => [row("Pool A", 5)], fetchClaude: async () => { throw new Error("claude is down"); }, now: () => NOW });
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Pool A", remaining: 5 }]);
});

test("createQuota: a failing agy lookup does not stop the Claude lookup", async () => {
  const q = createQuota({ fetchRows: async () => { throw new Error("agy is down"); }, fetchClaude: claudeStream(nearlyFull), now: () => NOW });
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Claude plan", remaining: 5 }]);
});

test("createQuota: a probe that hit the limit marks the plan used up until the reset, and probing stops until then", async () => {
  let calls = 0, time = NOW;
  const q = createQuota({
    fetchRows: async () => [],
    fetchClaude: async () => { calls++; return { rows: [], errorText: HIT }; },
    now: () => time, claudeEveryMs: 1000,
  });
  await q.refresh();
  assert.deepStrictEqual(await q.get(), [{ pool: "Claude plan", remaining: 0 }]);
  time += 5000; await q.refresh();
  assert.strictEqual(calls, 1); // no pointless probe while we know it is used up
  time = Date.UTC(2026, 10, 6, 13, 0, 1); // 3pm in Jerusalem has passed: the window started over
  assert.deepStrictEqual(await q.get(), []);
  await q.refresh();
  assert.strictEqual(calls, 2);
});

test("createQuota: an old low reading disappears after its reset time", async () => {
  let time = NOW;
  const q = createQuota({ fetchRows: async () => [], fetchClaude: claudeStream({ ...nearlyFull, resetsAt: inHours(1) }), now: () => time });
  await q.refresh();
  assert.strictEqual((await q.get()).length, 1);
  time = NOW + 2 * 3600000;
  assert.deepStrictEqual(await q.get(), []);
});

test("createQuota.noteFailure: a Claude limit error marks the plan low until the reset time it names", async () => {
  const q = createQuota({ fetchRows: async () => [], fetchClaude: noClaude, now: () => NOW });
  assert.strictEqual(q.noteFailure({ provider: "claude", model: "sonnet" }, HIT), true);
  assert.deepStrictEqual(await q.get(), [{ pool: "Claude plan", remaining: 0 }]);
});

test("createQuota.noteFailure: other errors are ignored; an Opus-only limit marks only the Opus pool; agy limits mark that model's pool", async () => {
  const q = createQuota({ fetchRows: async () => [], fetchClaude: noClaude, now: () => NOW });
  assert.strictEqual(q.noteFailure({ provider: "claude", model: "sonnet" }, "OAuth session expired"), false);
  assert.strictEqual(q.noteFailure({ provider: "claude", model: "sonnet" }, "claude timed out after 180 s"), false);
  assert.strictEqual(q.noteFailure(null, "quota"), false);
  assert.deepStrictEqual(await q.get(), []);
  q.noteFailure({ provider: "claude", model: "opus" }, "You've hit your Opus limit · resets 3pm (Asia/Jerusalem)");
  assert.deepStrictEqual(await q.get(), [{ pool: "Claude plan (Opus)", remaining: 0 }]);
  q.noteFailure({ provider: "agy", model: "gemini-4-argon-low" }, "RESOURCE_EXHAUSTED");
  assert.deepStrictEqual((await q.get()).map((p) => p.pool).sort(), ["Claude plan (Opus)", "Gemini 4 Argon"]);
});

test("createQuota.noteFailure: a model Bot does not know has no pool, so nothing is marked", async () => {
  const q = createQuota({ fetchRows: async () => [], fetchClaude: noClaude, now: () => NOW });
  assert.strictEqual(q.noteFailure({ provider: "agy", model: "mystery" }, "quota exceeded"), false);
  assert.deepStrictEqual(await q.get(), []);
});
