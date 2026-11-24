// tests/models-watch.test.js
// t29: Bot notices when agy's models or quota pools change (models-watch.js), counts a model whose pool row is missing as part of its
// family's pool, skips models agy no longer offers, and only REPORTS new models. Fake agy output and fake models only: no real call.
// Run with:  node --test tests/models-watch.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mw = require("../models-watch");
const { MODELS } = require("../router");
const { createBrain, CHAIN } = require("../brain");
const { askChain } = require("../providers");
const { parseUsage, paceFree } = require("../quota");

const GEMINI = "Gemini Models", AGY_CLAUDE = "Claude and GPT models";
const NOW = Date.parse("2026-11-24T12:00:00Z");
const inDays = (d) => new Date(NOW + d * 24 * 3600 * 1000).toISOString();
const week = (pool, remaining, daysLeft) => ({ pool, window: "Weekly Limit Remaining", remaining, resets: inDays(daysLeft) });

const OURS = [...new Set(Object.values(MODELS).filter((m) => m.provider !== "claude").map((m) => m.model))];
const listText = (ids) => "Fetching available models...\n" + ids.map((i) => `${i}\tLabel of ${i}`).join("\n") + "\n";
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-mw-")), "agy-models.json");
const USAGE = `${GEMINI}\tWeekly Limit Remaining\t89%\t2026-11-30T20:57:07Z\n${GEMINI}\tFive Hour Limit Remaining\t99%\t2026-11-24T14:05:45Z\n${AGY_CLAUDE}\tWeekly Limit Remaining\t46%\t2026-11-27T14:08:47Z\n`;

test("parseModels: reads agy's list, drops the header, odd lines and duplicates", () => {
  const m = mw.parseModels("Fetching available models...\ngemini-4-neon-low\tGemini 4 Neon (Low)\n\nBAD LINE with spaces\ngemini-4-neon-low\tagain\n../evil\tx\nclaude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)\n");
  assert.deepStrictEqual(m.map((x) => x.id), ["gemini-4-neon-low", "claude-sonnet-5-5-low"]);
  assert.strictEqual(m[0].label, "Gemini 4 Neon (Low)");
  assert.deepStrictEqual(mw.parseModels(""), []);
  assert.deepStrictEqual(mw.parseModels(null), []);
});

test("poolNames and familyPool: distinct checked pool names; a model's family by its id", () => {
  assert.deepStrictEqual(mw.poolNames(parseUsage(USAGE)), [GEMINI, AGY_CLAUDE]);
  assert.deepStrictEqual(mw.poolNames([{ pool: "<script>" }, { pool: "x".repeat(200) }, null]), []);
  assert.strictEqual(mw.familyPool("gemini-4-carbon-low"), GEMINI);
  assert.strictEqual(mw.familyPool("claude-opus-5-5-low"), AGY_CLAUDE);
  assert.strictEqual(mw.familyPool("gpt-oss-120b-medium"), AGY_CLAUDE);
  assert.strictEqual(mw.familyPool("sonnet"), null);
  assert.strictEqual(mw.familyPool(undefined), null);
});

test("diff: appeared and disappeared models and pools; new models are candidates, a used model that is gone is named", () => {
  const saved = { models: OURS.map((id) => ({ id })), pools: [GEMINI, "Gemini 4 Argon", AGY_CLAUDE] };
  const now = { models: [...OURS.filter((i) => i !== "gemini-4-argon-low").map((id) => ({ id })), { id: "gemini-4-boron-low", label: "Gemini 4 Boron (Low)" }], pools: [GEMINI, AGY_CLAUDE] };
  const d = mw.diff(saved, now);
  assert.deepStrictEqual(d.modelsAdded, ["gemini-4-boron-low"]);
  assert.deepStrictEqual(d.modelsRemoved, ["gemini-4-argon-low"]);
  assert.deepStrictEqual(d.poolsRemoved, ["Gemini 4 Argon"]);
  assert.deepStrictEqual(d.poolsAdded, []);
  assert.ok(d.usedGone.includes("gemini-4-argon-low"));
  assert.strictEqual(d.changed, true);
  const text = mw.describe(d, now);
  assert.match(text, /Quota pool gone from \/usage: Gemini 4 Argon/);
  assert.match(text, /agy no longer offers: gemini-4-argon-low/);
  assert.match(text, /New in agy: gemini-4-boron-low \(Gemini 4 Boron \(Low\)\)\. Candidates for a trial only\. Bot does NOT use them until you say so/);
  assert.strictEqual(mw.diff(saved, saved).changed, false);
});

