# 2026-11-19: the new Gemini model (Gemini 4 Neon), a basic look

Omri: "gemini dropped a new model to replace argon so we probably need to update bot", "cap it to basic looking at".
This is a BASIC look only: no code changed, no trial run. Two small calls were made through agy (one by mistake, see below).

## 1. What the model is

- **Name:** Gemini 4 **Neon**. In agy the ids are `gemini-4-neon-low`, `gemini-4-neon-medium`, `gemini-4-neon-high`,
  `gemini-4-neon-xhigh` (from `agy models`, see 2). There is also `gemini-pro-orchestrator-neon` ("Orchestrator (Neon)").
- **Announced:** 2026-11-18, rolled out gradually from the same day.
- **What it replaces:** in the Gemini APP, Neon takes the place of Argon (and Gemini 3.1 Pro) for AI Pro and Ultra.
  Argon left the app but **stays available on the API**. Carbon stays Ultra-only. Neon sits between Hydrogen (fast) and Carbon
  (largest).
- **Price (API, from news sites only, not checked on Google's own page):** $3 in / $15 out per million tokens. Argon $2 / $10
  until 2026-11-30, $4 / $20 from 2026-12-01. This is the paid API; Bot uses agy's plan quota, not paid tokens.

Sources (read 2026-11-19, all dated 2026-11-18/19; all are news sites, I found no Google page yet):
- https://9to5google.com/2026/11/18/gemini-4-neon-announcement/
- https://www.notebookcheck.net/Gemini-4-Neon-replaces-Argon-for-Google-AI-Pro-subscribers.1454281.0.html
- https://basic-tutorials.com/news/gemini-4-neon-google-replaces-argon-and-3-1-pro-with-a-faster-more-affordable-model/
- https://servola.de/journal/gemini-4-neon-costs-3-dollars-and-replaces-argon/
- agy's own changelog (`agy changelog`, version 1.5.12): "Added Gemini 4 Neon (Low, Medium, High, and XHigh) to `/model` and
  `--model` when you connect with a `GEMINI_API_KEY`." (It names only the API-key sign-in, but see 2: Omri's Google sign-in
  lists it too.)

## 2. Does agy offer it (Google AI Pro)?

