# 2026-11-24: Bot adapts when Google changes agy's models or quota pools (to-do t29)

## Verdict (plain words)

Bot now looks at `agy models` and `agy -p /usage` by itself (at start, then once a day), compares them with a saved copy, and tells Omri
in the thread when a model or a pool row appears or disappears. A model agy stops offering is skipped in every chain (logged). A model
whose own pool row is missing counts as part of the shared "Gemini Models" pool. A NEW model is only reported, never used. All of it is
code: **no model call, no quota**. Test sessions get a small guard that stops live calls at a set share of the week.

## 1. What was built

| Part | Where | What it does |
|---|---|---|
| 1. The check | `models-watch.js` (new), wired in `server.js` after `moodleWatch.start()` | At start and then once a day (retry 30 min after a failed try): `agy models` + `agy -p /usage`, compared with `data/agy-models.json` (models with labels, pool names, time). ONE code-written thread message (`rule: "model watch"`) when something appeared or disappeared; push shows counts only ("1 new model, 1 gone, 1 quota pool change"), none from 22:00 to 08:00 (the message is still posted). The first look ever only saves the baseline and says nothing. A failed or empty lookup changes nothing (a broken command can never look like "every model vanished"); if only `/usage` fails the models are still compared and the saved pools are kept. |
| 2. Missing pool row | `resolvePools` in `models-watch.js`, called in `brain.js` before pacing | A chain model (agy, web, research) whose own pool has no row in `/usage` is copied with the pool of its family: `gemini-*` -> "Gemini Models", `claude-*` / `gpt-*` -> "Claude and GPT models" (only when that family pool has a row; nothing known = nothing changes). So `paceOrder`, `paceFree`, `claudeFirst`, the 25% reserve and the 15% rule all see real numbers. Before: such a model could never look low (test "steps back when the shared Gemini pool is low"). |
| 3. Preference lists | `filterChain` in `models-watch.js`, called in `brain.js` (brain and photo chains) and at the top of `providers.askChain` (so every background job: reading, tutor, summary, news, brief, Moodle sorter, id pickers) | A model agy does not offer is skipped, one log line each: `[models] skipping X: agy does not offer it any more (see the model check)`. The Claude Code CLI is never touched. A chain is never emptied: if nothing would be left it is kept as it is, so the normal failure message tells Omri honestly. Until a check worked, nothing is skipped (the saved file is not trusted for this, only a live look). New models: reported in the message ("Candidates for a trial only. Bot does NOT use them until you say so"), in no chain, and nothing in the code can add one: chains stay hand-written lists. |
| 4. Test-session guard | `tools/quota-guard.js` (new) | See section 3. |

Tests: `tests/models-watch.test.js` (15), `tests/quota-guard.test.js` (4). No package, no build step.

## 2. What I measured (real, free calls only)

- `agy models` today lists **27** models, parsed correctly. Every model Bot's table uses is still offered.
- **New and unused today: `gemini-4-carbon-low/medium/high`** (a new Carbon family) and **`gemini-pro-orchestrator`, `-neon`, `-argon`**. `gpt-oss-120b-medium` is old news (rejected before). The first real check will only save this as the baseline (nothing posted); if Omri wants a trial of Carbon he should say so.
- `agy -p /usage` today: Gemini Models weekly 89% (reset 2026-11-30 20:57Z), 5-hour 99%; Claude and GPT models weekly 46% (reset 11-27), 5-hour 100%. No Argon row, as in the 2026-11-23 note.
- **One trap found:** `agy -p /usage` typed in Git Bash is rewritten to `C:/Program Files/Git/usage` and agy then ANSWERS it as a normal prompt (one small model call, I made it by accident, once). In Git Bash use `MSYS_NO_PATHCONV=1 agy -p /usage`; from Node (`execFile`) or PowerShell it is fine.
- **Another trap:** `quota.fetchUsage()` detaches its child on purpose, so a short script that calls it exits before the answer. The guard has its own small fetch.
- Model calls made for this task: **1** by accident (the `/usage` above), none otherwise.

## 3. For test sessions: read the weekly level first, stop at a share of it

```powershell
node tools/quota-guard.js begin --share 10     # writes down the weekly level; refuses (exit 3) when under 40% is left
node my-experiment.js --a-few-calls
node tools/quota-guard.js check                # exit 0 = go on, exit 2 = STOP
```

- Budget = `--share` % of what was left at `begin` (89% left, share 10 -> 8.9 points of the week; at least 1 point). `--min 40` refuses to start a test on a week that is already low. `--five 20` also stops when the 5-hour window is under 20%. `--pool` picks another pool.
- From a script: `const g = require("./tools/quota-guard").createGuard({ share: 10 }); await g.begin(); ... if (!(await g.allow()).ok) break;`.
- A new weekly period (the reset time moved) says so and wants a new `begin`. Tried against the real `/usage`: `begin` printed "week 89% left; budget 8.9 points", `check` "spent 0 of 8.9".
- **Suggested rule for every live-test brief:** run `begin` first, `check` after every few calls, stop on exit 2. (The weekly row moves 1 point per ~4 Argon-sized calls, so this is a hard cap of roughly 30-40 calls per 10%.)

## 4. Limits and open points

- The baseline is saved at the first real run, so Carbon and the Orchestrators will NOT be reported then (nothing to compare with). Only changes after that are posted.
- `noteFailure` (a limit error marks a pool low) still takes the pool from `router.js`'s table, not from the family rule. With today's table that is right; if a table entry ever names a vanished pool, a limit error would mark a pool nobody reads. Cheap to fix later if it ever happens.
- Not covered by `resolvePools`: models that Omri's page picker offers (`model-choice.js`); a choice of a vanished model is simply skipped by `askChain`.
- `selfedit.js` (guard file) and its Neon editor are not touched; the editor models are not filtered by this.
- The watcher posts in English, like the Moodle watch.

## 5. CLAUDE.md lines I suggest (I did not edit it)

Add to the MODELS paragraph of "How Bot works":

> MODELS CHANGE (2026-11-24, t29, `models-watch.js`; experiments/2026-11-24-dynamic-models.md): at start and once a day code runs `agy models` and `agy -p /usage` (no model call), compares them with `data/agy-models.json` and posts ONE code-written thread message when a model or pool row appears or disappears (push counts only, none at night). A model agy no longer offers is skipped in every chain and in `askChain` (logged, never an empty chain); a chain model whose own pool has no `/usage` row counts as part of its family's pool (`gemini-*` -> Gemini Models, `claude-*`/`gpt-*` -> Claude and GPT models), so pacing, the reserve, the 15% rule and `paceFree` use real numbers. A NEW model is only REPORTED as a candidate for a trial: chains are hand-written lists, and no model is used before Omri says so. Test sessions use `tools/quota-guard.js` (read the weekly level first, stop at a set share).

And in "Running and growing Bot" or the working rules: every live-test brief starts with `node tools/quota-guard.js begin --share 10` and checks with `check` every few calls.
