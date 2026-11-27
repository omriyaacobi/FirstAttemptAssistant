# Studying in one conversation: how it works now, where it hurts, and 5 ways forward (2026-11-27)

Research only. No code was changed, no model was called, Bot was not restarted. Real chat text and note content are NOT copied
here. Only counts and code-written log lines (tool names, course names, times) are used.

**Short version (read this part, about 10 minutes):**

1. Bot does not know which course a message is about. It **guesses**: the newest answer filed under a course in the last
   **6 hours** "owns" the talk, unless the new message names another course. Because of that, **96% of the brain's answers are
   filed under some course** (885 of 925), even though most messages are not study messages.
2. When the guess is wrong, the model can call `talk_course` to fix it. But the prompt is **already built** with the wrong
   course's material, so the fix only helps the **next** message. The model did this only 18 times in about 900 answers.
3. The "recent talk" (5,000 characters) is one window for **everything**. Calculus, Systems Programming, Moodle and laundry
   all share it. On 14 of the 18 days with brain answers, 2 or more courses were in the talk.
4. A full quiz never expires. Every open quiz question, in **every** course, rides along with **every** message.
5. **My recommendation: Option D, "one store, course views".** Keep ONE store, so the memory, the summaries, the brief and
   search all keep working. Add a view of each course on the page. A message sent from a course's view belongs to that course
   because of **where** you typed it, so Bot never guesses. Do the small fixes of **Option A** first. They are needed in every
   option and help at once.

---

## 1. How the brain handles studying today (simple version)

Think of each message as a **request to a stateless server**. The model remembers nothing between calls. So for every message,
code builds one big prompt from a fixed set of parts, sends it, and lets the model ask for tools (at most 3 rounds).

```
 Omri types a message (PC or phone)
          |
          v
 jobs.js startThread ── saves it in data/thread/YYYY-MM-DD.jsonl (one store, one timeline)
          |
          v
 brain.js handle()
   1. WHICH COURSE?  focusCourse():
        - the message names a course (its name, or the timetable's Hebrew pattern)  -> that course
        - you replied to a quoted answer about a course                              -> that course
        - else: the newest answer in the recent talk with a courseId, < 6 h old       -> that course
        - an answer marked noCourse (talk_course "none") stops the search            -> no course
   2. BUILD THE PROMPT (same order every time):
        brain-brief.md  |  time  |  picked profile facts  |  calendar 7 days + reminders
        ALL courses: files, "Omri said" notes (4 x 300 chars), open quiz question, working_on
        exam plans  |  a study card waiting?
        ---- only for the guessed course ----
        assignment text (up to 24,000)  |  best-matching note pages (up to 10,000)
        file list (up to 4,000)  |  linked-folder code changed in the last 48 h
        "already worked on" formulas (2 days)  |  lecture parts and their marks
        ---- the talk ----
        daily notes of the last 3 days (2,400)  |  newest calendar card
        recent talk: 5,000 chars, newest first, the last 3 messages whole, older answers cut to 500
   3. MODEL (Neon low -> Hydrogen -> Sonnet in agy -> Claude Code), up to 3 tool rounds
        study tools: course_search/read, lecture_parts, study_status, study_position, course_note,
        parts_done, teach_next, quiz, quiz_answer, study_plan, exam_plan, plan_done, talk_course ...
   4. SAVE the answer with result.courseId = the course in ctx (guessed, or set by a tool)
          |
          v
 That courseId becomes the guess for the NEXT message (step 1).
```

The key point: **the course of a message is only a guess that carries forward from the previous answer.** Nothing on the page
or in your words fixes it. The model can correct it, but too late for the message it is answering.

### What each study part does (one line each)

