// hello-claude.js
// Sends one question to Claude through the Claude Code CLI and prints the answer.
// Because it goes through the CLI (not an API key), it uses your Claude plan.
//
// Run it with:  node hello-claude.js "your question here"

const { exec } = require("node:child_process");

// process.argv holds the command-line words: [node, this file, ...your words]
const question = process.argv.slice(2).join(" ") || "Say hello in one short sentence.";

// Where the claude command lives. Set CLAUDE_CMD to override; the default is the
// folder we installed it into (a plain "claude" isn't on this machine's PATH).
const claudeCmd = process.env.CLAUDE_CMD || '"C:\\Users\\User\\npm-global\\claude.cmd"';

// "claude -p <text>" means "print mode": ask once, print the answer, exit.
// exec runs the command through the shell, which Windows needs for claude.cmd.
// The question is sent through stdin (the program's input stream) instead of the
// command line, so special characters in it can't confuse the shell.
const child = exec(`${claudeCmd} -p`, (error, stdout, stderr) => {
  if (error) {
    console.error("Could not get an answer from Claude:", stderr || error.message);
    process.exit(1);
  }
  console.log(stdout.trim());
});
child.stdin.end(question);
