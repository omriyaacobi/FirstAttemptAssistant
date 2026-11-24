// models-watch.js
// BOT NOTICES WHEN GOOGLE CHANGES agy's MODELS OR QUOTA POOLS (to-do t29; Omri, 2026-11-23: "gemini keep changing drastically their
// models and weekly pools"). On 2026-11-23 Argon's own pool silently vanished and Argon started spending the shared "Gemini Models"
// pool, and Bot's chains were wrong for a day until someone looked by hand (experiments/2026-11-23-argon-pool.md).
//
// What this file does, in code only (NO model call, so it costs no quota):
//   1. check(): at start and once a day, ask `agy models` (the list of models agy offers) and `agy -p /usage` (the quota pools),
//      compare both with the saved copy data/agy-models.json, and post ONE message in the thread when a model or a pool row
//      appeared or disappeared. Push shows counts only, and none at night (like the Moodle watch).
//   2. offered(): the models agy offers right now, as seen by the last good check (null until one worked).
//   3. filterChain(chain): a chain is a PREFERENCE LIST. A model agy no longer offers is skipped (logged with the reason); the
//      Claude Code CLI is never touched (it is not an agy model). A chain is never made empty: if nothing in it would be left, it
//      is returned as it was and the normal failure handling tells Omri honestly.
//   4. A NEW model agy starts offering is only REPORTED, as a candidate for a trial. It is in no chain, and nothing here can put it
//      in one: chains are written in router.js / the files that own them, by hand, after Omri says so.
//
// What agy prints is untrusted text: every id and pool name is checked for shape and length before it is saved or shown.

const fs = require("node:fs");
const path = require("node:path");
const { MODELS, poolsOf } = require("./router"); // (needs nothing else, so providers.js can load it lazily)

const EVERY_MS = 24 * 3600 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
const PUSH_QUIET = { from: "22:00", to: "08:00" };
const RULE = "model watch";
const GEMINI = "Gemini Models", CLAUDE_AGY = "Claude and GPT models"; // the same names as router.js
const ID_SHAPE = /^[a-z0-9][a-z0-9._-]{1,80}$/;
const POOL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 ()._+-]{1,60}$/;

// ---- parsing (pure) ----

// `agy models` prints "Fetching available models..." and then one line per model: id <TAB> label. Lines that do not look right are dropped.
function parseModels(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const [id, ...rest] = line.split("\t");
    const clean = String(id || "").trim();
    if (!ID_SHAPE.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push({ id: clean, label: rest.join(" ").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 60) });
  }
  return out;
}

// The pool names of the /usage rows (parseUsage's output): a list of distinct, checked names.
function poolNames(rows) {
  return [...new Set((rows || []).map((r) => (r && typeof r.pool === "string" ? r.pool.trim() : "")).filter((p) => POOL_SHAPE.test(p)))];
}

// Which pool a model draws from, by its id, when /usage has no row of that model's own: a gemini-* model is part of the shared
// "Gemini Models" pool and a claude-* or gpt-* model of "Claude and GPT models" (what agy reports today). null = we cannot say.
function familyPool(id) {
  const s = String(id || "");
  if (s.startsWith("gemini-")) return GEMINI;
  if (s.startsWith("claude-") || s.startsWith("gpt-")) return CLAUDE_AGY;
  return null;
}

// ---- comparing (pure) ----

// saved: { models: [{id,label}], pools: [name] } or null. now: the same shape. ours: ids Bot's own table (router.js MODELS) uses.
// Returns what appeared and disappeared; candidates = new models no chain uses (they are only reported).
function diff(saved, now, ours = new Set(Object.values(MODELS).filter((m) => m.provider !== "claude").map((m) => m.model))) {
  const ids = (list) => new Set((list || []).map((m) => m.id));
  const before = ids(saved && saved.models), after = ids(now.models);
  const modelsAdded = [...after].filter((i) => !before.has(i));
  const modelsRemoved = [...before].filter((i) => !after.has(i));
  const poolsBefore = new Set((saved && saved.pools) || []), poolsAfter = new Set(now.pools || []);
  const poolsAdded = [...poolsAfter].filter((p) => !poolsBefore.has(p));
  const poolsRemoved = [...poolsBefore].filter((p) => !poolsAfter.has(p));
  const usedGone = [...ours].filter((m) => !after.has(m)); // models Bot uses that agy does not offer now
  return { modelsAdded, modelsRemoved, poolsAdded, poolsRemoved, usedGone, changed: Boolean(modelsAdded.length || modelsRemoved.length || poolsAdded.length || poolsRemoved.length) };
}

