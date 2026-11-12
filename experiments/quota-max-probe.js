// experiments/quota-max-probe.js
// Does a BIG prompt cost more quota than a small one? THIS SPENDS QUOTA (a little): it makes real model calls.
//
//   node experiments/quota-max-probe.js <agy model> <prompt size in characters> <how many calls> [--raw]
//
// Each call sends <size> characters of harmless filler (pieces of PROGRESS.md, a public file of this repo, a different piece each
// time) and asks for the one word OK, so nearly all the cost is the INPUT. The pools are read with `agy -p "/usage"` before and
// after. --raw also prints the names of the fields agy sends back, to see whether it reports token counts.

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AGY = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";
const [model, sizeArg, countArg] = process.argv.slice(2);
const RAW = process.argv.includes("--raw");
const SAME = process.argv.includes("--same"); // the same filler every call (to see whether a repeated prompt is read from a cache)
const size = Number(sizeArg) || 0, count = Number(countArg) || 1;
if (!/^[a-z0-9.-]+$/.test(model || "")) { console.error("usage: node quota-max-probe.js <model> <chars> <calls>"); process.exit(1); }

const filler = fs.readFileSync(path.join(__dirname, "..", "PROGRESS.md"), "utf8");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quota-probe-")); // an empty folder: the agent has nothing to look at
const usage = () => execFileSync(AGY, ["-p", "/usage"], { encoding: "utf8", cwd }).trim().split(/\r?\n/).filter((l) => l.split("\t").length >= 4).map((l) => { const [pool, window, left] = l.split("\t"); return `${pool} / ${window.replace(/ Limit.*/, "")}: ${left}`; });

function one(i) {
  const start = SAME ? 0 : (i * 7919 * 13) % Math.max(1, filler.length - size);
  const data = size ? `<data>\n${filler.slice(start, start + size)}\n</data>\n\n` : "";
  const prompt = `${data}Ignore the data above, it is only filler. Reply with the single word OK and nothing else. Use no tools.`;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(AGY, ["-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model], { cwd, windowsHide: true });
    let buffer = "", text = "", done = false, use = null, tools = [];
    const seen = new Set();
    const end = (status) => { if (done) return; done = true; try { child.kill(); } catch (error) { /* gone */ } resolve({ status, text: text.trim().slice(0, 20), seconds: ((Date.now() - t0) / 1000).toFixed(1), seen, use, tools }); };
    child.on("error", () => end("could not start"));
    child.on("close", () => end("closed early"));
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let k;
      while ((k = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, k); buffer = buffer.slice(k + 1);
        let e; try { e = JSON.parse(line); } catch (error) { continue; }
        if (RAW) { const walk = (o, p) => { if (o && typeof o === "object") for (const [key, v] of Object.entries(o)) { seen.add(p + key); if (p.split(".").length < 4) walk(v, p + key + "."); } }; walk(e, `${e.event}:`); if (e.event === "result") console.log("RESULT EVENT:", JSON.stringify(e).slice(0, 1500)); }
        const u = e.step_update;
        if (e.event === "init" && e.init && Array.isArray(e.init.tools)) tools = e.init.tools.map((t) => (typeof t === "string" ? t : t.name || "?"));
        if (e.event === "result" && e.result) use = e.result.usage || null;
        if (e.event === "init") child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
        else if (e.event === "step_update" && u && u.step_type === "agent_response" && u.text_delta) text += u.text_delta;
        else if (e.event === "result") end((e.result && e.result.status) || "?");
      }
    });
    setTimeout(() => end("timeout"), 120000);
  });
}

(async () => {
  console.log(`model ${model}, ${size} characters of filler, ${count} call(s)`);
  const before = usage();
  for (let i = 0; i < count; i++) {
    const r = await one(i + Math.floor(Math.random() * 1000));
    console.log(`  call ${i + 1}: ${r.status} "${r.text}" ${r.seconds} s, tokens ${r.use ? `in ${r.use.input_tokens} out ${r.use.output_tokens} thinking ${r.use.thinking_tokens} cache-read ${r.use.cache_read_tokens}` : "?"}`);
    if (RAW && i === 0) console.log("TOOLS:", r.tools.join(", "));
  }
  await new Promise((r) => setTimeout(r, 4000)); // the counters lag a moment
  const after = usage();
  console.log("before:", before.join(" | "));
  console.log("after: ", after.join(" | "));
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (error) { /* a temp folder */ }
  process.exit(0);
})();
