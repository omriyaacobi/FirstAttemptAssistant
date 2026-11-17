# Moodle actions: what Bot may do after reading Moodle (2026-11-17)

## Why

In chat, Omri said "open it for me from the moodle" (the Mission 3 README of a course). The brain called `moodle_course` and then
`open_on_pc {"course","file"}`, and code refused the open. The reason: in `brain.js`, `afterWeb()` refuses every instant
doing-tool once Moodle text was read in the same message (`ctx.sawMoodle`). Bot then told Omri to send a second message.
Omri asked for Bot to be able to act on Moodle when asked, and accepted some loss of safety for it.

## What "act on Moodle" can mean (smallest first) and Omri's answer for each

| # | Item | Added risk | Omri's answer |
|---|------|------------|---------------|
| a | After a Moodle read in the same message, `open_on_pc` may open a **course file** (Bot's own copy) or the **linked folder** / a file inside it. Opening a Moodle item in Chrome was already allowed. | Text on a Moodle page could steer the model into opening one of Omri's own course files or folders in its normal app. Programs, scripts and unknown types are still refused by `pc-open.js`, so the worst case is an unwanted window. | **Allow** |
| b | After a Moodle read, other instant tools: `set_reminder` | A Moodle page could make Bot set a reminder nobody asked for. Code still checks that the time is real and in the future. The worst case is an unwanted ping. | **Allow** |
| b | `save_link` / `save_links` | A Moodle page could steer saving a link into a course. | **Not chosen** (still refused) |
| c | Actions that CHANGE Moodle (each as a Confirm card, token route only): mark an activity done, upload an assignment draft, post in a forum | Real changes on the university site. An upload can count as a submission, and a forum post is public to the course. | **None for now** (Moodle stays read-only) |

`moodle_fetch` (download) and `moodle_link` were already allowed after a Moodle read.

## What changed

- `brain.js`: `afterWeb(..., { moodleOk: true })` on `set_reminder`, `open_on_pc` with `linked`, and `open_on_pc` with `course` + `file`.
  - Still refused after a web page (also agy's own web search) and in a message with a photo.
  - Still refused after Moodle: `open_on_pc {"found"}` (a pc_find number), `{"url"}`, `course_note`, `study_position`, `working_on`, `file_folder`, `save_link(s)`, `link_folder`, `pc_roots`, `moodle_watch`, `study_pause/resume`, `study_undo`.
- `brain-brief.md`: one line. For "open X from Moodle", the model opens Bot's copy if the course has the file, and otherwise the Moodle item in Chrome, in the same message. It never sends Omri to "ask again".
- Tests:
  - `tests/brain-pc.test.js` has two new tests: open after `moodle_course` works for a course file and for the linked folder; a found number after Moodle and a course file after a web page are still refused.
  - `tests/moodle.test.js`: the reminder test flipped (a reminder is now set after a Moodle read), plus a new test that `course_note` is still refused.
- Full suite: 1140 tests, 1139 pass, 1 skipped, 0 fail.

## Rules NOT changed

- The token is never printed, logged, put in an address or committed.
- `READ_FUNCTIONS` is unchanged (all `_get_`).
- The extension's allowlist is unchanged.
- Moodle and web text stays DATA.
- Nothing changes Moodle.
- No `--dangerously-skip-permissions`.
- `selfedit.js` is untouched.

## Live check

Not done from this session. Bot must not be started from a side session's shell, and the running Bot serves `main`. To check after
the merge and restart, send Bot: "open the Mission 3 README from the moodle" (High-Performance Systems Programming S1).
The README should open on the PC in one message. This only reads Moodle; nothing on Moodle changes.

## Proposed CLAUDE.md lines (only on Omri's word)

In **RULES THAT STAY IN CODE**, replace the part "...(set_reminder, course_note, ... pc_roots; Moodle downloads and Moodle opens after a web page or photo) are refused in that message..." by adding after it:

> (2026-11-17, Omri's decision) After a MOODLE read only (not a web page, not a photo), three of them are allowed in the same message: open_on_pc for a course file or the linked folder (Moodle items already were), and set_reminder. Everything else on the list stays refused after Moodle text.

In **MOODLE**, add:

> (2026-11-17) "Open X from Moodle" works in one message: Bot's copy of the file if the course has it, otherwise the Moodle item in Chrome. Writing to Moodle (mark done, upload a draft, post) was offered and declined: Moodle stays read-only.
