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

- Planner done (step 5a): `planner.js` splits a multi-part task into labeled sub-tasks (types: quick, code, hard, google, general) and runs them, independent ones in parallel; a step that needs an earlier answer gets it in its prompt; if a step fails, steps depending on it are skipped. Flow: `looksMultiPart` (free keyword check) -> `plan` (Gemini Flash call with `--json-schema`; needs `--output-format json`, result in `structured_output`) -> `validatePlan` (never trust model output) -> `runPlan`. Falls back to the old single-job route if the planner fails. Flags: `--plan-only`, `--no-plan`, `--dry-run`. 23 tests pass. Live test: a 3-part task (explain, code, compare) finished in 21s with Gemini Flash, Claude Sonnet and Argon in parallel.
- Planner caveats: the keyword check can trigger on single tasks (costs one small Flash call, then handled as one job); the `claude` CLI sometimes answers like an agent ("I didn't save this to a file"); `needs` was empty in my test because the planner judged the steps independent.

- Web page done (step 7): `node server.js` (or double-click `start-web.cmd`) then open http://localhost:3000. Files: `core.js` (engine shared by CLI and web: `handleTask`), `server.js` (built-in `http` only, listens on 127.0.0.1), `public/index.html` (one file: HTML + CSS + JS), `orchestrator.js` is now a thin CLI over `core.js`. The page streams progress live (NDJSON), shows each step with its model, and has a quota panel from `agy -p "/usage"`. 45 tests pass (`node --test`), live-tested in the browser.
  - Security checks in `server.js` (each has a test): only 127.0.0.1; Host header must be localhost (blocks DNS rebinding); Origin / Sec-Fetch-Site must be same-origin (blocks other websites); JSON content-type only; body and task size limits; max 2 tasks at once. The page uses `textContent` only, never `innerHTML`, because model output is untrusted.
  - Known limits: answers show as plain text (markdown tables, LaTeX like `$\sqrt{n}$` appear raw); no history; the server must be running (close the window to stop it); if port 3000 is busy use `PORT=3001 node server.js`.

