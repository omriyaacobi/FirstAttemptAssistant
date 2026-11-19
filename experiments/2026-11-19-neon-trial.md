# 2026-11-19: Neon trial (blind), Argon vs Neon vs Hydrogen vs Orchestrator (Neon)

Follows `2026-11-19-new-gemini-model.md` (the basic look). No Bot code was changed. Script: `neon-trial.js` (reuses the questions
of `hydrogen-round3.js`; everything is invented, no `data/` is read). Results: `neon-trial-results.json`; blind file
`neon-trial-blind.md`; key `neon-trial-key.json` (opened only after grading).

## What was run

6 models x 7 tests = **42 calls** (one run per test, so the timings are rough). Every call goes through Bot's own path
(`ask("agy", ...)` under the slim agent `bot-brain`, no shell, no `--dangerously-skip-permissions`; the photo through
`askAgyStreamWithImage`). Tests: a hard integral (code-checked), the C++ slicing program (code-checked), the parameter linear
system (hand-graded), a Hebrew reminder as a CALL (code-checked), a Hebrew explanation (code-checked and read), the unclear
"lecture moved" photo (checked on the card), and the real tutor `gradeAnswer` on a partly-right answer.
Models: Argon low, Argon medium, Neon low, Neon medium, Hydrogen medium, Orchestrator (Neon).

## Results

| Model | Correct | Time per test (mean / worst) | Tokens per test (thinking) | Errors |
|---|---|---|---|---|
| Hydrogen medium | 7/7 | **9.1 s** / 13.5 | 13,067 (876) | 0 |
| Argon low | 7/7 | 11.7 s / 24.4 | **10,754** (0) | 0 |
| Neon low | 7/7 | 12.1 s / 21.0 | 12,101 (676) | 0 |
| Argon medium | 7/7 | 12.0 s / 18.3 | 12,236 (115) | 0 (one test used 2 calls: a lookup) |
| Neon medium | 7/7 | 16.0 s / 22.3 | 13,256 (1,255) | 0 |
| Orchestrator (Neon) | 7/7 | **79.2 s / 235.5** | **28,823 (8,349)** | 0 (one test used 2 calls) |

"Correct" = the code-checked tests passed, the tutor verdict was right, and the two hand-graded ones (parameter system, photo)
were judged blind. Every model sat at the ceiling again, so **correctness does not separate them**.

- **Parameter system (blind):** all 6 answers coached (did the first elimination, asked the student for the next step) and none
  said anything wrong. That is what `brain-brief.md` asks for. No difference.
- **Hebrew:** all 6 were correct, in Hebrew, with a check question.
- **Unclear photo (the old weak spot):** all 6 made a **one-time** card (`repeat: none`) and asked "does it repeat weekly, and
  until when?". In round 3 Hydrogen medium guessed a weekly series 2 times of 3; this time it did not, but that is one run, not
  a fix. Neon low and medium behaved like Argon (careful).
- **Tool format:** every model wrote valid `CALL` lines; the Hebrew reminder had the right time on all 6.

## Pools: which quota each model spends (`agy /usage` before and after each batch)

| Batch | Gemini Models, five-hour | Gemini Models, weekly | Gemini 4 Argon, weekly |
|---|---|---|---|
| (start, after one Orchestrator probe) | 99% | 91% | 85% |
| Neon low (7 calls) | 99 -> 98 | 91 | 85 |
| Neon medium (7 calls) | 98 -> 97 | 91 | 85 |
| Orchestrator (Neon) (7 calls) | 97 -> **93** | 91 -> 90 | 85 |
| Hydrogen medium (7 calls) | 93 | 90 -> 89 | 85 |
| Argon low (7 calls) | 93 | 89 | 85 -> 84 |
| Argon medium (7 calls) | 93 | 89 | 84 -> 83 |

(Claude and GPT models stayed at 100% / 100% the whole time.)

**Findings**
1. **Neon uses the "Gemini Models" pool** (the same one as Hydrogen and Flash), NOT the "Gemini 4 Argon" row. The Argon row did
   not move during any Neon batch; the Gemini Models five-hour row did. There is no separate Neon row in `/usage`.
2. **The Orchestrator uses the same Gemini Models pool** and costs the most: 4 points of the five-hour window for 7 calls,
   against 1 point for Neon low or medium.
3. **Argon keeps its own weekly row** (about 1 point per 7 calls here). That is a real advantage for Bot: Argon is a second,
   separate bucket, so it spares the Gemini Models pool that all Hydrogen background jobs share.
4. Neon is therefore not clearly cheaper than Hydrogen in agy: it spends the same pool at a similar rate (about 1 point of the
   five-hour window per 7 calls for Neon; Hydrogen showed no five-hour movement but 1 point of the week). `/usage` rounds to whole
   percent, and Bot may have run in the background, so do not trust decimals.

