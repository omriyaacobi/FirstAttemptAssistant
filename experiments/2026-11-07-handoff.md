> NOTE (2026-11-12): written on 2026-11-07, before the brain. `BOT_THREAD` no longer exists (the thread is always on) and the front desk is gone. For the current state read `PROGRESS.md`.

# Handoff to the manager chat (written 2026-11-07)

Read this with `CLAUDE.md` and the end of `PROGRESS.md`. This chat replaces the old Opus manager chat, which grew too long.

## How we work
- You are the **manager**. Omri talks to you. Side chats do the tasks; you check their work yourself (read the diff, run the tests) before anything is merged, and you sum up here. Do not trust a side chat's report alone.
- This is a **learning** project. Say what each tool or term is. With each task, say in a line or two how best to run it (this chat or a fresh one, which model, plan first or not, context cost). Tell Omri when context use gets high.
- Use they/them for Omri unless they say otherwise. Hebrew wording in Bot avoids gendered "you" and "I" verbs. Answer in Omri's language.
- **Quota:** Omri's Claude Pro quota is the scarce one. Keep this chat small: hand big jobs to side chats on Sonnet, and do not read large files here. Gemini quota is plentiful. For security changes, big design decisions, or review of a large merge, tell Omri that this is an Opus moment and let them choose.
- Merge a side branch only when Omri says so. Commit and push after each step on the project (public repo). Omri has said to run the QA fixes through you, but merging still needs their yes.

## Rules that side chats have broken, so check every time
- **No real chat text in the repo.** A Sonnet chat copied Omri's real Hebrew message into a test on 2026-11-07. Before every push, read the added lines of the diff for real messages, names, links and secrets. Tests use made-up sentences.
- The main folder must stay on `main`. Improve Bot approvals merge into whatever branch it is on, and Omri uses Improve Bot at any time. Do work in worktrees, then fast-forward `main`.
- After a merge that changes Bot, restart it (`POST http://127.0.0.1:3000/api/restart`, which refuses by itself while busy) and confirm with `/api/session`. A fix that is merged but not restarted is not live.
- Reports must say what was not verified.

## Where things stand
- Live on `main`: the new Bot (`BOT_THREAD=on`), the phone app, no PIN on the phone, whole Hebrew answers, the link and study coach fixes. Omri is trying it and has said it is not comfortable enough yet to replace the Gemini app. That is the goal: make it comfortable.
- Omri's decision: keep the new Bot on for now. The three fixed study settings (8:00 Calculus not attended, 70% bar, course answers not asking about the last lecture) stay as they are while Omri tests.
- Research on long conversations is on branch `claude/long-chat-research-097d54`, NOT merged. Its report: `experiments/2026-11-07-long-conversation-research.md`. Main finding: Bot does not choke on long history, it forgets quickly unless a fact is saved. It calls Omri "he" in places: fix that before merging. Omri has not yet answered whether to build the "Bot should have known this" button; the recommendation was to build only that during testing.
- Daily check: scheduled task `watch-improve-bot` (about 21:14) runs `node improve-watch.js`, then `node improve-watch.js done`, read-only. It has not yet proven it runs without a prompt. If it stalls, Omri should choose "Always allow" on those commands; if only "Allow once" appears, find another way. It asks about continuing after 2026-11-15. Its report comes to the old chat, so check runs with `list_task_runs` and `data/improve-watch-log.md`.
- Known small problem: removing the checkbox also removed "Think harder" for course answers (`deeper: false` in `public/index.html`).
- Not working yet: nobody confirmed Bot really reads a page from a link; saving something to a course by asking in chat is not an action.

## First jobs, in order
1. **Start the QA branch now** (below). Omri asked for this to begin immediately.
2. Add a small pre-push check script for real chat text and secrets, so that this does not rely on any model remembering it. Keep it simple; show Omri before wiring it into git.
3. Turn QA findings into fix branches, one per group, with a test each. Report to Omri in plain words.

## QA plan (agreed with Omri, manual first)
Goal: a tester uses Bot like a person with an ordinary day, finds bugs and reports them; you manage the fixes.
- **Where:** a side chat on Sonnet, in its own worktree on a branch like `claude/qa-everyday`. If you cannot start a side chat from this turn, run it as a subagent in a worktree instead.
- **The copy of Bot:** start it inside the worktree with `BOT_THREAD=on PORT=3100 node server.js`. Without `BOT_THREAD=on` it tests the OLD Bot. The worktree has its own empty `data/` and no `.env`, so it cannot touch Omri's chats, memory or calendar. Never copy `.env`, the Google token or real `data/` into it, and never use port 3000.
- **Setup:** add a made-up course and made-up files through the normal routes, so that course and study paths can run.
- **How it talks to Bot:** like the page does: `POST /api/ask`, then read the answer from `/api/thread` and `/api/jobs`. Uploads go to `/api/thread/upload`. Use a real browser at 375 px for a few journeys, because the page itself is part of what Omri feels.
- **What to try:** about 25 everyday scenarios in Hebrew and English: vague messages, typos, follow-ups, mixed languages, links, reminders, "add this to my calendar", course questions, "I skipped class", changing your mind, a message sent while another is running, a file with a message.
- **Judge as a person would:** was it wrong, confusing, slow, a dead end, or too much text? Compare with what a good assistant would say.
- **Limits:** calendar steps stop at the "not logged in" path, because the copy has no Google login. The tester never edits Bot's code. Real models spend real quota: most is Gemini, but some answers go through Claude, so keep the first run to about 25 scenarios and report what the run cost (use `get_usage` before and after).
- **Output:** `qa/reports/2026-11-07.md` on its branch: each bug with the message sent (made-up text only), what Bot said, what it should have said, severity, and which file probably owns it. Then a short summary back to you.