test("filterChain: skips a model agy no longer offers (with the reason logged), keeps the Claude CLI, never empties a chain", () => {
  const offered = new Set(["gemini-4-hydrogen-medium", "claude-sonnet-5-5-low"]);
  const logs = [];
  const out = mw.filterChain(CHAIN, (l) => logs.push(l), offered);
  assert.deepStrictEqual(out.map((m) => m.model), ["gemini-4-hydrogen-medium", "claude-sonnet-5-5-low", "sonnet"]);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /skipping gemini-4-neon-low: agy does not offer it any more/);
  assert.strictEqual(mw.filterChain(CHAIN, () => {}, null), CHAIN, "nothing known = the chain as it is");
  const allGone = [MODELS.neonLow, MODELS.hydrogenMedium];
  const l2 = [];
  assert.strictEqual(mw.filterChain(allGone, (l) => l2.push(l), new Set(["something-else"])), allGone);
  assert.match(l2[l2.length - 1], /every model of this chain is gone/);
});

test("resolvePools: a model whose own pool has no row counts as part of its family's pool (Argon, 2026-11-23); nothing known changes nothing", () => {
  const argon = { provider: "agy", model: "gemini-4-argon-low", pool: "Gemini 4 Argon" };
  const [fixed, same, claude] = mw.resolvePools([argon, MODELS.neonLow, MODELS.claudeSonnet], [GEMINI, AGY_CLAUDE]);
  assert.strictEqual(fixed.pool, GEMINI);
  assert.strictEqual(argon.pool, "Gemini 4 Argon", "the original is not changed");
  assert.strictEqual(same, MODELS.neonLow);
  assert.strictEqual(claude, MODELS.claudeSonnet, "the Claude CLI is never moved");
  assert.strictEqual(mw.resolvePools([argon], [])[0], argon, "a failed lookup must not move models");
  assert.strictEqual(mw.resolvePools([argon], [AGY_CLAUDE])[0], argon, "family pool has no row either: stays unknown");
  const odd = { provider: "agy", model: "mystery-1", pool: "Nowhere" };
  assert.strictEqual(mw.resolvePools([odd], [GEMINI])[0], odd, "a family we cannot tell stays unknown");
  const [fam] = mw.resolvePools([{ provider: "agy", model: "claude-opus-5-5-low", pool: "Claude Opus pool" }], [GEMINI, AGY_CLAUDE]);
  assert.strictEqual(fam.pool, AGY_CLAUDE);
});

test("with the pool row missing, paceFree uses the real Gemini week (Neon first above 75%)", () => {
  const argonFirst = [{ provider: "agy", model: "gemini-4-argon-low", pool: "Gemini 4 Argon" }, MODELS.sonnetInAgy];
  const rows = [week(GEMINI, 89, 6)];
  assert.strictEqual(paceFree(argonFirst, rows, { now: NOW }).free, false, "before: unknown pool, the pacing runs on a guess");
  assert.strictEqual(paceFree(mw.resolvePools(argonFirst, [GEMINI]), rows, { now: NOW }).free, true);
});

function brainWith({ chain, rows = [], levels = [] }) {
  const asked = [], logs = [];
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    poolRows: async () => rows, poolLevels: async () => levels, refreshPools: () => {}, notePoolFailure: () => {},
    askOne: async (provider, model) => { asked.push(model); return "Fine."; }, now: () => NOW, chain,
  });
  return async () => { asked.length = 0; logs.length = 0; await brain.handle("hello", { history: [], courses: [], log: (l) => logs.push(l) }); return { first: asked[0], logs: logs.slice() }; };
}

