# 2026-11-19: what else Bot could read (research only, nothing built)

Asked by Omri: "see what other options we can add to Bot", as much (read) access as possible.
Method: `core_webservice_get_site_info` lists every function the BGU token may call (459 of them). Each
candidate below was then tried with ONE real read-only call through the `moodle-ws.js` client (token from
`.env`, never printed). Only names, counts and field names were looked at for this note; no real Moodle
content is written here (the repo is public).

Already read since this morning (branch moodle-read-items): pages, labels, assignments' text and dates,
links, books, file and folder descriptions (`moodle_read`).

## A warning first: "_get_" in the name is not enough

The test in `tests/moodle-ws.test.js` checks that every function on `READ_FUNCTIONS` contains `_get_`.
That is a good net but NOT a proof of read-only. Functions the token may call that have `_get_` in the
name but are not plain reads:

- `core_calendar_get_calendar_export_token`: hands out a secret calendar-export token.
- `core_files_get_unused_draft_itemid`: reserves a draft area (a first step of uploading).
- `mod_lti_get_tool_launch_data`: builds signed launch data for an external tool (acting as Omri there).
- `mod_quiz_get_attempt_data` on an attempt that is still open can move its current page.
- Every `*_view_*` function (for example `mod_page_view_page`) marks the item as viewed and can tick
  activity completion. Never add one.

So the list must stay a CLOSED list chosen by hand (as it is now), never a pattern.

## The options, most valuable first

R = a pure read: only new names on `READ_FUNCTIONS` + a brain lookup, no rule change.
D = needs Omri's decision (new kind of data, privacy, or a rule in CLAUDE.md changes).

