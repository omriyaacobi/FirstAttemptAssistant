# 2026-11-23: Argon now spends the shared "Gemini Models" pool, so Argon leaves every chain

## Verdict (plain words)

**Argon draws from the same pool as Neon, Hydrogen and Flash.** `agy -p /usage` no longer has a "Gemini 4 Argon" row, and 20 Argon
calls moved the "Gemini Models" rows. Neon is newer and was as careful in every trial, and it costs less per call, so Argon is now
in **no chain** in Bot. Only the old page-only Improve Bot editor in `selfedit.js` still names it (a guard file, see the end).

## 1. What the sources say (no announcement found)

I found no Google or Antigravity post from November that says "Argon is merged into the Gemini quota". What exists:

- Google's own October posts: Argon on Pro got "a separate weekly-only Argon quota ... on top of the existing Gemini bucket"
  ([Antigravity on X](https://x.com/antigravity/status/2110866531932316011),
  [9to5Google, 2026-10-15](https://9to5google.com/2026/10/15/gemini-4-argon-is-now-rolling-out-to-googles-antigravity-for-ai-pro-subscribers/),
  [Magica](https://magica.com/news/gemini-4-argon-antigravity-pro-weekly-quota)). That is the old state, and it matches what Bot saw until today.
- A third-party quota tool reports the opposite: [agy: Gemini 4 Argon quota is merged into the Gemini quota on Pro plans (quota-axi issue 342)](https://github.com/kunchenguid/quota-axi/issues/342).
  It was checked on 2026-10-19, quotes Antigravity as saying Argon is separate "for paid Pro plans", and guesses the merge is an Ultra behaviour.
  So it cannot explain a change on 2026-11-23.
- A forum thread asks to give Argon to Pro users ([discuss.ai.google.dev](https://discuss.ai.google.dev/t/give-argon-to-pro-users-in-antigravity/188900));
  not about quota structure. The Antigravity changelog and the AI Pro plan page showed nothing about it in the searches I could run.

So the sources do **not** settle it; the measurement does.

## 2. The measurement

Setup: a small script (scratchpad, not committed) asks `agy -p ... --model <m>` one call at a time. Each call reads a file `notes.txt` of
invented course notes (about 140 KB, ~30 k tokens; a long prompt on the command line is too long for Windows) and answers a one-number
question. `/usage` was read after every 4 calls. Bot's own last answer before the test was at 20:49Z; the first answers after it were at
21:11Z, so **Bot spent nothing from this pool during the 20:59-21:10Z calls** (thread timestamps only).

| Step | Gemini Models weekly | Gemini Models 5-hour | Claude and GPT (weekly / 5-hour) |
|---|---|---|---|
| Start, 20:59Z | 99% | 97% | 46% / 100% |
| After 1 Argon low call | 99% | 95% | 46% / 100% |
| After 4 / 8 / 12 / 16 / 20 Argon low calls | 98 / 97 / 96 / 95 / **94%** | 91 / 87 / 83 / 79 / **75%** | unchanged |
| After 4 / 8 / 12 / 16 / 20 Neon low calls | 93 / 92 / 92 / 91 / **91%** | 72 / 69 / 67 / 65 / **63%** | unchanged |
| After 3 Neon low photo calls (Bot also answered at 21:11Z, so mixed) | 90% | 60% | unchanged |

Readings:

- **Argon spends "Gemini Models":** 20 Argon calls took it from 99% to 94% weekly and from 95% to 75% on the 5-hour row. No "Gemini 4 Argon"
  row appeared at any point, and no call said Argon has its own limit (0 failures in 41 calls).
- **Neon is cheaper per call from the same pool:** the same kind of call cost about 12 points of the 5-hour row for 20 Neon calls against 20 for
  20 Argon calls (roughly 60%), 3 weekly points against 5. This matches the 25-55% fewer tokens in `2026-11-20-neon-deep-trial.md`.
- "Gemini Models" went from 82% (reset Nov 28) to 100% (reset Nov 30) today: the weekly period was restarted at the same time as the merge.
  The weekly reset is now **2026-11-30 20:57Z**.
- 44 agy calls in all (1 smoke + 20 + 20 + 3 photo), under the 60 limit. Time is not a factor: Argon low took 12-15 s per call here, Neon low 10-16 s.

The `gemini-4-argon-*` models still exist in `agy models` and still answer.

## 3. How `quota.js` behaves with no Argon row

Checked by running the real functions on rows with only "Gemini Models" and "Claude and GPT models" (the tests below cover it):

- `lowPools`, `lowWithReserve`, `paceOrder` and `claudeFirst` all work on whatever rows exist; a pool with no row is simply "unknown",
  which keeps the normal order. Nothing crashed.
- **One wrong behaviour found, and fixed by this change:** while Argon was still in chains with pool "Gemini 4 Argon", it could never look
  low (no row), so when the real shared pool ran low Argon would not move back. Argon was also the pool the 25% reserve was written for.
  Fix: no Argon in any chain, the Argon entries in `router.js` now point at "Gemini Models" (so a limit error from the old page-only editor
  marks the right pool), and the reserve moved to "Gemini Models".
- **Leftover to know about:** `selfedit.js:835` refuses an Argon page-only change when a pool whose name matches /argon/ is low. That pool
  can never be low now, so the check is dead (it protects nothing now).
- **Behaviour change to decide on:** the 25% reserve now sits on the shared "Gemini Models" pool. Under 25% everyday chat goes to agy
  Sonnet first (as before for Argon), but this pool also feeds the background jobs, tutoring and PDF reading, so it will be reached
  more often than Argon's was. If Omri finds that too early, change one number: `RESERVES` in `brain.js`.

## 4. Replacements chosen by evidence

| Use | Was | Now | Evidence |
|---|---|---|---|
| Brain `CHAIN` | Neon low, Hydrogen medium, **Argon low**, Sonnet in agy, Claude Code | Neon low, Hydrogen medium, Sonnet in agy, Claude Code | Neon was already first; Argon was third |
| BOT_BRAIN_FIRST=claude chain | ..., Argon low, ... | Argon removed | same |
| Photo chain `PHOTO_CHAIN` | **Argon low**, Hydrogen medium | **Neon low**, Hydrogen medium | unclear "lecture moved" photo through the real brain prompt: Neon low made a one-time card (no weekly repeat) **3 of 3 today** (`2026-11-23-neon-photo.js`, 15-17 s), 6 of 6 on 11-19/20 (`2026-11-19-neon-trial.md`, `2026-11-20-neon-deep-trial.md`). Argon was 5 of 5. |
| `WARM_MODELS` | Neon low, Hydrogen medium, Argon low | Argon removed | one warm Argon process less |
| `RESERVES` | Argon's pool: 25 | "Gemini Models": 25 | see section 3 |
| Big-PDF reader `CUT_CHAIN` | Argon low, Neon low, Hydrogen high | Neon low, Hydrogen high | 140k-character reads were right on every model in the deep trial (not repeated today) |
| Whole-file reader `READ_CHAIN` | Hydrogen high, **Flash**, Argon low | Hydrogen high, **Neon low**, Flash | Flash made math errors, so it moved behind Neon instead of ahead of it |
| Tutor `TUTOR_CHAIN` | Hydrogen medium, Argon medium, Argon low | Hydrogen medium, Neon medium, Neon low | tutor test in the Neon trials (verdicts right, no answer given away) |
| `catchup` / `study-coach` id picker | Argon low | Neon low | one small call that returns ids from a list that code checks |
| `model-choice.js` CHOICES | Argon medium / low in the picker | removed | a saved old choice of `argonLow` is ignored (normal order) |
| `router.js` | Argon pool "Gemini 4 Argon", `researchArgon`, named chains | Argon entries kept only for the pool mapping (pool "Gemini Models"); named chains and `web-research` use Neon | the named chains are not used by the live brain |
| Page Editor choice | Neon / Sonnet / Opus / **Argon (page only)** | Argon option removed from `public/index.html` | see below |

Not run today: a PDF or math-reading test of Neon low against Argon (the deep trial of 11-20 is the evidence), and the web-research chain
(`researchNeon`, `gemini-4-neon-medium`, never used by the live brain).

## 5. Tests

Changed for Argon (no test was deleted; each now checks the new chain): `tests/brain-quota.test.js` (chain, photo chain, reserve on the Gemini pool,
order cases), `tests/quota-max.test.js` and `tests/claude-first.test.js` (the pacing mechanism now uses the Gemini pool and agy's Claude
pool), `tests/tutor.test.js`, `tests/study-coach.test.js`, `tests/courses.test.js` (reader chains), `tests/router.test.js`,
`tests/quota.test.js`, `tests/model-choice.test.js` (the Argon choices are now refused). `tests/selfedit-argon.test.js` has ONE changed check (the page no longer offers the Argon option; the rest tests
the guard file `selfedit.js` and is untouched). Full suite with fake models only: 1369 tests, all passing after the fixes (the same count as before; none removed). Note: no model calls were made after the usage series; the manager asked to stop them.

## 6. For the manager and Omri

**`selfedit.js` is a guard file; I did not change it.** It still has an Argon page-only editor (`ARGON_MODEL = "gemini-4-argon-low"`,
`makeArgonEditor`, the `argon` model value, the low-pool check at line ~835 and the label at ~848/937). With Omri's OK, one change by Claude Code:
remove the Argon profile and make the page-only limits an option of the Neon editor (Neon medium with `writes only under public/`), or just
delete the page-only mode if Omri does not use it. The changes would be: delete `ARGON_MODEL`/`ARGON_PROFILE`/`makeArgonEditor` and the
`argon` branches (lines ~187-191, 404-406, 482, 647-650, 831-848, 937, exports), the `argon` value in `server.js` (lines 583 and 597), the
`argon` entry of `QUOTA_NOTES` in `public/index.html`, and `tests/selfedit-argon.test.js` (53 Argon mentions; its checks of the page-only
limits should move to a Neon page-only test). Until then the Argon editor works if called by an API call, but the page no longer offers it.

**CLAUDE.md lines that need updating (I did not edit it):** the MODELS paragraph ("Argon low -> ... Argon has a 25% RESERVE", "Argon's last
part stays for tutoring and big PDFs", "PACING of the first two agy POOLS ... Neon and Hydrogen count as one", "CLAUDE FIRST BY PACE ... the best
agy pool", "Hydrogen medium also answers the tutor first"), the PHOTOS paragraph (Argon low first, Hydrogen medium fallback), the READING
paragraph (read Argon low first, then Neon low, then Hydrogen high; whole file Hydrogen high, Flash medium, then Argon), the STUDY COACH
paragraph (tutoring: Hydrogen medium, then Argon medium, then Argon low), CATCH-UP ("ONE Argon call"), and the SELF-EDIT editors list
(Argon for page-only changes).

Other places that still mention Argon, only in comments or for the guard file: the start of `brain.js` (the long history comment), `providers.js`
(`ARGON_TIMEOUT_MS`, the 150 s photo limit and the `loop` comments; harmless, `selfedit.js` imports it), `thread-summary.js` and `news.js`
comments ("never Argon"), `tokenlog.js`'s example.

**Decision for Omri:** keep the 25% reserve on the shared Gemini pool (done) or drop it. And whether to delete the Argon page-only editor.
