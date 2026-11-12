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
- **Tests:** `node --test` (about 940 tests, about 45 s). All pass.
- **Going back:** the tag `before-fable-2026-11-10` is the code before the brain; the commit before this cleanup is `c3162c5`. Both are on GitHub.

## What the 2026-11-12 cleanup did (branch claude/brain-permanent-3257b5)

1. Fixed real bugs in the brain: a lost "slow slot" when every model failed (later messages could wait forever), "wait for files" not
   working with the brain, a message shown as failed after it partly worked, a folder path checked too loosely, quiz calls dropping other calls.
2. Photos and the words sent with an uploaded file now go through the brain.
3. The study flows the brain could not reach became checked tools (see above).
4. Deleted the old path (about 5,000 lines with its tests) and the two switches.
5. Rewrote `CLAUDE.md` (Bot design), this file and the `README.md` map.

## Next (not started)

- **Finish removing the old chat list.** The page (`public/index.html`) and the server still carry the old list-of-chats code
  (`jobs.start`, `/api/conversations`, the non-thread parts of the page). Nothing reaches it from chat; old chats can only be read.
  It needs its own session, with the page checked in a browser after every step.
- **Trim `study-coach.js`.** It still holds the intent branches and word lists (regexes) from the front desk days. The brain only calls
  `progress`, `quiz`, `answer`, `confirm`, `cancel` and the new `brainTools`. Remove the rest with its tests.
- **Two things the brain changed that I should decide on:** (1) the model that sees my profile can also search the web (before, web
  models never got the profile); (2) every message now takes one of the 2 slots, so a reminder can wait behind two long answers.
- **Protect `brain.js` from Improve Bot** (decided 2026-11-12, not urgent: Omri does not use Improve Bot until the quota work is
  done). Add it to `selfedit.js`'s protected list, because it holds the code checks on every tool call. `brain-brief.md` stays
  editable (that is how Bot is tuned).
- **Moodle, smarter (asked 2026-11-11, when there is quota):** a quiet morning check for new announcements, files and deadlines (offered,
  never downloaded silently); deadlines offered as calendar events or reminders; assignment pages read in full; lecture videos (Kaltura,
  captions not checked); the coach using Moodle's sections to know the week. Read-only, no keep-alive, tools and the briefing only.
- The morning brief and the study nudges are still code-written English text.
- Other chains still use Flash (the course page's own question box, the daily summary, the reader's fallback).

## To do by me (Omri)

- After a merge that changes the starter files: double-click `install-autostart.cmd` once (if "access denied": Run as administrator).
- Windows: Settings -> Accounts -> Sign-in options -> "Use my sign-in info to automatically finish setting up after an update".
- Phone: Tailscale Always-on VPN + battery Unrestricted (steps in `experiments/2026-11-12-always-up.md`).
- Moodle: Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> the folder `moodle-extension`. Keep Chrome open and logged in
  to Moodle; when Moodle logs me out (about an hour idle), Bot says so and I log in again.
- A leftover test copy of Bot may still run on port 3100; `stop-bot.cmd` stops every `node server.js`.

## Remember

- First place to look when Bot is down or odd: the end of `data/bot.log`.
- `BOT_BRAIN_FIRST=claude` in `.env` (then restart) makes the brain ask Claude Code Sonnet (the Pro plan) first, for a few hours
  when the agy pools are low. Delete the line and restart to go back. The 15% rule still moves Claude to the end near the limit.
- Start: the scheduled task "Bot" (hidden, at login) or `start-web.cmd`. Stop: `stop-bot.cmd`. Restart: the button on the page.
- Claude Pro tokens work through Claude Code (`claude` CLI); a separate Anthropic API key would be billed separately.
- Gemini route is the Antigravity CLI (`agy`); the old Gemini CLI stopped serving personal accounts on 2026-06-18.
- Never put keys in code; `.env` is git-ignored. `data/` never goes to GitHub; its encrypted backup goes to the cloud-synced folder.
- The Claude CLI lives in `C:\Users\User\npm-global` and is called by full path.
- Before a long break: read `CLAUDE.md`, this file, then `README.md`.
