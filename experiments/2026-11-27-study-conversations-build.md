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
