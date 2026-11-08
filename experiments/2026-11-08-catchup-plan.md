# Catch-up: plan (2026-11-08, branch claude/study-catchup-417705)

Goal: Bot as a tutor for a student who is behind in everything. No real text here; all examples are made up.

## What is missing today
- `teach` and `quiz` need a timetable lecture. A course whose notes are ONE big file has none (Bot says "I do not see a held lecture").
- "I'm behind in everything, what now?" gives a report of counts, not a plan with times.
- "Teach me through the assignment" only asks check questions; there is no teaching of the prerequisite concept.
- Hebrew sentences written by code still use masculine "you"; a message with no course named dead-ends even when one course fits.

## Design (small, code checks, models only propose)
1. `catchup.js` (pure code, no model): section matching against the real outline (`matchSections`: words of the student against section titles, any language), chunks of a section (about one phone screen of teaching each), a cursor of what was taught, and the plan builder.
   - If the words match nothing (English words, Hebrew headings), ONE Argon call gets the list of real section ids and must answer with ids from it; code drops any id that is not in the outline. A model never invents a section.
2. Teach from notes (`tutor.turn`, `range.chunk`): the next chunk (or the named section) is cut from the notes, taught in 3 steps in the student's language (cited by section and page), ends with one check question (graded like any answer, never "Understood" by itself). The cursor and the list of taught sections are kept in the course record. "Quiz me on what I covered" draws only from taught sections, else the student's own `where`.
3. Catch-up plan (`answerStudy`, intent `plan`, or "behind in everything"): from each course's record (mode, where, pace, goal, focus), the outline size, the timetable (behind lectures with material), assignments with real dates and CONFIRMED exam dates only. Time budget: 90 min/day unless the student writes another number; chunk 25 min, lecture 45 min. Output: what to do FIRST today with minutes, then one line per day, one screen. Missing exam dates: ONE question, once a week; the answer becomes the usual Confirm card.
4. Assignment teaching (`start` with "teach me through"): concepts listed, the next one taught from the notes with a check question, then guided hints. The teaching prompt forbids using the assignment's own task; the hint rules are unchanged.
5. Hebrew: no gendered "you" in code sentences; the teaching prompt asks for infinitives / "אפשר ל..." and one phone screen.
6. Gaps: "skipped two weeks and came back" -> one question (what is the last part you went through); a message with no course named uses the only course that fits (section title or name match), or the only course.

## Not changing
Front desk architecture, protected files, "Understood" only by a graded check (3+ questions, 70%+), Argon only for tutoring.

## Check
Tests with fake models after each step; then a real-model run on a test copy (port 3100, empty data): `experiments/2026-11-08-catchup-check.md`.
