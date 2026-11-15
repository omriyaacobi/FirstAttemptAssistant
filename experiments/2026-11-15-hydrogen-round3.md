# 2026-11-15: Hydrogen round 3, a fairer and harder test

Follows `2026-11-15-hydrogen.md` (round 1) and `2026-11-15-hydrogen-contest.md` (round 2). Omri doubted the round-2 result, rightly. This round fixes its four weak points:
- **Unequal effort:** Argon MEDIUM joins.
- **Tests too easy:** 12 hard tests with known answers.
- **One run per test:** Hydrogen runs everything 3 times.
- **A grader who knew the model:** grading is blind.

## How it was run

- **Scripts:**
  - `hydrogen-round3.js` (the groups `hydrogen` and `argon`, plus `blind`);
  - `hydrogen-round3-argon-photo.js` (3 extra runs of the unclear photo on Argon low);
  - `hydrogen-round3-reveal.js` (joins the grades with the key).
- **Results:** `hydrogen-round3-results-hydrogen.json` and `hydrogen-round3-results-argon.json`.
- **Blind file:** `hydrogen-round3-blind.md`. Grades are in `hydrogen-round3-grades.json`, written BEFORE `hydrogen-round3-key.json` was opened.
- **Made-up PDF:** `hydrogen-notes.pdf`, 3 pages, built by code. It contains one planted "author error" ("the series sum 1/2^n equals 3") that the reader must copy as written, not fix.
- **Models:**
  - Hydrogen medium, Hydrogen high, Argon low, and Argon medium (the effort level matching Hydrogen medium).
  - **Carbon is not available:** `agy models` does not list it for Omri's account. agy's changelog says Carbon is offered only with Application Default Credentials (a Google Cloud login), not the Google AI Pro plan.
- **Brain tests** went through the brain's real prompt (`brain-brief.md`, slim agent) with its tool rounds, like `brain.js`: up to 3 more rounds, and a lookup gets a made-up result. This also removes the round-2 artifact where a sensible lookup was counted as a failure.
- **The real tutor prompts:** `tutor.js` `gradeAnswer` on a wrong, a partly-right and a right made-up student answer, and `makeHint` at levels 1 to 3.
- **The real reader prompt:** `ingest.js` `chunkPrompt` through `askAgyWithFile`, the whole-file reading road.
- **Repeats:**
  - Hydrogen ran every test 3 times, spread over the run.
  - Argon ran once per level, to save its week, plus 3 runs of the unclear photo on Argon low.
- **Calls: 204 model calls.** Hydrogen medium 82, Hydrogen high 88, Argon low 16, Argon medium 18. Argon's 34 stay under the 35-call limit. The two groups ran at the same time; they use different pools.
- **Errors:** 1 agy "status ERROR", on an Argon medium hint. It is counted as a failure.

## The hard tests (all with known answers)

| Test | The trap |
|---|---|
| Σ(−1)ⁿ·n/(n+1) | looks alternating, but diverges (the terms do not go to 0) |
| Σ 1/(n (ln n)^p) | p > 1, not p ≥ 1 |
| ∫ sin/(sin+cos) from 0 to π/2 | π/4, by the x → π/2 − x trick |
| ∫ ln(1+x)/(1+x²) from 0 to 1 | (π/8)·ln 2, by x = tan t, then t → π/4 − t |
| Proof: x³+x−1 = 0 has exactly one real root | needs existence (IVT) AND uniqueness (f′ > 0 or Rolle) |
| The parameter system | (a−1)(a−2): infinitely many solutions for a = 1 AND a = 2, never "no solution" |
| lim x² sin(1/x) / sin x | 0, and L'Hôpital fails here |
| Interval of Σ (x−2)ⁿ/(n·3ⁿ) | [−1, 5) |
| C++ slicing program | prints ABA |
| C++ three snippets | dangling reference = UB; vector push_back = UB; moved-from string = NOT UB (valid but unspecified) |
| Java a.wait() inside synchronized(a){synchronized(b){…}} | deadlock: wait releases only a |
| Min and max of 100 numbers | 148 comparisons |

## Results

