# Study improver, 2026-11-17 (Fable)

Branch `claude/fable-study-improver-0d2b42`, on top of main `58ed3a0`. Nothing pushed, Bot not restarted, the real `data/` only read.
Tests: 1148 before, **1162 now, all green** (`node --test`). Five commits.

## What I looked at

- The real talk of 2026-11-16, 15:00-19:40 (Calculus 2, lecture 4), `data/study/calculus.json` and `sp.json`, read-only.
- The outline that code builds from the real Calculus 2 notebook and from Meni's notes (Systems Programming).
- The teaching code: `catchup.js`, `tutor.js`, `outline.js`, `study-coach.js`, `course-work.js`, the brain's context and tools.

## What was wrong, and what I did

### 1. The outline (the root of several problems). FIXED
- **Calculus 2 notebook:** its lecture lines look like `05/11/25 חדו״א 2 הרצאה 4` (date and course in front). `outline.js` wanted the
  line to START with "הרצאה", so it saw none of the 26 lectures and cut the file into 10 blind slices ("Part 2 of 10").
  Now a short prefix is allowed (number at the end of the line, numbers must still rise); a date alone on the line above belongs
  to the lecture. The real notebook now gives 26 lectures with exact pages (lecture 4 = pages 11-12).
- **Meni's notes, chapter 4 (the known bug):** the file is a Word document saved as a page. Headings Word numbered by itself came
  out as `- Title` list lines; only hand-typed numbers survived. So every chapter title was missing, chapter 4 had no heading at
  all, and "3.3.3" ran on for 53 pages up to "5.1". Code now gives a number back only where the numbering proves it:
  a lone `- Title` line right above "N.1" is chapter N (above "3.3.1" it is "3.3"); and when exactly one chapter number is
  missing between two chapters found that way, it starts where three lone `- Title` lines follow each other.
  Real result: `2 ניהול זיכרון`, `3 מקביליות`, `3.3 בטיחות ונכונות...`, **`4 תקשורת בין תהליכים (Interprocess Communication)` (pages 61-90)**,
  `5 בסיסי נתונים`. "teach me chapter 4" / "פרק 4" now finds it. The title words are always a real line of the file.
  Still missing there: 2.2, 2.3, 3.2 and the sections inside chapter 4 (their numbers are lost and nothing proves them), so chapter 4
  is taught as one long section in about 13 pieces.

### 2. What was practised INSIDE a lecture was not kept. NEW: `lecture-parts.js`
- The parts of a lecture are made by CODE: the lecture is a section of the notes, so its pages are known; each page already has
  topic words that Bot stored when it read the file. Real lecture 4: `4.1 אינטגרציה בחלקים, 4.2 נוסחת וואליס, 4.3 נסיגה באינטגרלים,
  4.4 קירוב פאי, 4.5 שינוי משתנה, 4.6 אינטגרל בהצבה, 4.7 הצבה טריגונומטרית, 4.8 ארקטנגנס`.
- Two checked tools for the brain: `lecture_parts` (a lookup) and `parts_done` (marks parts as worked on; the model hands back only
  IDS, code checks every id against the fresh list; one bad id stores nothing; `"undo":true` takes a mark back).
  Kept in the course record as `worked` (page, topic, time). It is never "Understood" and touches nothing else.
- `parts_done` is refused after a web page, with a photo or after Moodle text, like the other tools that act at once. So an
  answer sent as a photo cannot be marked in that message: the briefing tells the brain to mark it with the next message.
- Every message in a course now shows the brain "The parts of the lectures Omri is on" (the lecture after the last one covered,
  that one, and any lecture with marks from the last 2 days; 3 lectures at most) with NOT YET / worked on, and "Left of lecture N".
- `teach_next` on a lecture notebook now teaches only parts that are NOT YET (3 per lesson), tells the tutor which parts were
  done and which wait, and marks what it taught. With nothing left it gives a review, not a first-time lesson.
