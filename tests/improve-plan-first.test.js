// tests/improve-plan-first.test.js
// "Plan first" in Improve Bot (public/index.html). Bug of 2026-11-21: after a change had finished (approved, rejected or
// failed) and was still shown, a new message skipped "Plan first" and started a real edit (private copy + 6-minute tests),
// because the page only planned when NO change was shown. Now only a running or ready change takes follow-ups.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

// The page's own helper, taken out of the file and run on sample records.
function loadOpenChange() {
  const m = html.match(/const openChange = \(\) => (\([^\n]+\));/);
  assert.ok(m, "openChange helper is in the page");
  return (current) => new Function("current", `return ${m[1]};`)(current);
}

test("a finished change no longer counts as the open one, so Plan first works after it", () => {
  const openChange = loadOpenChange();
  for (const status of ["approved", "rejected", "failed", "undone", "stopped"]) {
    assert.strictEqual(openChange({ id: "a", status }), null, status);
  }
  for (const status of ["running", "ready"]) {
    assert.deepStrictEqual(openChange({ id: "a", status }), { id: "a", status }, status);
  }
  assert.strictEqual(openChange(null), null);
});

test("sending, drawing and the message box all use openChange, not any shown change", () => {
  const send = html.slice(html.indexOf("async function sendImprove()"));
  assert.match(send.slice(0, 400), /const p = openChange\(\);/);
  assert.match(html, /const inPlan = Boolean\(currentPlan && !openChange\(\)\);/);
  assert.match(html, /const plan = !openChange\(\) \? currentPlan : null;/);
  assert.match(html, /\(!openChange\(\) && !inPlan && planMode\) \? "Plan" : "Send"/, "the button says Plan after a finished change too");
  assert.doesNotMatch(html, /const p = current;\s*\n\s*const plan = !p \? currentPlan : null;/);
});
