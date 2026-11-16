# Code review of the guard files (2026-11-16)

Branch `claude/fable-code-review-0be442`, built on the real-use audit branch. Nothing pushed, Bot not restarted, the main folder and
`data/` only read. No real chat text or course text is in this note or in the commits.

**Two parts.** Part 1 (16 Nov, sections 1 to 6) stopped at about 70% of the quota window. Part 2 (17 Nov, section 7) read almost
all the rest and fixed what it found. Section 5 now lists the few files still unread. Part 2 started by taking in `main` (the
audit's work and the manager's fixes), with all tests green.

## 1. What I read

In full: `pc-open.js`, `pc-find.js`, `linkfetch.js`, `link-batch.js`, `unzip.js`, `upload.js`, `zip-filing.js`, `selfedit.js`,
`project-folder.js`, `auth.js`, `store.js`, `gitops.js`, `preview.js`, `server.js`, `providers.js`, `pdfcut.js`, `photo.js`,
`html-text.js`, `office.js`, `ingest.js`, `courses.js`, `moodle-ws.js`, `moodle-bridge.js`, `profile.js`, `calendar-add.js`, and two
parts of `brain.js` (the PC tools; how the prompt and the tool rounds are built).

Read and found sound (nothing to fix): the server's request checks (`server.js`), the phone login (`auth.js`), pushing to GitHub
(`gitops.js`), the Improve Bot preview (`preview.js`), the upload and zip limits, the link fetcher's redirect and address checks,
the Moodle token road (the token stays in the request body, only Moodle's own file addresses, read functions only), the extension
bridge, the memory's secret check and the calendar card checks.

## 2. What I fixed (2 commits, tests green: 1,127 tests, 1,126 pass, 1 skipped as before)

### `d319ae3` PDFs that "cannot be cut" (the 8-minute wait from the audit)

- **What was wrong:** `pdfcut.js` gave up on every PDF that uses "object streams" (a newer way to pack a PDF; Word, LaTeX and most
  slide tools write it). Such a file was then sent whole to the model, one slow call after another. I counted the real course files
  (read-only): **11 of 29 PDFs** could not be cut, among them the 76-page and the 81-page ones.
- **The fix:** an object stream is now unpacked (Node's built-in zlib, at most 20 MB per stream and 100 MB in all) and its objects are
  treated like normal ones. Anything packed in an unusual way still returns "cannot cut", so the old whole-file road stays as the
  fallback. No package was added.
- **How I checked it:** all 29 real PDFs now open; the page count of every one equals what the models had reported; and I drew the
  first page of 11 cut files with pdf.js (a PDF reader that runs in the browser) in strict mode: all 11 drew, with their text and
  fonts. An 81-page file is now read as 9 small pieces, 3 at a time, instead of 5 whole-file calls in a row.
- Tests: `tests/pdfcut.test.js` (3 new: a packed PDF is cut; damaged, lying and "zip bomb" streams are refused; a newer copy wins).

### `16d0246` Four safety fixes

1. **Short Windows names walked around two rules** (`pc-open.js`, `project-folder.js`). Windows keeps a second, short name for many
   files: `QUARTE~1.DOC` for `quarterly report.docm`. Bot judged the type on the name it was given, so through the short name
   - a macro file (`.docm`, `.xlsm`, `.pptm`; refused on purpose) opened as a normal document, and
   - a file Bot must never read (`credentials...`, `.env`) could be read from a linked folder, because its short name does not hold
     the word the rule looks for.
   I confirmed both on this PC before fixing. Now Windows itself is asked for the full real name first. The WSL folder behaves the
   same as before (checked read-only).
2. **Improve Bot with Argon could run its own file** (`selfedit.js`, protected: one check ADDED, none weakened). Argon may only write
   under `public/`. But the checks run the tests, and Node's test runner runs every file called `*.test.js` wherever it lies. So a
   file `public/x.test.js` passed "only under public/" and was then executed on the PC, before Omri saw anything. Now such a file is
   refused before the tests run, and the tests are not run on that change at all.
3. **IPv6 addresses** (`linkfetch.js`): a few odd forms (the old `::127.0.0.1` spelling, `100::`) counted as "public". Now only the
   real public range (2000::/3) passes. Low risk before, but the rule says "public addresses only".
4. **Zip file types** (`unzip.js`): four patterns had a dot that meant "any letter", so a file named `ahtml` counted as a web page.

Tests: `tests/code-review-2026-11-16.test.js` (7 tests; the short-name ones create a real file and ask Windows for its short name).

## 3. Found, NOT fixed (and why)

1. **Opening the linked folder fails when the folder is in WSL.** `open_on_pc` with a linked folder goes through `pc-open.js`, which
   accepts only `C:\...` paths. One of the two linked folders is a `\\wsl.localhost\...` path, so "open the folder in VS Code" is
   refused for that course. Allowing WSL paths changes a written safety rule ("no network paths"), so it is question 1 below.
2. **The editor's own tests run before approval (Claude editor).** By design the Claude editor may add tests, and the checks run
   them. So code a model wrote runs on the PC before Omri approves. This is how "the tests must pass" works; it is only worth knowing.
   Question 2.
3. **Tokens per tool round, and the wasted round on photos** (from the audit). Not touched: both are in `brain.js` (protected), and a
   safe fix needs live model calls to measure that answers stay right. No quota for that today. One number that helps whoever does
   it: in `data/token-log.json` only 2 to 5% of the input tokens are "cache read" (16 Nov, Hydrogen: 22,000 of 785,000). So the
   prompt that is sent again in every tool round is paid in full each time; nothing is saved by the model's own cache. Leaving the
   course material (assignment text, best pages, the code files) out of round 2 and 3 would save roughly a third to a half of those
   rounds, but only a trial can show that the answers stay as good.
4. **A long prompt on the command line.** `askAgy`, `askAgyWithFile`, `askWeb` and `askAgyStructured` in `providers.js` pass the whole
   prompt as a command-line argument. Windows allows about 32,000 characters there; a longer prompt would fail to start. The brain
   uses the stdin road, so it is not affected. I did not check which callers can reach the limit.
5. **An Improve Bot run cut off by a restart leaves its private copy behind** (a folder in the temp folder and a branch
   `selfedit/<id>`): the record is marked failed but nothing is cleaned. Harmless, it only piles up.
6. **Small ones:** an approved Improve Bot change is always committed as "Co-Authored-By: Claude Sonnet", also when Argon or Opus
   wrote it; `ingest.js` cuts every PDF piece twice (once only to measure its size); a folder whose name holds a comma may open the
   wrong Explorer window (not tested).

## 4. Questions for Omri (with my recommendation)

1. **Let `open_on_pc` open things inside WSL?** *Recommendation:* yes, but narrow: only a `\\wsl.localhost\<distro>\...` path that is
   a course's linked folder or a file inside it, only folders and text/code files (they open in VS Code or Explorer), never a
   document type there. It needs one line changed in the rules of CLAUDE.md ("only plain local paths").
2. **Is it fine that the Claude editor's new tests run before you approve?** *Recommendation:* keep it (without it "the tests pass"
   means nothing), and keep Argon strict as it now is. A stronger wall (running the tests inside a sandbox) is a big job.
3. **Finish the review?** *Recommendation:* yes, in a fresh session with a normal model. Section 5 is its list.

## 5. Still not reviewed (after part 2)

- `public/index.html` (3,543 lines) and `public/study.js`: NOT read line by line. I searched both for every way a page can turn
  text into code or a link (`innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, links built from text): none is used. The
  page draws everything with `textContent`, so text from a model or from Moodle stays text. The Hebrew words of the Study tab
  were read and fixed.
- `study.js` in the root and the bottom two thirds of `moodle.js`: code that no page reaches any more (CLAUDE.md says both are
  kept on purpose and wait for Omri's decision), so I spent no quota on them.
- `standing.js`, `position-record.js`, `history.js`: small helpers, not read.
- `brain.js` beyond the PC tools and the study tools, `jobs.js`, `thread-context.js`, `brief-me.js`, `moodle-watch.js`: the audit
  session's files (it read them; `brief-me.js` and `moodle-watch.js` I was asked to keep away from).

## 6. How to check after the merge (needs a restart of Bot)

1. Upload a lecture PDF made by Word or LaTeX (or press Retry on one). The log (`data/bot.log`) should no longer say "cannot be cut",
   and the page count should climb in steps of 10 with three pieces at once.
2. Nothing else changes in daily use: the other fixes only close doors.

## 7. Part 2 (2026-11-17): the rest of the files

Read in full: the Moodle extension (`moodle-extension/`), `backup.js`, `webpush.js`, `calendar.js`, `calendar-chat.js`,
`reminders.js`, `router.js`, `quota.js`, `morning.js`, `news.js`, `moodle-tools.js`, `moodle-token.js`, `course-routes.js`,
`thread-store.js`, `thread-files.js`, `thread-summary.js`, `study-coach.js`, `study-tracker.js`, `study-plan.js`,
`study-nudges.js`, `study-page.js`, `tutor.js`, `catchup.js`, `outline.js`, `recall.js`, `search.js`, `course-material.js`,
`crosslang.js`, `warmagy.js`, `improve-watch.js`, `public/sw.js`, and the small helpers `botlog.js`, `due-date.js`, `lang.js`,
`progress-log.js`, `suggestion-filter.js`, `tokenlog.js`, `quote.js`.

Found sound, nothing to fix: the calendar (no delete or change function exists; only the two calls it needs), the Google login,
phone push (only real push services are ever contacted), reminders, the backup's encryption and restore checks, the news reader
(headlines can never fake a marker), the Moodle token script (the password is never stored or printed), the course routes, the
thread store (nothing is ever dropped; the trash is not reachable by a model), the quota and pacing rules, the page's service
worker, and the Improve Bot watcher.

### What I fixed (4 code commits; tests: 1,146, of them 1,145 pass and 1 is skipped as before)

**`8380336` Hebrew written by code used the masculine "you".** CLAUDE.md says code-written Hebrew uses no gendered "you". Three
places still did: the questions on the Study page ("איפה אתה", "ספר לי", "שלח"), the Confirm cards for links and Moodle files
("שתלחץ"), and the page's own Hebrew words (the Study tab and the first-open notice). All are now neutral ("אפשר לכתוב לי...",
"לפני לחיצה על אישור"). One old test expected the masculine words; it now expects the neutral ones.

**`70d1252` Quiz: a real answer could be taken for a request.** The tutor looked for words inside Omri's answer. An honest
answer that held the word "reveal" was SHOWN THE ANSWER AND MARKED WRONG; one that held "stuck" or "hint" got a hint that counts
against the grade. This is exactly the kind of word list the core wish forbids. Now the brain's `quiz_answer` tool says what the
reply is: `"ask": "answer" | "hint" | "show" | "skip"` (a closed list; code drops anything else), and the tutor follows that
without looking at the words. If the model leaves "ask" out, the old way still runs, so nothing can get worse.
`brain.js` (a protected file) changed by one line: the tool hands the checked value on. `brain-brief.md` got the new field.
NOT tried with a live model (no quota for trials): see "How to check" below.

**`f7aadc7` Four small ones.**
1. *Moodle extension:* a file address was accepted when it only STARTED like one. An address with `..` in it would have been
   fetched as another Moodle page, outside the list of pages Bot may open. Low risk (only a GET, and Moodle needs a session key
   for actions), but the rule is "only these pages". Now the address is parsed first and judged on what the browser would really
   request. **The extension must be reloaded once in Chrome** (chrome://extensions, the round arrow on "Bot Moodle reader").
2. *Daily summary:* a message (or web text inside one of Bot's answers) could hold the word `</transcript>` and so look like
   text outside the data block the summary model reads. The marker words are now taken out. Facts were already safe (each needs
   a word-for-word quote from Omri's own message); this closes the door fully.
3. *A file sent in the chat:* the Hebrew reply always said the course was picked "by the file name or the message", also when it
   was picked because a class was on right now, or by Omri's own tap. It now says the real reason.
4. *Backup:* a new copy that fails its read-back check stayed in the folder, counted as one of the newest five, and the next
   good backup would have deleted a good old copy to keep it. A failed copy is now removed.

**`60acf18` Dead code.** The study coach still held word lists of the old front desk ("today", "week", "2 hours a day", an exam
date reader, a follow-up question). Nothing had reached them since the brain. Removed; behaviour is unchanged.

Tests for all of it: `tests/code-review-2026-11-17.test.js` (10 tests, made-up data).

### Found, NOT fixed (and why)

1. **"no" still undoes a stored course position through a word list** (`study-coach.js`, `NO_ONLY` / `UNDO_ONLY`). When Bot
   stored where Omri stands and Omri then answers a study card with exactly "no", code undoes the position instead of only
   cancelling the card. Bot's own readback tells Omri 'Say "no" to undo', and tests pin it, so it is an agreed feature, not a
   bug. But it is a word list on Omri's words. Question 4.
2. **"I will not write the full solution" is added by a word list** (`SOLUTION_ASK` in `study-coach.js`), in a quiz turn when
   Omri's message holds words like "full solution". Harmless text, but the same kind of list. Part of question 4.
3. **The tutor's old word lists stay as the fallback** (`SHOW`, `HINT`, `SKIP` in `tutor.js`) for when the model sends no "ask".
   They can be deleted once a live check shows the brain always sends it.
4. **Assignment or lecture?** After a chat upload, `study-coach.js` decides by words in the FILE text ("assignment", "due",
   "תרגיל"...) whether to propose an assignment card or a lecture card. It reads the file, not Omri, and ends in a Confirm
   card, so I left it.
5. **Moodle "already downloaded"** (`moodle-tools.js`): an item is marked as downloaded also when Bot refused the file (too big,
   an unsupported type). So the list can say "[already downloaded]" for a file that is not in the course. Probably on purpose
   (so "download the new ones" does not retry it for ever), but the label is not exact.
6. **Small ones:** phone push follows a redirect of the push service (they never send one); a failed backup write can leave a
   `.tmp` file in the synced folder; `calendar.js` alone accepts "30 February" (the card check in `calendar-add.js` refuses it
   first, so nothing reaches Google); `catchup.parseBudget` is now unused; the header comment of `news.js` still says "model text
   never reaches the brief" although the short summaries do (checked by code against the headline's own words).

### Questions for Omri (part 2)

4. **Move the last word lists of the study coach to the brain?** ("no" = undo, "full solution"). *Recommendation:* yes, as one
   small job with a live check: the brain already has `study_undo`; the readback line would say "say undo" and the brief would
   tell the model that "no, that's wrong" right after a stored position means `study_undo`. Not done now because it changes what
   Bot tells Omri and needs a trial with the real model.
5. **Delete the unreachable course-chat code** (`study.js` in the root, `crosslang.js`, `courseRoutes.answer`)? CLAUDE.md says it
   waits for your decision. *Recommendation:* delete it in a quiet week; about 500 lines nobody can reach, and each review has
   to step around it. `tutor.js` still uses a few small helpers from `study.js`, so they would move, not vanish.

### Lines suggested for CLAUDE.md (I did not edit it)

- In STUDY COACH, after "Never give an assignment's solution...": *"A reply to an open quiz question: the brain's quiz_answer
  says what it is ("ask": answer, hint, show, skip; a closed list checked by code). The tutor never looks for those words inside
  Omri's answer (2026-11-17); its old word lists only run when "ask" is missing."*
- In MOODLE, at the extension's allowlist: *"A pluginfile.php address is judged after it is parsed (no `..`, Moodle's own host,
  no session key)."*

### How to check after the merge (part 2)

1. Reload the extension in Chrome (see above). Then any Moodle read or download that goes through Chrome should work as before.
2. Quiz: ask for a quiz, then answer one question with a real sentence that holds the word "stuck" or "hint". It must be GRADED.
   Then write "give me a hint": a hint must come. In `data/bot.log` the line `[brain] tool quiz_answer` shows the call; if hints
   stop working, the model is not sending "ask" and the brief line needs clearer words (the old way is still there, so this
   cannot be worse than before).
3. Open the Study page with Hebrew on: the questions should read "איפה עומדים בקורס...".
