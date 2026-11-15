// Round 2 for the contest (hydrogen-contest.js asks only ONE round). When a model's first reply was only LOOKUP calls
// (course_search, calendar_read, ...), the real brain would run them and ask again. Here the lookups get made-up results and
// the model is asked again in the brain's own format ("## Tool round 1", "You called:", <tool-result>), so its final reply can
// be checked. Also re-runs any call that failed with an error. Results are added to hydrogen-contest-results.json.
// Run: node experiments/hydrogen-contest-round2.js   (spends quota: one call per such case)
const fs = require("node:fs");
const path = require("node:path");
const { ask, askAgyStreamWithImage } = require("../providers");
const { parseReply, leaksPrompt } = require("../brain");
const { TESTS, finalValue, brainPrompt, photoSection, runOne, OUT } = require("./hydrogen-contest");

const LOOKUPS = new Set(["course_search", "course_read", "course_files", "calendar_read", "reminders_list", "study_status", "search_memory"]);
// Made-up results, by tool and course (nothing real).
function fakeResult(call) {
  if (call.tool === "course_search" && /rule of (five|5)/i.test(String(call.query))) return "No pages of Systems Programming match this query.";
  if (call.tool === "course_search" && /geometric|הנדסי/i.test(String(call.query))) return "Calculus 2 / lecture3.pdf, page 4: \"A geometric series sum a*q^n (n from 0) converges if and only if |q| < 1, and then its sum is a/(1-q).\"";
  if (call.tool === "course_search") return `No pages of ${call.course || "the course"} match this query.`;
  if (call.tool === "study_status") return `${call.course || "Data Structures"}: attending, last lecture covered: 6 of 13.`;
  if (call.tool === "calendar_read") return "No events in that range.";
  if (call.tool === "course_files") return "lecture1.pdf ... lecture6.pdf, assignment3.pdf";
  return "No result.";
}

(async () => {
  const results = JSON.parse(fs.readFileSync(OUT, "utf8"));
  let calls = 0;
  for (const r of results.runs) {
    const test = TESTS.find((t) => t.id === r.test);
    if (r.error) { // the call itself failed: run it again once, fresh
      const again = await runOne(r.model, test); calls++;
      r.retry = again;
      console.error(`retry ${r.model} / ${r.test}: ${again.seconds}s, ${again.ok ? "OK" : "FAIL"}${again.error ? " " + again.error.slice(0, 100) : ""}`);
      continue;
    }
    const lookupsOnly = r.calls && r.calls.length && r.calls.every((c) => LOOKUPS.has(c.tool));
    if (!lookupsOnly || test.job || r.ok) continue; // a lookup that WAS the test (tool-search) needs no second round
    const round = "## Tool round 1\n" + r.calls.map((c, i) => `You called: ${JSON.stringify(c).slice(0, 400)}\n<tool-result id="r${i}">\n${fakeResult(c)}\n</tool-result id="r${i}">`).join("\n\n");
    const prompt = (test.photo ? brainPrompt(test.message, photoSection("photo.png")) : brainPrompt(test.message)) + "\n\n" + round + "\n\nContinue: either more CALL lines (only if really needed), or the final reply to Omri.";
    let spent = null; const t0 = Date.now();
    try {
      const text = test.photo
        ? await askAgyStreamWithImage(r.model, prompt, path.join(__dirname, test.photo), () => {}, { onUsage: (u) => { spent = u; } })
        : await ask("agy", r.model, prompt, () => {}, { agent: true, onUsage: (u) => { spent = u; }, timeoutMs: 300000 });
      calls++;
      let ok = false; try { ok = !!test.ok(text); } catch (error) { ok = false; }
      r.round2 = { seconds: +((Date.now() - t0) / 1000).toFixed(1), usage: spent, ok: ok && !leaksPrompt(text), leak: leaksPrompt(text), final: finalValue(text), calls: parseReply(text).calls, text };
      console.error(`round 2 ${r.model} / ${r.test}: ${r.round2.seconds}s, ${r.round2.ok ? "OK" : "FAIL"}`);
    } catch (error) {
      calls++;
      r.round2 = { seconds: +((Date.now() - t0) / 1000).toFixed(1), ok: false, error: String(error.message).slice(0, 300) };
      console.error(`round 2 ${r.model} / ${r.test}: ERROR ${r.round2.error.slice(0, 100)}`);
    }
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.error(`round 2 done: ${calls} calls`);
})();
