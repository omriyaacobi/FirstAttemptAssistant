# Cleanup progress (2026-11-08, branch claude/project-cleanup-873384)

Baseline: 1007 tests, 248 tracked files, 131 `.js` files in the repo root (69 of them tests).

## Decision: safe subset, NOT a full `src/` restructure
Why: `server.js`, `selfedit.js`, `store.js`, `gitops.js`, `auth.js`, `preview.js`, `start-web.cmd` are PROTECTED by name at the root;
`improve-watch.js` is run by name by a scheduled task; 40+ modules use `__dirname`/relative paths for `data/`, `public/` and the
router briefings; Improve Bot's path rules assume the root layout. Moving ~60 modules into `src/` would touch all of that for little gain.

## Done
1. Tests moved to `tests/` (69 `*.test.js` + helper `testzip.js`, via `git mv`). Requires became `../x`, `__dirname` reads became `..`.
   Suite still 1007 green. Fixture strings inside two selfedit tests keep `./greet`.
   Added a test: every name in `PROTECTED_FILES` still exists at the root, and the files that scheduled tasks/cmd run stay at the root.
   `selfedit.js` only changed one sentence of the editor's rules ("tests live in the tests folder").

2. `hello-claude.js`, `hello-gemini.js` moved to `experiments/` (nothing requires them).
3. PROGRESS.md: the block that was pasted twice (old lines 186-355) was deduplicated by exact line match: 123 identical lines removed, every line that differed was kept (654 -> 503 lines). Nothing else removed.
4. Added `README.md` (map of the repo), `experiments/README.md`, a Layout bullet in CLAUDE.md, two comment paths fixed.
5. React verdict written: experiments/2026-11-08-react-verdict.md (verdict: do not rewrite).
6. Test copy: BOT_THREAD=on PORT=3100, empty data, no .env: /api/session OK, page 200, study.js 200; stopped. Port 3000 untouched.
7. Final suite: 1008 passed (1007 + the new protected-list test).

## Decided NOT to do (and why)
- No src/ restructure: protected-by-name root files, scheduled task runs improve-watch.js by name, ~40 modules use __dirname paths to data/ public/ and the briefings; risk high, gain small.
- Experiment scripts NOT moved into a subfolder: they require("../x"), read sibling files and cite their own path in comments. Indexed instead.
- No code module deleted: every root module is required by another module or documented as agreed in CLAUDE.md (bot.js is used by preview.js/selfedit.js; testzip.js is a test helper).
- HANDOFF.md kept: the manager chat uses it. PRIVACY.md and calendar-setup.md kept in root (linked from Google consent screen / Bot message and a test).

## Deletions
None (no file deleted; 70 files moved with git mv: 69 tests + testzip.js, plus 2 hello scripts).

## Stale branches (merged into main; DO NOT delete before review). Marked + are still checked out in a worktree: remove the worktree first.
answer-speed-e31751 app-navigation-802516 assistant-memory-36ee6b calendar-add-5116af calendar-chat-6d7517 calendar-fixes calendar-research-23d051 course-answers course-chats-96fc56 data-backup-0015e0 frontdesk-speed-01ec9f google-publish-95cc7f hebrew-notes-477307 improve-argon-c2ef07 lecture-lookup markdown-font-6d2aa8 math-render night-bughunt night-check-424ecd night-integrate night-page-52cb98 night-polish night-study-coach-4018fc night-thread-core-260aec phone-app-4bc9a2 phone-app-8c510b phone-no-pin profile-memory-5189f8 quota-aware quota-routing-8f82cd research-one-chat-world-3f7f24 speed-1e2cc8 study-faster-fe7506 study-notebooks-5e8d7a study-upgrade-ae8811 thinking-process-a14d1d ui-popup-improve-981eec
With worktree (+): fix-files-07ce43 fix-reminder-a59674 fix-study-061603 frontdesk-haiku-d42fac position-b1-a02893 position-b2 qa-round2-8a3bf5 research-one-chat-bot-4cffb7 study-catchup-417705 zip-code-files-d3124f zip-course-page-4faec6 zip-image-triage-0ae29b zip-upload-de24b4
(Branch quota-why-0c9eaf is not listed as merged: keep it, the quota report lives only there.)
