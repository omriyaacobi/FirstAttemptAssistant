// hello-gemini.js
// Sends one question to Gemini through the Antigravity CLI (agy) and prints the answer.
// Like hello-claude.js, it goes through a CLI that is already logged in to your
// Google AI Pro account, so no API key is needed.
//
// Run it with:  node hello-gemini.js "your question here"
// Pick a model: set AGY_MODEL (run "agy models" to see the names), e.g.
//   $env:AGY_MODEL = "gemini-4-argon-low"; node hello-gemini.js "hi"

const { execFile } = require("node:child_process");

const question = process.argv.slice(2).join(" ") || "Say hello in one short sentence.";

// Where agy.exe lives. Set AGY_CMD to override.
const agyPath = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

// Default to the cheapest model, so a quick test barely touches your quota.
const model = process.env.AGY_MODEL || "gemini-3.8-flash-low";

// agy is a real .exe, so we don't need a shell. That means the question is passed
// straight to the program as one argument and special characters can't be misread.
// "-p" is print mode: ask once, print the answer, exit.
execFile(agyPath, ["-p", question, "--model", model], (error, stdout, stderr) => {
  if (error) {
    console.error("Could not get an answer from Gemini:", stderr || error.message);
    process.exit(1);
  }
  console.log(stdout.trim());
});