| Model | Hard: time (mean ± sd) | Thinking tokens per call (hard) | Hard, code-checked (8 tests) | Hard, blind quality | Tutor: verdicts / safe hints | PDF read | Quota used |
|---|---|---|---|---|---|---|---|
| **Hydrogen medium** | **7.6 ± 1.2 s** | 588 | **24/24** (3 runs) | 4.75 (20 answers) | **9/9 / 9/9** | 3/3, 12.7 s | Gemini week 97→96%, 5-hour 100→95% (82 calls) |
| Hydrogen high | 9.5 ± 2.9 s | 939 | **24/24** | **4.80** | **9/9 / 9/9** | 3/3, 19.0 s | Gemini week 96→94%, 5-hour 95→87% (88 calls) |
| Argon low | 10.7 ± 1.3 s | **0** | 8/8 (1 run) | 4.75 (12) | not run | 1/1, 19.5 s | Argon week 58→56% (13 calls), then 54→53% (3 photo calls) |
| Argon medium | 11.2 ± 2.7 s | **44** | 8/8 | 4.75 (12) | 3/3 / 2/2 (+1 agy error) | not run | Argon week 56→54% (18 calls) |

Notes on the table:
- **Correct answers:** no model gave a single wrong final answer on any hard test.
- **The 4 hand-graded hard tests:** the proof, the parameter system, the C++ snippets and the Java deadlock.
  - Every answer was right except on the parameter system.
  - There, 7 of the 8 answers **coached** instead of solving: they did the first elimination and asked the student for the next row. That is what `brain-brief.md` asks for: no full answers unless Omri says so.
  - Only one Hydrogen high run solved it fully, including the tricky "never no solution".
- **PDF read:** every read had all 3 pages, every formula and number, and the planted error copied as written.
- **Quota cost per call:**
  - Argon spent 5 points of its week for 34 calls, about 0.15 point per call.
  - Hydrogen medium spent about 1 point of the Gemini week for 82 calls, under 0.02 point per call.
  - Per call, Argon costs roughly **10 times** more of a weekly pool.

### Re-runs of the tests Hydrogen high failed in round 2 (3 times each, with the brain's tool rounds)

| Test | Hydrogen medium: time per run, success | Hydrogen high: time per run, success |
|---|---|---|
| Planning (7 days) | 12.7, 11.6, 9.9 s: 3/3 | 19.9, 17.6, 15.9 s: 3/3 (round 2 took 104.5 s: not seen again) |
| Unclear photo "lecture moved" | 13.5, 14.6, 13.4 s: 3/3 cards | 62.3, 30.8, 27.4 s: 3/3 cards (round 2 made none: not seen again) |
| Hebrew geometric series | 8.2, 9.9, 9.2 s: 3/3 | 20.1, 15.2, 14.9 s: 3/3 (2 runs did a lookup first) |
| Hebrew reminder | 6.9, 6.4, 6.0 s: 3/3 | 6.6, 7.3, 6.5 s: 3/3 |
| Typed timetable | 7.4, 6.4, 6.5 s: 3/3 | 8.1, 7.3, 7.5 s: 3/3 |
| "What do my notes say about the ratio test" (search, then "nothing found") | 20.8, 25.7, 20.8 s (3 to 4 calls) | 42.1, 41.8, 43.3 s (4 calls every time) |

**The unclear photo is the one real difference in judgement.** The photo says "lecture moved, new time Wednesday", with no end date.

| Model | Weekly series guessed | One-time event made |
|---|---|---|
| Hydrogen medium | 2 of 3 (made-up end date 2027-01-31) | 1 of 3 |
| Hydrogen high | 2 of 3 (end date 2026-12-30, worked out from the made-up "lecture 6 of 13") | 1 of 3 |
| Argon low (rounds 1, 2 and 3) | 0 of 5 | **5 of 5**, offering to make it weekly |

Every Hydrogen guess said "assumed" on the card, and code checks the format, so Omri would see it before tapping. It is still the wrong default.

## Omri's two doubts

**1. "In the Gemini app Hydrogen is 'Everyday help', two levels below Argon. How can it be smarter, faster, cheaper and better?"**

