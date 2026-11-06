# Course search across Hebrew and English (2026-11-06)

Branch `claude/hebrew-notes-477307`. Real data, read-only: Calculus 2 (one Hebrew notebook, 87 pages, a bilingual KEYWORDS line per page) and
High-Performance Systems Programming (English slides: 2 PDFs with keywords, 1 older .pptx with NO keywords). 28 questions I wrote with the right
pages chosen by hand (14 Hebrew questions about the English slides, 14 about Calculus). "Hit" = a right page is among the 12 pages sent.

## Before (today's search, no model)
- Calculus 2: 14 of 14 hit. The KEYWORDS line (Hebrew + English terms per page) already bridges the languages there.
- Systems Programming, Hebrew questions: only **5 of 10 hit** (e.g. "מה זה מצביע למצביע", "איך משנים גודל של זיכרון שהוקצה",
  "חשבון מצביעים במערך" found nothing useful). The English questions on the same slides were fine (4 of 4).
- Why: the .pptx pages have no KEYWORDS line, and a Hebrew word never shares a 3-letter piece with an English word.

## After (Flash through the pre-warmed agy writes search words in both languages; used only when the question language differs from the notes)
- 28 of 28 hit (5 more), 26 of 28 with the right page in the first 3 (was 22).
- The model was called for 19 of the 28 questions (all 10 Hebrew-on-English, 9 English-on-Hebrew). The other 9 (same language) had no delay.
- Time added per call: 2.1 - 5.9 s, median 3.0 s (warm Flash low). The call has an 8 s limit; on failure the plain search is used.
- Small cost: "מה ההבדל בין calloc ל malloc" moved from the 1st to the 3rd page (more words dilute the score), still a hit.
- English questions on the Hebrew Calculus notes did not get worse (all hits both times; 2 got better: "perpendicular vectors dot product zero", "Taylor polynomial in several variables").

## Cheaper idea considered: a fixed dictionary
A small hand-written math/CS word list would cost 0 s, but it only knows the words I put in it: it would have fixed "pointer" and "integral" and missed
"padding", "realloc", "locality", "Hessian" in the next course. The Flash call knows any subject and costs no Claude quota. The dictionary was
rejected as the main fix; it could still be added as a zero-delay first layer later.
