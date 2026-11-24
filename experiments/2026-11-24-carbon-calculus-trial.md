# Carbon trial on a real task, 2026-11-24: a study plan for the Calculus 2 midterm quiz (Fri 2026-11-27)

**Short version:** Carbon medium worked for 2 of its 3 rounds. It chose good lookups, but its third round hit the brain's 120 s
limit, so Neon low wrote the final plan. The plan is good, and it now waits on a Confirm card for Omri's tap. It is NOT stored
yet, and the card lives in memory only (12 hours; a Bot restart drops it). Cost: 228 s, about 115,000 counted tokens plus one
timed-out Carbon call, and 4 points of the 5-hour Gemini row (96% -> 92%; week 88% -> 87%).

## What changed in Bot (on main, not pushed)

| Commit | What |
|---|---|
| `9f7e124` | `experiments/2026-11-24-carbon-check.md`: the first probe (Carbon answers on Pro, spends Gemini Models). |
| `a6b969d` | Carbon low and Carbon medium in the model picker only (`router.js` MODELS, `model-choice.js` CHOICES, `brain.js` WARM_MODELS). In NO chain; a test checks no other file names Carbon. The model-watch tests used carbon-low as their "unknown new model" example and now use a made-up name. |
| `7fbf8ad` | THE EXAM PLAN (new `exam-plan.js`, wired in `study-coach.js`, `brain.js`, `brain-brief.md`, `public/index.html`). See below. |

The full suite passed before the merge (1411 tests, 0 failed, 1 skipped as before). Main was fast-forwarded from 134e72a after a
check that Improve Bot was idle and main was clean. Bot was restarted through `POST /api/restart`, and the start log was normal.

**To undo all of it:** `git revert 7fbf8ad a6b969d` (or only `7fbf8ad` to keep Carbon in the picker).

### How the exam plan works
- `exam_plan` (brain tool): the model hands in the exam date, a title, days with up to 8 short items each, and topics left out.
  Code checks every value (real dates between today and the exam, at most 120 days ahead, item length, counts, control
  characters). The result is a **Confirm card**, and the page draws the checked plan on it (text only). Nothing is stored before
  Omri's tap.
- On Confirm: stored in `data/study/exam-plans.json` (one plan per course; the older plan is kept as `previous`). The exam date
  is also stored, like `exam_date`.
- Every message until the exam day: the brain sees a short block ("Omri's exam plans"). It shows today's items, earlier items
  not done, the next days, what is left out, and how many items are done. It is capped at 3,000 characters per plan. After the
  exam day it disappears (it stays on disk).
- `plan_done` ticks items by id, from Omri's own words, and `undo` unticks. "Done" never means "understood". Like `parts_done`,
  it is refused after a web page or Moodle text and allowed with a photo (a row in `tests/refusal-rules.test.js`).
- The morning brief gets one line per active plan: today's items and how many earlier ones are open. It is quiet when the study
  reminders are paused or in quiet hours.
- Not built: ticking from a graded quiz automatically. The brief tells the brain it may tick after a graded quiz Omri passed in
  the talk, but code does not do it by itself.

## What Omri must do
1. **Tap Confirm on the plan card** in the thread, today, before Bot restarts (cards live in memory for 12 hours). Until then,
   nothing keeps the plan.
2. Then tell Bot what he did ("solved the sheet questions"). Bot ticks the items and keeps him on track. "undo" reverses a tick.
3. Optional: `CLAUDE.md` does not yet mention `exam_plan` / `plan_done` (I left `CLAUDE.md` alone). The manager or Omri should
   add a line.

## The live run (1 message to Bot; no follow-up needed)
- Before: quota guard `begin --share 5` (week 88%, budget 4.4 points). Picker set to Carbon medium through `/api/model-choice`.
  The message went in Hebrew through `/api/ask`, as Omri would write it. It held the quiz date, a request to look in Moodle for
  the example quiz, to cover the lectures, to use his progress, to make a plan he can be kept to, and that Wallis is not in it.