It is NOT shown to be smarter. Even with the harder tests, every model answered every question correctly, so these tests still sit at the ceiling. What the data does show:
- **Effort was unequal, and still is.** In agy, Argon low does not think at all (0 thinking tokens) and Argon medium barely does (44 per call). Hydrogen medium thinks about 590 tokens per call. Argon is a stronger model answering "from the hip"; Hydrogen is a smaller model that thinks by default. On Bot's jobs, both reach the right answer.
- **Speed and cost are real differences.**
  - Hydrogen medium is about 30% faster (7.6 vs 10.7–11.2 s on hard tests).
  - It costs about 10 times less per call of its weekly pool.
- **Judgement on unclear input favours Argon:** see the photo table above.
- **The app's tiers are about frontier work:** long multi-step reasoning, research, big code bases. Bot's jobs are a student's questions, tool calls and short JSON, and a small model reaches the ceiling on them. Google's own number agrees: Hydrogen high scores 51 on the Artificial Analysis index against Argon's 50.

**2. "How can Hydrogen high be WORSE than Hydrogen medium?"**

It is not worse at being right:
- 24/24 hard, 18/18 tutor and 3/3 PDF, the same as medium.
- Blind quality was slightly higher (4.80 vs 4.75); it was the only model that solved the parameter system once.
- Round 2's two failures did not come back in 3 runs each: no card for the photo, and the 104 s plan. They were one-run noise, plus the round-2 limit of one tool round.

What IS worse is cost and speed, especially in the brain:
- It thinks 60% to 125% more (939 vs 588 tokens on hard tests, 1,568 vs 697 on brain tasks).
- It is twice as slow on brain tasks (21.9 ± 15.7 s vs 11.7 ± 5.6 s).
- It makes more lookup rounds, for example 4 rounds every time on the notes search.

More thinking makes it explore more, and it gains nothing that these tests can measure.

## Updated recommendation (Omri decides; no live chain was changed)

| Bot job | Today | Suggested now | Why |
|---|---|---|---|
| Brain, first | Argon low | **Hydrogen medium**, plus one line in `brain-brief.md`: "if a photo or message does not say whether an event repeats, or until when, make it one-time and ask" | Equal correctness, faster, about 10× cheaper per call, and saves the scarce Argon week. Its weak spot is guessing on unclear dates, which the brief line targets. Check that line with a re-run of the photo test. |
| Brain, second | Sonnet low inside agy | **Argon low**, then Sonnet low inside agy, then Claude Code | The Claude and GPT pool inside agy has 7% left. |
| Photos | Argon low -> Flash medium | **Argon low first**, Hydrogen medium second (changed from round 2) | Argon low made the careful card 5 of 5 times; Hydrogen guessed "weekly" 4 of 6 times. Photos are rare, so Argon's cost here is small. |
| Tutoring | Argon only (a CLAUDE.md rule) | Hydrogen medium could tutor: 9/9 verdicts and 9/9 hints that never gave the answer, over 3 runs. If Omri agrees: Hydrogen medium -> Argon medium. | The same quality as Argon medium here. But a tutor session is long, and only the grading and hint steps were tested. |
| Reading PDFs (whole file) | Hydrogen high -> Flash -> Argon low (manager, 2026-11-15) | Fine as it is. Hydrogen medium was just as exact and 6 s faster per read. | All 7 reads were perfect, including the planted error. |
| Reading PDFs (cut file) | Argon low -> Sonnet -> Hydrogen high | Could start with Hydrogen to save Argon | Same evidence; only 3-page files were tested. |
| Summaries and news | Hydrogen high (manager) | Fine as it is; medium also passes (round 2) | Nobody waits for these, so the extra time does not matter. |
| Hydrogen high in the brain | - | **No** | Twice as slow, more tool rounds, no gain. |

## Limits

- The tests are still within a strong student's reach, so every model sat at the ceiling. A test that really separates these models would need longer multi-step work (a full assignment, a long proof, a big code review).
- Argon ran each hard test only once (its week is precious), so its timings carry more noise than Hydrogen's.
- Grading was blind, with letters shuffled again for every test, but done by one grader (Claude). A model's style can still be recognised.
- Bot itself was running during the test and may have used the Argon or Gemini pools, so the quota numbers are rough. The integer percentages from `/usage` round small costs.
- One check had a bug, fixed after the run and re-scored from the saved answers with no new calls: "equals $3$" in the PDF check.
- The notes-search re-run was re-scored as "it searched and then answered". The check made before the run expected a CALL line in the FINAL reply, which is wrong once the tool rounds run.
