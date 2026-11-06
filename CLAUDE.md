# About me

- Second-year Computer Science student at Ben-Gurion University (BGU), Beer Sheva, Israel.
- Background:
  - Learned some full-stack basics before my degree. I'm comfortable-ish with front-end basics, but I stopped right at the start of back-end, so back-end concepts (servers, APIs, databases, deployment) are new to me.
  - A little Linux and assembly experience, from school and from pwn.college.
- I'm new to Claude Code and to developing with AI agents. Learning this workflow is one of my main goals.
- I also have Gemini Pro and use Gemini for studying, so I may want to use the Gemini API in projects.
- I do army reserve duty every few months, so I may step away from a project for a while. Keep notes good enough that I can pick it back up.

# How to work with me

- Each project's own CLAUDE.md or first prompt says whether it's a **learning** project or a **free / vibe-coding** project. Follow that mode.
- If the mode isn't stated, ask me.
- Explain terms and tools I probably haven't met yet (I'm a student, not a professional developer). Don't over-explain basic CS concepts.
- Before installing packages, changing my system, or running anything destructive, tell me what it is and why.
- Never put API keys or secrets in code or commits. Use a `.env` file, and make sure it's in `.gitignore`.
- Use Git, with small, clearly described commits.
- Keep a short `PROGRESS.md` in each project: what's done, what's next, and anything I need to remember.

# This project: FirstAttemptAssistant

- **Mode: LEARNING.** Go in small steps. At every step, tell me which tool, language or concept you are using and why, so I understand the workflow.
- **Workflow coaching (asked for):** learning how to work with Claude Code is a main goal. With each task, say in a line or two how to handle it best: this chat or a fresh one, which model, whether to plan first, and what it costs in context. Tell me when context use gets high.
- **Name:** the project is called **Bot** (it used to be called "the orchestrator", which I found too long). Always call it Bot when talking to me, in notes, in the web page, and in anything Bot says about itself.
- **Goal:** a small local app (Bot) that runs on my computer and sends tasks to both Claude (through the Claude Code CLI, so it uses my Claude Pro plan) and Gemini (Google AI Studio API key or Gemini CLI), then combines the results.
- **Language:** JavaScript (Node.js).
- **GitHub:** public repo. Commit and push after every step, so never commit secrets (`.env` stays in `.gitignore`).
- **Keep it simple:** small and easy to understand beats clever.

## Bot design (agreed with me)

