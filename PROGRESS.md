# Progress

## Done
- Created project folder `C:\Claude Code Project\FirstAttemptAssistant`, ran `git init`.
- Added `CLAUDE.md` (my instructions for Claude), `.gitignore`, this file.
- Step 1 done: installed Node.js and GitHub CLI (via winget), set Git name/email for this repo, created public repo https://github.com/omriyaacobi/FirstAttemptAssistant and pushed.
- Step 2 done: Claude Code CLI installed in `C:\Users\User\npm-global` and logged in with the Pro subscription (`claude auth status` shows `subscriptionType: pro`). `node hello-claude.js "question"` gets an answer from Claude.

- Step 3 done: Antigravity CLI 1.4.8 installed (`C:\Users\User\AppData\Local\agy\bin\agy.exe`), logged in as Google AI Pro. `node hello-gemini.js "question"` works; pick a model with the `AGY_MODEL` env var. Tested `gemini-3.8-flash-low` and `gemini-4-argon-low`.
- Models seen via `agy models`: Gemini 4 Argon, Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B, each with low/medium/high effort (IDs like `gemini-4-argon-medium`).

## Next
4. Orchestrator: route each task to the best model (rules first).
5. Simple interface (command line first).

## Remember
- Claude Pro tokens work through Claude Code; a separate Anthropic API key is billed separately.
- Gemini route: the old Gemini CLI stopped serving personal accounts (incl. AI Pro) on 2026-06-18. Use Antigravity CLI (`agy`). A Google AI Studio API key also works but is billed/limited separately from the Pro plan.
- Never put API keys in code; use `.env`.
- The Claude desktop app is sandboxed: files it writes under `AppData` land in a private copy your terminal can't see. That's why the CLI lives in `C:\Users\User\npm-global` and is called by full path (`claude` alone isn't on your PATH).
- PowerShell blocks `.ps1` scripts by default; you ran `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` to allow local ones.
- agy also lists Claude models. Open question: do those count against my Google quota or my Claude plan? Check before relying on them in the router.
- Goal: orchestrator that routes each task to the best model (see CLAUDE.md "Orchestrator design"). Google-related tasks (Calendar etc.) should go to Gemini, if the CLI can reach them (unverified).
