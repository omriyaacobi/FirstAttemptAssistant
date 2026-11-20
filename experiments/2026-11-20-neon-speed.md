# 2026-11-20: Neon low vs Hydrogen medium — how fast does Bot react?

Script: `neon-speed.js` (`run <rounds>`, `table`); raw numbers: `neon-speed-results.json`. Bot's real brain (`createBrain`: real prompt,
tool protocol, rounds) with FAKE courses, calendar and reminders (nothing from `data/` or `.env`), agy under the slim agent `bot-brain`
(no shell, no `--dangerously-skip-permissions`). ONE call at a time, never parallel; the order of the arms flipped from message to
message to cancel warm-up effects; 3 rounds x 8 invented messages x 4 arms = 96 messages. Times are wall-clock seconds from "message
in" to "answer out" (the first-text time is when the first words arrived).

## Short answer (simple words)

- **Earlier "30 seconds" numbers were noise.** They were measured with four batches running at once and agy queues them. Run one at
  a time, both models answer a short question in **about 3-6 seconds**, and a 3-step tool chain in 7-12 seconds.
- **Hydrogen is a little faster than Neon, but not much** when both are started the same way: median 5.9 s vs 6.8 s over all
  messages (about 0.9 s). Neon is right 24/24 of the time.
- **The real gap today is bigger (2.7 s) and it is Bot's fault, not the model's.** Bot keeps a "waiting spare" agy process ready for
  some models, which saves the 2-3 second start. The list of those models (`WARM_MODELS` in `brain.js`) still said Hydrogen and Argon.
  When Neon low became the first model, Bot started a spare for it (it does that for the chain's first model) and then never used it, so
  every Neon call started cold. With the spare, Neon drops from 6.8 s to 4.8 s median, within 0.7 s of Hydrogen.
- **Tokens:** Neon uses about 8% fewer per message here (median 9.6k vs 10.4k), not 25-55%, because Bot's own prompt is about 9k tokens
  of every call and the model's extra thinking is small next to that.
- **Verdict: Neon low stays first, with the one-line `WARM_MODELS` fix (done, own commit).** Same correctness, a bit fewer tokens, and
  once warm only ~0.7 s slower than Hydrogen. If Omri wants every last second, Hydrogen medium first is ~0.7 s quicker but spends more
  of the same pool. Watch the real log over the week (see below).

## Results (medians / worst, seconds; 3 rounds, so n is 3-6 per cell)

Arms: **neon-cold** = what Bot did today for Neon (new agy process per call); **hydrogen-warm** = what Bot does for Hydrogen;
**hydrogen-cold** = Hydrogen started like Neon (the fair model-vs-model comparison); **neon-warm** = Neon after the fix.

| kind | arm | n | median s | worst s | median first-text s | median tokens | right |
|---|---|---|---|---|---|---|---|
| short | neon-warm | 6 | 3.6 | 5.3 | 3.3 | 9226 | 6/6 |
| short | hydrogen-cold | 6 | 5.3 | 6.5 | 5.0 | 9924 | 6/6 |
| short | hydrogen-warm | 6 | 4.1 | 4.7 | 3.8 | 9970 | 6/6 |
| short | neon-cold | 6 | 5.7 | 6.2 | 5.4 | 9256 | 6/6 |
| hebrew | neon-warm | 3 | 5.6 | 6.9 | 3.9 | 9545 | 3/3 |
| hebrew | hydrogen-cold | 3 | 6.8 | 8.1 | 5.6 | 10601 | 3/3 |
| hebrew | hydrogen-warm | 3 | 4.2 | 5.1 | 3.2 | 10562 | 3/3 |
| hebrew | neon-cold | 3 | 9.1 | 11.3 | 7.7 | 10048 | 3/3 |
| course | neon-warm | 3 | 3.6 | 3.8 | 3.5 | 9454 | 3/3 |
| course | hydrogen-cold | 3 | 4.9 | 6.5 | 4.9 | 10050 | 3/3 |
| course | hydrogen-warm | 3 | 2.4 | 2.8 | 2.3 | 10101 | 3/3 |
| course | neon-cold | 3 | 5.5 | 6.8 | 5.5 | 9457 | 3/3 |
| one-tool | neon-warm | 6 | 5.2 | 6.7 | 4.7 | 9656 | 6/6 |
| one-tool | hydrogen-cold | 6 | 6.7 | 9.0 | 6.3 | 10582 | 4/6 |
| one-tool | hydrogen-warm | 6 | 5.0 | 6.0 | 4.6 | 10541 | 4/6 |
| one-tool | neon-cold | 6 | 8.5 | 10.4 | 7.8 | 9710 | 6/6 |
| chain-3 | neon-warm | 3 | 9.8 | 10.5 | 8.6 | 11220 | 3/3 |
| chain-3 | hydrogen-cold | 3 | 10.1 | 11.1 | 9.3 | 12574 | 3/3 |
| chain-3 | hydrogen-warm | 3 | 7.4 | 7.7 | 6.6 | 12178 | 3/3 |
| chain-3 | neon-cold | 3 | 12.4 | 12.5 | 11.0 | 11221 | 3/3 |
| long-ctx | neon-warm | 3 | 3.1 | 3.3 | 3.0 | 16411 | 3/3 |
| long-ctx | hydrogen-cold | 3 | 5.4 | 5.9 | 5.3 | 17139 | 3/3 |
| long-ctx | hydrogen-warm | 3 | 3.1 | 3.8 | 2.8 | 17057 | 3/3 |
| long-ctx | neon-cold | 3 | 5.3 | 5.6 | 5.2 | 16445 | 3/3 |
| ALL | neon-warm | 24 | 4.8 | 10.5 | 3.8 | 9563 | 24/24 |
| ALL | hydrogen-cold | 24 | 5.9 | 11.1 | 5.5 | 10368 | 22/24 |
| ALL | hydrogen-warm | 24 | 4.1 | 7.7 | 3.8 | 10437 | 22/24 |
| ALL | neon-cold | 24 | 6.8 | 12.5 | 6.1 | 9596 | 24/24 |

"right" = code check of the answer. The 4 misses are all the `calendar` message on Hydrogen ("what is on my calendar this week?"): it
answered "nothing this week" from the calendar block already in Bot's prompt without calling `calendar_read` (my fake events were on
1-3 December, outside the week, so the answer was in fact correct; my check wanted the events named). A test flaw, not a model failure.
Neon called the tool and listed them.

Pool: the Gemini Models 5-hour window went 98% -> 79% over about 190 calls in two runs (Bot was running too). No Claude pool was touched.

## What was changed in Bot

- `brain.js`: every model call now records its own seconds; the per-answer line in `data/bot.log` reads
  `[brain] answered by gemini-4-neon-low in 4.9 s, tools: ..., 2 model calls (3.1 s, 1.8 s), 2,020 tokens`.
  Compare models over the week with: `grep "answered by" data/bot.log` (whole-message seconds, per-call seconds, tokens).
- `brain.js`: `WARM_MODELS` now includes Neon low (+ a test that the chain's first model is always in it).

## Limits

- 3 rounds, one machine, one evening; the laptop and agy's servers vary. Medians are fair; 0.5 s differences are inside the noise.
- The messages are short; real Bot messages carry more context (a longer brain prompt makes both slower by about the same).
- Bot was running in the background (port 3000), so the pool percentages include its own use.
