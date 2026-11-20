# 2026-11-20: building Improve Bot for all of Bot (light gate) and Neon in Bot's chains

Omri's approved plan, built in one Opus side session on branch `claude/selfedit-neon-build-1519c3` (cut from the research branch
with the prototypes). Research and the decisions behind it: `2026-11-20-selfedit-full-access.md`, `2026-11-20-neon-deep-trial.md`.
Nothing was merged, pushed or restarted; the running Bot (port 3000) and the real `.env` / `data/` were never touched.

## What each phase changed (one commit each, full suite green after each)

| Phase | What | Where |
|---|---|---|
| 0 | The test run may take 15 minutes (was 240 s; the suite needs up to ~6 min on a busy PC). A cut-off run says so. | `selfedit.js` `TEST_TIMEOUT_MS` |
| 1 | The test run is FENCED: `GIT_CONFIG_*` sends every github.com push to a missing folder, saved logins off. A change that touches a protected file or whose added lines mention `.env`, permission flags or force-push/reset is refused BEFORE any test run (every editor, not only Argon). | `fencedEnv` in `selfedit-guard.js`, `preTestProblems` |
| 2 | On a ready change: the code's risk notes and ONE Hydrogen medium review, shown only (no extra tick). A failed review says why; an unreadable one is "unclear", never "ok". | `reviewChange`, `renderReview` in the page |
| 3 | Undo of the LAST approved change (a new revert commit; refuses a dirty project or a conflict), with a button. `approve()` writes `data/selfedit-pending.json`; `server.js` marks it healthy once listening; `start-web.cmd` runs `node health-guard.js` before every start: two failed starts -> the change is reverted, `data/selfedit-rollback.json` + a `bot.log` line, and the page explains it. | `undo`, `health-guard.js`, `start-web.cmd`, `POST /api/selfedit/:id/undo` |
| 4 | FIRST `tests/refusal-rules.test.js`: one row per tool of every "refused after a web page / photo / Moodle text" rule, for all three sources, with Omri's exceptions (69 rows + 1). Then every file is open except the GUARD files (`tierOf`); safety-check files only get a note; limits 25 files / 300,000 characters (the prototype's line limits dropped). | `isProtected` = `tierOf(...) === "guard"`, `EDITOR_RULES`, `improve-watch.js` |
| 5 | Neon medium as the DEFAULT editor (`makeNeonEditor`, built from the Argon editor: agy `--mode accept-edits`, private TEMP, `auditWide` on every tool step, also never a `.env` file; no fallback to Claude; refuses to start when the Gemini Models pool is low). `neonLow` / `neonMedium` in `router.js` (ids checked with `agy models`). | `selfedit.js`, page, `server.js`, `router.js` |
| 6 | One phone push when a change ends ready / blocked / failed: no change text, nothing 22:00-08:00. | `finishPush`, `onFinish` |
| 7 | Brain: Neon low -> Hydrogen medium -> Argon low -> Sonnet in agy -> Claude Code. Big PDFs: Argon low -> Neon low -> Hydrogen high. | `brain.js` `CHAIN`, `ingest.js` `CUT_CHAIN`, `quota.js` `paceOrder` |
| 8 | CLAUDE.md (SELF-EDIT, MODELS, READING, plus the IMPROVE CHAT and INDEPENDENCE lines that named the old list), PROGRESS.md, README, this note. | |

Tests: 1165 at the start (1163 pass, 1 skipped, 1 flaky watchdog fail) -> 1264 (1263 pass, 1 skipped, 0 fail).

## Found on the way (fixed, each with a test)
- **The week pacing would have switched itself off.** `paceOrder` compared "the first two agy models"; with Neon low and Hydrogen
  medium first (one pool) it would never have let Argon lead again. It now compares the first two agy POOLS and moves the leader in
  front (the old swap for neighbours).
- **A failed agy editor could leave a proposal "running".** On Windows the just-stopped agy still held the private copy, `cleanup()`
  threw EPERM and the "failed" record was never saved. Now it retries and never throws. (True for the Argon editor before too.)
- **An agy failure was told to the quota module twice** (on the error, again on "close"). Once now.
- Two flaky tests seen once each (not from this build): `watchdog.test.js` "nothing on the port" (empty PowerShell time stamp) and
  `selfedit-argon.test.js` "private TEMP" (its check fails when the random folder name starts with "x"). Listed in PROGRESS.md.

## Decided alone (say if you want it otherwise)
- **watchdog.cmd is unchanged.** Omri allowed one line there too, but the watchdog starts Bot through start-hidden.vbs ->
  start-web.cmd, which already runs the guard before every start; a second line would count every start twice.
- **The health guard's 3-minute rule starts at the first start, not at approve.** Otherwise a restart done more than 3 minutes
  after approving would have counted as a failure and reverted a good change.
- **Neon may not open a `.env` file at all** (also not to read), and links/submodules are refused for every editor, not only Argon.
- **`start()` in code still defaults to Sonnet**; the page and the server default to Neon (so the many fake-editor tests stay
  model-free). For Omri the default is Neon.
- **The push also goes for "blocked"** (it is a "could not be finished" ending, like "failed").
- **A safety-check file's note** says "this file holds safety checks; read this part of the change yourself" (level "high", so red
  on the card), and improve-watch.js names such files on their own line.

## End checks (real models, temp worktrees with a fake `.env`)
| Check | Result |
|---|---|
| One real Improve Bot run, Neon medium, through `createSelfEdit` (request: a new `tiny-format.js` with `percent(part, whole)` and 3 tests) | **ready** after 177 s in all (baseline tests 60 s, editor ~40 s, tests on the change ~75 s, review): 2 files added, tests 1267 pass (baseline 1264), 1 attempt. Risk notes: none (a pure function: nothing to note). Hydrogen medium review: **ok**, 3 notes (it matches the request; it also handles null/NaN; run the tests). The push listener heard one "ready". |
| Approve, then Undo, on that run | Approve: merged, `needsRestart` true, `selfedit-pending.json` written. Undo: a new revert commit, the file gone, the pending note removed, the project clean. The temp worktree and its `selfedit/*` branch were removed afterwards. |
| A scripted bad change (a new test that reads `.env`) | **blocked before its tests**: "mentions the .env file", "the tests were not run"; the planted test never ran; only the baseline test run happened (the 3 tries were each refused before running). |
| Real brain calls through the normal chain (fake stores) | All by **gemini-4-neon-low**: "17 x 23" -> "391" (5.4 s, 8,985 tokens); "which reminders are waiting" (7.6 s, 9,094 tokens, answered from the context); "remind me tomorrow at 9:00" -> `set_reminder` into the fake store and the answer in ONE model call (7.4 s, 9,280 tokens). |
| Full `node --test` | 1264 tests, 1263 pass, 1 skipped, 0 fail. |

Pools before the checks (`agy -p "/usage"`): Gemini Models 5 h 100% / week 76%, Gemini 4 Argon week 61%, Claude and GPT 5 h 100% /
week 48% (not used). The 30% floor was never near.

## Cost of this build
Claude: one Opus session (this one). Gemini: one Neon medium edit, one Hydrogen medium review, 3 Neon low brain calls, one `/usage` look
and one tiny call by mistake (Git Bash turned "/usage" into a path, so agy answered it as a question). The Claude-and-GPT agy pool was not used.
