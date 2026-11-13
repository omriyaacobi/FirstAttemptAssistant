# Progress

Short on purpose. The full history up to 2026-11-12 (every step, branch and measurement since day one) is in
`experiments/progress-history-until-2026-11-12.md`. The agreed rules are in `CLAUDE.md`. The file map is in `README.md`.

## Where things stand (2026-11-12)

- **Bot is one conversation answered by the brain.** One model (Argon low, then Claude Sonnet low inside agy, then Claude Code Sonnet) reads
  every message with a toolbox (`brain.js`, briefing `brain-brief.md`). I accepted the Fable rebuild of 2026-11-10 and made it permanent:
  the old front desk, planner, `core.js`, the study chat mode, the `bot.js` command line and the switches `BOT_THREAD` / `BOT_BRAIN` are deleted.
- **To change how Bot behaves: edit `brain-brief.md`** (plain English), or add a checked tool in `brain.js`. Never keyword lists on my words.
- **What the brain can do now:** answer, course material (search, read, files), my linked code folder, calendar (read; add through a card),
  reminders, memory (cards), links (read, save one, save a file's list through one Confirm), Moodle through Chrome (read, news, download),
  photos (Argon first), files sent with a message (filed by code, my words answered by the brain), and the study coach as tools:
  quiz, plan across courses, teach the next part, where I stand (with undo), exam date (card), pause / resume the study reminders.
- **When every model fails** Bot says so honestly and tries nothing else.
- **Quota (branch `claude/vigilant-aryabhata-2bf780`, 2026-11-12, NOT merged yet):** one everyday message costs about 40% fewer
  tokens than before (about 33,000 -> 20,000 on Argon), so each pool gives about 1.65 times the messages. A token is the unit
  models count text in; the pools charge by tokens. What does it: the brain's `agy` calls run under a slim agent (only web
  search, no shell or browser descriptions), the recent talk and the linked code folder are sent smaller, the two agy pools
  are paced over the week, and the daily summary asks Flash first. Every answer's log line now ends with its model calls and
  tokens, and `node tokenlog.js` prints tokens per message per day. Quick actions (a reminder) no longer wait behind long
  answers. Full numbers, open points and how to check: `experiments/2026-11-12-quota-max.md` section 7.
- **PC hands (2026-11-12, branch claude/pc-hands-e816e7):** Bot can find my folders and files by name (`pc_find`, `pc_list`, roots via
  `pc_roots`) and open things on the PC (`open_on_pc`: pages in Chrome, Moodle pages, course files, found files and folders; never programs).
  A found folder is linked to a course with one Confirm tap. The rules are in `CLAUDE.md` (PC HANDS).
- **Tests:** `node --test` (about 1,000 tests, about 45 s). All pass.
- **Going back:** the tag `before-fable-2026-11-10` is the code before the brain; the commit before this cleanup is `c3162c5`. Both are on GitHub.

## Folders for course files (2026-11-13, branch claude/zip-folders-721aaa)

- Files from a zip now keep the folder they sat in as a label (`mission2/README.pdf`), so Bot can find "the README inside mission2".
  Moodle downloads keep their section ("Week 3", "Week 3/Lab files"). Single uploads and chat files have no folder.
  It is display text only: files are still stored by random id. Details and what was tested: `experiments/2026-11-13-zip-folders.md`.
- Ask Bot "put lecture1 and lecture2 in a Lectures folder" or "rename the folder op to Assignment 1": the brain tool `file_folder`
  changes only the labels (checked by code, never after a web page or photo).
- Hebrew names in zips made on a Mac (no UTF-8 flag) are no longer garbled.
- Proposed, not built: group the page's file list by folder, move files from the page. See the note.
- **To do once after the merge:** upload the assignment zip again (chat or course page). No second copy is made; the summary says
  "I added folder names to N files you already had".

## Morning newspaper (2026-11-13, branch claude/morning-brief-27f031, NOT merged yet)

The morning brief is now a small newspaper. Choices and reasons: `experiments/2026-11-13-morning-brief-options.md` (option B).
- **When:** at the brief time (default now 08:30; set it in the page, the box must be ON) Bot fetches the news one last time and sends
  the brief right after, with a push that shows counts only. If I write to Bot between 05:00 and the brief time, my first message
  starts the brief at once; it arrives a little after the answer, and the timer does not send a second one.