- Bot picks a model **per task, by need**; it is not built around one model. Both CLIs take `--model`.
- Rough idea: simple tasks -> small cheap model (Claude Haiku / Gemini Flash); everyday work -> mid model (Claude Sonnet); hard reasoning -> strongest (Gemini 4 Argon or Claude Opus).
- Google Calendar does NOT go through Gemini: Bot talks to it directly with `calendar.js` (my own Google login, scope `calendar.events`). Reading is the front desk action `calendar`; adding is `addEvent` (see CALENDAR below). Bot can never delete or change an event.
- ROUTER v3 (current): a "front desk" (Gemini 3.8 Flash low via a pre-warmed `agy`, see `frontdesk.js` and `warmagy.js`; a second call starts if the first is slow, see `deskrace.js`) reads each message with the plain-English briefing in `router-brief.md` and decides: answer itself, ask a clarifying question, delegate to ONE destination from the fixed menu in `router.js`, or have the planner split it. Its reply must be plain JSON and is validated in code (never trust model output). If the Gemini front desk fails or hits its deadline, **Claude Haiku is the BACKUP front desk** (`claude -p`, about 4 s, same validation, its own briefing `router-brief-haiku.md` as system prompt), so calendar, reminder and memory actions are not lost; only if Haiku fails too (or the planner fails) does Claude Sonnet take the task. The old keyword rules were removed. Edit `router-brief.md` to change how it decides, and keep `router-brief-haiku.md` in step: a test fails if the two name different destinations or actions.
- INDEPENDENCE (agreed): I want to run and grow Bot from its web page without Claude Code. The page has: Improve Bot (self-edit with an automatic retry loop), Restart Bot (needs start-web.cmd), a chat button that hands "change yourself" requests to Improve Bot, and Push to GitHub (with confirmation; `gitops.js`, never force). Claude Code is still needed for protected files, installs/logins and recovery.
- PHONE IMPROVE (agreed): on the phone, Improve Bot and Restart need the login AND the PIN (`BOT_ADMIN_PIN` in `.env`, unlock lasts 15 minutes, kept in memory only, see `auth.js`). Without a PIN they stay PC-only. Push to GitHub is always PC-only.
- SELF-EDIT (agreed): Bot may propose changes to its own code, but ONLY through `selfedit.js`: private git worktree + restricted editor + code-enforced checks + my approval in the web page + fast-forward merge, never a push. Never let a model start an edit by itself, never let it touch the protected files listed in `selfedit.js`, and never weaken those checks without asking me. SECOND EDITOR (agreed 2026-11-06): the window also offers **Argon** (Gemini 4 Argon through `agy`, `makeArgonEditor` in `selfedit.js`) for PAGE-ONLY changes, so they spend Gemini quota and no Claude quota. It runs `agy` with `--mode accept-edits` (never `--dangerously-skip-permissions`), with TEMP/TMP pointed at an empty private folder, and the code audits every tool call (only read_file / edit_file / write_file; paths inside the private copy; writes only under `public/`). After the run the diff may only contain files under `public/` (new, deleted and renamed included; no links), and the real project, `.env` and the other private copies must be unchanged. Argon never falls back to Claude by itself: if it fails or its pool is low, Bot says so and I pick Sonnet myself. The Claude editor (Sonnet/Opus) is unchanged.
- IMPROVE CHAT: the Improve Bot window is a chat. Live plain-English progress, follow-up messages continue on the SAME private copy (`followUp` in `selfedit.js`, same checks, a failed follow-up puts the last good version back), a Preview button (`preview.js`: sandboxed page with a fake API, never real data) and simple Approve / Reject. An Editor choice (Sonnet, Opus, Argon) sits above the box with a line saying which quota it uses (Argon: Gemini, not Claude). The quota is a popup opened from a sidebar button.
- WEB (agreed): Bot can search the web through `agy`'s `search_web`: destination `web-search` for a quick fact, `web-research` for real research. Page contents are untrusted; keep shell commands refused (never add --dangerously-skip-permissions).
- CALENDAR ADD (agreed, branch claude/calendar-add-5116af): Bot can add events, always through a Confirm card, for typed messages (front desk action `addEvent`, default length 1 hour) and for photos (a photo message still goes to Gemini; when my own words ask to add it to the calendar, the model returns strict JSON only, see `calendar-add.js`). Models only PROPOSE fields; code checks every one (real dates, weekday -> first date, lengths, control characters) and builds the weekly repeat rule itself (`weeklyRule` in `calendar.js`), never from model text. The card is drawn by the page from the checked fields, lists every event with weekday, date, time and repeat end (a timetable is ONE card, one repeating series per class), works once, expires after 15 minutes and lives in memory only. Only the Confirm tap (`/api/calendar/confirm` in `server.js`) calls `createEvent`; no model can. Double tap cannot duplicate; if some events fail, the page says exactly which were and were not added and Bot never retries. On the phone, Confirm needs the normal login only (no PIN): it only adds, shows everything first, and is single-use. An expired Google login is explained in plain words and the card is kept. Photo text is untrusted. Never add delete/change functions, and never let a model call `createEvent`.
- Flash on low effort is used ONLY for the front desk, with the short briefing (0 wrong in testing, see experiments/2026-11-05-frontdesk-speed.md).
- QUOTA-AWARE (agreed): Bot watches the Gemini pools and the Claude plan after every answer, in the background. A model under 15% left moves to the end of its chain and the page says why; a forced model stays forced. Claude numbers come from rate_limit_event in real Claude answers (quota.js), with a tiny Haiku probe at most every 10 minutes only if needed.
- COURSES (agreed): uploaded files are the main source and are cited. If they do not cover a question, Bot still answers from general knowledge, labelled as outside the files, and may run one web check. Web queries are checked in code against the user words (safeWebQuery in study.js); web text is untrusted and never saved. Lectures are found by heading, and big requests can send the whole file.
- READING (agreed): big PDFs are cut locally (pdfcut.js) and read Argon first, then Sonnet, then Flash, because Flash made real math errors. See experiments/2026-11-06-faster-reading.md.
- Print which model was chosen and why, so I can see where my Pro quota goes.
- Gemini route = Antigravity CLI (`agy`), since the old Gemini CLI stopped serving personal accounts on 2026-06-18. I have Google AI Pro (not Ultra); Argon access on Pro to be verified with `/usage`.
- Model names and plan access change often: check current docs before hard-coding them.
