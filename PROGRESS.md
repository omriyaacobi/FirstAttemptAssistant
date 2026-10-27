# Progress

## Done
- Created project folder `C:\Claude Code Project\FirstAttemptAssistant`, ran `git init`.
- Added `CLAUDE.md` (my instructions for Claude), `.gitignore`, this file.
- Step 1 done: installed Node.js and GitHub CLI (via winget), set Git name/email for this repo, created public repo https://github.com/omriyaacobi/FirstAttemptAssistant and pushed.
- Step 2 done: Claude Code CLI installed in `C:\Users\User\npm-global` and logged in with the Pro subscription (`claude auth status` shows `subscriptionType: pro`). `node hello-claude.js "question"` gets an answer from Claude.

- Step 3 done: Antigravity CLI 1.4.8 installed (`C:\Users\User\AppData\Local\agy\bin\agy.exe`), logged in as Google AI Pro. `node hello-gemini.js "question"` works; pick a model with the `AGY_MODEL` env var. Tested `gemini-3.8-flash-low` and `gemini-4-argon-low`.
- Models seen via `agy models`: Gemini 4 Argon, Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B, each with low/medium/high effort (IDs like `gemini-4-argon-medium`).

- Step 4 done: orchestrator v1. Files: `providers.js` (runs claude/agy), `router.js` (rules: google -> hard -> code -> quick -> fallback), `orchestrator.js` (main), `router.test.js` (run `node --test`, 7 tests pass).
  - Use: `node orchestrator.js "task"`, `--dry-run` to only see the choice, `--force claude:opus "task"` to override.
  - Verified live: a short question went to Gemini Flash, a coding task went to Claude Sonnet. The `[router] ...` log lines go to stderr on purpose.
  - Quota facts: Claude models inside `agy` are covered by the Google AI Pro plan (separate "Claude and GPT models" limit), not the Claude plan. So there are 3 pools: Claude plan (claude CLI), Gemini models (agy), Claude+GPT models (agy). Router v1 uses pools 1 and 2 only.

- Experiment done (2026-10-28), see `experiments/2026-10-28-model-comparison.md`: Claude Sonnet 5.5 via `agy` vs via `claude` CLI vs Gemini 4 Argon. Quality similar on easy tasks. Claude/GPT pool in `agy` is the scarcest (3 tiny calls = -2%); Gemini pool barely moved; `claude` CLI sends ~38k input tokens per call. `agy -p "/usage"` prints quotas non-interactively.

- Routing v2 done: each task type now has a **chain** of models (first choice + fallbacks) in `router.js` (`CHAINS`). Gemini is the default, `claude` CLI first for code, Claude-in-`agy` last resort only. `askChain` in `providers.js` tries the chain in order and moves on when a model fails or returns nothing. `--force a:x,b:y` lets you test your own chain. 12 tests pass (`node --test`); live-tested fallback with a fake model.

## Next
5. Fix the Calendar idea: check whether agy can actually read Google Calendar (MCP server / extension?). Right now the "google" rule only picks a Gemini model.
6. Routing v3 ideas: check `agy -p "/usage"` before choosing and skip a pool that is nearly empty; tune the keyword rules from real use (e.g. "design" always means hard); maybe a small model as router; log each run (model, time) to a file to see where quota goes.
7. Simple interface (command line first, web page maybe).

## Remember
- Claude Pro tokens work through Claude Code; a separate Anthropic API key is billed separately.
- Gemini route: the old Gemini CLI stopped serving personal accounts (incl. AI Pro) on 2026-06-18. Use Antigravity CLI (`agy`). A Google AI Studio API key also works but is billed/limited separately from the Pro plan.
- Never put API keys in code; use `.env`.
- The Claude desktop app is sandboxed: files it writes under `AppData` land in a private copy your terminal can't see. That's why the CLI lives in `C:\Users\User\npm-global` and is called by full path (`claude` alone isn't on your PATH).
- PowerShell blocks `.ps1` scripts by default; you ran `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` to allow local ones.
- Old GPT-OSS and Claude 4.6 models in agy are scheduled for removal on 2026-11-02; don't depend on them.
- Goal: orchestrator that routes each task to the best model (see CLAUDE.md "Orchestrator design"). Google-related tasks (Calendar etc.) should go to Gemini, if the CLI can reach them (unverified).