## The Orchestrator (Neon): can Bot call it?

- **What it is (agy's changelog):** a planner plus an executor. It "plans with Gemini 4 Carbon (High) and hands the plan's
  execution to Gemini 4 Hydrogen (High)"; the changelog introduces it for Enterprise and Application Default Credentials
  sign-ins, with a Planner choice per plan. On Omri's Google AI Pro login, `agy models` lists both `Orchestrator (Neon)` and
  `Orchestrator (Argon)`.
- **Can it be called Bot's way?** Technically yes: `ask("agy", "gemini-pro-orchestrator-neon", ...)` under `bot-brain` returned
  an answer for every test with no errors. With the slim agent it has no tools to delegate with, so it ran as a plain single
  turn (one test needed 2 calls, like Argon medium).
- **Does it fit Bot?** No. It is by far the slowest (79 s on average, 235 s on one Hebrew explanation; the brain's agy time limit
  is 120 s, so that call would have been dropped), uses about 2-3x the tokens (8,349 thinking tokens per test against 676 for
  Neon low), spends about 4x the quota, and was not more correct. Its design (plan, then delegate execution) is for multi-step agent
  work with a shell and files, which Bot deliberately never gives agy. **Leave it out.**

## What Omri's Gemini info said, and whether agy matched it

| Claim | agy |
|---|---|
| Neon is for AI Pro and up | Matches: Omri's Pro login lists all four Neon levels. (Plus/Free not testable.) |
| In agy, Gemini models (Hydrogen, Neon) share one Gemini pool; Claude/GPT have their own | **Matches for Neon and Hydrogen.** But the info missed that **Argon has its own third row**, which still moves separately. |
| agy quota is separate from the Gemini app | Not tested (only agy was read). |
| Neon is cheaper per token than Argon and "stretches your allowance further" | **Not seen.** Neon spent the Gemini Models pool at about Hydrogen's rate; Argon spends a different pool, so the two cannot be compared in one number. |
| "Argon defaulted to Medium thinking, Neon defaults to High" | **Does not match what Bot sees.** Under `bot-brain`, Argon low gave 0 thinking tokens and Argon medium 115 per test; Neon low 676, medium 1,255. Bot always puts the level in the model id, so the default does not matter. |
| Neon is a big improvement for coding, tool chains, STEM | **Not visible in this trial.** Every model passed every test; these questions are too easy to separate them, and Bot never runs shell chains. |
| Orchestrator (Neon): Neon plans, Hydrogen runs the steps | Matches the changelog, but only with tools. Under Bot's slim agent it just thinks a lot. |
| Neon uses about 2x the compute of Hydrogen | Roughly consistent with thinking tokens (676-1,255 vs 876); time was 12-16 s vs 9 s. |

## Recommendation (small; Omri decides; nothing was swapped)

The trial shows **no quality gain** for Bot's jobs, so there is no hurry. What matters is the POOL.

| Job | Today | Suggestion |
|---|---|---|
| Brain, first | Hydrogen medium | **Keep.** Fastest (9 s), cheapest, same correctness. |
| Brain, second | Argon low | **Keep Argon low.** It has its own pool, so it spares Gemini Models. Neon low is equal in quality but spends Hydrogen's pool. |
| Brain, after that | Sonnet low in agy, Claude Code | Optionally add **Neon low** between Argon low and Sonnet as one more Gemini step (a fallback when Argon is under 15% or in its 25% reserve). |
| Photos | Argon low, then Hydrogen medium | **Keep Argon low first.** Neon low is as careful on the unclear photo (21 s vs 24 s) and could replace Hydrogen as the fallback, but test the photo 3 more times first. |
| Big PDFs (cut) | Argon, Sonnet, Hydrogen high | **Keep**; no PDF was tested here. |
| Tutor | Hydrogen medium, Argon medium, Argon low | **Keep**; Neon low could be added at the end (its grade verdict was right). |
| Self-edit editor (Argon) | Argon | **Keep Argon** (its safety checks were tested on Argon). |
| Orchestrator (Neon) | - | **No.** |
| If Google retires Argon | - | Neon low is a drop-in for Argon low (same quality, same CALL format, 12 s). Then `quota.js` would need the 25% reserve on the Gemini Models pool, and `providers.js` the longer Argon time limits for Neon ids. |

## Limits

- One run per test and 7 tests: this shows "no failure", not "equal". The questions are within a student's reach, so all models sit at the ceiling.
- Hand grading was blind (letters shuffled per test) but done by one grader (Claude).
- Pool movement is in whole percent; Bot may have used some of the Gemini pool in the background.
- The PDF reader and the C++ UB and Java deadlock tests were not repeated here; a longer task would be needed to see Neon's claimed strengths.