// The message, written by code. Ids come from agy, already checked for shape; nothing else is quoted.
function describe(d, now) {
  const labelOf = (id) => { const m = (now.models || []).find((x) => x.id === id); return m && m.label ? `${id} (${m.label})` : id; };
  const lines = ["Model check: agy's models or quota pools changed since the last check."];
  if (d.poolsRemoved.length) lines.push(`- Quota pool gone from /usage: ${d.poolsRemoved.join(", ")}. A model that drew from it now counts as part of the shared "${GEMINI}" pool (by its name).`);
  if (d.poolsAdded.length) lines.push(`- New quota pool in /usage: ${d.poolsAdded.join(", ")}. Bot does not use it yet; tell me if a model should.`);
  if (d.modelsRemoved.length) {
    const used = d.modelsRemoved.filter((m) => d.usedGone.includes(m));
    lines.push(`- agy no longer offers: ${d.modelsRemoved.join(", ")}.${used.length ? ` Bot used ${used.join(", ")}: it is skipped in every chain now, the next model answers instead.` : " None of them was in a chain."}`);
  }
  const stillGone = d.usedGone.filter((m) => !d.modelsRemoved.includes(m));
  if (stillGone.length) lines.push(`- Still not offered by agy and still in a chain: ${stillGone.join(", ")} (skipped).`);
  if (d.modelsAdded.length) lines.push(`- New in agy: ${d.modelsAdded.map(labelOf).join(", ")}. Candidates for a trial only. Bot does NOT use them until you say so.`);
  return lines.join("\n");
}

// ---- the state every chain reads (in memory; set by a good check) ----

let current = null; // Set of offered model ids, or null = never checked successfully
const setOffered = (ids) => { current = ids ? new Set(ids) : null; };
const offered = () => current;

const runsViaAgy = (m) => m && (m.provider === "agy" || m.provider === "web" || m.provider === "research");

// A chain without the agy models agy does not offer. `log` gets one line per skipped model. Never returns an empty chain.
function filterChain(chain, log = () => {}, ids = current) {
  if (!ids || !Array.isArray(chain)) return chain;
  const kept = chain.filter((m) => !runsViaAgy(m) || ids.has(m.model));
  if (kept.length === chain.length) return chain;
  for (const m of chain) if (!kept.includes(m)) log(`[models] skipping ${m.model}: agy does not offer it any more (see the model check)`);
  if (!kept.length) { log("[models] every model of this chain is gone from agy: keeping the chain as it is, so the failure is reported honestly"); return chain; }
  return kept;
}

// Pools from the rows: a chain model whose own pool has NO row in /usage counts as part of its family's pool, when that pool has a row
// (Argon on 2026-11-23). known = pool names that have a row now. Nothing known = nothing changes (a failed lookup must not move models).
// Returns a new chain; the models are copied only when their pool changed.
function resolvePools(chain, known) {
  const have = new Set(known || []);
  if (!have.size || !Array.isArray(chain)) return chain;
  return chain.map((m) => {
    if (!runsViaAgy(m)) return m;
    const mine = poolsOf(m);
    if (!mine.length || mine.every((p) => have.has(p))) return m;
    const family = familyPool(m.model);
    if (!family || !have.has(family)) return m;
    return { ...m, pool: family };
  });
}

// ---- the watcher ----