| # | What | Function(s), answered with the token | Omri gets | R/D | Risk | Work |
|---|------|------|------|-----|------|------|
| 1 | My submission status | `mod_assign_get_submission_status` (OK) | "Did I submit HW2? Is it graded? Any feedback?" per assignment; the watch / brief can say "due in 2 days and NOT submitted" | R | low: own data only | small (one tool + one brief line; the brief part is medium) |
| 2 | Grades and feedback | `gradereport_overview_get_course_grades`, `gradereport_user_get_grade_items`, `gradereport_user_get_grades_table` (all OK) | every grade with the lecturer's feedback, per course and overall; "what did I get in quiz 3" | D | medium: grades are private; they would sit in Bot's data and the models' prompts (models see them). Decide: on request only, or also in the watch ("new grade") | small for on-request, medium for the watch |
| 3 | Notifications and Moodle messages | `message_popup_get_popup_notifications`, `core_message_get_messages`, `core_message_get_conversations`, `core_message_get_conversation_messages`, unread counts (all OK) | what Moodle told Omri (grading done, forum replies, deadline changes) and private messages from lecturers / TAs, without opening Moodle | D | medium: private messages from people are a new kind of data; reading them does NOT mark them read with these functions (keep it that way: never `core_message_mark_*`) | small-medium |
| 4 | Changes since a date | `core_course_get_updates_since` (OK) | a cheaper, exact "what changed in this course since last look" for the Moodle watch (instead of comparing whole snapshots); also catches edited pages and new grades | R | low | medium (the watch changes, its tests too) |
| 5 | Upcoming view of the Moodle calendar | `core_calendar_get_calendar_upcoming_view`, `core_calendar_get_action_events_by_courses`, `core_calendar_get_calendar_monthly_view` (all OK) | every Moodle deadline and event, also those of quizzes and forums, per course; can be offered as calendar cards (the normal Confirm card) | R (reading) / D (if it should propose calendar cards by itself) | low | small to read; medium for cards |
| 6 | Quizzes and my attempts | `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_user_attempts`, `mod_quiz_get_user_best_grade`, `mod_quiz_get_attempt_review` (all OK on a FINISHED attempt) | quiz open/close times and limits; my score; the review of a finished attempt (questions, my answers, marks) for the tutor to practise my mistakes | D for the review (it puts real quiz questions into the models' prompts; fine for studying, but say so); R for the times and grade | low for times; medium for the review | small for times; medium for the review in the tutor |
| 7 | Recently opened items | `block_recentlyaccesseditems_get_recent_items`, `core_course_get_recent_courses` (OK) | "where did I stop" signal: what Omri opened lately on Moodle; could feed WHERE I AM as a hint (never a position by itself) | D (it is a new source for the position rules) | low | small to read |
| 8 | Course people and contacts | `core_enrol_get_enrolled_users` (OK; gives names, emails, roles), `core_course_get_courses_by_field` `contacts` (OK; the lecturers) | "who is the TA of my group, what is their email" | D | medium: other students' names and emails. Suggest: only role = teacher/TA, and only on request | small |
| 9 | My groups | `core_group_get_course_user_groups` (OK) | which practice group Omri is in, so Bot knows which TA and which session time are Omri's | R | low | small |
| 10 | Forum list per course | `mod_forum_get_forums_by_courses` (OK) | all forums (not only announcements), with due dates of graded forums; `moodle_news` could read the Q&A forum too | R | low | small |
| 11 | Private files | `core_user_get_private_files_info`, `core_files_get_files` with filearea private (OK) | the files Omri keeps in "My private files"; could go through the normal download road | R | low | small-medium |
| 12 | Completion ticks | `core_completion_get_activities_completion_status` (answered, but empty for this course: completion seems off) | which items Moodle shows as done | R | low | small; low value at BGU right now |
| - | Site search | `core_search_get_results` | (BGU has Moodle's global search turned OFF: "search engine not enabled") | - | - | not possible |
| - | Zoom, questionnaire lists | `mod_zoom_get_zooms_by_courses`, `mod_questionnaire_*` | not offered to the token at BGU | - | - | not possible |
| - | Badges, blogs, comments, notes | answered or listed, little value | - | - | - | skip |

Not to add (they change Moodle or act as Omri), even though the token may call them: everything with
`_view_`, `save_`, `submit`, `mark`, `update`, `delete`, `create`, `send`, `start_attempt`,
`process_attempt`, `set_`, `subscribe`, and the four "_get_ but not a read" ones above.

## Beyond Moodle (from the code, briefly)

Bot's Google login (`calendar.js`) asks for `calendar.events` only, on purpose. Each item below is a NEW
scope and a new login tap, so each is D.

| What | Omri gets | Risk | Work |
|------|-----------|------|------|
| Gmail READ (`gmail.readonly`) | "did the TA answer my email", university mail about exams and room changes, in the brief | high: the whole mailbox becomes readable; mail text is untrusted data (prompt injection by email). Narrower: only mail from `@bgu.ac.il` / `@post.bgu.ac.il`, filtered by code | medium-large |
| Google Drive READ (`drive.readonly`, or better `drive.file` + a picker) | Omri's own notes and shared course folders as course files | medium: all of Drive readable with `drive.readonly` | medium |
| Google Tasks / Keep | to-do lists next to reminders | low | small-medium |
| BGU timetable / exam schedule site (bgu4u) | real exam dates and rooms instead of typed ones | medium: another login, no official API; scraping a login site breaks Omri's rule "never pretend to be a browser" | large; probably no |
| GitHub (Omri's own repos, read) | assignment repos next to the linked folder | low with a fine-grained read-only token | small-medium |

## Top 5 (suggested order)

1. Submission status (R): "submitted / not submitted / graded" per assignment, also in the brief.
2. Grades and feedback (D: on request only, or also "new grade" in the watch?).
3. Notifications and lecturer messages (D: private messages are new data; read without marking read).
4. `core_course_get_updates_since` for the Moodle watch (R).
5. The Moodle calendar's upcoming view, offered as normal calendar Confirm cards (read R; proposing cards D).