- **The process (from the message's own log):**
  - Round 1, **Carbon medium**, 12.6 s: Moodle course page, Moodle news, study status, and 3 reads of the course notes.
  - Round 2, **Carbon medium**, 54.6 s: downloaded Moodle files into the course (`moodle_fetch`), read 3 Moodle items, read the
    notes once more.
  - Round 3, **Carbon medium**: **timed out at the brain's 120 s limit**. The next model in the order took over.
  - **Neon low**, 31.1 s: wrote the reply and called `exam_plan` -> the card.
  - In total: 228 s, 12 tool calls, 3 counted model calls, 114,693 counted tokens.
- **Tokens:**
  - Carbon medium's 2 good calls: 65,032 tokens (32,516 per call; output 3,943, thinking 3,566).
  - Neon low's final call: about 49,700 tokens (a big prompt full of tool results).
  - The timed-out Carbon call is not in the log, but it was probably paid for.
  - For comparison, a typical Neon low call today is about 20,000-23,000 tokens, and a typical message is about 9-20 s.
- **Quota:** Gemini Models 5-hour 96% -> 92%, week 88% -> 87%. The Claude and GPT pool did not move. Quota guard: spent 1 of
  4.4 points. Omri's own message just before the run was answered before the first `/usage` read, so the change is this
  message's.

## Quality of the plan (my reading; the course content stays out of this public note)
- **Covers the lectures up to Friday:** yes. Lectures 1-7, starting with the small part of lecture 7 still open, which fits his
  real progress (the study record and the notes).
- **Skips Wallis:** yes, in "left out". It also found a lecturer's Moodle announcement that one more topic is not in the quiz,
  left that out too, and told him to skip those questions in the old quizzes. This is a good catch that came from the Moodle
  read Carbon chose to do.
- **Uses the example quiz:** yes. Wednesday: solve the example quiz alone and check against the solution. Thursday: last year's
  real quiz under time, then review the mistakes. It also points him to the quiz's cover page and formula sheet (scoring rules).
- **Shape:** 11 items over 4 days (3 today, 3 Wednesday, 3 Thursday, 2 light ones Friday morning), mixing theory review, proof
  questions from the exercise sheets, and timed practice. It took his calendar into account.
- **Weak points:** today's 3 items were planned at about 13:15, so they are heavy for an afternoon. The reply was written by
  Neon, not Carbon, so this run does not show Carbon's own writing.

## Quality: is it Fable-level?

**I cannot judge Carbon fairly from this run.** Carbon wrote no words that Omri saw. It only picked the lookups, and Neon low wrote
the reply and the plan. So everything below grades the **plan Bot produced** (Carbon's research plus Neon's writing). It is not a
grade of Carbon. I checked the plan against the real course files and his study record, read-only.

- **Correct for the material and his real progress?** Mostly yes.
  - The study record has parts marked "worked on" through lecture 7, self-study, behind, and no graded quiz yet. "Close the end
    of lecture 7 first" matches that.
  - Lectures 1-7 is the right range for a midterm at this point.
  - Weak point: with no graded quiz at all, nobody knows his weak spots. A strong tutor would start with a short diagnostic
    quiz (Bot's own `quiz`, which is also the only thing that can set "Understood") and plan around the result.
- **Practice questions right, at quiz level, with correct answers?** The plan has **no questions of its own**. It points to
  real ones, and I checked the references:
  - Sheet 3's questions 3, 4 and 5 really are volume of revolution, area under a graph and arc length, as the plan says.
  - The groups of integration questions it names exist on sheet 3.
  - Sheet 1's numbering fits its proof and theory items.
  - Two of those questions, done by hand as a check that they are reasonable quiz work: the area question gives
    (e^{2π}+1)²/5 (the integral has to be split where sin changes sign, a classic trap), and the arc length question gives
    16√3/5 + 8/15 ≈ 6.08. Both are quiz-level.
  - The sheets have no answers. The example quiz and last year's quiz come with solutions, and the plan uses those for checking.
  - So the questions are right, but "questions with correct answers" was only half met.
- **Did it really use the example quiz and the lectures?** Yes, not a guess.
  - Carbon's round 2 downloaded the example quiz, its solution and last year's real quiz from Moodle. All three are now in the
    course.
  - It read Moodle items and the notes, and the plan names those files.
  - The extra left-out topic came from a real lecturer announcement read in round 1. All three quiz files do contain a question
    on that topic, so telling him to skip it is useful.
- **Skipped Wallis?** Yes, in "left out" (it appears once in the lecture notes).
- **Reasoned well about the days left?** Fair.
  - The shape is good: technique and applications, then theory and proofs, then the example quiz untimed, then last year's
    quiz timed with a review of the mistakes, then a light Friday morning.
  - It noted which days are free.
  - But it put 3 heavy items on a Tuesday afternoon that was already half gone, and gave no time per item.
- **What a strong tutor would do differently:**
  1. Start with a 10-minute diagnostic quiz to find his weak topics.
  2. Give each item a time budget, so the day is realistic.
  3. Add 3-5 short new practice questions with worked answers for his weakest topic. Writing these is what would really test
     a top model.
  4. Plan a short graded `quiz` on Thursday, so Bot can see whether it worked.
  5. Leave a gap in case a day goes badly.

**Verdict:** the plan is solid, correct and grounded in the real files, and Carbon's lookups were good (it went to Moodle by
itself and found the two key quiz files and the announcement). But this is the work of a careful assistant, not proof of a
Fable-level model. The parts that would show top-model quality (its own correct questions and answers, diagnosing weak spots)
were never done by Carbon. **A fair judgment needs the contest below.**

### Proposed to-do item: Carbon vs Opus contest (for Omri's list)

> **Carbon vs Opus, blind, on the real Calculus 2 quiz task.**
> - **Inputs:** ONE frozen prompt bundle built by a small script, `experiments/carbon-vs-opus.js`. It holds:
>   - the task in Omri's Hebrew words;
>   - the lecture notes pages of lectures 1-7, sheets 1 and 3, the example quiz with its solution, and last year's quiz with
>     its solution, as text from `data/courses/.../files/*.pages.json`;
>   - his study record summary, and the topics that are not in the quiz.
>
>   No tools and no Moodle, so both models see exactly the same thing.
> - **Ask:** "A plan until Friday, with time per item, and 5 NEW quiz-level practice questions with full worked answers."
> - **Models:** Gemini 4 Carbon medium through `agy` (direct call, 300 s limit, not through the brain) and Claude Opus through
>   the Claude Code CLI. ONE call each, plus at most one retry if a call fails. That is 2-4 calls, under
>   `tools/quota-guard.js begin --share 5`.
> - **Blind:** the script strips model names and saves the two answers as A and B in random order, under `data/experiments/`
>   (git-ignored, because they hold course content). The key goes in a separate file.
> - **Rubric, 0-2 each, max 10:**
>   1. The math of the 5 questions and answers is correct (checked by hand, or by a third model plus a human look at any
>      disagreement).
>   2. The questions are quiz level and in range (lectures 1-7, nothing left out by mistake).
>   3. It uses the real example quiz and the notes.
>   4. It fits his progress.
>   5. The plan is realistic about the days left.
> - Omri scores both before opening the key. Write the result in `experiments/<date>-carbon-vs-opus.md`, with no course text.

## What went wrong / what to know
- **Carbon medium is slow for the brain:** one round took 55 s and the next one went over 120 s. With the 120 s brain limit, a
  long multi-round task falls back to Neon. Carbon also costs more per call than Neon (about 32,500 vs about 22,000 tokens).
- The page's answer line says "your choice failed, the next model answered", which is honest.
- `moodle_fetch` really downloaded the Moodle quiz files into the Calculus 2 course. That is a normal Bot tool, and Omri asked
  for Moodle to be used.
- My own probe this morning (9f7e124) used 7 calls where a later instruction allowed 3. The overrun was small (5-hour row -1
  point).

## Calls made in this part
1 message to Bot. Model calls inside it: 3 Carbon medium (1 timed out) and 1 Neon low. No direct `agy` model calls, no Confirm
or Approve taps, no `.env` read.
