// health-guard.js  (built 2026-11-20 from the research prototype)
// The "roll back if Bot does not come up" step. The starter (start-web.cmd) runs
//   node health-guard.js
// BEFORE every start of server.js (the watchdog starts Bot through start-web.cmd too, so every start passes here once).
// It reads ONE small file that approve() writes when a merged change needs a restart:
//   data/selfedit-pending.json = { mergedCommit, approvedAt, tries, startedAt?, healthyAt? }
// and Bot's server writes healthyAt once it is listening (markHealthy below, called from server.js).
//   ok        -> nothing to do (no pending change, or Bot was healthy): the file is removed.
//   wait      -> one more start is allowed: tries + 1 is written (and startedAt, the time of the first start).
//   rollback  -> two starts failed or 3 minutes passed without "healthy": the change is undone with a NEW revert commit
//                (undoMerge: refuses a dirty project or a conflict, never resets or forces), the file is removed, and
//                data/selfedit-rollback.json says what happened so the page can tell Omri.
// This file is a GUARD file (selfedit-guard.js): Bot itself can never change it.
const fs = require("node:fs");
const path = require("node:path");
const { bootDecision, undoMerge } = require("./selfedit-guard");

// One line in data/bot.log (where everything Bot does is written), so Omri can see what the guard did. Never throws.
function logLine(dataDir, text, now) {
  try { fs.appendFileSync(path.join(dataDir, "bot.log"), `${new Date(now).toISOString()} [health-guard] ${text}\n`); } catch (error) { /* only a log */ }
}

// Called by server.js once it is listening: the change that was waiting for a restart did not keep Bot from starting. Never throws.
function markHealthy(dataDir, now = Date.now()) {
  const file = path.join(dataDir, "selfedit-pending.json");
  try {
    const pending = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pending && !pending.healthyAt) fs.writeFileSync(file, JSON.stringify({ ...pending, healthyAt: now }));
    return true;
  } catch (error) {
    return false; // no pending change (the usual case)
  }
}

function runGuard({ repoDir = __dirname, dataDir = path.join(__dirname, "data"), now = Date.now() } = {}) {
  const file = path.join(dataDir, "selfedit-pending.json");
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { pending = null; }
  const decision = bootDecision(pending, now);
  if (!pending) return { decision };
  if (decision === "ok") { fs.rmSync(file, { force: true }); return { decision }; }
  if (decision === "wait") {
    fs.writeFileSync(file, JSON.stringify({ ...pending, tries: (pending.tries || 0) + 1, startedAt: pending.startedAt || now }));
    if (pending.tries) logLine(dataDir, `Bot did not come up after the last approved change (start ${pending.tries + 1}); one more try before it is undone.`, now);
    return { decision };
  }
  let result;
  try { result = { decision, undone: true, revertCommit: undoMerge({ repoDir, mergedCommit: pending.mergedCommit }) }; }
  catch (error) { result = { decision, undone: false, why: error.message }; }
  fs.writeFileSync(path.join(dataDir, "selfedit-rollback.json"), JSON.stringify({ at: new Date(now).toISOString(), mergedCommit: pending.mergedCommit, ...result }));
  fs.rmSync(file, { force: true });
  logLine(dataDir, result.undone ? `Bot did not come up after the last approved change, so it was undone (new commit ${result.revertCommit.slice(0, 7)}).` : `Bot did not come up after the last approved change, and undoing it failed: ${result.why}`, now);
  return result;
}

module.exports = { runGuard, markHealthy };
if (require.main === module) { const r = runGuard(); if (r.decision !== "ok") console.log("health-guard:", JSON.stringify(r)); }
