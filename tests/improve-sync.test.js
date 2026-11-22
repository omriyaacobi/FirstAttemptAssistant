// tests/improve-sync.test.js
// Improve Bot on two devices (2026-11-22): a change started on the phone from the plan the PC showed never appeared on the
// PC, because the PC page only asked the server while something there was busy, and only followed a request when nothing
// was open. Now the page looks every 5 seconds (and when the tab comes back) and follows a change or plan that is NEW.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("the Improve page keeps looking while idle and when the tab comes back", () => {
  assert.match(html, /setInterval\(\(\) => \{ if \(!pollTimer && !document\.hidden && !\$\("improveView"\)\.hidden\) loadProposals\(\); \}, 5000\);/);
  assert.match(html, /visibilitychange", \(\) => \{ if \(!document\.hidden && !\$\("improveView"\)\.hidden\) loadProposals\(\); \}/);
});

test("a change or plan that is new since the last look is followed, even when the page showed the old plan", () => {
  const load = html.slice(html.indexOf("async function loadProposals("), html.indexOf("// The diff, with added and removed lines colored."));
  assert.match(load, /const showingLive = Boolean\(openChange\(\)\) \|\| Boolean\(plan && openPlanId === plan\.id\);/);
  assert.match(load, /live && \(\(adopt && !declined\) \|\| fresh\(live\.id\)\)/);
  assert.match(load, /openPlan\(plan\.id, true\); \/\/ a reply sent from the other device/);
  assert.match(load, /knownLive = new Set\(/);
  // The old rule (only when NOTHING is open) is gone.
  assert.doesNotMatch(load, /if \(adopt && !openProposalId && !openPlanId && !declined\)/);
});
