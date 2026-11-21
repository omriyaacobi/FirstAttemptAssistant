# 2026-11-21: Improve Bot is faster, and can be stopped

Branch `claude/improve-speed-stop-bda4db`. Omri asked for both. `selfedit.js` is a guard file, so only Claude Code could change it.
Nothing was merged, pushed or restarted; the running Bot and the real `.env` / `data/` were not touched.

## 1. Skipping "tests before"

A change used to cost about 15 minutes, most of it two full test runs: one on the unchanged copy (the baseline), one on the change.

- `data/selfedit-baseline.json` holds `{ commit, total, at }`, written atomically (temp file, then rename).
- `work()` reads it after making the private copy. The first run is skipped only when ALL of these hold: the copy's `HEAD` is exactly
  `commit`, the main tree is clean, `total` is a positive whole number, `commit` is 40 hex characters, and the record is at most 7 days old.
  The page then shows: "Bot's tests already passed on this version, skipping the first run." and the record has `baselineReused: true`.
- Anything else (another commit, a missing or broken file, an old or odd record) runs the baseline as before.
- A failed or stopped baseline is never stored. Only a green run (`ok`, total > 0) is.
- Also stored after an APPROVED merge: the merged commit holds exactly the tree whose tests passed (approve already checks the tree hash),
  so the next change on top of it can skip the first run too. Without this the record would rarely match, because every approved change
  moves `main`. A commit made by hand (a manager merge) has no record, so the next change runs the baseline once and stores it.
- The "tests after" run and every other gate check are unchanged. The test-count check uses the stored total (a test proves a reused
  baseline cannot hide dropped tests).

Saving: about 1 to 6 minutes per change, depending on how busy the PC is (the suite took 343 s when busy, about 1 minute when quiet).

## 2. The Stop button

- `POST /api/selfedit/:id/stop` and `POST /api/selfedit/plan/:id/stop` (same login / origin / JSON checks as approve and reject: they
  go through the same `readJsonBody`).
- One `run` per active change: an `AbortController` plus a "stop promise". The signal goes to the editor and to the test runner
  (`killOnSignal`: `taskkill /T /F` on the child's pid on Windows via `providers.killTree`, so agy's helpers and the test workers die
  too). `guarded(...)` also ends each long wait at once, even for an editor or test run that ignores the signal.
- `stop()` waits for the work loop to end. The loop cleans up like Reject (worktree and branch removed) and saves `stopped` with
  "Stopped by you. Nothing was changed." Its `finally` clears `active`, so a new change can start straight away. Nothing is merged and
  no push is sent. It works in every phase: copy being made, baseline, editing, tests after, second review.
- A follow-up that is stopped puts the previous version back and the proposal stays `ready` (approvable).
- A plan that is stopped becomes `discarded` (the page says "Stop and discard plan"). `providers.ask` now passes `signal` to agy.
- An editor killed from OUTSIDE (not by the button) still ends as a normal failure, as before.
- Page: a "Stop" button on the running card and "Stop and discard plan" on the planning card, with a confirm. They are normal buttons,
  so they work on the phone too.

## Tests

`tests/selfedit-stop.test.js` (15 tests): the baseline reused on the same commit only, the stored total used for the count check,
broken / old / nonsense records, never stored when failed, stored after an approved merge, and the stop in every phase (leaves no
worktree, no branch, `isActive()` false, nothing merged), a new change after a stop, a stopped follow-up, the real `nodeTests` ending
on the signal, and a stopped plan.
