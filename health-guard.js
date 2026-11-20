// health-guard.js  (PROTOTYPE, research branch 2026-11-20; not used by the running Bot)
// The "roll back if Bot does not come up" step. The guard-protected starter (start-web.cmd / watchdog.cmd) would run
//   node health-guard.js
// BEFORE every start of server.js. It reads ONE small file that approve() writes when a merged change needs a restart:
//   data/selfedit-pending.json = { mergedCommit, startedAt, tries, healthyAt? }
// and Bot's server writes healthyAt once it has really come up (listening, routes answering, the brain's modules loaded).
//   ok        -> nothing to do (no pending change, or Bot was healthy): the file is removed.
//   wait      -> one more start is allowed: tries + 1 is written.
//   rollback  -> two starts failed or 3 minutes passed without "healthy": the change is undone with a NEW revert commit
//                (undoMerge: refuses a dirty project or a conflict, never resets or forces), the file is removed, and
//                data/selfedit-rollback.json says what happened so the page can tell Omri.
// This file is a GUARD file (selfedit-guard.js): Bot itself can never change it.
const fs = require("node:fs");
const path = require("node:path");
const { bootDecision, undoMerge } = require("./selfedit-guard");

function runGuard({ repoDir = __dirname, dataDir = path.join(__dirname, "data"), now = Date.now() } = {}) {
  const file = path.join(dataDir, "selfedit-pending.json");
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { pending = null; }
  const decision = bootDecision(pending, now);
  if (!pending) return { decision };
  if (decision === "ok") { fs.rmSync(file, { force: true }); return { decision }; }
  if (decision === "wait") { fs.writeFileSync(file, JSON.stringify({ ...pending, tries: (pending.tries || 0) + 1 })); return { decision }; }
  let result;
  try { result = { decision, undone: true, revertCommit: undoMerge({ repoDir, mergedCommit: pending.mergedCommit }) }; }
  catch (error) { result = { decision, undone: false, why: error.message }; }
  fs.writeFileSync(path.join(dataDir, "selfedit-rollback.json"), JSON.stringify({ at: new Date(now).toISOString(), mergedCommit: pending.mergedCommit, ...result }));
  fs.rmSync(file, { force: true });
  return result;
}

module.exports = { runGuard };
if (require.main === module) { const r = runGuard(); if (r.decision !== "ok") console.log("health-guard:", JSON.stringify(r)); }
