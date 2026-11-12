# experiments/

Finished one-off measurements. Nothing in Bot requires anything from this folder, so it is safe to ignore.
- `YYYY-MM-DD-*.md`: the written results (what was tried, numbers, decision). Newest decisions are summarized in `CLAUDE.md`.
- `*.js`, `*.sh`: the scripts that produced those numbers. Run them from the project root, e.g. `node experiments/answer-e2e.js out.json`.
  They call the real models (they cost quota), and some read sibling files like `router-brief-short.md`.
  They `require("../x")` modules from the project root, so keep them in this folder.
- `hello-claude.js`, `hello-gemini.js`: the first learning steps (Claude CLI and `agy` "hello"); moved here from the root on 2026-11-08, nothing used them.
- `one-thread-results/`, `study-notebooks-files/`: raw data for the matching notes.
- `2026-11-08-wait-for-file.md`, `wait-for-file-live.js`: a course question waits while that course's file is being read (fake models, slow fake reader).
- `2026-11-12-always-up.md`: keeping Bot up (login task + watchdog), what was checked on the laptop and Tailscale, phone steps, and whether Bot can run with the laptop off.
- `progress-history-until-2026-11-12.md`: the old `PROGRESS.md`, every step since day one. It describes files that no longer exist (the front desk, `core.js`, `bot.js`, the switches `BOT_THREAD` / `BOT_BRAIN`); some older scripts here `require` those files and no longer run.
- `window-check.ps1`: proves the watchdog chain opens no window and takes no focus (see `2026-11-12-always-up.md`).