| Part | File | What it does |
|---|---|---|
| Timetable and "should be" | `study-plan.js` | Pure code: which lectures were held (minus the cancellations you told it), so "where you should be" |
| Course records | `study-tracker.js`, `data/study/<key>.json` | One JSON per course: position, lectures by date, assignments, topic boxes, the running tutor session. Written only by code |
| Your position | `position-record.js`, `standing.js` | `said` (your own words, always kept) plus checked closed fields (mode, where, pace, gaps...) |
| Course notes | `course_note` | Short sentences in your words, shown in every message's context (4 newest per course) |
| Lecture parts | `lecture-parts.js` | Code cuts a lecture into parts from the notes' page topics; `parts_done` marks "worked on" (not "understood") |
| Already worked on | `course-work.js` | The formulas Bot showed in the course over the last 2 days, read fresh from the thread |
| Tutor and quiz | `tutor.js` | A 3-question graded quiz, hints, reveal. "Understood" needs 3+ questions and 70%+. A one-question check expires after 6 h; **a full quiz never expires** |
| Teach next | `catchup.js`, `teach_next` | Teaches one chunk (about 4,500 chars) of the notes, ends with a check question, remembers what was taught |
| Plans | `study_plan` (all courses, code only), `exam_plan` (one course, a card you confirm), `plan_done` |
| Nudges | `study-nudges.js` | At most one line a day in the morning brief, tied to a real date, quiet after 2 ignored, `study_pause` for reserve duty |
| Daily summary | `thread-summary.js` | At 23:45, one note per day (Hydrogen high): "done" items for the brief and quoted facts or positions (cards, or checked by code) |
| Morning brief | `coach.morningBlock` and the brief | One message in the thread: the You part (from the summary), the study line, the news |
| Courses page | `public/index.html` (`courseCard`, `tellBot`) | A card per course: should-be, where you are, deadlines, an open question. Every button sends you **back to the one chat** with a sentence ready in the box |

### How the big picture is kept today

Everything is either **per course and code-kept** (records, notes, positions, parts, exam plans) or **global** (profile facts,
the daily summary, the brief, `search_memory` over the whole thread). The course records are already "separate per course".
Only the **conversation** is shared. That matters for the options below: splitting the conversation does not split the
memory, because the memory is already per course.

---

## 2. Where the one conversation really causes trouble (with evidence)

Counts come from `data/thread/*.jsonl` (2,111 messages, 925 brain answers, 2026-11-10 to 11-27), from the code-written `log`
lines only. `data/bot.log` is small (100 KB) and holds mostly start-up lines, so the per-message logs in the thread were used.

### P1. The course guess sticks for 6 hours, so almost everything is "about a course"
- Code: `FOCUS_MS = 6 * 3600 * 1000` and `focusCourse()` in `brain.js` (around line 420).
- Data: **885 of 925** brain answers carry a `courseId`. Only **10** carry `noCourse`. Since 11-17, 432 answers filed under a
  course called **no** course or study tool at all. Some of them were course questions answered from the prefetched pages,
  but a share of them were not about the course. Either way, every one of them carried that course's assignment, pages,
  parts and code in its prompt.
- Effect: a question about the calendar, a shopping question or a Bot question an hour after Calculus still gets Calculus
  material (up to about 40,000 characters) and the label "about Calculus 2". The model must notice and call `talk_course`.

### P2. Correcting the course comes one message too late
- Code: `talk_course` sets `ctx.course` (brain.js about line 602), but the course block of the prompt (`prefetch`) was built
  **before** the first model call. Its own comment says "It changes a label and what the NEXT message is given".
- Data: `talk_course` was called **18 times** (10 to "none", 8 to a course: High-Performance SP once, Calculus 2 five times,
  Systems Programming twice). Each time, the answer itself was written with the wrong course in its prompt. On 11-22
  (19:10 none, 19:45 Systems Programming, 20:50 none) the talk went back and forth three times in one evening.

### P3. One 5,000-character window mixes courses and topics
- Code: `buildHistory` in `thread-context.js` takes the newest messages, whatever their course (`RECENT_CHARS = 5000`,
  `FULL_TURNS = 3`, older answers cut to 500).
