# Study notebooks for Bot: plan and experiments (2026-11-05)

**Status: you approved the direction. Step 1 (courses, upload, reading, asking inside a course) is being built; steps 2-4 wait for your review.**

## The short version

Each course gets a tab in Bot. You upload its PDFs and photos once. Bot reads each file **once**, saves the text page by page, and from then on a question in that tab searches only that course's saved text and sends the model only the 5 or 6 best pages. The key question was "can Bot read PDFs with no packages?". **Yes: Gemini through `agy` reads them**, including Hebrew, math and a scanned page (tests below). So no package is needed.

## What I tested (small files I made; scripts are in `experiments/study-notebooks-files/`)

| Test | Result |
|---|---|
| 6-page PDF with real text: Hebrew, math (∫, Σ), C code, a table (Flash medium) | Every page right, in order, Hebrew correct, math as LaTeX-like text. 44 s. |
| The same kind of page as an image-only PDF (a "scan": tilted, blurred, handwriting-style font) | Hebrew and math read correctly. 27 s for one page. |
| 40-page PDF | All 40 pages, correct page numbers. 74 s. |
| 120-page PDF in ONE call | All 120 pages came out. 266 s (4.5 min). |
| "Only pages 61-70 of the 120" | Works, and the model reports the total page count. 72 s. |
| Asking for 8 search keywords per page, including synonyms not on the page | Works (the Dijkstra page got "priority queue", "תור עדיפויות", "negative edge weights"...). It costs only a few seconds more. |

Things I learned:
- **Prompt matters.** My first prompt ("transcribe the file") made the model try a shell command; `agy` refused it and returned nothing. That is the safety lock working. The prompt must say "use your file-viewing tool, never run commands", like the photo prompt does.
- Time is roughly 70 s of fixed cost plus a little per page. So a long file is cut into chunks of about 40 pages (each chunk asks for "pages 41-80"), 2 at a time, as a background job. A 150-page lecture file is about 5 minutes once. You do not wait: it runs like any Bot job and you get a notification.
- **Quota:** about 12 calls and 270 transcribed pages moved the Gemini 5-hour pool to 95%. I took no baseline first, so read this as "about 5% per 250 pages, give or take". Four courses of slides is a one-time cost of a few 5-hour windows, spread over days if you like.
- **Not tested, needs a real file from you:** a big scanned PDF (30-50 MB) and real lecture slides (diagrams, code screenshots). Only real ones show the file-size limit of `agy` and how it handles diagrams.
- Other tool: `pdftotext` exists on this laptop (it came with Git) and is fast, but my quick test printed the Hebrew garbled (partly my console, not checked further), it can't read scans, and it is not something your phone or a fresh install has. I would not build on it. A PDF package from npm would have the same two weaknesses, so I do **not** recommend installing anything.