- **News (`news.js`):** 9 fixed public feeds (Times of Israel, Ynetnews, Jerusalem Post; BBC, NPR, Guardian; BBC Technology,
  Ars Technica, The Verge), read by code every 3 hours while the brief is on (no tokens). Before the brief, ONE Gemini Flash high call
  picks by NUMBER: Israel at most 2 and only if big, world at most 2, tech at most 1 and only if very big. Code checks the numbers and
  prints the site's own headline and name. During the day, if a check finds a very big event, Bot posts "Big news" at once (at most
  2 a day; push without the headline; no push 22:00-08:00).
- **You (`brief-me.js`, `progress-log.js`):** code now writes my study day as it happens (graded quizzes, lessons, my notes,
  positions, assignments, exam dates, cancelled classes; `data/study/progress/`). The brief gives Flash high a numbered ledger of
  yesterday + what is due + held lectures not checked; every line it writes must cite the ledger, and code drops a line with an
  invented number or an "understood" without a passed graded quiz. If Flash fails, code writes the ledger itself.
- **Safety:** headlines are data inside `<news-data>` markers (also in the brain's memory), never facts, out of recall and the daily
  summary, and nothing can act on them. Only the Flash pool is used (Omri agreed); never Argon or Claude.
- **To try after the merge:** turn the morning brief on in the page and set 08:30; "Show me one now" makes one at once (it uses the
  news pile). The log lines start with `[news]` and `[brief]` in `data/bot.log`.
- **Measured live 2026-11-13 (2 runs, real feeds, made-up ledger):** the news pick by Flash high took about 3.5 minutes and about
  39,000 tokens (28,000 of them thinking); by Flash medium about 50 s. The "You" call timed out on Flash high twice (90 s, then 4 min)
  and Flash medium wrote 3 checked lines. So with high first the brief arrives around 08:35, not 08:32. Open: Omri decides high or medium first. Links are in the alerts, not in the brief
  (to keep it one screen).

## Review of 2026-11-13 (branch claude/fable-improve-c73f00, NOT merged yet)

The full list with sizes and status: `experiments/2026-11-13-fable-review.md`. The main finds:
- **Code answers looked broken because of Bot, not the model:** the brain deleted the closing ``` of every code block. Fixed.
- English questions are no longer answered in Hebrew: code tells the model the message's language. The briefing now says how to
  check code (main problems first with line numbers, hints in steps), never to talk about "the context", and to use Bot's own copy
  of a file when Moodle is logged out.
- Bot's memory keeps the END of a long recent answer too (the question Bot asked last was being cut off).
- agy's own web search is noticed even without token numbers; photo messages are in the token log; clearer progress lines.
- Improve Bot can no longer change `brain.js`, the starter and watchdog files or `improve-watch.js`.
- Tidy: `pagesandbox.js` -> `tests/`, `HANDOFF.md` -> `experiments/2026-11-07-handoff.md`, `thread.js` -> `tools/`.
- The old list of chats is removed (page, routes, `jobs.start`) and `study-coach.js` is trimmed; see Next for what is left.

## What the 2026-11-12 cleanup did (branch claude/brain-permanent-3257b5)

1. Fixed real bugs in the brain: a lost "slow slot" when every model failed (later messages could wait forever), "wait for files" not
   working with the brain, a message shown as failed after it partly worked, a folder path checked too loosely, quiz calls dropping other calls.
2. Photos and the words sent with an uploaded file now go through the brain.
3. The study flows the brain could not reach became checked tools (see above).
4. Deleted the old path (about 5,000 lines with its tests) and the two switches.
5. Rewrote `CLAUDE.md` (Bot design), this file and the `README.md` map.

## Next (not started)

- **The old list of chats is removed (2026-11-13).** Gone: the chat list, opening / deleting / starting chats and the course chat bar in
  `public/index.html` and `public/study.js`, the routes `/api/conversations`, the chat half of `/api/ask`, and `jobs.start`. The old
  chats stay on disk in `data/conversations/` (nothing deletes them) and Bot's memory search still finds them; no page opens them.
  **Left, each needs my yes** (list in `experiments/2026-11-13-fable-review.md`, "After 5.5"): the course question answering code that
  only course chats used (`courseRoutes.answer`, root `study.js`, `crosslang.js`) is now reached by nothing; `morning.js` still has a
  branch for a Bot without the conversation; `CLAUDE.md` still describes the old state in three places.
- **`study-coach.js` trimmed (2026-11-13):** the front desk's intents and word lists are gone (979 -> about 610 lines); tests of what
  is still used now go through `brainTools`. Telling Bot that a class was cancelled ("no lecture this week") only
  worked through the old intents; since 2026-11-13 the brain has the checked tool `class_cancelled` for it (item 5.6 in
  `experiments/2026-11-13-fable-review.md`), with undo.
- **Two things the brain changed that I should decide on:** (1) the model that sees my profile can also search the web (before, web
  models never got the profile); (2) every message now takes one of the 2 slots, so a reminder can wait behind two long answers.
- **Moodle, smarter (asked 2026-11-11, when there is quota):** a quiet morning check for new announcements, files and deadlines (offered,
  never downloaded silently); deadlines offered as calendar events or reminders; assignment pages read in full; lecture videos (Kaltura,
  captions not checked); the coach using Moodle's sections to know the week. Read-only, no keep-alive, tools and the briefing only.
- The morning brief and the study nudges are still code-written English text.
- Other chains still use Flash (the course page's own question box, the daily summary, the reader's fallback).

## To do by me (Omri)

- Quota work: decide the three open points in `experiments/2026-11-12-quota-max.md` 7.3 (a reserve that shrinks as the week
  ends; counting agy's own web search as "a web page was read"; the odd agy Sonnet reading), and say whether the proposed
  `CLAUDE.md` text in 7.5 goes in. After a few days, run `node tokenlog.js` to see the real tokens per message.

- After a merge that changes the starter files: double-click `install-autostart.cmd` once (if "access denied": Run as administrator).
- Windows: Settings -> Accounts -> Sign-in options -> "Use my sign-in info to automatically finish setting up after an update".
- Phone: Tailscale Always-on VPN + battery Unrestricted (steps in `experiments/2026-11-12-always-up.md`).
- Moodle: Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> the folder `moodle-extension`. Keep Chrome open and logged in
  to Moodle; when Moodle logs me out (about an hour idle), Bot says so and I log in again.
- Make Chrome the Windows default browser myself: Settings -> Apps -> Default apps -> Google Chrome -> Set default (Bot uses Chrome anyway).
- To let Bot search `C:Assingnemt` too, write in chat: "also search C:Assingnemt" (a new root needs its full path in my own message).
- After the PC-hands merge, try once: "open the last lecture of Calculus 2" and "find my SP assignment folder and link it", to see the windows open while Bot runs hidden.
- A leftover test copy of Bot may still run on port 3100; `stop-bot.cmd` stops every `node server.js`.

## Remember

- First place to look when Bot is down or odd: the end of `data/bot.log`.
- Where the quota goes: `node tokenlog.js` (tokens per day, per model, per message). `MSYS_NO_PATHCONV=1 agy -p "/usage"` in
  Git Bash shows the pools. Scripts that spend quota to test the brain are in `experiments/` (`quota-max-brain-run.js`).
- `BOT_BRAIN_FIRST=claude` in `.env` (then restart) makes the brain ask Claude Code Sonnet (the Pro plan) first, for a few hours
  when the agy pools are low. Delete the line and restart to go back. The 15% rule still moves Claude to the end near the limit.
- Start: the scheduled task "Bot" (hidden, at login) or `start-web.cmd`. Stop: `stop-bot.cmd`. Restart: the button on the page.
- Claude Pro tokens work through Claude Code (`claude` CLI); a separate Anthropic API key would be billed separately.
- Gemini route is the Antigravity CLI (`agy`); the old Gemini CLI stopped serving personal accounts on 2026-06-18.
- Never put keys in code; `.env` is git-ignored. `data/` never goes to GitHub; its encrypted backup goes to the cloud-synced folder.
- The Claude CLI lives in `C:\Users\User\npm-global` and is called by full path.
- Before a long break: read `CLAUDE.md`, this file, then `README.md`.
