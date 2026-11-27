# Course tabs: what was built (2026-11-27)

The research is `2026-11-27-study-conversations-research.md`. Omri chose option D, "one store, course views", with the course
messages kept in their own tab. The plan (revision 2) was approved in plan mode, after the manager session's review. Built on
branch `claude/study-research-51056e`: one commit per step, not merged, not pushed. Bot was not restarted and no model was
called.

## What Omri sees

- **Tabs:** a row above the chat with **Main** and one tab per course (it scrolls sideways on the phone).
  - A dot marks a tab with new messages.
  - The open tab is remembered on that device.
  - A push opens the tab its answer is in.
- **Course header:** where you are, the next deadline, and "A quiz question is open" or "The quiz is paused". It comes from
  the same data as the Study cards.
- **Typing in a tab:** the message is about that course. A file sent there is filed in that course.
- **The Study cards' buttons** open the course's tab, not Main.
- **The "Add to <course>?" card:** under a Main answer, shown only when that message itself named the course, replied to a
  marked course answer, or made a course tool run. It shows the question shortened, and three choices:
  - **Add**: copies the question and the answer into the tab;
  - **another course** from the list;
  - **No**.
- **Moodle checks** stay in Main. Each linked course's part is also copied into its tab, so "download them" works there.

## How it works (for the next session)

| Step | Commit | What |
|---|---|---|
| 1 | ad17762 | `thread-store.js`: `place` ("course:<id>") and `copyOf` / `copyKind` on messages. `page({ place })` reads one tab, looking back at most 60 days for a course tab. `places()` gives the newest time per tab. `server.js`: `tabPlace()` checks a tab is a real course in `/api/ask`, `GET /api/thread?place=`, `/api/thread/places` and uploads. Copies are skipped by `recall.js`, `course-work.js`, `thread-summary.js` and the restart check. |
| 2 | ea26363 | `jobs.js` keeps the question, the answer, the ack line and the push in the tab. `buildHistory({ place })` builds the recent talk from that tab only. `brain.js`: in a tab, `ctx.tab` is the course, `talk_course` changes nothing, and the prompt line "Omri is writing in the X tab" is added. `workCourseId` records a side question's real course. `FOCUS_MS` is 90 min. `sw.js` opens the push's tab. `refusal-rules.test.js` runs every row again inside a tab. |
| 3 | ed24ef9 | `public/index.html`: the tab row, per-tab loading and sending, unread dots, the course header and `tellBot` opening the tab. `preview.js` has sample tabs. |
| 5 | 4157e0f | `namedCourse()` and `CARD_TOOLS` in `brain.js` set `result.courseCard` (evidence only). `POST /api/thread/:id/to-course` copies the question and the answer: Main answers of the last 7 days only, a real course only, once per course. |
| 4 | 4642597 | `tab-today.js` and `coach.brainTools.todayRecord` build "Today in the course tabs" in Main's prompt only: active minutes (gaps under 20 min), parts by topic, quiz score or paused, lessons, plan ticks. At most 800 characters. |
| 6 | 138fad0 | `moodle-watch.js` copies each linked course's block into its tab, with `copyKind: "moodle"`, the same data markers and no extra push. |
| 7 | 05cccd6 | The daily summary labels tab lines "[Calculus 2 tab]" and skips copies. Its input is 36,000 characters, with Omri's messages kept whole first. |
| 8 | d4da29b | `tutor.js` `pausedQuiz`: a full quiz with no answer for 24 h is paused (not open, not graded) and picked up again by the quiz tool. Only the course in focus shows its open question word for word. `study_status`, the Study data and the today line say "the quiz is paused". |

## Small differences from the plan

- **No extra Moodle post in the tab's recent talk.** Step 2's "add the newest Main post about this course" was left out,
  because step 6's Moodle copies already put it in the tab.
- **No brief nudge in the course header.** The nudge stays in the morning brief in Main. The header shows where you are, the
  deadline and the quiz.
- **The remembered tab** is kept in browser storage, not in the Back history. Back still works for the views.
- **The old one-time welcome notice** ("Bot is now one conversation") was not reworded.

## How it was checked

- **Tests:** `node --test` passes: 1,699 tests, 1 skipped (1,585 before).
  - Most of the new ones are in `tests/course-tabs.test.js`.
  - New rows were added to `refusal-rules.test.js`, `moodle-watch.test.js` and `thread-files-fix.test.js`.
- **Browser:** checked with the preview's sample data on a local page, at PC width and at 375 px:
  - the tab row and the dots;
  - the remembered tab;
  - the course header ("The quiz is paused");
  - the Add card under a Main answer.
- **Not checked:** the real Bot. It needs a merge, a restart through the scheduled task, and a few real messages (the quota
  guard first).

## Answer time with and without the tabs (live, 2026-11-27)

Omri asked for this, as its own step after the build passed its tests. Script: `experiments/2026-11-27-tabs-timing.js`. Raw
results: `experiments/2026-11-27-tabs-timing-results.json`.

**What was compared**
- **Before:** main's code (11ca643), the one conversation. It differs from this branch's start only in Moodle files and two
  lines of the brief.
- **After:** this branch's code.
- **The road:** the real one, `jobs.startThread` → `buildHistory` → `brain.handle` → agy. The model is Neon low, the brain's
  first model, started fresh for every message (no warm spare) in both arms.
- **The data:** an invented thread in a temp folder. A Databases study talk, then a pasta question, then an Algorithms side
  talk most recently. All within the last 40 minutes.
- **The two questions:**
  - "course": "Which normal form does the assignment ask me to reach?" It does not name the course.
  - "chat": "Explain in two sentences what a hash table is."
- **How it ran:** each arm 3 times, one call at a time, with the order flipped every round. The quota guard was checked
  before every call; the run spent 3 of its 7.2 points.

| question | arm | runs | median s | min-max s | model calls | first prompt (chars) | median tokens | right | filed under |
|---|---|---|---|---|---|---|---|---|---|
| course | before (one thread) | 3 | 12.8 | 11.9-14.0 | 2 | 37,995 | 24,600 | 3/3 | Databases |
| course | after, in the course TAB | 3 | **6.6** | 5.9-6.6 | **1** | 37,578 | **12,009** | 3/3 | Databases |
| course | after, in MAIN | 3 | 13.1 | 12.8-13.3 | 2 | 34,342 | 23,007 | 3/3 | Databases |
| chat | before (one thread) | 3 | 6.1 | 5.5-6.7 | 1 | 38,346 | 12,065 | 3/3 | Algorithms (wrong) |
| chat | after, in MAIN | 3 | 6.1 | 5.4-6.1 | 1 | 34,334 | 11,112 | 3/3 | no course |

**What it shows**
- **A course question in its tab is about twice as fast and costs half the tokens: 6.6 s instead of 12.8 s.**
  - Before, Bot's guess put the most recent course (Algorithms) in focus, so the first prompt carried the wrong material. The
    model needed a second round to look up the Databases assignment.
  - In the tab, the right course's assignment is already in the first prompt, so one call answers.
- **The same question in Main takes as long as before (13.1 s).**
  - Main no longer sees the tab talk, so no course is in focus. The model looks the assignment up itself (2 calls).
  - It still finds the right course and answers right.
  - So course questions are fastest in their tab. In Main they cost what they cost before.
- **An everyday question in Main is as fast as before (6.1 s), with about 8% fewer tokens.**
  - The prompt is 4,000 characters smaller: no Algorithms material and no study talk.
  - It is no longer filed under Algorithms.
- **Every answer was right (15/15).** Timing jumps by about ±1 s between runs, so only the 2x for the tab is a clear
  difference.