**Yes.** `agy models` on this PC (Omri's normal Google sign-in, no `GEMINI_API_KEY` set) lists all four Neon levels
(low, medium, high, xhigh). Argon low/medium/high are **still listed** too, so nothing in Bot breaks today.

**Which pool:** NOT KNOWN YET. `agy -p "/usage"` (run from PowerShell; Git Bash turns `/usage` into a path) shows the same
three pools as before, no Neon row:

```
Gemini Models          Weekly 91%   Five Hour 100%
Claude and GPT models  Weekly 100%  Five Hour 100%
Gemini 4 Argon         Weekly 85%
```

After one tiny Neon call, no row moved (one small call is under 1%). So Neon either shares a pool that did not move by a whole
point (most likely "Gemini 4 Argon", since it "replaces Argon", or "Gemini Models"), or it has a pool `/usage` does not show yet.
This matters: `quota.js` can only pace and protect a pool it sees in `/usage`.

## 3. Test calls

1. By mistake: `agy -p "/usage"` from Git Bash became a prompt (path rewritten), so the DEFAULT model answered it once. Harmless,
   no tools, about one small call.
2. `agy -p "Reply with one word: what day of the week was 2026-11-19?" --model gemini-4-neon-medium --output-format json`
   from an empty temp folder: status SUCCESS, answer "Thursday" (correct), 10 s, 9,822 input + 767 output tokens (765 of them
   thinking). The 9,822 input tokens are agy's own overhead (no slim agent was used); Bot's `bot-brain` agent would cut that.

No more calls were made (Omri asked for a basic look).

## 4. Every place Bot names Argon

Model ids and pools (the places a swap would touch):
- `router.js:19` pool name `ARGON = "Gemini 4 Argon"`
- `router.js:24` `argonLow` = `gemini-4-argon-low`; `router.js:25` `argonMedium` = `gemini-4-argon-medium`
- `router.js:41` `researchArgon` = `gemini-4-argon-medium` (web research)
- `router.js:48-55` chains: `gemini-flash`, `gemini-argon-low`, `gemini-argon-medium`, `claude-sonnet`, `claude-opus`, `web-research`
- `selfedit.js:162` `ARGON_MODEL = "gemini-4-argon-low"` (the page-only editor, `makeArgonEditor` at :248; checks/messages at
  :153-377, :490-535, :632-647, :732, export :752)
- `server.js:567` editor choice must be `sonnet | opus | argon`
- `public/index.html:725` the Editor `<select>` option "argon"; `public/index.html:1996-1997` the quota line for it

Chains that use Argon:
- Brain: `brain.js:51` `CHAIN` (Argon low 2nd), `:56` Claude-first order, `:61` `PHOTO_CHAIN` (Argon low FIRST), `:65`
  `RESERVES` (25% for Argon's pool), `:94` `WARM_MODELS` (warm agy process for Argon low)
- Reading files: `ingest.js:29` `READ_CHAIN` (Argon last), `ingest.js:30` `CUT_CHAIN` (big PDFs, Argon FIRST)
- Tutor: `tutor.js:23` `TUTOR_CHAIN` (Hydrogen medium, Argon medium, Argon low); text `tutor.js:86` names "Argon" to the user
- Catch-up: `study-coach.js:204` `chooseByModel(... chain: [MODELS.argonLow])` (the one Argon call of `catchup.js:9,111`)
- Time limits: `providers.js:44,52` `ARGON_TIMEOUT_MS` picked by `/argon/` in the id; `providers.js:373` photo limit 150 s
  by `/argon/` (a Neon id would get the SHORT Flash limits unless this is changed)

Only in comments / notes: `brain.js:10,43-49,58-59,84,96,105,124,200,1127`, `quota.js:203-204,215,248-254,286`,
`brief-me.js:8`, `news.js:19`, `thread-summary.js:6,19`, `server.js:762,842`, `study-coach.js:13`, `tutor.js:9-10,22,79`,
`tokenlog.js:7`, `PROGRESS.md` (several), `qa/reports/2026-11-08.md:35`.

CLAUDE.md: line 46 (MODELS), 48 (PHOTOS), 60 (DAILY SUMMARY), 65 (READING), 66 (STUDY COACH / tutor), 69 (CATCH-UP),
80 (SELF-EDIT), 81 (IMPROVE CHAT editor choice).

Tests that name Argon (23 files, count of lines): quota-max 55, selfedit-argon 53, brain-quota 26, claude-first 21,
code-review-2026-11-16 6, photo-stream 6, thread-study 5, tutor 5, jobs 4, providers 4, courses 3, study-coach 3, quota 2, and
1 each in brain-first, brain-sticky, brain, news, quiz-photo, real-use-2026-11-16, router, stream, thread-files-fix, tutor-real.

In short: **4 model ids** (router.js x3, selfedit.js x1), **1 pool name**, **7 chains** plus the reserve and warm list,
**2 time-limit checks** by name, the editor choice (server + page), 8 CLAUDE.md bullets, 23 test files.

## 5. Proposal (small)

Nothing is urgent: Argon is still in agy and still on the API, so Bot keeps working as it is.

1. **First, learn the pool** (no code): after Bot has made a few Neon calls in a trial, or after Google's docs say it, read
   `/usage` again. If a "Gemini 4 Neon" row appears, it is its own pool; if Argon's row drops, it shares Argon's.
2. **A short trial like the Hydrogen ones** (`experiments/2026-11-15-hydrogen*.md`): reuse `experiments/hydrogen-round3.js`
   with `gemini-4-neon-low` and `-medium` against Argon low on the same blind questions (hard math, C++, tools, Hebrew, the
   unclear timetable photo). About 20-30 calls. Measure: correct, time, tokens, and which `/usage` row moves.
3. **If Neon wins, a small swap** (Omri decides): add `neonLow` / `neonMedium` to `router.js` MODELS with the right pool,
   put Neon in Argon's place in the brain, photo, cut-PDF and tutor chains, and KEEP Argon right behind it as the fallback
   (as Flash stayed behind Hydrogen). Also make `providers.js` give Neon Argon's longer time limits (it matches `/argon/` today),
   and move the 25% `RESERVES` to Neon's pool if it is a new one. Leave the self-edit editor on Argon until a separate test,
   since its safety checks were tested on Argon's tool behaviour. Then update the CLAUDE.md MODELS bullet.

Workflow note for Omri: steps 2-3 fit one fresh Claude Code chat each, on Sonnet or Opus; plan step 3 first since it touches
quota code and many tests.
