# 2026-11-15: Contest: Hydrogen medium vs Hydrogen high vs Argon low

Follows `2026-11-15-hydrogen.md`, the first small trial. Omri asked for a bigger competition on the jobs Bot really does.

## How it was run

- **Script:** `hydrogen-contest.js` (25 tests per model).
- **Second round:** `hydrogen-contest-round2.js`. When a first reply was only a lookup call (for example `course_search`), the real brain would run it and ask again. Here the lookup got a made-up result and the model was asked once more in the brain's own "## Tool round 1" format. A call that failed with an error was re-run once.
- **Results:** `hydrogen-contest-results.json`.
- **Made-up photos:** `hydrogen-photo.png` (the unclear "lecture moved") and `hydrogen-timetable.png` (3 weekly classes).
- **Prompts:** every test used the prompt Bot really uses for that job:
  - chat, study, tools and photos: the brain prompt (`brain-brief.md` plus a made-up context, slim agent);
  - the end-of-day summary: `promptFor`, then `checkSummary`, from `thread-summary.js`;
  - the news brief: `briefPrompt`, then `checkPick`, from `news.js`.
- **Data:** every prompt is invented. No `data/` and no real chat.
- **Calls:** **80 model calls**: 75 in the contest, plus 4 second rounds and 1 retry. One more was a stray call: a `/usage` read through Git Bash, which turned `/usage` into a path.
- **Success:** checked by code. That means:
  - the right number on the "Answer:" line (11 math problems with known answers);
  - required terms found (C/C++, Java, SQL);
  - a valid `CALL` with the right fields (`set_reminder` at 2026-11-17T20:00, a weekly `add_events` with the right weekdays, times and until date, `course_search` on Calculus 2);
  - the reply in Hebrew for a Hebrew message;
  - the summary JSON passing `checkSummary` with nothing dropped, plus at least 1 task, 1 done item and the Calculus 2 study item;
  - the news JSON passing `checkPick`: 2 Israel stories, the teaser skipped, tech empty;
  - no `leaksPrompt` anywhere.
- **Quality:** graded 1 to 5 by hand (by Claude, reading every answer). The criteria were correctness, clarity, fitting a phone screen, and following the brief: no full solutions, one check question, no talk about tools.

## Summary

| Model | Median time | Avg time (incl. 2nd rounds) | Tokens per call (in / out / thinking) | Success, 1st round | Success, final | Quality avg | Quota used (25 calls) |
|---|---|---|---|---|---|---|---|
| **Hydrogen medium** | **8.5 s** | **10.4 s** (max 24.6) | 8,293 / 751 / 555 | **25/25 (100%)** | 25/25 | **4.96** | Gemini Models: 2 points of the 5-hour window, under 1 of the week |
| Hydrogen high | 10.5 s | 18.1 s (max **104.5**) | 8,316 / 1,056 / 895 | 21/25 (84%) | 24/25 (96%) | 4.48 | Gemini Models: 2 points of the 5-hour window, under 1 of the week |
| Argon low | 11.8 s | 13.6 s (max 31.3) | 7,744 / 179 / 0 | 24/25 (96%) | 25/25 | 4.88 | **Gemini 4 Argon: 3 points of the WEEK** (61% -> 58%) |

Notes:
- agy counts Hydrogen's thinking inside "out", so its visible answers are about the same length as Argon's.
- Argon low does no thinking at all.
- No model leaked its prompt.
- The "1st round" failures of Argon (rule of five) and Hydrogen high (rule of five, Hebrew) were sensible lookups in a course that exists. They answered well in round 2.

Pools over the whole run:
- Gemini Models: week 98% -> 97%, 5-hour window 99% -> 95%.
- Gemini 4 Argon: week 61% -> 58%.
- Claude: untouched.

**Hydrogen is about 4 to 5 times cheaper in quota than Argon** for the same work: 25 Hydrogen calls moved the Gemini week by less than 1 point, while 25 Argon calls moved Argon's week by 3.

## Per topic (seconds / success / quality)

