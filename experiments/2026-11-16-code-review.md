# Code review of the guard files (2026-11-16)

Branch `claude/fable-code-review-0be442`, built on the real-use audit branch. Nothing pushed, Bot not restarted, the main folder and
`data/` only read. No real chat text or course text is in this note or in the commits.

**Not finished.** The 5-hour quota window (shared with the audit session) was about 70% used after this part, so I stopped at a clean
point. What was read and what was not is listed in section 1 and section 5.

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

## 5. Not reviewed yet

`brain.js` beyond the PC tools (the audit read it), `jobs.js` and the thread files (audit), and never read by either session:
`calendar.js`, `calendar-chat.js`, `reminders.js`, `backup.js`, `webpush.js`, `news.js`,
`morning.js`, `catchup.js`, `tutor.js`, `outline.js`, `quota.js`, `router.js`, `moodle-tools.js`,
`moodle.js`, `moodle-token.js`, the Moodle extension, `course-routes.js`, `thread-files.js`, `thread-store.js`, `thread-summary.js`,
`study.js`, `study-coach.js`, `study-tracker.js`, `study-plan.js`, `recall.js`, `search.js`, `course-material.js`, `warmagy.js`,
`crosslang.js`, `improve-watch.js`, the small helpers, and all of `public/` (`index.html`, `study.js`, `sw.js`).
Order I would take: the Moodle extension (`moodle-extension/`, its allowlist), `backup.js`, `webpush.js`, `calendar.js`,
`course-routes.js`, then `public/index.html` (how text from models and Moodle is drawn).

## 6. How to check after the merge (needs a restart of Bot)

1. Upload a lecture PDF made by Word or LaTeX (or press Retry on one). The log (`data/bot.log`) should no longer say "cannot be cut",
   and the page count should climb in steps of 10 with three pieces at once.
2. Nothing else changes in daily use: the other fixes only close doors.
