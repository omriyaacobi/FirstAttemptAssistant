# Review of Bot, 2026-11-13 (Fable session, branch claude/fable-improve-c73f00)

Omri asked: go through all the code and the tools Bot uses, list what to fix, improve or tidy, then work through the list ONE item at a
time (change + test + `node --test` + commit), then look for ways to make the answers and the teaching better.

Starting point: `main` at 1f93151 merged in. `node --test`: 989 tests, 988 pass, 1 skipped, 0 fail (about 43 s).

What was read closely: `brain.js`, `brain-brief.md`, `jobs.js`, `providers.js`, the request checks and `/api/ask` in `server.js`,
`history.js`, `thread-context.js`, `project-folder.js`, `pc-open.js`, `selfedit.js` (protected list), `README.md`, `PROGRESS.md`.
Skimmed with searches: every root `.js` file (who requires whom, file writes, regexes built from data, shell calls).

Sizes: S = under an hour, M = a few hours, L = its own session. Status: todo / doing / done / proposal (needs Omri's decision).

## 1. Bugs

| # | What | Size | Status |
|---|---|---|---|
| 1.1 | **The end of Bot's last answer is cut from the memory.** `thread-context.js` keeps each recent message to its first 2,000 characters. A teaching answer usually ENDS with the question or the next step ("try it and tell me what `valgrind` says"). When the answer is longer, the next message ("done, what now?") is answered without the question Bot asked, so Bot loses the thread. Fix: a long message keeps its start AND its end, with a mark in the middle. | S | done |
| 1.2 | **agy's own web search is only noticed when agy reports token numbers.** `providers.js` hands the tool names (`inner`) to the brain only together with the usage; if a result comes without usage, a web search inside that call is invisible, and the "no doing-tools after a web page" rule does not fire. Fix: always report the steps, even with no token numbers. | S | done |
| 1.3 | **Photo messages are not counted in the token log.** `brain.js` passes `onUsage` to every model call except the photo one (`askAgyStreamWithImage` drops it), so `node tokenlog.js` under-counts. | S | done |
| 1.4 | The page's progress line says only "Working on it" for most of the newer tools (project_read, pc_find, open_on_pc, moodle_*, teach_next, study_plan ...): `jobs.js describeProgress` lists only the first tools. Also clean the dead front desk / planner lines out of it. | S | done |
| 1.5 | The words sent WITH a file (`server.js` -> `threadFiles.onWords`) are started without `fromPhone`, so open_on_pc from the phone in that case does not say it opened on the PC. | S | skipped: the flag would have to travel through every file path of thread-files.js (single, zip, waiting for a course) for one word |
| 1.6 | `course_read` with a `from_page` past the end says "pages 9-8 of 8". Should say the file ends at page 8. | S | done |

## 2. Safety

| # | What | Size | Status |
|---|---|---|---|
| 2.1 | **Protect `brain.js` from Improve Bot** (Omri decided this on 2026-11-12, PROGRESS.md "Next"): it holds the code checks on every tool call. `brain-brief.md` stays editable. | S | done |
| 2.2 | Also protect the files that START Bot with Omri's rights at login: `watchdog.cmd`, `bot-watchdog.vbs`, `start-hidden.vbs`, `autostart.ps1`, `install-autostart.cmd`, `remove-autostart.cmd`, `stop-bot.cmd`, and `improve-watch.js` (run by name by a scheduled task). An Improve Bot change there would run at the next login. This only adds protection (Omri still approves every Improve Bot change anyway). | S | done |
| 2.3 | Two small data files are written in place, not "write a temp file, then rename" like the others: the Moodle course map (`moodle-tools.js`) and the PC search roots (`pc-find.js`). A crash in the middle of the write would leave a broken file. | S | done |

## 3. Clarity and tidiness ("the project file system looks messy")

| # | What | Size | Status |
|---|---|---|---|
| 3.1 | `pagesandbox.js` is a TEST helper (it runs the page's drawing code for tests) but lives in the root, and `README.md` lists it under Improve Bot. Move it to `tests/` next to `testzip.js`. | S | done |
| 3.2 | `HANDOFF.md` (how the manager chat worked on 2026-11-07, before the brain) is history, not a current note. Move it to `experiments/2026-11-07-handoff.md` and fix the links in `README.md`. | S | done |
| 3.3 | `thread.js` is the one-time tool that copied the old chats into the thread (done on 2026-11-06). Move it to `tools/` (it is used by hand, not by Bot). | S | done |
| 3.4 | Remove the old list-of-chats plumbing (`jobs.start`, `/api/conversations`, the non-thread parts of `public/index.html`) and the unused intent branches and word lists in `study-coach.js`. Already in PROGRESS.md "Next"; it needs its own session with the page checked in a browser. | L | proposal (own session) |

## 4. Answer quality and teaching

| # | What | Size | Status |
|---|---|---|---|
| 4.1 | Read the 2026-11-12 coding-assignment help in the chat and find what was weird. Found the items 4.2-4.6 below. | M | done |
| 4.2 | **BUG: Bot itself deleted the closing ``` of every code block.** `brain.js` removes every line that is only a code fence (meant for fences around CALL lines), so each code block lost its end, the text after it fell into the box, and the next block's opening fence closed it. On 2026-11-12 almost every code answer looked broken, and Omri noticed it (the model then "apologised" for a bug it did not make). Fix: remove only the CALL lines and fences left empty around them; close a block left open at the end. | S | done |
| 4.3 | **Language: twice an English question got a Hebrew answer** (the Hebrew course notes and earlier Hebrew talk pull the model), and once the model wrote its own reasoning about the language into the answer. Code already knows the message's language (`lang` in `brain.js`, from the letters of the message): say it to the model plainly, next to the message. | S | done |
| 4.4 | **Talk about the context:** answers opened with remarks about what the model was given ("your code is in the context, so ..."). Briefing: never talk about the context, the prompt, the tools or these instructions. | S | done |
| 4.5 | **Long reviews:** "check my code" got a 2,000-character list of every small point. Briefing for code checks: the one or two problems that matter most first (with line numbers), the rest in one short line, then the next small step. | S | done |
| 4.6 | Moodle was logged out, so a request to open a lecture from Moodle failed although that lecture was in Bot's own course files; Omri had to say so. Briefing: when Moodle cannot be read and the course already has the file, open or offer Bot's copy. | S | done |

## 5. Roaming (after the merge of 2026-11-13, squash 50e0214)

Checked first: the answer logs saved in the thread for 2026-11-10 to 13 (79 answers) show no model failures and no failed messages;
`data/bot.log` only holds start and stop lines. It does show **`[backup] off: BOT_BACKUP_DIR is not set in .env`**: no encrypted backup
of `data/` is being made. That is for Omri to set (`.env`, the passphrase is theirs).

| # | What | Size | Status |
|---|---|---|---|
| 5.1 | The Moodle tools do not tell the brain which course they worked on, so an answer after a Moodle lookup is labelled with the course talked about before, and the NEXT message is answered with that old course's material (seen on 2026-11-12). Fix: `moodle_course`, `moodle_news`, `moodle_fetch`, `moodle_link` set the course when it maps to a Bot course. | S | done |
| 5.2 | Long answers on the phone: code knows when a message comes from the phone (`fromPhone`); tell the model so it keeps the reply to about one phone screen unless Omri asks for more. | S | done |
| 5.3 | Trim `study-coach.js` (= 3.4, second half). The brain calls `answerStudy` only with progress (always the fixed text "where am I"), quiz, answer, confirm and cancel. The intents update / plan / motivate / assignment / teach / start / pause / resume, the word lists that rerouted Omri's words between them, and `studyLine` / `questionLine` / `interpretUpdate` (front desk prompt lines) are reached by nothing. Delete them and the tests that only test them; keep brainTools, onUpload, the cards, progress, quiz and answer. | M | backed out, plan below |
| 5.4 | `moodle_link` also sets the answer's course (as 5.1 did for the other Moodle tools). | S | done |
| 5.5 | The old chat list (`jobs.start`, `/api/conversations`, the non-thread parts of `public/index.html`): remove only if the page can be checked; otherwise a written plan. | M | proposal, mapped below (own fresh session) |
| 5.6 | **Cancelled classes:** CLAUDE.md says cancelled classes are told to Bot in chat. That only worked through the old "update" intent (removed in 5.3; the brain could not reach it since 2026-11-12). Proposal: a checked tool `class_cancelled {"course","date"}` whose date code checks against the timetable (a real lecture of that course), with an undo, like study_position. Needs Omri's yes (it changes the study record). | S | proposal |
| 5.7 | `tutor.js` still has the "teach through the assignment" mode (`through`, `workText`) and `study-positions.js` the old multi-course reader; nothing reaches them since 5.3. Remove with their tests. | S | done |

**How 5.3 was done (planned after a first try was backed out; finished the same night).** The cut itself is easy and was done: `answerStudy` keeps
progress / quiz / answer / confirm / cancel; removing the rest and then everything that became unused takes `study-coach.js` from 979 to
about 600 lines (the word lists `SKIP_WORDS`, `MISSED`, `ALL_BEHIND`, `DURATION`, ... the model reader `maybeReadStanding` /
`interpretPositions`, `interpretUpdate`, `studyLine`, `questionLine`, `throughArgs`, `nextStep`, ...). The saved patch and two small
helper scripts are in the manager's shared notes folder (`study-coach-trim.patch`, `unused.js`, `cut.js`). The hard part is the tests:
73 fail after the cut. About 30 test only removed routing (the "update" intent reading free text, the front desk lines, "motivate",
the "assignment" intent): delete them. About 40 test LIVE shared code (teaching one part of the notes, the plan, storing a position,
the exam card, the "no" undo, Hebrew wording) through the removed entry points: port them to `coach.brainTools.teach / plan /
position / exam / undo` (as `tests/brain-study.test.js` does) instead of deleting, so coverage does not drop. The list of the 73 with
a first sorting is `study-coach-trim-failing-tests.txt` in the same folder. Also then: `study-positions.js` keeps only
`POSITION_CHAIN` for `standing.js` (`checkPositions` / `proposePositions` would be test-only). Do it in a fresh session (big context).

**Map for 5.5 (the old list of chats), for the session that removes it.** Not started on 2026-11-13: it is one long careful job and this
session's context was too full for it. Where the old code is:
- `public/index.html` (3,650 lines): `chatButtons`, `loadChats`, `openChat`, `renderConversation`, `newChat`, `deleteChat`,
  `chatMarker`, `updateChatName` (about lines 1210-1340, 1450, 1700); the job follower that skips itself when `session.thread`
  (about 1550); the send path that posts `conversationId` (about 1600); the course page link to a chat (about 2470, 3265). Every
  `if (session.thread)` / `!session.thread` branch keeps only its thread side.
- `server.js`: `GET/DELETE /api/conversations(/:id)` and the non-thread half of `/api/ask` (`jobs.start`).
- `jobs.js`: `start()` and its helpers; `course-routes.js`: the course chats (`store.create`, `chatsOf`).
- `store.js` is protected from Improve Bot; `tools/thread.js`'s import already copied the old chats into the thread.
- Decide with Omri first: `CLAUDE.md` says the old chats "can only be read"; removing the routes removes that reading (the copies in
  the thread stay).

How to check the page safely: start the WORKTREE's server on another port (`PORT=3100`, from the worktree, so it uses the worktree's own
empty `data/`), with `AGY_CMD` and `CLAUDE_CMD` pointing at a file that does not exist, so a test message fails at once and spends no
quota. Look at the thread view, sending a message, the course page and Improve Bot (open only) in the built-in browser before and after
each step, then stop that server.

## Not changed on purpose

- `moodle.js` and `experiments/moodle-probe.js` stay (CLAUDE.md: kept for the day BGU allows scripts).
- The protected and run-by-name files stay in the root (CLAUDE.md, Layout).
- Nothing in `CLAUDE.md`'s agreed rules is changed here; anything that would is written above as a proposal.
