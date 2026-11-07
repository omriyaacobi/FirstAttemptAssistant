# Why the Claude quota runs out faster (2026-11-07)

Research only. Nothing in Bot was changed. No chat text is quoted here; only counts, sizes and timings.

## Short answer

The quota is not being eaten by Bot itself. It is being eaten by **Claude Code chats**, mostly by two things:

1. **One very long Opus chat** (the old manager chat, up to ~590,000 tokens of context).
2. **Many Sonnet chats at the same time**, each carrying a fixed "starter pack" of about 80,000 tokens that is re-read on every turn.

Bot's own `claude -p` calls are a small part (section 5).

## Words you may not have met

- **Token**: a chunk of text (about 3/4 of a word). Quota is counted in tokens.
- **Context**: everything the chat has read so far. On every turn Claude re-reads all of it, so a turn at 500k context costs about 5x a turn at 100k.
- **Cache read / cache write**: the re-read is mostly "cached", about a tenth of the normal price but not free. A cache write (first time, or after ~5 minutes idle) costs a bit more than normal. Over hundreds of turns it adds up.
- **Opus vs Sonnet**: Opus is stronger and costs more per token. I could not read the plan's exact weighting, so the shares below are rough (I tried Opus = 1.7x and 5x Sonnet).

## Evidence

### 1. Plan numbers now (get_usage)
- 5-hour window: 43% used. Weekly (all models): **35% used, resets 2026-11-13 15:00**. So the week started 2026-11-06 15:00 and about 35% went in roughly 27 hours. At that pace the week runs out in about 3 days.
- Only the current value is given: no history, no per-model line. **This is the biggest unknown.**

### 2. Claude Code transcripts (local session files, 69 sessions)
Per day, all Bot-project chats together (turn = one Claude reply; read = cached context re-read, in millions of tokens):

| Day | Opus turns | Opus read | Sonnet turns | Sonnet read |
|---|---|---|---|---|
| Nov 1 | 46 | 8.8M | 71 | 8.8M |
| Nov 4 | 111 | 32.7M | 189 | 26.0M |
| **Nov 5** | 267 | 97.9M | **802** | 169.9M |
| **Nov 6** | 444 | 109.7M | **889** | 177.3M |
| Nov 7 (to ~18:00) | 112 | 29.7M | 754 | 158.1M |

- Turns per day went from ~300 (Nov 4) to ~1070 (Nov 5), ~1330 (Nov 6) and 866 (Nov 7, partial day): **3-4x more work per day**. That matches "faster in the last few days".
- Rough cost units (cache read 0.1, write 1.25, output 5, in Sonnet-input-price units): Nov 4 ≈ 9, Nov 5 ≈ 36, Nov 6 ≈ 43, Nov 7 so far ≈ 25. Opus is about 35-70% of that on Nov 5-6, depending on the weighting.

**Biggest single chat:** the old manager chat ("Creating project with Claude Code", Opus, Remote Control on): 1123 replies (873 Opus), context up to **590k**, 319M tokens re-read in total. That is more than 4x the next chat (front-desk-speed, Sonnet, 251 turns, 75M, 494k). About 237M of the Nov 5-7 Opus re-reads are nearly all this chat (plus the Opus child "study-faster", 26M).

Next biggest, all Sonnet at 300-490k context: frontdesk-speed, night-study-coach (145 turns, 427k), study-upgrade, night-page, night-check, ui-popup-improve, phone-app, night-thread-core.

### 3. The fixed "starter pack" per turn
`get_usage` on current chats shows ~80,000 tokens before any message: system tools 37.5k, MCP tool lists ~20k, system prompt 11k, memory files 6k, skills 6k, MCP instructions 1.7k. With ~754 Sonnet turns on Nov 7 alone, that is ~60M tokens, roughly **38% of that day's Sonnet re-reads**. Small chats pay it as much as big ones; ~35 chats means paying it 35 times.

### 4. Parallel chats
- Night of Nov 6-7: 4 Sonnet chats started 23:16 and ran together until ~01:00, after several research chats the evening before.
- Now: 3 QA fix chats, the zip-upload chat and this one. Chats active per day: 8 on Nov 5, 15 on Nov 6, 10 on Nov 7.
- Parallel chats do not cost extra by themselves, but they fill the 5-hour window faster and each has its own starter pack and growing context.

