# Catch-up: real-model check, 2026-11-08

Branch `claude/study-catchup-417705`. A TEST copy of Bot (`BOT_THREAD=on PORT=3100 node server.js` in this worktree, empty `data/`, no `.env`, no Google login; the real Bot on port 3000 was never touched and was still running at the end). Real models (front desk Gemini 3.8 Flash low through `agy`, tutoring Argon). Messages sent with `POST /api/ask`, answers read from `/api/thread` like the page does. Everything is made up:

- **Systems Programming** (has the default timetable, 6 lectures held): ONE made-up notes file, 10 headed sections in Hebrew and English (introduction, process memory layout, stack frames, heap and malloc, pointers, pointer arithmetic, memory bugs, files, processes, threads).
- **Algorithms Planning** (timetable): one made-up file with "Lecture 1..8" headings.
- A made-up assignment file "hw2.txt" (a small memory allocator, "due next Sunday") sent through the thread upload.

The test Bot was restarted four times to load fixes (data kept); it was stopped at the end. The table shows the LAST result of each message; "screens" = characters / about 1000 (one phone screen).

| # | Message (made up) | What Bot said (short) | Verdict | s | screens |
|---|---|---|---|---|---|
| 1 | "I'm behind in everything, what should I do today?" (nothing known yet) | Plan across both courses: 90 min a day, "Start with: ... (25 min). Say: ...", today's list, ONE question about exam dates | good (code only, no model) | 6 | 0.7 |
| 2 | "I went to the Systems Programming lectures but I didn't follow anything. The lecturer is around page 2 of the notes. I want to understand the concepts, especially memory management." | Reader: attending, pages 1-2, goal concepts, focus "memory management", depth shaky; readback with undo | good | 17 | 0.3 |
| 3 | "what should I do today?" | Plan again; now "Concepts first, as you said" and the memory-layout part first (focus) | good | 6 | 0.5 |
| 4 | "teach me memory management" | Teach: first memory part, 3 steps with a code example, cited [S1], ONE check question; nothing marked understood. Round 1 had "Part 1 of 3" headings that looked like chunk numbers: prompt fixed, and code now writes the section title in bold above | good after fix | 32 | 1.2 |
| 5 | "teach me the next part" | Next chunk (stack frames), same shape | good | 30 | 1.2 |
| 6 | an answer to the OLD question (my script was one step behind) | "different question", the open question is asked again; a single question is shown without "Question 1 of 1" | good (shows a stuck student is not blocked wrongly) | 26 | 0.3 |
| 7 | "תלמד אותי על מצביעים" | Hebrew lesson, Hebrew check question, no gendered "you" | good | 33 | 0.9 |
| 8 | "I have 2 hours a day, what should I do this week?" | 120 min a day read from the words; day by day lines. Round 1 listed Algorithms lectures 7-8 that are not held yet and overshot the budget: fixed (only held lectures, budget respected, each day takes the first item that still fits) | good after fix | 6 | 0.8 |
| 9 | "quiz me on what I covered" | Quiz on "what we covered so far", questions only about the pieces taught (pointers, stack frames, layout) | good | 27 | 0.3 |
| 10 | assignment file "hw2.txt" + "Assignment for Systems Programming, due next Sunday" | Filed under the right course; about 70 s later a card: "Memory allocator", due Sunday 15 Nov (computed by code from "next Sunday"), 5 needed ideas; Confirm tap saved it | good (slow: reading + proposal) | ~70 | 0.4 |
| 11 | "teach me through the assignment" | Lists the 5 ideas, teaches idea 1 (pointers and arithmetic) from the notes, one check question. The teaching prompt never contains the assignment text (also tested) | good | 21 | 1.4 (a little over) |
| 12 | "give me a hint" (open check question) | Hint 1 of 3, one step, no answer | good | 26 | 0.2 |
| 13 | "teach me the next idea of the assignment" | "Idea 2 of 5: dynamic memory allocation", from two notes pieces, one check question | good | 23 | 1.1 |
| 14 | "give me the full solution code for the memory allocator assignment" | Round 1 started the check questions without saying no; now a plain "I will not write the full solution ... I can guide step by step" first, then the guided start | good after fix | 27 | 0.5 |
| 15 | "skip" (single check question) | "Skipped. Nothing was recorded." | good | 6 | 0.1 |
| 16 | "I skipped two weeks of Algorithms Planning and came back" | Reader: attending; then ONE question: "which lecture are you in now (a number or a day)?" | good (gap closed) | 27 | 0.3 |
| 17 | "explain the heap and malloc section" (no course named) | The only course whose section titles fit (Systems Programming) was used; lesson on that section | good (gap closed) | 23 | 1.1 |
| 18 | "teach me quantum chromodynamics in Systems Programming" | "I could not find that in the notes ... I will not guess" and the real list of parts; no model teaching call | good | 33 | 0.3 |
| 19 | "תלמד אותי על דליפות זיכרון" | Round 1: the desk said `ask` and the notebook answered with a worked problem (no check). After the fix ("teach me X" is teaching for a notes course): Hebrew lesson on the memory-bugs section with a check question | good after fix | 29 | 1.1 |
| 20 | "אני מאחור בהכל, מה לעשות היום?" | Hebrew plan: "תוכנית ריאלית ...", start with the assignment (60 דקות), "קודם מושגים" | good, Hebrew has no gendered verbs | 8 | 0.4 |
| 21 | "the exam in Systems Programming is on 22 December" | Round 1: a plain report (the sentence has no "I"). After the fix: readback + a Confirm card with Tuesday 22 Dec, not saved before; Confirm tap saved it | good after fix | 21 | 0.3 |
| 22 | "teach me about dijkstra" (Algorithms Planning, notes made of lecture headings) | The desk says `ask`; the notebook answers (as before), labelled "Outside your files" for the worked example. Lecture-structured notes keep the lecture road on purpose | acceptable (not notes teaching) | 43 | 1.0 |

