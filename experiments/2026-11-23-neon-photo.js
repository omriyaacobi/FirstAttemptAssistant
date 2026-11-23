// Re-check 2026-11-23: the unclear "lecture moved" photo 3 times through Neon low (replaces Argon low as first photo model). 3 Neon calls.
// Run: node experiments/2026-11-23-neon-photo.js
const fs = require("node:fs");
const path = require("node:path");
const { brainRun } = require("./hydrogen-round3");
const { TESTS } = require("./hydrogen-contest");
const { usage } = require("./hydrogen-contest");
const { parseReply } = require("../brain");

const file = path.join(__dirname, "2026-11-23-neon-photo-results.json");
const test = TESTS.find((t) => t.id === "photo-moved");
(async () => {
  const results = JSON.parse(fs.readFileSync(file, "utf8"));
  results.usage["before neon-low photo"] = usage();
  for (let rep = 1; rep <= 3; rep++) {
    const t0 = Date.now();
    try {
      const { text, rounds } = await brainRun("gemini-4-neon-low", test);
      const calls = parseReply(text).calls;
      results.runs.push({ model: "gemini-4-neon-low", part: "rerun", test: "photo-moved", topic: "photo", rep, text, rounds, calls, ok: calls.some((c) => c.tool === "add_events") });
      const c = calls.find((x) => x.tool === "add_events");
      console.error(`neon-low photo-moved #${rep}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${rounds.length} call(s), ${c ? "repeat " + c.repeat : "no card"}`);
    } catch (error) {
      results.runs.push({ model: "gemini-4-neon-low", part: "rerun", test: "photo-moved", topic: "photo", rep, ok: false, error: String(error.message).slice(0, 300), seconds: +((Date.now() - t0) / 1000).toFixed(1) });
      console.error(`neon-low photo-moved #${rep}: ERROR ${String(error.message).slice(0, 100)}`);
    }
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
  }
  results.usage["after neon-low photo"] = usage();
  console.error("after:", results.usage["after neon-low photo"].join(" | "));
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
})();