### 5. Bot's own Claude calls (small)
- Thread log (`data/thread`, counts only): 12, 10, 6, 48, 49 messages on Oct 28, Nov 4, 5, 6, 7. Claude Sonnet answered 2 on Oct 28, 2 on Nov 6, none logged on Nov 7. The rest was Gemini (Flash, Argon) or code.
- Old chats (`data/conversations`, 24 files): 20 Sonnet and 2 Opus answers ever.
- Improve Bot jobs ever: 5 (3 Sonnet, 1 Opus on Nov 5, 1 Argon).
- `quota.js` Haiku probe: at most once per 10 minutes, only if no real Claude answer showed the numbers recently, with `--tools "" --system-prompt ok`, so a few thousand Haiku tokens each (worst case 144/day, realistically far fewer).
- Haiku backup front desk: `claude -p` with no saved session, so no log; **exact count unknown**, but with Gemini mostly working it is small.
- I found nothing new in the last days that multiplies Claude calls (no retry loop seen; the BOT_THREAD context is capped and goes mostly to Gemini).
- Estimated share: **under 5%**.

### 6. Scheduled task `watch-improve-bot`
Only 1 run exists (Nov 7, 22 minutes, Sonnet, medium effort, succeeded). Its prompt limits it to two commands. About 1-3% of a day; not the cause. The three one-off night runs (Nov 6) are disabled.

## Ranked causes (rough share of the recent increase)

| # | Cause | Rough share | Confidence |
|---|---|---|---|
| 1 | Old Opus manager chat: 590k context, 873 Opus turns, kept alive 11 days | 30-50% | High that it is #1, medium on the share |
| 2 | Volume: ~35 chats, mostly Sonnet, 300-490k context, 3-4x more turns/day since Nov 5 | 25-35% | High |
| 3 | The ~80k starter pack re-read on every turn of every chat | 15-25% (overlaps with 2) | Medium |
| 4 | Parallel chats (night batch of 4, QA batch of 4) | changes when you hit the 5-hour limit more than the total | Medium |
| 5 | Bot's own Claude calls | <5% | Medium (Haiku count not logged) |
| 6 | `watch-improve-bot` | 1-3% | High |

## What is NOT known
- Exact plan weighting of Opus, Sonnet and Haiku (I used two guesses).
- Daily history of the plan percentage.
- Sub-agent usage (separate files, not counted) and Bot's Haiku calls (no log).
- Anything else on the same plan (claude.ai website, other devices).
- Whether failed or retried turns are in the transcript counts.

## Recommended changes (nothing implemented)

1. **Retire the Opus manager chat.** Archive it (and turn Remote Control off); keep working in the Sonnet manager chat. Use Opus only for one short hard problem in a fresh chat, then close it. Expected: the biggest saving, maybe 30-40% of daily use.
2. **Start a fresh chat before context passes ~150k** and carry only a short note (PROGRESS.md or a handoff note). One 500k chat of 150 turns re-reads ~40M; three 100k chats of 50 turns re-read ~15M. Expected: 40-60% less on long jobs.
3. **One task, one chat, then archive it.** Do not reuse a finished chat for a new topic.
4. **Cut the starter pack.** Turn off MCP servers you don't use in coding chats, and trim the duplicated CLAUDE.md (global and project copies carry the same text). Expected: 10-20k fewer tokens per turn, about 10-20% overall.
5. **Limit parallel chats to 2-3** and don't start two big batches inside one 5-hour window.
6. **Write the 5-hour and weekly percentages in PROGRESS.md** twice a day so future causes can be tied to days. Optionally let `quota.js` log each Haiku probe and each `claude -p` call (counts only) so Bot's part becomes measurable. Suggestion only.
7. **Bot settings:** leave as they are (already small). Optionally run `watch-improve-bot` every 2-3 days instead of daily (saves 1-2%).

## Expected effect
Doing 1 + 2 + 3 should roughly halve weekly use, enough for the quota to last most of the week at today's amount of building.