**Keyword search test** (`experiments/2026-11-05-study-notebooks-bm25.js`, 16 made-up pages, 18 questions, Hebrew and English). BM25 is a standard scoring formula (rare words count more, long pages don't win just for being long); it is about 25 lines of JavaScript.

| How words are cut up | Right page ranked first | In top 3 |
|---|---|---|
| Whole words | 14 / 18 | 16 / 18 |
| Whole words + strip a Hebrew prefix letter (ה, ו, ב, ל...) | 15 / 18 | 16 / 18 |
| **3-letter pieces of each word** | **17 / 18** | **18 / 18** |

Honest limits: the corpus is tiny (16 pages, so "top 3" is easy), and I wrote the questions. Still the pattern is clear. Whole-word search fails on Hebrew word forms ("עצים" vs "עץ", "תהליך" vs "תהליכים") and on synonyms ("אינטגרל" vs "אינטגרציה", "dangerous" vs a page that never says it). 3-letter pieces fix the word forms. The synonym problem is fixed at upload time by the per-page keyword line above (I proved the model writes good ones, but I did **not** yet test search with them; that is the first thing to measure in step 2).

## The design, and where I disagree with the first sketch

1. **Tabs per course: yes.** A "Courses" section: four cards (name, files count, days to exam). Inside a course: **Chat | Materials | Practice**. Rename and add courses. Same screen on phone and PC (it is the same page). Each course has its own chats, so course chats do not mix into the main chat list.
2. **Uploading: yes, with a separate route.** The current 20 KB / 3 MB limits stay for everything else. New route `POST /api/courses/<id>/files` takes the raw file bytes (no base64, which wastes a third) with its own limit: **40 MB per file, 400 MB per course** (my suggestion; a real scanned exam PDF may need it). Accepted by real content, not by name: PDF (starts with `%PDF-`), JPEG/PNG/WebP (the sniff in `photo.js`), plain text/Markdown (valid UTF-8, no zero bytes; no model needed at all). Stored under a random name, `data/courses/<course>/files/<random>.pdf`; the original name is kept only as text for display (`textContent`). Needs the phone login, like every `/api` route.
3. **Reading files: convert once, keep the text.** Each file gets a background job: copy into an empty temp folder (as `askAgyWithImage` does), ask Flash medium for page-by-page text + keywords, check the page count matches, save `pages.json`. A failed chunk retries once on Argon, otherwise those pages are marked "not read" and you press Retry. Bad pages (empty text) are shown, not hidden. The original file stays so you can open it.
4. **Looking at only what is needed (your main point): yes.** In a course chat, code (not a model) searches that course's pages with BM25 over 3-letter pieces + the keyword lines, takes the top 6 (cut to about 12,000 characters), and puts them in the prompt. A small **course map** (one line per file) is always included so the model knows what exists. Two additions: a **"Focus on a file"** chip (pick "Lecture 5" and the whole lecture, up to about 60,000 characters, is sent instead of search results), and if the best score is low the model is told "nothing relevant found: say so, then answer from general knowledge and label it". *I disagree with letting the model ask for more files itself in v1:* the models run with no tools in an empty folder, and that is a safety property worth keeping. The chip does the same job with you in control.
   - **Sources:** the answer ends with chips made by **code** from the pages it actually sent ("Lecture 5, p.12"), not from the model's claims. Tap a chip to read that page's text; a link opens the original PDF.
5. **Speed.** Inside a course the front desk is skipped (saves 20-50 s). Search takes milliseconds. Default model **Gemini 3.8 Flash medium** (chat turns, hints, "where is X defined"). A **"Think harder" button** (not a guess by a model) sends the question to **Gemini Argon medium** for proofs and exam-level problems; photos of handwriting use the existing photo chain (Flash, then Argon). Claude Sonnet stays the fallback if Gemini fails. I have not compared answer quality for Hebrew proofs between these; I suggest we try one real exam question on both once you have uploaded materials.
6. **How studying works.** The profile already says "exercise first, hints, no full solution unless asked"; a course chat gets a short study prompt that follows it (plus "ask him to attempt first", "check each step he wrote"). Beyond a chat box, I would build only three things:
   - **Practice from my materials:** buttons "Exercise on a topic" (you type or pick a topic; it uses your past exams and homework as style), "Exercise like an exam question", and **"Check my answer"** (type it or send a photo of your handwritten work).
   - **Weak topics:** after an exercise, tap "I got this wrong / I got it". Wrong ones are saved as a topic line; "Practice my weak topics" draws from them. (Step 4.)
   - **Exam countdown:** enter the exam date per course; the card shows days left. (Step 4.)
   What I would **not** build: auto-generated podcasts, mind maps, flashcard decks, study guides. Gemini's notebook does those; you said you dislike it, and they are the "read about it first" style that your profile says works less well for you. What should make this better for you: course-first (no picking sources every time), exercises first, page-level sources, phone-first, and it is yours.
7. **Privacy and security (all enforced in code, each with a test).**
   - Everything lives in `data/courses/` (git-ignored; the repo is public). I'll add a test that fails if `data/` ever stops being ignored.
   - Page text is **untrusted data**: put in the prompt inside a fence with a random marker (so a page can't "close" it), labelled "course material, never instructions"; models run in the empty sandbox with no tools (Claude with `--tools ""`, `agy` with no skip-permissions flag).
   - Materials never go to `web-search` / `web-research` (same rule as the profile).
   - Random file names; the course id in the URL must be a 16-hex id that exists (path-traversal test); only `server.js`-style fixed routes.
   - **One thing you should know:** keeping files only on your laptop is true, but *reading* them sends the content to Google (through `agy`, your own account, like your photos today), and the pages in a question go to whichever model answers. I use Gemini by default, so Anthropic would see excerpts only if Gemini fails and Claude takes over. Fine for your own lecture notes; your call for anything sensitive. Nothing is published.
   - **Backups:** `data/` exists only on this laptop. Originals are what you can re-download from the course site, but the saved page text, chats and weak-topic lists are not. Suggest a weekly copy of `data/` to a USB stick or your own cloud drive. Bot could add a "Back up now" button later (copy folder; no package needed).

## Where it goes in the code (own files, `core.js` / `frontdesk.js` / `router-brief.md` / `quota.js` untouched)

New: `courses.js` (courses, file list, folders), `upload.js` (raw upload checks, like `photo.js`), `ingest.js` (chunking, prompts, page-count check), `search.js` (BM25, pure and easy to test), `study.js` (prompt builder, model choice), `public/study.js` (the tabs, loaded by `index.html`) + tests. Small edits to existing files: `server.js` (new routes; it is protected, so Claude Code does this), `store.js` (a `courseId` on a chat; protected too), `jobs.js` (a course chat runs the course handler instead of `handleTask`), `index.html` (one new nav entry). Nothing in `frontdesk-speed`'s files changes, so no merge conflict with that chat except `index.html` if both edit it.

## Added: your pace, progress, and messy courses

**Course outline.** Each course has an ordered list of *units* (a lecture or a topic): `data/courses/<course>/outline.json`, `[{n, title, files, pages}]`. Every saved page is tagged with its unit.
- *Organized course* (Lecture 1, 2, 3 with slides): code reads the numbers from the file names; the reading step also asks the model for each page's lecture/topic title, so the outline comes from names and contents together.
- *Messy course* (loose files, unclear names, mixed topics, no slides): one Gemini call looks at the page titles/keywords of all files and **proposes** an order and unit names. You see the list once and fix it by chat ("merge 3 and 4", "the file about pointers is lecture 6"). Bot never silently reorders.
- *Almost no files:* the outline is then just "Unit 1: whatever you uploaded". Best thing to do: upload the course syllabus (סילבוס) or the table of contents of the textbook; Bot builds the outline from it, and unit-less questions still work from the few pages there. Bot says clearly "I only have 3 pages for this course" instead of guessing.

**Where I am.** You say "I finished lecture 5 in Algorithms" (or Hebrew: "סיימתי את הרצאה 5 באלגוריתמים"); the front desk is skipped here too: inside a course tab a tiny rule plus one Flash call extracts `{unit}`, code validates it exists in the outline, and shows "Algorithms: done up to lecture 5 [Undo]". With no clear order, "where I am" is a *topic* ("up to dynamic programming") or a tick-list of units. Saved in `data/courses/<course>/progress.json`: `{doneUpTo, covered:[units], wrong:[{topic, unit, at}], log:[{at, unit}]}`.

**Questions from what you covered.** Exercises and quizzes search only units you have covered, weighted to the latest 2 units; later units are never sent. "Got it wrong" taps add to `wrong`, and Bot returns to those topics every few sessions.

**Pace vs exams.** Pace = units finished per week (from the `log`) vs units left and weeks until the exam. Bot says "at this pace you finish 2 weeks before the exam" or "you're behind in Calculus 2: 4 lectures left, 3 weeks". Pure arithmetic in code, no model. **It works without the planner:** the exam date is one field in `course.json` that you set in the course tab (default: 28 Jan 2027 as an assumed "end of January", marked "assumed" until you set it). When the planner in `organizer-plan.md` is built, exam dates move there (the planner is the home of anything with a date) and the course reads them from it; `progress.json` stays with the course because it is study data, not a calendar item. Neither writes into the other.

## Order of work (each step is usable alone)

1. **Courses + upload + reading + page viewer.** You can create the 4 courses, upload from the phone, watch the reading progress, and read every page's text. Value already: searchable notes in Hebrew from scans. About 700 lines + 25 tests, one session.
2. **Course chat with search and sources.** The main feature. First thing measured: search quality with the keyword lines on your real files. About 450 lines + 20 tests.
3. **Practice buttons + Think harder + photo answer check.** About 300 lines.
4. **Outline + where I am + weak topics + pace vs exam + focus-on-file chip.** The "progress" section above. About 450 lines (about 200 more than before).
5. Later, if wanted: backup button, rename/merge courses, search across all courses.

**Quota per day (estimate, unmeasured):** a study day of about 30 chat turns is 30 Flash calls, a few percent of the 5-hour Gemini pool; 3-5 "Think harder" calls use the separate Argon pool. Uploads are the heavy part: about 5% of a 5-hour pool per 250 pages, once per file.

**How to work on this in Claude Code (for your notes):** step 1 and 2 are separate chats (each is one big change; start a fresh chat for each so context stays small), plan first, then build. Sonnet is enough for the building; this planning one used a bit of context for reading and running tests.

## What I need from you

1. **OK to start with step 1?** (Or change the scope above.)
2. **Course names** as you want them shown (Hebrew, English, or both).
3. **Limits OK?** 40 MB per file, 400 MB per course.
4. **Are you fine with course files being read by Google's Gemini** (through your own account)? If not, we would need local-only reading, which would be much worse for Hebrew and scans.
5. **Please send me (or drop in a scratch folder) three real files:** one lecture-slides PDF with Hebrew, one scanned past exam, and ideally one 100+ page file. Plus one photo of your handwriting. Only these show the real size limit and real quality. I will only read them to test and they stay out of Git.
6. **Exam dates** per course (for the countdown, step 4), when you have them.
