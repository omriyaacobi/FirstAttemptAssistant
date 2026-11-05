// warmagy.js
// A "pre-warmed" agy for the front desk. Starting agy costs about 2-3 s (it prints an "init" event when it is ready)
// before the model even sees the prompt. So we start the NEXT agy process in advance and keep it waiting; when a
// message arrives we only have to write the prompt to the process that is already running.
//
// Why this is safe (measured in experiments/2026-11-05-frontdesk-speed.md):
//   * Every process serves EXACTLY ONE message, then it is closed. A new conversation each time, so nothing from an
//     earlier message can leak into a later decision (that was the problem with one long-lived process).
//   * The prompt, the model, the flags and the empty sandbox folder are the same as the normal cold call.
//   * If the spare is missing, too old or dead, the call simply starts a fresh process (the normal cold speed).
//
// askStructured has the same shape as providers.askAgyStructured, so it can replace it.
// command / prefixArgs / clock are parameters so the tests can use a fake agy.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { SANDBOX_DIR, killTree, checkModelName, AGY_CMD } = require("./providers");

const MAX_SPARE_AGE_MS = 8 * 60 * 1000; // a spare older than this is thrown away (idle 5 min was tested fine)
const DEFAULT_TIMEOUT_MS = 90 * 1000;

// One agy process in stream mode. ready resolves when agy printed "init". run(prompt) writes the prompt and resolves
// with the structured reply. kill() stops it. It can run() only once.
function startProcess({ command, prefixArgs, model, schema, clock }) {
  const args = [...prefixArgs, "-p=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", model];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  const child = spawn(command, args, { cwd: SANDBOX_DIR, windowsHide: true });
  const born = clock();
  let buffer = "";
  let isReady = false;
  let isDead = false;
  let used = false;
  let onReady;
  let waiter = null; // { resolve, reject } of the one run() in progress
  const ready = new Promise((resolve) => { onReady = resolve; });
  let deathReason = "agy closed before it answered";

  const die = (reason) => {
    isDead = true;
    deathReason = reason || deathReason;
    if (waiter) { const w = waiter; waiter = null; w.reject(new Error(deathReason)); }
  };

  child.on("error", (error) => die("could not start agy: " + error.message));
  child.on("close", () => die());
  child.stderr.on("data", () => {}); // agy's noise on stderr is not needed
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (error) { continue; }
      if (event.event === "init") { isReady = true; onReady(); }
      if (event.event === "result" && waiter) {
        const w = waiter;
        waiter = null;
        const result = event.result || {};
        if (result.status && result.status !== "SUCCESS") return w.reject(new Error("agy status " + result.status));
        try {
          w.resolve(result.structured_output ?? JSON.parse(String(result.response).match(/\{[\s\S]*\}/)[0]));
        } catch (error) {
          w.reject(new Error("agy did not return valid structured output: " + String(result.response).replace(/\s+/g, " ").trim().slice(0, 150)));
        }
      }
    }
  });

  return {
    get alive() { return !isDead && child.exitCode === null; },
    get ready() { return isReady; },
    get age() { return clock() - born; },
    get used() { return used; },
    run(prompt) {
      used = true;
      return new Promise((resolve, reject) => {
        if (isDead) return reject(new Error(deathReason));
        waiter = { resolve, reject };
        ready.then(() => {
          if (isDead) return;
          // The message format agy expects on stdin in stream-json mode: one JSON line per user turn.
          child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
        });
      });
    },
    kill() {
      if (!isDead) die("stopped");
      try { child.stdin.end(); } catch (error) { /* already closed */ }
      try { child.kill(); } catch (error) { /* already gone */ } // synchronous, so it also works while Bot is exiting
      killTree(child);
    },
  };
}

function createWarmAgy({ command = AGY_CMD, prefixArgs = [], clock = Date.now, maxSpareAgeMs = MAX_SPARE_AGE_MS } = {}) {
  const spares = new Map(); // "model|schema" -> a waiting process
  process.once("exit", () => { for (const proc of spares.values()) proc.kill(); }); // never leave an agy behind

  const keyOf = (model, schema) => model + "|" + (schema ? JSON.stringify(schema) : "");
  const fresh = (model, schema) => startProcess({ command, prefixArgs, model, schema, clock });

  // Starts the spare for the NEXT message (does nothing if a good one is already waiting).
  function warmUp(model, schema) {
    checkModelName(model);
    const key = keyOf(model, schema);
    const old = spares.get(key);
    if (old && old.alive && old.age < maxSpareAgeMs) return;
    if (old) old.kill();
    spares.set(key, fresh(model, schema));
  }

  // Same shape as providers.askAgyStructured(question, model, schema, { signal, timeoutMs }).
  // Uses the waiting spare if there is a good one, otherwise a new process (a normal cold call).
  async function askStructured(question, model, schema, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    checkModelName(model);
    const key = keyOf(model, schema);
    let proc = spares.get(key);
    spares.delete(key);
    let warm = true;
    if (!proc || !proc.alive || proc.age >= maxSpareAgeMs) {
      if (proc) proc.kill();
      proc = fresh(model, schema);
      warm = false;
    }
    let timer;
    const stop = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${model} timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      if (signal) {
        const onAbort = () => reject(new Error("aborted"));
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      const reply = await Promise.race([proc.run(question), stop]);
      return reply;
    } finally {
      clearTimeout(timer);
      proc.kill(); // one process, one message
      // Prepare the spare for the next message only AFTER this one is done, so they never compete for the network.
      try { warmUp(model, schema); } catch (error) { /* a missing spare only means the next call is cold */ }
    }
  }

  function closeAll() {
    for (const proc of spares.values()) proc.kill();
    spares.clear();
  }

  return { askStructured, warmUp, closeAll, _spares: spares };
}

module.exports = { createWarmAgy, MAX_SPARE_AGE_MS };
