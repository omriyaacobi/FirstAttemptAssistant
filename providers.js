// providers.js
// The "hands" of the orchestrator: one function per AI tool we can talk to.
// Each takes a question and a model name and returns a Promise of the answer text.
// (A Promise is JavaScript's way of saying "the answer will arrive later".)

const { exec, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The front desk and the planner only classify text, so they run in an empty folder.
// agy is an agent that can see (and try to edit) the folder it starts in; this way it
// has nothing of yours to see.
const SANDBOX_DIR = path.join(os.tmpdir(), "orchestrator-empty");

// Where the two command-line tools live. Set the env var to override.
const CLAUDE_CMD = process.env.CLAUDE_CMD || '"C:\\Users\\User\\npm-global\\claude.cmd"';
const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

// Model names end up inside a shell command (for Claude), so only allow plain
// names like "sonnet" or "gemini-3.8-flash-low". Anything else is refused.
function checkModelName(model) {
  if (!/^[\w.-]+$/.test(model)) throw new Error(`Suspicious model name: ${model}`);
}

// Claude Code CLI. The question goes in through stdin so special characters are safe.
function askClaude(question, model) {
  checkModelName(model);
  return new Promise((resolve, reject) => {
    const child = exec(`${CLAUDE_CMD} -p --model ${model}`, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
    child.stdin.end(question);
  });
}

// Antigravity CLI. agy is a real .exe, so no shell is involved at all.
function askAgy(question, model) {
  checkModelName(model);
  return new Promise((resolve, reject) => {
    execFile(AGY_CMD, ["-p", question, "--model", model], (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

// Asks agy for an answer that must match a JSON schema (a description of the shape we want).
// agy only allows --json-schema together with --output-format json, and puts the clean
// result in a "structured_output" field. Returns that result as a JavaScript object.
function askAgyStructured(question, model, schema) {
  checkModelName(model);
  const args = ["-p", question, "--model", model, "--output-format", "json", "--json-schema", JSON.stringify(schema)];
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(AGY_CMD, args, { maxBuffer: 1e7, cwd: SANDBOX_DIR }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      try {
        const envelope = JSON.parse(stdout);
        resolve(envelope.structured_output ?? JSON.parse(envelope.response));
      } catch (parseError) {
        reject(new Error("agy did not return valid structured output"));
      }
    });
  });
}

const PROVIDERS = { claude: askClaude, agy: askAgy };

function ask(provider, model, question) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  return PROVIDERS[provider](question, model);
}

// Tries each model in the chain, in order, and returns the first answer that works.
// If one fails (out of quota, tool crashed, empty answer) it moves on to the next.
// askOne and the callbacks are parameters so tests can plug in fakes.
async function askChain(chain, question, { askOne = ask, onTry = () => {}, onFail = () => {} } = {}) {
  const errors = [];
  for (const { provider, model } of chain) {
    onTry({ provider, model });
    try {
      const answer = await askOne(provider, model, question);
      if (!answer) throw new Error("empty answer");
      return { answer, used: { provider, model } };
    } catch (error) {
      const message = String(error.message).trim().slice(0, 200);
      errors.push(`${provider}/${model}: ${message}`);
      onFail({ provider, model, message });
    }
  }
  throw new Error("Every model in the chain failed:\n" + errors.join("\n"));
}

module.exports = { ask, askChain, askAgyStructured, PROVIDERS, CLAUDE_CMD };