- Data: in 832 pairs of answers less than 30 minutes apart, the course changed **41 times**. **14 of 18** days had 2 or
  more courses in the talk.
- The code already shows the damage. `course-work.js` and `lecture-parts.js` exist because on 2026-11-16 a long Calculus
  evening fell out of the window: Bot offered exercises done hours earlier as "next", and you had to say "we already did
  this" three times. Those fixes work around the window **for one course**. They do not stop a side talk about another course
  from pushing the tutoring out of it.

### P4. Quizzes left open follow you everywhere
- Code: `coursesText()` in `brain.js` lists, for **every** course, "A QUIZ QUESTION IS OPEN in this course" with every
  message. In `tutor.js`, `stale()` only expires a **one-question check from a lesson** (6 h). A full 3-question quiz stays
  open until it ends.
- Evidence: the 6-hour limit was added because a check question from 11-08 was still open on 11-14 and took a reply about
  another topic (the upper Darboux sum) as a wrong answer (comment above `CHECK_TTL_MS`). On 11-14 a reply to a question the
  brain asked in the talk went to an old quiz question (comment in `coursesText`). On 11-17, `quiz_answer` ran 9 times in
  90 minutes on one Calculus quiz, mixed with other talk. A quiz you leave half-done today still sits in the context of your
  laundry question next week.

### P5. The wrong course can block or slow you
- Code: the per-course queue ("a question to a course waits for an earlier one to the same course") and `waitForFiles` both
  use the **guessed** course.