function createModelsWatch({ file, fetchModels, fetchRows, thread = null, push = null, now = () => Date.now(), log = () => {}, everyMs = EVERY_MS, quietHours = null }) {
  const read = () => { try { const s = JSON.parse(fs.readFileSync(file, "utf8")); return s && typeof s === "object" ? s : null; } catch (error) { return null; } };
  const write = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(s, null, 1)); fs.renameSync(file + ".tmp", file); };
  let running = false, timer = null, lastTry = 0;

  // One look. Returns { ok, posted } or { ok: false, why }. A lookup that fails or comes back empty changes NOTHING (a broken command
  // must never look like "every model disappeared").
  async function check() {
    if (running) return { ok: false, why: "busy" };
    running = true;
    lastTry = now();
    try {
      let models;
      try { models = parseModels(await fetchModels()); } catch (error) { log(`[models] could not run agy models: ${String(error.message).slice(0, 100)}`); return { ok: false, why: "models" }; }
      if (!models.length) { log("[models] agy models printed no models: nothing compared"); return { ok: false, why: "empty" }; }
      let pools = null; // null = could not read /usage: the pools are then neither compared nor saved over
      try { const rows = await fetchRows(); const names = poolNames(rows); if (names.length) pools = names; } catch (error) { log(`[models] could not read /usage: ${String(error.message).slice(0, 100)}`); }
      const saved = read();
      const snapshot = { models, pools: pools || (saved && saved.pools) || [] };
      setOffered(models.map((m) => m.id));
      const first = !saved;
      const d = first ? null : diff(saved, { models, pools: pools || saved.pools || [] });
      write({ checkedAt: new Date(now()).toISOString(), models, pools: snapshot.pools });
      if (first) { log(`[models] first look saved: ${models.length} models, pools: ${snapshot.pools.join(", ") || "unknown"}`); return { ok: true, posted: false, first: true }; }
      if (!d.changed) { log(`[models] no change (${models.length} models)`); return { ok: true, posted: false }; }
      const text = describe(d, snapshot);
      post(text);
      log(`[models] changed: +${d.modelsAdded.length} -${d.modelsRemoved.length} models, +${d.poolsAdded.length} -${d.poolsRemoved.length} pools`);
      const parts = [d.modelsAdded.length ? `${d.modelsAdded.length} new model${d.modelsAdded.length === 1 ? "" : "s"}` : "", d.modelsRemoved.length ? `${d.modelsRemoved.length} gone` : "", (d.poolsAdded.length + d.poolsRemoved.length) ? `${d.poolsAdded.length + d.poolsRemoved.length} quota pool change${d.poolsAdded.length + d.poolsRemoved.length === 1 ? "" : "s"}` : ""].filter(Boolean);
      if (push && !(quietHours && quietHours(now()))) {
        try { await push.notifyAll({ title: "Bot", body: `Model check: ${parts.join(", ")}. Open Bot to read.`, tag: `models-${now()}` }); } catch (error) { log(`[models] push failed: ${error.message}`); }
      }
      return { ok: true, posted: true, diff: d };
    } finally { running = false; }
  }

  function post(text) {
    if (!thread) return;
    const result = { mode: "single", rule: RULE, reason: "agy's models or quota pools changed", chain: [], used: { provider: "code", model: "written by code, no model" }, answer: text, seconds: 0 };
    thread.append({ role: "assistant", text, result, topic: "general", at: now() });
  }

  // Due: never checked, or a day since the last good look (the saved file's time); after a failed try, RETRY_MS later.
  function due() {
    const s = read();
    const lastGood = s && Date.parse(s.checkedAt);
    if (current && Number.isFinite(lastGood) && now() - lastGood < everyMs) return false;
    return now() - lastTry >= RETRY_MS;
  }
  // The look at start is not delayed: it is cheap (no model call) and the chains need to know what is offered.
  const tick = () => (due() ? check() : Promise.resolve(null));
  function start() {
    if (timer) return;
    tick().catch((error) => log(`[models] ${error.message}`));
    timer = setInterval(() => { tick().catch((error) => log(`[models] ${error.message}`)); }, TICK_MS);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { check, tick, due, start, stop, state: read };
}

module.exports = { parseModels, poolNames, familyPool, diff, describe, setOffered, offered, filterChain, resolvePools, createModelsWatch, RULE, EVERY_MS, PUSH_QUIET, GEMINI, CLAUDE_AGY };
