# Bot (FirstAttemptAssistant)

A small local Node.js app (no packages, no build step) that sends tasks to Claude and Gemini, and holds Omri's
calendar, courses, study coach and phone page. Start it with `start-web.cmd` (or `node server.js`), open http://localhost:3000.
Run all checks with `node --test` (about 1000 tests, about 45 s; they find the `tests/` folder by themselves).

## Where things are
| Folder / file | What it is |
|---|---|
| `server.js`, `start-web.cmd` | the web server and the double-click starter. Protected from Improve Bot. |
| `core.js`, `frontdesk.js`, `router.js`, `router-brief*.md`, `planner.js`, `providers.js`, `jobs.js` | how a message is routed to a model and answered |
| `calendar*.js`, `reminders.js`, `morning.js` | Google Calendar, reminders, the morning brief |
| `courses.js`, `course-routes.js`, `study*.js`, `tutor.js`, `catchup.js`, `standing.js`, `outline.js`, `position-record.js` | courses, notebooks and the study coach |
| `study-chat.js`, `study-brief.md` | the study chat: one big-context call for assignment and study talk (edit `study-brief.md` to change how it behaves) |
| `linkfetch.js` | download a file or GitHub repo from a link Omri typed (safe fetch: https, public addresses, size limits); filed by `course-routes.js` |
| `thread*.js`, `unzip.js`, `zip-filing.js`, `upload.js`, `office.js`, `pdfcut.js`, `photo.js` | the one conversation, file and zip upload, reading files |
| `selfedit.js`, `preview.js`, `pagesandbox.js`, `gitops.js`, `improve-watch.js` | Improve Bot (self edit) and its safety checks |
| `backup.js`, `auth.js`, `store.js`, `quota.js`, `webpush.js`, `warmagy.js` | backup, login, chat storage, quota, phone pushes, the pre-warmed `agy` |
| `public/` | the web page and phone app (plain HTML/JS, `index.html`, `study.js`, `sw.js`) |
| `tests/` | all tests (`*.test.js`) and the test helper `testzip.js` |
| `experiments/` | one-off measurements: notes (`*.md`, dated) and the scripts that produced them. See `experiments/README.md` |
| `qa/` | QA reports |
| `tools/` | small helper scripts (icons, power settings) |
| `bot.js` | the command-line front end (`node bot.js "task"`) |

## Notes to read after a break
1. `CLAUDE.md` - the agreed rules and design (the long list is the project's memory of decisions).
2. End of `PROGRESS.md` - newest work. `HANDOFF.md` - how the manager chat works.
3. `experiments/2026-11-08-cleanup-progress.md` - what the November cleanup moved and why.
4. `experiments/2026-11-08-react-verdict.md` - should Bot be rewritten in React?

`PRIVACY.md` and `calendar-setup.md` stay in the root on purpose: the Google consent screen links to `PRIVACY.md`, and Bot tells you to open `calendar-setup.md`.
