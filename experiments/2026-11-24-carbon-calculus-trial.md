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
