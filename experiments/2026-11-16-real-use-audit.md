# Audit of Bot from real use (2026-11-16)

Branch `claude/fable-real-use-audit-78c38e`. Nothing pushed, Bot not restarted, the main folder and `data/` only read.
Examples in this note are made up or described in my own words; no real chat text is copied.

## 1. What I read

- The conversation, 2026-11-12 to 2026-11-16: about 170 of Omri's messages and Bot's answers (each answer's model, tools, seconds, tokens, log).
- `data/bot.log` (480 lines), `data/token-log.json`, `data/moodle-watch.json`, `data/study/` (positions, nudges, undo).
- Code read in full: `brain.js`, `brain-brief.md`, `jobs.js`, `thread-context.js`, `history.js`, `brief-me.js`, `study-nudges.js`,
  `standing.js`, `moodle-watch.js`, `quote.js`. Read in part: `providers.js`, `moodle-tools.js`, `study-coach.js`, `thread-summary.js`,
  `study-tracker.js`, `server.js` (the ask route and the watch wiring).
- **Not done:** the task asked for a review of ALL the code. The window went to the real-use reading and the fixes. Not reviewed this
  time: `selfedit.js`, `linkfetch.js`, `link-batch.js`, `unzip.js`, `upload.js`, `ingest.js`, `pdfcut.js`, `pc-open.js`, `pc-find.js`,
  `project-folder.js`, the calendar files, `reminders.js`, `profile.js`, `backup.js`, `auth.js`, `webpush.js`, `news.js`, `morning.js`,
  `catchup.js`, `tutor.js`, `outline.js`, `quota.js`, `router.js`, `moodle-ws.js`, `moodle-bridge.js`, the Moodle extension and almost all
  of `public/index.html`. The review of 2026-11-13 (`experiments/2026-11-13-fable-review.md`) covered many of them three days ago.

## 2. The numbers (5 days of real use)

- 293 model calls that worked: half took under 9 s, 95% under 18 s, the slowest 50 s. One call hung for 240 s.
- An answer cost 32,800 tokens on average: 21,300 without tools, 53,000 with tools. 36% of the answers used tools.
  (A token is the unit a model counts text in; the quota pools charge by tokens.)
- Bot understood the message almost every time. The tutoring itself (hints, one question at a time, reading the real code file,
  line numbers) worked well on every model. The problems were around it: wrong labels, wrong language, waiting, noise.

## 3. What I found, grouped

### A. Already fixed before today (checked that the fix is in the code)

| Seen in real use | Fixed by |
|---|---|
| Code blocks lost their closing fence (12 Nov) | review of 13 Nov |
| An English question answered in Hebrew (12 Nov) | the language line, 13 Nov |
| A reply to Bot's own question was graded as the answer to an old quiz question; Omri had to send it again (14 Nov) | `6e58520` |
| "Go through section N" taught a completely different part; a page of the model's notes to itself was shown (15 Nov) | `62b027a` |
| A saved web page opened in VS Code; the linked folder could not be opened in VS Code (15 Nov) | `be41ecc` and the .html rule |
| "Open the mission 2 readme" failed because several files had the same name (13 Nov) | folder labels, 13 Nov |

### B. Fixed today (6 commits, each with tests in `tests/real-use-2026-11-16.test.js`)

1. **`a8ac01d` Wrong language.** A message that was only a formula, a file name, or a photo sent without words got the line "this
   message is in English", so Bot switched to English in the middle of a Hebrew lesson (three times). Now the English line needs a
   real sentence (4+ Latin words) or a talk that was not Hebrew; a short Latin message after a Hebrew one gets a line that keeps
   Hebrew. Code counts letters and words; there is no word list. The page's own text for a photo without words is now
   `(photo only)` and the briefing says what it means.
2. **`0b642eb` Leaked notes, second kind.** One photo answer opened with the model quoting Bot's own instructions to itself. The guard
   of 15 Nov knew four markers and missed it. Now any 45-character run of the briefing inside a reply counts as a leak: the model is
   asked once more, exactly as before. Measured cost: 0.3 s spread over a very long streamed answer.
3. **`0b642eb` A hung model.** One answer took 283 s because the first model hung for 240 s before the next one was asked. A brain
   call through agy now gets 120 s (the slowest real call was 50 s). Reading big files keeps its long limit.
4. **`255b74c` Wrong course.** Code guesses the course from the last answers, and every answer inherited the guess. Seen: a whole
   calculus lesson filed under another course (that course's assignment text and code rode along in every prompt, about 8,000 extra
   tokens per message), a shopping question filed under a course, and a reply to a marked answer that waited 100 s for a file of a
   different course. Two changes: a reply to a marked part goes to the course of the marked answer; and a new checked tool
   `talk_course` lets the brain say "this talk is about course X" or "about no course". The model only names a course; code checks it
   is real. No extra model round. **Checked live** on Hydrogen medium with 3 made-up messages: 3 of 3 right, one call each.
5. **`d291336` Morning brief.** (a) The "You" lines were cut at 180 characters, so most mornings two or three stopped in the middle
   of a sentence. Limit 300, the model is asked for under 220, a longer line ends at a sentence or a word. (b) The same "lecture of
   <date> is not checked yet" nudge came on six mornings for a course Omri studies alone from the notes. The study report and the plan
   already left the lecture count out for a course Omri does not attend (the agreed rule); the brief and the nudge now do too.
6. **`c4c962a` Moodle watch.** Omri answered a watch message twice with "not needed for this course". Bot saved a note and said
   "noted", but the watch is code and never reads notes, so it would have kept posting. New checked tool
   `moodle_watch {course, files: on|off}`: for that course new files and folders are not posted; lecturers' messages, deadlines,
   assignments and quizzes still are. Refused after a web page, a photo or Moodle text, like every tool that acts at once.

`brain.js` is on the protected list of `selfedit.js` (Bot's own editor may not touch it). Fixes 1 to 4 and 6 needed it; they were
made here in Claude Code, which is what the rule expects. No check was weakened.

### C. Found, NOT fixed (and why)

1. **Tokens per tool round.** Every tool round sends the whole prompt again (about 25,000 to 33,000 tokens), so a message with three
   rounds costs 100,000. Idea: leave the up-front course material out of the later rounds. It needs measuring that answers stay
   right; no window left for that.
2. **Waiting for a file.** A lecture PDF took 8 minutes to read because it "cannot be cut" (9 such lines in the log), so the whole
   file goes to the model at once. Teaching `pdfcut.js` that PDF format (object streams) is its own task.
3. **Photos still cost a wasted round sometimes.** Argon writes a tool line for reading the photo instead of just looking (42 s and
   85,000 tokens once). The leak is hidden now; the cause is not fixed.
4. **agy's web search failed once** (a "find a shop near me" request under agy Sonnet). Bot said so honestly. Not investigated.
5. **One answer contradicted itself** (14 Nov): it had already saved notes and then offered "say save them". Wording only; not fixed.
6. **The end-of-day position review stored nothing on both days.** Checked: correct, the brain had already stored the same thing live.
7. **Restarts.** The log shows about 20 restarts in two days (exit code 75 = the Restart button, from merges). Normal, not a fault.

## 4. Questions for Omri (with my recommendation)

1. **"Not checked by a quiz" in the brief for courses you DO attend.** You asked "what quizzes?" and never use them. It still shows
   for three courses. *Recommendation:* show that line only for a course where you took at least one graded quiz; otherwise leave it
   out. I did not change it because the line was your choice on 13 Nov.
2. **Turn the file switch on for the course you meant.** A switch is set only by your own message. After the merge and a restart,
   tell Bot once that you do not want new files of that course. *Recommendation:* do it; it takes one message.
3. **The Moodle course that is not linked to a Bot course** posts long messages through the watch. The new switch works per Bot
   course, so it cannot mute that one. *Recommendation:* either link it to a new Bot course, or I add "the whole course off" to
   `moodle_watch` in a small follow-up.
4. **CLAUDE.md.** I did not edit it. It should get four short lines: the tools `talk_course` and `moodle_watch`, the 120-second
   limit of a brain call, and "no lecture count in the brief or nudge for a course I do not attend". *Recommendation:* the manager
   adds them when merging.
5. **The rest of the code review** (section 1 lists what was not read). *Recommendation:* a separate session with a normal model;
   the files that guard the PC and the web (`pc-open.js`, `linkfetch.js`, `unzip.js`, `selfedit.js`) first.

## 5. How to check after the merge (needs a restart of Bot)

1. In a Hebrew talk send only a formula. The reply stays in Hebrew.
2. Send a photo with no words after Bot asked something. Bot treats it as your answer, in the talk's language.
3. While working in one course ask an everyday question. The answer's label shows no course, and the next course message still works.
4. Tomorrow's brief: no line ends in the middle of a sentence, and no "lecture of ... is not checked" for the course you study alone.

Tests: `node --test`, 1,117 tests, 1,116 pass, 1 skipped (the same one as before), 0 fail.