- Evidence: the comment in `focusCourse` says that on 2026-11-16 a reply to a marked Systems Programming answer waited 100 s
  for a file of **another** course to be read. That case was fixed (the quoted answer's course wins). A plain unquoted message
  can still be held by the guessed course's files or queue.

### P6. The page gives you nowhere to "be" in a course
- Code: the Courses tab cards (`courseCard`) only show status. Every button (`tellBot`, "answer") sends you back to the one
  chat with a sentence typed in the box. So the only way to tell Bot "this is Calculus now" is to write the course name.
- Your own feeling ("messy in my head") matches the data. One scrolling timeline holds tutoring, quizzes, Moodle checks,
  briefs and errands. To find "where did we stop in lecture 5" you scroll or ask `search_memory`.

### What does NOT seem to be a problem
- The memory is not mixed: positions, notes, parts and plans are per course and checked by code.
- Cross-course questions ("what should I do today", `study_plan`) work **because** the brain sees all courses every time.
  Every option below must keep that.

---

## 3. Five options

Common to all options: the safety rules stay in code and work **per message**, wherever it was typed. A web page, photo or
Moodle read still blocks the doing-tools in that message. The tests in `tests/refusal-rules.test.js` do not change.

### Option A: keep one thread, fix the confusion (small, do it first)

**What changes (code only, nothing new on the page except one label):**
1. **Show the guess.** Under each answer, the page already knows `courseId`. Show a small chip "Calculus 2" (or nothing).
   Tapping it offers "not about a course / another course". The tap goes through the same checked `talk_course` path. This is
   a button, not a word list.
2. **Fix the guess in the same message.** When the model's first round is only `talk_course`, code rebuilds the course block
   for the corrected course and runs the round again. Then the answer is written with the right material, not the next one.
   (One extra model round, only when the guess was wrong: 18 times in 900.)
3. **Shorter stickiness.** Make the 6 h a short gap (for example 45 to 90 minutes since the last answer in that course). After
   a long break, start with no course unless the message names one. A pure time rule, no words.
4. **Per-course recent talk.** When a course is in focus, fill the 5,000 characters as: the last 2 messages whatever they are
   (so "and that?" still works), then **older messages of the same course**. Other topics drop out first.
5. **Quizzes stop following you.** Show an open quiz question only for the course in focus, plus one short line elsewhere
   ("a Calculus quiz is half done"). Pause a full quiz after 24 h of no answer (it stays in the record and can be resumed;
   nothing is graded by the pause).

- **Page and phone:** the same chat, with a course chip on answers. Nothing to learn.
- **Big picture:** unchanged (same store, same summaries and brief).
- **Course things in the main talk:** unchanged.
- **CLAUDE.md rules:** ONE CONVERSATION kept. Core wish kept (time rules and a tap, no words). Refusal rules unchanged.
- **Size:** small (each item is a few dozen lines plus tests). Items 2 and 4 are the most valuable.
- **Risks:** a shorter window may sometimes drop a course you were still in (you name it once, or tap the chip). Item 2 costs
  one extra round when it fires.
- **Helps studying:** the tutor keeps the right course's work in sight during a long session. Old quizzes stop catching
  unrelated replies.

### Option B: a separate conversation per course (large)

**What it is:** a "Study rooms" list, one room (its own thread) per course, plus the main chat. A message in a room is always
that course (no guessing at all).

- **Page:** a side list (PC) or a top drop-down (phone): "Main", "Calculus 2", "Systems Programming"... Each room has its own
  history, input box and unread dot. Phone pushes say which room.
- **Big picture:** the records, notes, parts and exam plans are already per course, so every room and the main chat read the
  same ones. The daily summary must read **all** rooms. The brief stays in Main. `search_memory` must search all rooms.
- **Course things in Main:** the brain in Main still sees all courses (as today) and can answer a quick course question
  there. It can add a link "continue in the Calculus room". In a room, the brain sees a 2-line note of what is new in Main
  (a deadline, a reminder you set).
- **CLAUDE.md rules:** **replaces ONE CONVERSATION** (day files per room, queue per room). Core wish: a room is a place, not
  a mode chosen by words, so it fits. But it is close to the "modes" you did not want: Bot behaves differently depending on
  where you are. Refusal rules: unchanged, but every route and test must be checked again for the room id.
- **Size:** large (thread-store, jobs, server routes, page, phone, summary, search, the Moodle watch's messages, pushes,
  self-edit preview fake API).
- **Risks:** you must pick the room first, and on the phone that is a tap before every new topic. Work gets split ("I asked
  it in Main, the room does not know"). There are two places to look for one answer. It is also the most code to keep in step
  with every future feature.
- **Helps studying:** a clean room per course is calm. It is also the easiest place to show a "where we stopped" header.

### Option C: study sessions inside the one thread (medium)

**What it is:** one timeline, but focused **sessions**. A session starts when Bot starts teaching or a quiz in a course
(`teach_next`, `quiz`, `exam_plan` work), or when you tap "Study Calculus" on its card. It ends after a quiet gap (for
example 45 min) or when the brain calls `talk_course` with another course or "none".

- **Page:** the session is a band in the chat with a header ("Calculus 2, lecture 5, started 18:10") that folds up when it
  ends, into one line: "Calculus 2: 40 min, parts 5.2 and 5.3 worked on, quiz 2/3". Phone: the same band, folded by default
  when old.
- **Big picture:** at the end, **code** writes the session recap from facts it already has (`parts_done` marks, quiz
  grades, `teach_next` chunks, time). No model is needed and nothing is invented. The recaps feed the daily summary, the brief
  ("yesterday: Calculus 40 min, left at 5.4") and the next session's opening line.
- **Course things in the main talk:** everything outside a session is the normal thread. While a session is open, a side
  question is answered normally and does not end the session unless the brain says it changed course.
- **CLAUDE.md rules:** ONE CONVERSATION kept (one store, one timeline). Core wish: starting is a tool or a tap, ending is
  time or the brain's checked `talk_course`, so no words are parsed. Refusal rules unchanged.
- **Size:** medium (a session record per course, the band on the page, the code recap, the context uses the session's
  messages first, as in Option A item 4).
- **Risks:** where a session starts and ends can feel arbitrary. A session left open by mistake has the same problem as
  today's sticky guess (the quiet gap limits it).
- **Helps studying:** this one helps the most with the **learning**: a clear "what I did and where I stopped" after every
  sitting, and a start line next time ("last time you stopped at the arctan example, page 12. Continue?").

### Option D: one store, course views (medium) — RECOMMENDED

**What it is:** the thread stays **one store** (one timeline, one memory). The page gets a **view** per course: the same
messages, filtered to that course, with its own input box. A message typed in a course view is **that course, by place**, the
way a file sent with a message is already filed (`attached.courseId` wins over the guess in `handle()`). In the main view,
messages work as today (with Option A's fixes).

- **Page (PC):** the chat has a row of course tabs on top: "All", "Calculus 2", "SP", "HPSP", "Algorithms". "All" is today's
  thread. In it, a run of course messages can fold into one line ("12 messages in Calculus 2 · open"). A course tab shows
  only that course's messages, plus a small header from code: where you are (position and parts left), the open quiz, the
  next deadline, and "where we stopped". The Courses tab cards get a "Study here" button that opens the course tab, instead of
  `tellBot` sending you to the general chat.
- **Phone:** the same tabs as a drop-down at the top of the chat. Pushes and the share target go to "All" (they stay as
  they are).
- **Big picture:** nothing to build. One store means the daily summary, the brief, `search_memory`, the Moodle watch and
  pacing all keep working as they are. The brain in a course view still gets the whole "Omri's courses in Bot" block,
  the calendar and the exam plans, so it can still say "your SP assignment is due tomorrow" in a Calculus session.
- **Course things in the main talk:** "All" behaves as today. The brain can still answer course questions there, file them
  under a course (they then appear in that course's view too) and suggest "open the Calculus tab". Bot's own course messages
  (a Moodle check, a nudge) can appear in both "All" and the course view.
- **Context:** in a course view the recent talk is that course's messages (it can reach further back than today's 5,000
  characters of mixed talk), plus the newest 1 or 2 messages from "All" so a reminder you just set is not lost.
- **CLAUDE.md rules:** ONE CONVERSATION **kept as a store** and changed as a page ("one thread, several views"). That is a
  rule change you would have to approve. Core wish kept: the course comes from **where you typed**, never from your words.
  The guess (`focusCourse`) is only used in "All". Refusal rules unchanged, because the course view only sets the course,
  like `attached` does today.
- **Size:** medium. Store: a filter by `courseId` (a page of the store, never the whole thread). Server: a `course` field on
  `POST` to the thread, checked to be a real course. Brain: `focus = viewCourse || filedIn || focusCourse(...)` and a
  per-course history. Page: tabs, a filter and the header (data the Study card already loads). Plus tests.
- **Risks:** a message in "All" can still be guessed wrong (Option A covers that). You may write a Calculus question in the SP
  tab. The brain can still call `talk_course` there, and code should then show the answer in both views and say so. The
  fold-up in "All" needs care so the timeline stays readable.
- **Why I recommend it:**
  - It removes the guess where it matters most, during real study, without asking you to pick a room for everything else.
  - It costs much less than B, because the memory, summaries, brief and search are untouched.
  - It answers "messy in my head" directly: a tab per course shows only that course.
  - It can grow into C later. The course header is already the start of the "where we stopped" line.

### Option E: a study agenda per course (small to medium, can be added to A, C or D)

**What it is:** this option is about studying better, not about the layout. Code keeps a short list of **open loops** per
course: an open quiz question, a check question Bot asked and you did not answer, the lecture parts NOT YET of the lecture
you are on, unticked exam-plan items for today, and a formula you got wrong twice. These come from the records Bot already
has. Nothing comes from a model, and code writes every line.

- **Page:** shown at the top of the course card, the course view (D) or the session band (C): "Open: 1 quiz question, 2 parts
  of lecture 5, today's plan item 'series exercises'".
- **Big picture:** the morning brief's study line picks from these loops (still one nudge a day, the same quiet rules). The
  brain gets the list for the course in focus instead of the whole open-quiz-in-every-course block.
- **Main talk:** when you write in the main thread after a long study break, the brain may mention **one** open loop in one
  line, if it fits (the same style as the exam-plan line in the prompt today).
- **CLAUDE.md rules:** none changed. It uses the existing "Understood only from a graded quiz" and "worked on is not
  understood" rules.
- **Size:** small to medium.
- **Risks:** it can nag. Keep it to the existing nudge limits, and never in a class or in quiet hours.

### Side by side

| | A fix the thread | B rooms per course | C sessions | D course views | E agenda |
|---|---|---|---|---|---|
| Stops wrong-course answers | mostly | fully (in rooms) | inside sessions | fully (in views) | no |
| Stops mixed recent talk | mostly | fully | inside sessions | fully (in views) | no |
| Changes ONE CONVERSATION | no | replaces it | no | store kept, page changed | no |
| Big picture work needed | none | a lot | small (recap) | none | none |
| Helps learning itself | a little | a little | a lot | some | a lot |
| Size | small | large | medium | medium | small-medium |

**Suggested order:** A (items 2, 4 and 5 first) → D → E inside D's course header → maybe C's session recap later. This is a
proposal only. You pick, and the planning happens later in plan mode.

---

## 4. Details for the planning session

- **Course guess:** `brain.js` `focusCourse` (named course, then the quoted answer, then the newest `courseId` in the history
  under `FOCUS_MS`, stopped by `noCourse`). `handle()`: `focus = route === "general" ? null : filedIn || focusCourse(...)`.
  A view course would slot in front of `filedIn`.
- **`talk_course`:** `brain.js` around line 602. It is in `DOING` and `UNSAID` (never said back to you). It writes `ctx.course`
  / `ctx.noCourse`, and `courseOf()` stores it on the answer.
- **History:** `thread-context.js` `buildHistory` (`RECENT_CHARS` 5000, `FULL_TURNS` 3, `OLD_ANSWER_CHARS` 500,
  `MAX_MESSAGE_CHARS` 2000, `SCAN_MESSAGES` 80, notes 2,400, the pinned newest calendar card). Then `history.js`
  `historyBlock` (12,000 total, 3,000 per message). Entries already carry `courseId`, `noCourse` and `at`, so a per-course
  filter needs no new data.
- **Course block caps:** `LIMITS` in `brain.js`: assignment 24,000, notes 10,000, fileList 4,000, note 300 (4 per course),
  tool result 14,000, course_read 30,000.
- **Open quiz:** `tutor.js` `open`, `stale`, `CHECK_TTL_MS` (6 h, only `fromTeach`), `openQuestion`. It is shown for every
  course in `coursesText`.
- **Study card waiting:** `coach.pendingProposal()` (the newest one, global). One line in every prompt.
- **Thread store:** `thread-store.js`. A message has `topic` = "general" | "calendar" | "study" | "course:<id>" (a field from
  the old front desk, still written. In the data, 1,170 of 2,111 are "general"). The brain's answers carry `result.courseId`.
  A per-course view can filter on `result.courseId`, and for your own messages on the answer that replied to them (`replyTo`).
- **Page:** `public/index.html`: chat view, `studyView` (files per course), the Courses cards (`courseCard`, `tellBot`,
  `GET /api/study`).
- **Related open work:** t30 to t36 (Study card shows what the brain knows; one shared course-state function) from
  `experiments/2026-11-24-study-tracking.md` (branch `claude/study-tracking-research-b1b888`, not merged). Option D's course
  header should reuse that one shared course-state function (t34) instead of a third copy.
- **How the counts were made:** a throwaway Node one-liner over `data/thread/*.jsonl` that read only `at`, `role`, `topic`,
  `result.courseId`, `result.noCourse`, `result.brain`, `result.tools` and the code-written `log` lines. No message text was
  read or printed.
