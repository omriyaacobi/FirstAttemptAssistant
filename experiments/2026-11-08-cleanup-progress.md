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

## Next
- Move lab scripts in `experiments/` into `experiments/scripts/` (fix `../x` to `../../x`).
- Move `hello-claude.js`, `hello-gemini.js` (nothing requires them) into `experiments/scripts/`.
- PROGRESS.md: 156 KB, first 185 lines are duplicated ("# Progress" appears twice) -> archive.
- CLAUDE.md file names, README pointers, port 3100 test copy, React verdict.

## Deletions
(none yet)

## Kept on purpose
- `PRIVACY.md` and `calendar-setup.md` stay in the root: PRIVACY.md is linked from the Google consent screen
  (`.../blob/main/PRIVACY.md`), calendar-setup.md is named in a message Bot shows and in a test.
- `bot.js` (CLI, used by preview.js/selfedit.js), `testzip.js` (test helper, now in tests/).