Typical times: code-only answers (plan, report, skip) 6-9 s; a lesson or quiz 21-33 s (front desk 3-5 s plus Argon medium); a Hebrew notebook answer 45 s; assignment file to card about 70 s.

## What was fixed because of this run (all in the branch, each with a test)
1. Teaching prompt: step titles are plain, not "Part 1 of 3"; the section title and chunk number come from CODE in bold above the lesson.
2. Plan: budget respected, only held lectures, first-fit so a day is not left half empty, aligned lecture notes (Algorithms Planning) become lecture items.
3. "Give me the full solution" gets a plain no first.
4. A single check question can be skipped ("skip" / "דלג"); an off-topic answer tells how.
5. "teach me X" / "תלמד אותי X" labelled `ask` by the desk is teaching, but only for a course taught from its notes (`studyCanTeach` in `core.js`).
6. A written exam date (also in a sentence without "I") becomes a Confirm card.

## Not verified
- The real notes (108 pages, Hebrew, with sections that are far bigger than my 600-character made-up ones): the chunk size (4500 characters) and the teaching length were only seen on short sections. A real section is cut into several chunks of about 4500 characters.
- A whole quiz to the end with the real model, the graded "Understood" after 3+ questions on notes taught this way (tests cover the rule; this run did not finish a 3-question quiz).
- The Study page, the phone, the morning brief and nudges with the new `notes` / `pathIdx` fields (they are extra keys in the course record; the tracker keeps them, no format was changed).
- The front desk labels: "teach me the next part" and "plan" were labelled right every time here, but 22 messages are a small sample. The Haiku backup desk was not exercised (its briefing got the same three sentences).
- "teach me memory management" starts with the first memory-related section (title words), not with the best section for a concept that spans several; "teach me the next part" then walks in order.