test("brain: a chain model with no pool row steps back when the shared Gemini pool is low (before: it never looked low)", async () => {
  const argon = { provider: "agy", model: "gemini-4-argon-low", pool: "Gemini 4 Argon" };
  const send = brainWith({ chain: [argon, MODELS.sonnetInAgy], rows: [week(GEMINI, 10, 6), week(AGY_CLAUDE, 90, 6)], levels: [{ pool: GEMINI, remaining: 10 }, { pool: AGY_CLAUDE, remaining: 90 }] });
  assert.strictEqual((await send()).first, "claude-sonnet-5-5-low");
});

test("brain: a model agy no longer offers is skipped and the skip is logged; unknown means nothing is skipped", async () => {
  try {
    mw.setOffered(["gemini-4-hydrogen-medium", "claude-sonnet-5-5-low"]);
    const send = brainWith({ chain: CHAIN });
    const r = await send();
    assert.strictEqual(r.first, "gemini-4-hydrogen-medium");
    assert.ok(r.logs.some((l) => /skipping gemini-4-neon-low/.test(l)), r.logs.join("\n"));
    mw.setOffered(null);
    assert.strictEqual((await send()).first, "gemini-4-neon-low");
  } finally { mw.setOffered(null); }
});

test("askChain (every background job): skips a model agy no longer offers", async () => {
  try {
    mw.setOffered(["gemini-4-hydrogen-high"]);
    const asked = [];
    const r = await askChain([MODELS.neonLow, MODELS.hydrogenHigh], "q", { askOne: async (p, model) => { asked.push(model); return "ok"; } });
    assert.deepStrictEqual(asked, ["gemini-4-hydrogen-high"]);
    assert.strictEqual(r.used.model, "gemini-4-hydrogen-high");
  } finally { mw.setOffered(null); }
});

function watch({ models = [], usage = USAGE, file = tmp(), at = { t: NOW }, failModels = false, failUsage = false } = {}) {
  const posted = [], pushed = [], logs = [], calls = { models: 0, usage: 0 };
  const state = { models, usage, failModels, failUsage };
  const w = mw.createModelsWatch({
    file, thread: { append: (m) => posted.push(m) }, push: { notifyAll: async (p) => { pushed.push(p); } }, log: (l) => logs.push(l), now: () => at.t,
    fetchModels: async () => { calls.models++; if (state.failModels) throw new Error("agy broke"); return listText(state.models); },
    fetchRows: async () => { calls.usage++; if (state.failUsage) throw new Error("no usage"); return parseUsage(state.usage); },
    quietHours: (ms) => new Date(ms).getUTCHours() >= 22 || new Date(ms).getUTCHours() < 6,
  });
  return { w, state, posted, pushed, logs, calls, file, at };
}

test("check: the first look only saves a baseline (no post); the same list again says nothing", async () => {
  const t = watch({ models: OURS });
  assert.deepStrictEqual(await t.w.check(), { ok: true, posted: false, first: true });
  assert.strictEqual(t.posted.length, 0);
  const saved = JSON.parse(fs.readFileSync(t.file, "utf8"));
  assert.deepStrictEqual(saved.pools, [GEMINI, AGY_CLAUDE]);
  assert.strictEqual(saved.models.length, OURS.length);
  assert.deepStrictEqual(mw.offered(), new Set(OURS));
  assert.deepStrictEqual(await t.w.check(), { ok: true, posted: false });
  assert.strictEqual(t.posted.length, 0);
  mw.setOffered(null);
});