| Topic (tests) | Hydrogen medium | Hydrogen high | Argon low |
|---|---|---|---|
| Calculus 2 (8: by parts, arctan, improper, telescoping, radius of convergence, Taylor coefficient, limit, ln x/x²) | 10.9 s / 8 of 8 / 5.0 | 10.3 s / 8 of 8 / 4.9 | 11.3 s / 8 of 8 / 5.0 |
| Linear algebra (3: det, eigenvalues, rank) | 7.5 s / 3 of 3 / 5 | 7.5 s / 3 of 3 / 5 | 12.6 s / 3 of 3 / 5 |
| C/C++ (rule of five, review of a buggy `join`) | 10.0 s / 2 of 2 / 5 | 9.3 s (+10 s round 2) / 2 of 2 / 4.5 | 13.4 s (+12.7 s round 2) / 2 of 2 / 4.5 |
| Java (race on counter++) | 10.2 s / ok / 5 | 9.0 s / ok / 5 | 12.2 s / ok / 4 (long, 1,500 chars) |
| SQL (GROUP BY ... HAVING AVG) | 7.5 s / ok / 5 | 8.3 s / ok / 5 | 11.6 s / ok / 5 |
| Hebrew (geometric series) | 9.8 s / ok / 5 | 9.0 s (+9.1 s round 2) / ok / 4 | 14.7 s / ok / 5 |
| Plain chat | 6.2 s / ok / 5 | 8.2 s / ok / 5 | 12.1 s / ok / 5 |
| Planning (7 days, 3 made-up courses) | 14.3 s / ok / 4 (a bit long) | **104.5 s** / ok / 3 | 16.0 s / ok / 5 (compact) |
| Brain tools (Hebrew reminder, typed timetable, course_search) | 7.7 s / 3 of 3 / 5 | 21.2 s / 3 of 3 after 1 retry / 3.7 | 12.0 s / 3 of 3 / 5 |
| Photos (unclear "lecture moved", timetable) | 19.0 s / 2 of 2 / 5 | 27.0 s / **1 of 2** / 3 | 24.1 s / 2 of 2 / 4.5 |
| End-of-day summary (checkSummary) | 13.1 s / ok / 5 | 15.6 s / ok / 5 | 11.1 s / ok / 5 |
| News brief (checkPick) | 8.5 s / ok / 5 | 10.5 s / ok / 5 | 9.3 s / ok / 5 |

Correctness by hand:
- Every model got all 11 math answers right, with correct steps.
- On the buggy C function, all three found BOTH bugs (a dangling pointer to the stack buffer, and the overflow past 64 bytes). All three ended with a hint question instead of writing the fixed code, as the brief asks.
- The plans had the right weekdays (Thu Nov 19, Fri Nov 20, Tue Nov 24).

## The worst answer of each model

- **Hydrogen medium:** the plan. It was right and well built, but at 1,729 characters it is more than one phone screen. Nothing was wrong anywhere.
- **Hydrogen high:**
  - The unclear photo. Instead of a card it called `study_status`, `calendar_read` and `course_files`. After the made-up results it called `moodle_course` and `course_search` "quiz 2 schedule semester end". After 2 rounds there was still no card, and it spent 57 s.
  - Also: the plan took 104.5 s, and one call ended with "agy status ERROR" (fine on retry).
- **Argon low:**
  - The unclear photo. It made one one-time card, which is right, but gave the quiz a made-up time, "set for 09:00–10:00 since the photo didn't list a time". Hydrogen medium left the time empty.
  - On eigenvalues it asked "Would you like to find the corresponding eigenvectors next?" ABOVE the Answer line.

## Recommendation (Omri decides; no live chain was changed)

| Bot job | Today | Suggested |
|---|---|---|
| **Brain, first** | Argon low | **Hydrogen medium.** Same quality (4.96 vs 4.88), faster (median 8.5 vs 11.8 s), 100% first-round success. It runs on the pool with the most room (Gemini Models: 97% of the week left), not the scarce Argon week. |
| **Brain, second** | Sonnet low inside agy | **Argon low**, then Sonnet low inside agy, then Claude Code. The Claude and GPT pool inside agy has 7% left for the week. |
| **Photos** | Argon low -> Flash medium | **Hydrogen medium -> Argon low.** It is the only model that left an unknown time empty and asked about the unclear repeat. |
| **Tutoring** | Argon only (a CLAUDE.md rule) | Keep Argon for now. Hydrogen medium asked good check questions, but graded quizzes and step-by-step hints were not tested. Run a tutor test before changing the rule. |
| **Summaries / news** | being switched to Hydrogen high (manager) | Hydrogen high passed both jobs, so it is fine, since nobody waits for these. Hydrogen medium passed them too, slightly faster and with about 15% fewer tokens: either works. |
| **Reading big PDFs** | Argon -> Sonnet -> Flash | Not tested. Swap Flash for Hydrogen medium at the end of the chain after a reading test, and keep Argon first until then. |
| **Hydrogen high** | - | **Not for the brain.** It over-uses lookup tools and has slow outliers (104 s), and it failed the unclear photo. |

What the change would be in code (not done):
- `brain.js` CHAIN would become hydrogenMedium -> argonLow -> sonnetInAgy -> claudeSonnet.
- The photo chain would become hydrogenMedium -> argonLow.
- `quota.js` pacing compares the two agy pools. With Hydrogen first, the Gemini Models pool would need to join `paceOrder`, and the Argon RESERVE rule would matter less.
- The CLAUDE.md lines "Flash never writes the brain's answers" and "brain order Argon low -> ..." would need Omri's update. Hydrogen is not Flash: 13 of 13 math answers were right across both trials.

Limits of this test:
- Only one run per test, so the timings carry noise.
- The grading was done by one grader (Claude).
- Only 2 photos.
- Tool use was tested on first and second rounds only.
- No real course files, so `course_search` results were invented.
