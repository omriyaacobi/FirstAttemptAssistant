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
- **Name:** the project is called **Bot** (it used to be called "the orchestrator", which I found too long). Always call it Bot when talking to me, in notes, in the web page, and in anything Bot says about itself.
- **Goal:** a small local app (Bot) that runs on my computer and sends tasks to both Claude (through the Claude Code CLI, so it uses my Claude Pro plan) and Gemini (Google AI Studio API key or Gemini CLI), then combines the results.
- **Language:** JavaScript (Node.js).
- **GitHub:** public repo. Commit and push after every step, so never commit secrets (`.env` stays in `.gitignore`).
- **Keep it simple:** small and easy to understand beats clever.

## Bot design (agreed with me)

- Bot picks a model **per task, by need**; it is not built around one model. Both CLIs take `--model`.
- Rough idea: simple tasks -> small cheap model (Claude Haiku / Gemini Flash); everyday work -> mid model (Claude Sonnet); hard reasoning -> strongest (Gemini 4 Argon or Claude Opus).
- Tasks about Google things (Calendar, etc.) should go to Gemini. UNVERIFIED: whether the Gemini CLI route can actually reach my Calendar; check the docs before promising it.
- ROUTER v3 (current): a "front desk" (Gemini 3.8 Flash high via `agy`, see `frontdesk.js`) reads each message with the plain-English briefing in `router-brief.md` and decides: answer itself, ask a clarifying question, delegate to ONE destination from the fixed menu in `router.js`, or have the planner split it. Its reply is forced into a JSON schema and validated in code (never trust model output). If the front desk or planner fails, Claude Sonnet takes the task. The old keyword rules were removed. Edit `router-brief.md` to change how it decides; a test checks the briefing mentions every destination.
- INDEPENDENCE (agreed): I want to run and grow Bot from its web page without Claude Code. The page has: Improve Bot (self-edit with an automatic retry loop), Restart Bot (needs start-web.cmd), a chat button that hands "change yourself" requests to Improve Bot, and Push to GitHub (with confirmation; `gitops.js`, never force). Claude Code is still needed for protected files, installs/logins and recovery.
- SELF-EDIT (agreed): Bot may propose changes to its own code, but ONLY through `selfedit.js`: private git worktree + restricted editor + code-enforced checks + my approval in the web page + fast-forward merge, never a push. Never let a model start an edit by itself, never let it touch the protected files listed in `selfedit.js`, and never weaken those checks without asking me.
- Flash on low effort was dropped (not enough saving to justify the extra mistakes).
- Print which model was chosen and why, so I can see where my Pro quota goes.
- Gemini route = Antigravity CLI (`agy`), since the old Gemini CLI stopped serving personal accounts on 2026-06-18. I have Google AI Pro (not Ultra); Argon access on Pro to be verified with `/usage`.
- Model names and plan access change often: check current docs before hard-coding them.
