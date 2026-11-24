// tests/model-choice.test.js
// Omri picks which model answers (2026-11-22, to-do t10): first for one hour, the normal order behind it, a closed list,
// set only by the page's picker. With a photo a Claude Code choice is skipped (only agy can look at a photo).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createModelChoice, chosenFor, CHOICES, HOUR_MS } = require("../model-choice");
const { MODELS } = require("../router");

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-pick-")), "model-choice.json");

test("a picked model lasts one hour, then the normal order is back by itself", () => {
  let t = 1_000_000;
  const store = createModelChoice({ file: tempFile(), now: () => t });
  assert.strictEqual(store.get(), null);
  const c = store.set("neonMedium");
  assert.strictEqual(c.key, "neonMedium");
  assert.strictEqual(c.model, MODELS.neonMedium);
  assert.strictEqual(c.until, t + HOUR_MS);
  t += HOUR_MS - 1;
  assert.strictEqual(store.get().key, "neonMedium");
  t += 2;
  assert.strictEqual(store.get(), null);
});

test("only the closed list can be picked; auto clears it; a broken file means the normal order", () => {
  const file = tempFile();
  const store = createModelChoice({ file });
  for (const bad of ["opus", "argonLow", "argonMedium", "gemini-4-neon-medium", "__proto__", "constructor", 5, {}]) {
    assert.throws(() => store.set(bad), (e) => e.status === 400, String(bad));
  }
  store.set("hydrogenMedium");
  store.set("auto");
  assert.strictEqual(store.get(), null);
  fs.writeFileSync(file, "{not json");
  assert.strictEqual(store.get(), null);
  fs.writeFileSync(file, JSON.stringify({ key: "toString", until: Date.now() + 1000 }));
  assert.strictEqual(store.get(), null);
  for (const key of Object.keys(CHOICES)) assert.ok(MODELS[key], key + " is a real model in router.js");
});

test("with a photo a Claude Code choice is skipped; agy choices stay", () => {
  const store = createModelChoice({ file: tempFile() });
  assert.strictEqual(chosenFor(store.set("claudeSonnet"), { photo: true }), null);
  assert.strictEqual(chosenFor(store.get(), { photo: false }), MODELS.claudeSonnet);
  assert.strictEqual(chosenFor(store.set("hydrogenMedium"), { photo: true }), MODELS.hydrogenMedium);
  assert.strictEqual(chosenFor(null), null);
});

test("the brain puts the picked model first with the normal order behind it, and the answer's line says so", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "brain.js"), "utf8");
  assert.match(src, /order = \[chosen, \.\.\.order\.filter\(\(m\) => m\.model !== chosen\.model\)\];/);
  assert.match(src, /const chosen = chosenFor\(choice, \{ photo: Boolean\(image\) \}\);/);
  assert.match(src, /your choice failed, the next model answered/);
});

test("the server route and the page picker exist; the page never sends a model name with a message", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /modelChoice && url\.pathname === "\/api\/model-choice"/);
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /<select id="modelPick" class="model-pick"/);
  assert.match(html, /setupQuotes\(\);\r?\n\s*setupModelPick\(\);/);
  const code = html.match(/function setupModelPick\(\) \{[\s\S]*?\r?\n {4}\}\r?\n/)[0];
  assert.doesNotMatch(code, /innerHTML/);
});

test("Carbon low / medium (2026-11-24 trial) can be picked, spend Gemini Models, and are in NO automatic chain", () => {
  for (const key of ["carbonLow", "carbonMedium"]) {
    assert.ok(CHOICES[key], key + " is in the picker");
    assert.strictEqual(MODELS[key].provider, "agy");
    assert.strictEqual(MODELS[key].pool, "Gemini Models");
    assert.match(MODELS[key].model, /^gemini-4-carbon-(low|medium)$/);
  }
  assert.ok(!Object.hasOwn(CHOICES, "carbonHigh"), "Carbon high is not offered");
  const store = createModelChoice({ file: tempFile() });
  assert.strictEqual(chosenFor(store.set("carbonMedium"), { photo: false }), MODELS.carbonMedium);
  const { CHAIN, PHOTO_CHAIN } = require("../brain");
  const { DESTINATIONS } = require("../router");
  const chains = [CHAIN, PHOTO_CHAIN, ...Object.values(DESTINATIONS)];
  for (const chain of chains) assert.ok(!chain.some((m) => /carbon/.test(m.model)), "Carbon is in no chain");
  // No other file names Carbon: only router.js (the model), model-choice.js (the picker), brain.js (its warm spare), and since
  // 2026-11-24 the Improve Bot editor choice (selfedit.js, selfedit-plan.js, server.js), which only Omri picks on the page.
  const root = path.join(__dirname, "..");
  const allowed = new Set(["router.js", "model-choice.js", "brain.js", "selfedit.js", "selfedit-plan.js", "server.js"]);
  for (const name of fs.readdirSync(root).filter((n) => n.endsWith(".js") && !allowed.has(n))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), "utf8"), /carbon/i, name + " must not use Carbon");
  }
  const brainSrc = fs.readFileSync(path.join(root, "brain.js"), "utf8");
  assert.strictEqual((brainSrc.match(/MODELS\.carbon/g) || []).length, 2, "brain.js names Carbon only in WARM_MODELS");
});