- Chat + memory done (step 7b), after my first feedback on the web page (text box didn't clear, no memory between prompts): the page is now a real chat. Sidebar of saved conversations (open, new, delete), message thread, box clears on send, Enter sends / Shift+Enter new line, `dir="auto"` so Hebrew displays right-to-left. 69 tests pass.
  - How memory works: the models remember nothing, and different models answer different messages. So `core.js` pastes the recent conversation (`historyBlock`, newest 12000 chars, each message cut at 3000) in front of each new message. Routing and the planner decide from the newest message only. Verified live: Claude Sonnet used a fact (dog's name) said earlier in a Gemini turn.
  - Storage: `store.js` saves one JSON file per conversation in `data/conversations/` (git-ignored, private; the repo is PUBLIC so never remove that line from .gitignore). Ids are 16 hex chars and validated everywhere because the id becomes a file path (path-traversal test included). Writes go to a temp file then rename. Tests use temp folders, never the real data folder.
  - Why the orchestrator can't see the Claude Code chat: it is a separate program that starts `claude -p` / `agy -p` fresh each time. Those calls do not share the Claude Code session where we build the project.
  - Limits: memory is the pasted text, so very long chats lose their oldest messages; no auto-summary; two messages sent at once in the same chat can overwrite each other.

- Front desk router done (step 8): the keyword rules are gone. `frontdesk.js` + `router-brief.md`: Gemini 3.8 Flash high reads the message (plus conversation) and returns `answer` / `clarify` / `delegate` / `split` as validated JSON. Destinations (fixed menu in `router.js`): gemini-flash, gemini-argon-low, gemini-argon-medium, claude-sonnet, claude-opus, each with a fallback chain. If the front desk or planner fails, Claude Sonnet takes it. The front desk and planner run in an empty temp folder so they cannot see or touch the project. 75 tests pass.
  - Tested live on 14 prompts (all decisions as intended, incl. Hebrew, vague Hebrew -> clarify question, calendar -> "not connected", prompt-injection attempt refused) and end to end: simple question 10s (one call), code -> Sonnet 20s, broken front desk -> Sonnet fallback 5s, 3-part split 51s, web page checked in the browser.
  - Cost of the design: every message first waits ~9-15s for the front desk decision (11-30s when several run at once). Easy questions are answered in that same call.
  - Calendar/Gmail/Drive are marked "NOT connected" in `router-brief.md`; flip that line when it is real.

- Self-edit built (step 9): the orchestrator can propose changes to its OWN code, safely. Sidebar button "Improve the orchestrator" in the web page. Files: `selfedit.js` (the gate), routes in `server.js` (`/api/selfedit...`), panel in `public/index.html`. 97 tests pass (19 for the gate, run against REAL temporary git repos with a fake editor, so no quota).
  - Flow: YOU start it (never a model) -> a git worktree on branch `selfedit/<id>` in a temp folder -> `claude -p --restricted --tools "Read,Glob,Grep,Edit,Write" --permission-mode acceptEdits --permission-prompts none` edits only there -> CODE checks: protected files untouched, project's tests pass, test count did not drop, real project folder untouched -> you review diff + test results in the page -> Approve = `git merge --ff-only`, NEVER pushes; Reject = delete the copy.
  - Protected from the editor (changes are auto-rejected): `server.js`, `selfedit.js`, `store.js`, `.gitignore`, `.gitattributes`, `start-web.cmd`, `.git/`, `.github/`, `data/`, `node_modules/`, `.env*`. Everything else (page, router-brief.md, router, planner, tests...) is editable.
  - Other rules: only one proposal at a time; project must be clean (no uncommitted changes) to start; approve refused if the project got new commits since or if the copy changed after testing; baseline tests must pass before the editor starts; max 25 files / 300 KB diff. Proposals are saved in `data/selfedit/` (git-ignored). Approved changes to code files need a server restart; page-only changes just need F5.
  - Gotcha found: when tests run inside `node --test`, children inherit `NODE_TEST_CONTEXT` and an inner `node --test` misbehaves; `selfedit.js` strips it.
  - The front desk briefing now tells users to use the "Improve the orchestrator" button when they ask it to change itself.
  - Live test with the REAL editor (Claude Sonnet, `--restricted`): a one-line subtitle change in `public/index.html` took 18s, produced a one-line diff, 97/97 tests passed, status "ready"; reviewed in the page, then Rejected. Verified afterwards: project clean, branch + temp copy gone, nothing pushed. The Approve path is covered by the git-based tests but has not been exercised with the real editor yet.
  - Not covered yet: the editor cannot run tests itself (it has no shell), so it can only reason about whether its tests pass; the gate runs them afterwards. A big change may take several rounds of proposal -> reject -> new request.

## Next
5. Fix the Calendar idea: check whether agy can actually read Google Calendar (MCP server / extension?). Right now the "google" rule only picks a Gemini model.
6. Routing v3 ideas: check `agy -p "/usage"` before choosing and skip a pool that is nearly empty; tune the keyword rules from real use (e.g. "design" always means hard); maybe a small model as router; log each run (model, time) to a file to see where quota goes.
7. Web page polish: render markdown safely (tables, math), summarize old messages instead of dropping them, quota warnings.

## Remember
- Claude Pro tokens work through Claude Code; a separate Anthropic API key is billed separately.
- Gemini route: the old Gemini CLI stopped serving personal accounts (incl. AI Pro) on 2026-06-18. Use Antigravity CLI (`agy`). A Google AI Studio API key also works but is billed/limited separately from the Pro plan.
- Never put API keys in code; use `.env`.
- The Claude desktop app is sandboxed: files it writes under `AppData` land in a private copy your terminal can't see. That's why the CLI lives in `C:\Users\User\npm-global` and is called by full path (`claude` alone isn't on your PATH).
- PowerShell blocks `.ps1` scripts by default; you ran `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` to allow local ones.
- Old GPT-OSS and Claude 4.6 models in agy are scheduled for removal on 2026-11-02; don't depend on them.
- Goal: orchestrator that routes each task to the best model (see CLAUDE.md "Orchestrator design"). Google-related tasks (Calendar etc.) should go to Gemini, if the CLI can reach them (unverified).
