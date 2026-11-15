// Round 3 extra: the unclear "lecture moved" photo 3 times through Argon low (the brain's first model today), with the brain's
// tool rounds, to compare with Hydrogen's 3 runs (both Hydrogen levels guessed "weekly" 2 times of 3). 3 Argon calls.
// Run: node experiments/hydrogen-round3-argon-photo.js   (results added to hydrogen-round3-results-argon.json)
const fs = require("node:fs");
const path = require("node:path");
const { brainRun } = require("./hydrogen-round3");
const { TESTS } = require("./hydrogen-contest");
const { usage } = require("./hydrogen-contest");
const { parseReply } = require("../brain");

const file = path.join(__dirname, "hydrogen-round3-results-argon.json");
const test = TESTS.find((t) => t.id === "photo-moved");
(async () => {
  const results = JSON.parse(fs.readFileSync(file, "utf8"));
  results.usage["before argon-low photo"] = usage();
  for (let rep = 1; rep <= 3; rep++) {
    const t0 = Date.now();
    try {
      const { text, rounds } = await brainRun("gemini-4-argon-low", test);
      const calls = parseReply(text).calls;
      results.runs.push({ model: "gemini-4-argon-low", part: "rerun", test: "photo-moved", topic: "photo", rep, text, rounds, calls, ok: calls.some((c) => c.tool === "add_events") });
      const c = calls.find((x) => x.tool === "add_events");
      console.error(`argon-low photo-moved #${rep}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${rounds.length} call(s), ${c ? "repeat " + c.repeat : "no card"}`);
    } catch (error) {
      results.runs.push({ model: "gemini-4-argon-low", part: "rerun", test: "photo-moved", topic: "photo", rep, ok: false, error: String(error.message).slice(0, 300), seconds: +((Date.now() - t0) / 1000).toFixed(1) });
      console.error(`argon-low photo-moved #${rep}: ERROR ${String(error.message).slice(0, 100)}`);
    }
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
  }
  results.usage["after argon-low photo"] = usage();
  console.error("after:", results.usage["after argon-low photo"].join(" | "));
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
})();