test("check: a model and a pool row that appear or disappear give ONE thread message and a counts-only push", async () => {
  const t = watch({ models: OURS });
  await t.w.check();
  t.state.models = [...OURS.filter((m) => m !== "gemini-3.8-flash-low"), "gemini-4-boron-low"];
  t.state.usage = USAGE + `Gemini 4 Boron\tWeekly Limit Remaining\t100%\t2026-11-30T20:57:07Z\n`;
  const r = await t.w.check();
  assert.strictEqual(r.posted, true);
  assert.strictEqual(t.posted.length, 1);
  const m = t.posted[0];
  assert.strictEqual(m.role, "assistant");
  assert.strictEqual(m.result.rule, "model watch");
  assert.strictEqual(m.result.used.provider, "code");
  assert.match(m.text, /agy no longer offers: gemini-3\.8-flash-low/);
  assert.match(m.text, /New quota pool in \/usage: Gemini 4 Boron/);
  assert.match(m.text, /New in agy: gemini-4-boron-low/);
  assert.match(m.text, /does NOT use them until you say so/);
  assert.strictEqual(t.pushed.length, 1);
  assert.doesNotMatch(t.pushed[0].body, /flash|boron/i, "the push shows counts only, never names");
  assert.match(t.pushed[0].body, /1 new model, 1 gone, 1 quota pool change/);
  await t.w.check(); // the same state again: already saved, so nothing more is posted
  assert.strictEqual(t.posted.length, 1);
  assert.ok(!mw.offered().has("gemini-3.8-flash-low"));
  assert.ok(mw.offered().has("gemini-4-boron-low"), "the set only says what agy offers; no chain contains the new model");
  assert.ok(!CHAIN.some((x) => x.model === "gemini-4-boron-low"));
  mw.setOffered(null);
});

test("check: no push at night, but the message is still posted", async () => {
  const at = { t: Date.parse("2026-11-24T23:30:00Z") };
  const t = watch({ models: OURS, at });
  await t.w.check();
  t.state.models = OURS.slice(1);
  await t.w.check();
  assert.strictEqual(t.posted.length, 1);
  assert.strictEqual(t.pushed.length, 0);
  mw.setOffered(null);
});

test("check: a failed or empty lookup changes nothing (it never looks like 'every model disappeared')", async () => {
  const t = watch({ models: OURS });
  await t.w.check();
  const before = fs.readFileSync(t.file, "utf8");
  t.state.failModels = true;
  assert.strictEqual((await t.w.check()).ok, false);
  t.state.failModels = false; t.state.models = [];
  assert.deepStrictEqual(await t.w.check(), { ok: false, why: "empty" });
  assert.strictEqual(fs.readFileSync(t.file, "utf8"), before);
  assert.strictEqual(t.posted.length, 0);
  t.state.models = OURS; t.state.failUsage = true; // /usage broken: the models are still compared, the pools are not
  assert.strictEqual((await t.w.check()).ok, true);
  assert.strictEqual(t.posted.length, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(t.file, "utf8")).pools, [GEMINI, AGY_CLAUDE], "the saved pools are kept");
  mw.setOffered(null);
});

test("due: at start, then once a day; a failed try waits 30 minutes; no model is ever called", async () => {
  const at = { t: NOW };
  const t = watch({ models: OURS, at });
  assert.strictEqual(t.w.due(), true);
  await t.w.check();
  assert.strictEqual(t.w.due(), false);
  at.t = NOW + 23 * 3600 * 1000;
  assert.strictEqual(t.w.due(), false);
  at.t = NOW + 25 * 3600 * 1000;
  assert.strictEqual(t.w.due(), true);
  assert.deepStrictEqual(t.calls, { models: 1, usage: 1 }, "only the two free lookups (agy models, /usage)");
  mw.setOffered(null);
});

test("the real server asks only for the two free lookups and never puts a candidate in a chain", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /createModelsWatch/);
  assert.match(server, /\["models"\]/);
  const watchSrc = fs.readFileSync(path.join(__dirname, "..", "models-watch.js"), "utf8");
  assert.doesNotMatch(watchSrc, /askChain|providers"\)\.ask\(|\.ask\(/, "no model call in the watcher");
});