- `brain-brief.md`: three new lines (keep track of the parts; answer "what is left" from the list and believe "we already did
  this"; fit a time limit: only NOT YET parts, idea + one short example each, one check question).

### 3. Exercises offered again ("x e^x", the sin^2 trick). CHECKED, one gap closed
- `course-work.js` (the manager's fix) run on the real thread at 19:35 lists 15 formulas, including `∫x e^x dx` (15:02) and
  `∫sin²x dx` (16:11). It works. It is enough for "do not offer this again", but it is only formulas for 2 days; the parts record
  above is the lasting answer.
- Gap: the `∫ln(x)dx` exercise of 16:00 was written inside a sentence (`$...$`) and was not listed. Inline formulas that hold an
  integral, a sum or a limit are now listed too.

### 4. A lost teaching cursor restarted the course. FIXED
- Real `sp.json`: the cursor names a heading that no longer exists ("the expected value is the first element...", from the old
  bad outline). `nextChunk` then started from section 1.1 again. Now it goes on after the last taught part that still exists.

### 5. Photo with words; Argon leaking / looping. RE-CHECKED, nothing to fix
- The photo line right after the words is in the prompt (also in my flow test). The real leak of 16:52 is caught by `leaksPrompt`.
- I scanned all 256 real answers of 12-17 November for model notes: 3 leaks, all 3 caught by the check now; no other leak.
- Formula-only messages ("dt/2x") after Hebrew: `languageLine` keeps Hebrew (the English replies of 15:50 and 19:11 predate it).

## Part A: the full tutoring test

`tests/tutoring-flow.test.js` plays one evening with FAKE models and the real coach, tracker, outline and parts record:
teach me the next part -> check question -> wrong answer (graded, hint, no solution) -> "I don't get it" (second hint) ->
answer as a photo with words (photo named next to the words; a mark is refused there) -> "עברית בבקשה" ->
"we already did this" (marked with the reply in ONE model call) -> "what is left" (the context names the one open part) ->
"10 minutes, finish the lecture" (the lesson holds only the open part) -> asked again (a review). "Understood" stays 0 throughout.

Real model calls: 2 messages on Hydrogen medium (`experiments/2026-11-17-tutor-real.js`: real briefing, real pages, the real
talk as history, the study record in a temp folder). One run of 5 model calls; an earlier run lost its second message to an
"agy status ERROR" (Bot said so honestly).
- The real 19:33 message ("is anything left of lecture 4?"): yesterday Bot answered "integration by parts is left" (wrong, done
  at 15:02). Now: marked by parts / substitution as worked on by itself, and answered "Wallis formula and the arctan
  substitution are left". Correct.
- "I have 10 minutes, let's finish": one line on the plan, then only the two open topics, idea + one short example each, one
  check question at the end. Grade: good. Nothing already done was offered.
- Weak points seen: it calls `course_read` every time for the page text (one extra model round), and it did not mark the two
  topics it had just taught in that same message (the briefing makes it mark them with the next one).

## What is left / for Omri to decide

1. **Photo answers and marking.** A part cannot be marked in a message with a photo (the standing rule). If Omri wants
   `parts_done` allowed with a photo (it only marks "practised", checked ids, undoable), it is one line in `brain.js`
   (`afterWeb` in `parts_done`). I did not weaken the rule.
2. The topic words come from when the file was READ (a model wrote them then; code only splits and checks them). They can be
   uneven (lecture 3 has "פונקציה קדומה" and "נוסחת ניוטון לייבניץ" as separate parts). Files read as plain text have no topic
   words: such a lecture has one part per page.
3. Notes that are not a lecture notebook (Meni's notes) keep the old record (`notes.taught` pieces). "What is left of chapter 3"
   there is not answered from a parts list yet.
4. `study_status` ("where am I") does not show the parts yet; only the brain's context and `lecture_parts` do.
5. The end-of-day review does not propose marks. Could be added with the same quote rule as positions.
6. The real `data/study/calculus.json` has no marks yet (nothing was migrated from yesterday; the brain will mark as Omri works).
   Its old open quiz question (lecture 6, from 8 November) is still stored but is past the 6-hour limit, so it is not asked.

## Suggested lines for CLAUDE.md (not edited by me)

- In "How Bot works", Lookups: add `lecture_parts`; Doing: add `parts_done`.
- In "RULES THAT STAY IN CODE", the list of doing-tools refused after a web page / with a photo: add `parts_done`.
- In "Courses and studying", a new bullet:
  **INSIDE A LECTURE (2026-11-17, `lecture-parts.js`):** the parts of a lecture are made by code (the lecture's pages from the
  outline, each page's stored topic words). The brain marks parts as worked on with `parts_done` (ids only, checked; undo) and
  sees the list with every message in the course; `teach_next` teaches only parts not worked on yet. "Worked on" is never
  "Understood".
- In the same section, on the outline: lecture lines may carry a date in front; headings that lost their number in a Word page
  get it back only where the numbering proves it (`lostHeadings` in `outline.js`).
