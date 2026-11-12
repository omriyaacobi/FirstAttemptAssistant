# Bot (FirstAttemptAssistant)

A small local Node.js app (no packages, no build step): Omri's personal assistant. ONE conversation, answered by "the brain": one model
(Gemini through `agy`, or Claude) that reads every message with a toolbox for courses, calendar, reminders, links, Moodle and studying.
Start it with `start-web.cmd` (or `node server.js`), open http://localhost:3000.
Run all checks with `node --test` (about 940 tests, about 45 s; they find the `tests/` folder by themselves).

How a message is answered: `server.js` (route `/api/ask`) -> `jobs.js` (one job per message) -> `brain.js` (builds the context, asks the
model, checks and runs the tools it asks for) -> the answer is saved in the thread (`thread-store.js`) and shown by `public/index.html`.

## Where things are
| Folder / file | What it is |
|---|---|
| `server.js`, `start-web.cmd` | the web server and the double-click starter. Protected from Improve Bot. |
| `start-hidden.vbs`, `stop-bot.cmd`, `watchdog.cmd`, `bot-watchdog.vbs`, `autostart.ps1`, `install-autostart.cmd`, `remove-autostart.cmd` | running Bot in the background with no window: start, stop, and the scheduled task "Bot" that starts it at login and restarts it every 5 minutes if it stopped or hung (see `experiments/2026-11-12-always-up.md`) |
| `brain.js`, `brain-brief.md` | THE BRAIN: the one way Bot answers. To change how Bot behaves, edit `brain-brief.md` (plain English) or add a checked tool in `brain.js` |
| `history.js`, `thread-context.js`, `course-material.js`, `project-folder.js` | what code hands the brain with each message: the recent talk, the course's assignment and best pages, the linked code folder (read-only) |
| `pc-find.js`, `pc-open.js` | PC hands: find folders and files by name under the search roots, and open pages (Chrome), documents, code (VS Code) and folders; never programs |
| `jobs.js`, `providers.js`, `router.js`, `quota.js`, `warmagy.js` | one job per message; running `agy` and `claude`; the models and their quota pools; the pre-warmed `agy` |
| `tokenlog.js` | what the answers cost in tokens, per day and per model (`data/token-log.json`, numbers only). `node tokenlog.js` prints the last 7 days |
| `calendar*.js`, `reminders.js`, `morning.js`, `profile.js`, `recall.js` | Google Calendar (cards), reminders, the morning brief, the profile and saved facts, search in earlier talk |
| `courses.js`, `course-routes.js`, `study.js`, `ingest.js`, `crosslang.js`, `search.js` | courses, reading their files, the course page's own question box |
| `study-coach.js`, `study-plan.js`, `study-tracker.js`, `study-nudges.js`, `study-page.js`, `study-positions.js`, `tutor.js`, `catchup.js`, `standing.js`, `outline.js`, `position-record.js` | the study coach: timetable, progress, graded quiz, teaching from the notes, where Omri stands, nudges (the brain reaches it through tools) |
| `linkfetch.js`, `link-batch.js` | download or just read a link Omri typed, or the links inside a file of the course (safe fetch: https, public addresses, size limits); a list is shown first and fetched after one Confirm |
| `moodle-bridge.js`, `moodle-tools.js`, `moodle-extension/`, `moodle.js` | read-only BGU Moodle through Omri's own logged-in Chrome: the extension takes read jobs from Bot's waiting list (`/api/moodle/next`), the brain's `moodle_*` tools use them. `moodle.js` is a direct Node client that BGU's edge blocks (kept, unused) |
| `thread*.js`, `unzip.js`, `zip-filing.js`, `upload.js`, `office.js`, `pdfcut.js`, `photo.js` | the one conversation, file and zip upload, reading files |
| `selfedit.js`, `preview.js`, `pagesandbox.js`, `gitops.js`, `improve-watch.js` | Improve Bot (self edit) and its safety checks |
| `backup.js`, `auth.js`, `store.js`, `webpush.js`, `botlog.js` | backup, login, storage of the old chats and course chats, phone pushes, the log file `data/bot.log` |
| `public/` | the web page and phone app (plain HTML/JS, `index.html`, `study.js`, `sw.js`) |
| `tests/` | all tests (`*.test.js`) and the test helper `testzip.js` |
| `experiments/` | one-off measurements: notes (`*.md`, dated) and the scripts that produced them. See `experiments/README.md` |
| `qa/` | QA reports |
| `tools/` | small helper scripts (icons, power settings) |

## Notes to read after a break
1. `CLAUDE.md` - the agreed rules and design (my decisions; the Bot design part was rewritten 2026-11-12).
2. `PROGRESS.md` - where things stand and what is next (short). The full history: `experiments/progress-history-until-2026-11-12.md`. `HANDOFF.md` - how the manager chat worked (written 2026-11-07, before the brain).
3. `experiments/2026-11-08-cleanup-progress.md` - what the November cleanup moved and why.
4. `experiments/2026-11-08-react-verdict.md` - should Bot be rewritten in React?

`PRIVACY.md` and `calendar-setup.md` stay in the root on purpose: the Google consent screen links to `PRIVACY.md`, and Bot tells you to open `calendar-setup.md`.
