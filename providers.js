// providers.js
// The "hands" of the orchestrator: one function per AI tool we can talk to.
// Each takes a question and a model name and returns a Promise of the answer text.
// (A Promise is JavaScript's way of saying "the answer will arrive later".)

const { exec, execFile } = require("node:child_process");

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

const PROVIDERS = { claude: askClaude, agy: askAgy };

function ask(provider, model, question) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  return PROVIDERS[provider](question, model);
}

module.exports = { ask, PROVIDERS };
