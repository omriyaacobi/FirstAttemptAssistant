# Progress

## Done
- Created project folder `C:\Claude Code Project\FirstAttemptAssistant`, ran `git init`.
- Added `CLAUDE.md` (my instructions for Claude), `.gitignore`, this file.

- Step 1 done: installed Node.js and GitHub CLI (via winget), set Git name/email for this repo, created public repo https://github.com/omriyaacobi/FirstAttemptAssistant and pushed.
- Step 2 done: Claude Code CLI installed in `C:\Users\User\npm-global` and logged in with the Pro subscription (`claude auth status` shows `subscriptionType: pro`). `node hello-claude.js "question"` gets an answer from Claude.

## Next
3. Install Antigravity CLI (`agy`) in my own terminal, log in, check `/usage` for Gemini 4 Argon. Then `hello-gemini.js` using `agy -p`.
3. Hello Gemini: same, for Gemini.
4. Orchestrator: route tasks between the two.
5. Simple interface (command line first).

## Remember
- Claude Pro tokens work through Claude Code; a separate Anthropic API key is billed separately.
- Gemini Pro (the app plan) does not automatically include API access; use a Google AI Studio key or Gemini CLI.
- Never put API keys in code; use `.env`.
- The Claude desktop app is sandboxed: files it writes under `AppData` land in a private copy your terminal can't see. That's why the CLI lives in `C:\Users\User\npm-global` and is called by full path (`claude` alone isn't on your PATH).
- PowerShell blocks `.ps1` scripts by default; you ran `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` to allow local ones.
- Goal: orchestrator that routes each task to the best model (see CLAUDE.md "Orchestrator design"). Google-related tasks (Calendar etc.) should go to Gemini, if the CLI can reach them (unverified).
