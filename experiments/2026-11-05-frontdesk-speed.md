# Making Bot's front desk fast and predictable (measured 2026-11-05)

Branch `claude/frontdesk-speed-01ec9f`. Not pushed, not merged. 327 tests pass (298 on main before).
Raw data (JSON and logs of every run below) is in the shared notes folder, not in the repo.
All runs were one call after another on Omri's laptop, never two of my calls at once. **Other Claude sessions were running on the same laptop part of the time, so absolute numbers move between runs; compare things measured in the same run.**

## Result in one table

| | Before (today's real chats) | After (real `frontdesk.decide`, 49 messages, 10 s between messages) |
|---|---|---|
| Front desk, median | about 22 s (10.3, 14.6, 22.5, 23.3, 49.8) | **2.8 s** (second run 3.0 s) |
| Front desk, 90th percentile | about 50 s | **5.0 s** (4.7 s) |
| Front desk, slowest | 49.8 s | **6.3 s** (7.3 s) |
| Wrong routes | - | **0 of 147** |
| Invalid replies | seen in 3 of 10 full-briefing runs | **0 of 147** (the first real run showed 1, caused by my test clock, see the last note) |
| Schnitzel question, whole message | 67 s | **11.6-12.7 s** (15.9 s for the very first message after a start) |

Messages sent back to back with no pause (the next pre-warmed process is not ready yet): median 5.0 s, 90th percentile 6.2 s, slowest 11.7 s. All three runs: 0 wrong, 0 invalid. A second hedge call was needed on 2 of 147 messages.

Now the schnitzel answer itself (Flash medium, about 10 s) is most of the time; the front desk is a small part.

## Part 1: why was it slow?

1. **Prompt size.** Briefing 10.8k characters, profile block 2.4k, total about 13.5k characters. But `agy` reports about **9,970 input tokens** per front desk call (it adds roughly 6.5k tokens of its own system prompt and tool list). More important: the call spent about **1,600 output tokens and about 1,570 of them were "thinking"; the visible JSON reply is only about 90 tokens.** So the time is the model's thinking, not the transport, and not CLI start alone (a "Reply OK" call is 5.2-7.3 s, median 6.1 s).
2. **Cost of the JSON schema.** A tiny prompt with the real schema: median 7.6 s vs 6.1 s for a plain reply (so +1.5 s). With the real prompt, same session, run one after another: schema reply median **33.9 s, 12-54 s, 3 of 10 invalid** vs plain-text reply with the same prompt median **13.1 s, 9.6-15 s, 0 of 6 invalid**. Over all my later runs (about 300 calls) every invalid reply and the one 90 s hang were in schema mode; plain-text JSON, which the code validates itself, had none.
3. **Where the 50 s runs come from.** `--output-format stream-json` shows exactly one `agent_response` step per call: no tool calls, no `run_command` attempts, no retries in the front desk. It is just long thinking. How long depends on the **message**: a casual Hebrew question that could be answered or delegated (the schnitzel one) made the old setup think for 18-47 s (median 28 s, 6 runs) while most messages took about 12 s. It also depends on the **time** (the same message with the old setup took 16-57 s in one hour and about 30 s in another; some of that is other sessions using the laptop and Google's load, which I cannot separate).
4. **Quota lookup (5 s after a restart).** The lookup is `agy -p /usage`, 3.6-5 s, and it ran before the first message. Built Omri's design: an in-memory "is any pool low?" flag that starts as "not low" at every start, is read without waiting, and is refreshed in the background **after** each answer (a failed lookup keeps the flag, a lookup already running is not started twice). Saves the whole lookup (3.6-5 s) on the first message after a start and whenever the old 5-minute cache expired. `[timing]` no longer has a quota part.

## Part 2: fixes tried, with numbers

49 messages (English, Hebrew, mixed): greeting, math, facts, long explanations, code, hard problems, web-search vs web-research, 3 reminders with checked local times, "remind" without a time, remember / secret / change a numbered fact / forget (saved and unknown), 3 calendar ranges, adding to the calendar, Gmail, improve, clarify, split, follow-ups with history, a prompt injection. Script: `experiments/frontdesk-ab2.js` (the shared scorecard; the older `frontdesk-ab.js` is kept). "Wrong" = the route is not in the accepted list for that message (list is in the script). Setups took turns for each message.

| Setup (Flash = Gemini 3.8 Flash through agy) | median | 90th | slowest | invalid | wrong |
|---|---|---|---|---|---|
| Flash medium, old long briefing, schema (run A) | 12.2 s | 19.4 s | 31.2 s | 1 | 0 |
| Flash medium, short briefing, schema (run A) | 12.4 s | 19.3 s | 83.1 s | 1 | 0 |
| Flash medium, short briefing, plain JSON (run A) | 12.0 s | 16.5 s | 31.5 s | 0 | 0 |
| Flash medium, short briefing, plain JSON (run B) | 11.2 s | 16.8 s | 24.2 s | 0 | 0 |
| **Flash low**, short briefing, plain JSON (run B) | **5.7 s** | 8.4 s | 13.3 s | 0 | 0 |
| Flash low, short briefing, schema (run B) | 5.5 s | 6.4 s | 7.7 s | 0 | 1* |
| Argon low, short briefing, plain JSON (run B) | 7.5 s | 11.3 s | 14.2 s | 0 | 0 |

\* `he-hard` (a Hebrew proof) went to `gemini-argon-low` instead of `gemini-argon-medium`: arguable, but counted wrong.

The schnitzel message ×6 per setup (the slow case): old briefing medium 28.3 s median (17.9-46.9) · short medium schema 15.1 s · short medium plain 13.0 s · Flash low schema 6.5 s (one invalid reply after 90 s) · **Flash low plain 6.1 s (5.0-6.7)** · Argon low plain 7.3 s.

- **Short briefing alone:** helps on the hard-to-decide messages (28 s to 15 s on the schnitzel one) but did not change the 49-message median (12.2 vs 12.4 s). It is the same accuracy. Built (`router-brief.md` is now 5.7k characters; the old one is `experiments/router-brief-full-before.md`).
- **Plain JSON instead of the schema:** no invalid replies and no 90 s hang in about 300 calls vs 3 with the schema. Built.
- **Flash low (Omri allowed it for the front desk):** half the time, same decisions on all 49 messages. Built.
- **Pre-warmed single-use `agy` (new, `warmagy.js`):** starting `agy` costs about 2.2 s before the model sees the prompt. A process started in advance and kept waiting answered Flash low in **2.6-3.8 s after the prompt was written**, also after waiting 60 s and 300 s (Flash medium: 10.1 s). Every process serves **one** message and is then killed, so there is no shared conversation and nothing leaks (the problem with one long-lived process in the earlier notes). If the spare is missing, older than 8 minutes or dead, the call starts a normal process. The next spare is started after the front desk reply, not before. A spare is killed when Bot exits. Built, tested with a fake `agy`.
- **Hedging (built):** if the first call has no valid reply after **7 s**, a second identical call starts and the first valid reply wins; the loser's process is killed. A call with an invalid reply or an error starts the next one at once. Used on 2 of 147 messages (1.4 %). **Quota:** one extra Flash-low call on those messages, so about 1.4 % more front desk calls, plus one idle waiting process (it sends nothing to the model until used; I did not measure `/usage` to confirm it costs nothing). With the old slower setups it would have fired on about 1 in 4 (cold Flash low: 90th percentile 8.4 s).
- **Deadline (built): 20 s.** After that the front desk gives up and the existing fallback runs. The slowest real front desk call was 11.7 s, so it is only a safety net. Default after a miss is still **Claude Sonnet** as Omri decided (Sonnet works now: "Reply OK" 4.4-5.1 s through `claude -p`). I did not test Flash as the fallback because a front desk that fails twice in 20 s means agy is in trouble, and Flash goes through the same agy; Sonnet is the independent route. **Not changed; see the question below.**
- **Not built:** a Gemini API key (none exists). Estimate: it would remove the 2-3 s start, so a front desk call is about the model time, which for Flash low is about 1-2 s of reply; published first-token times are about 1 s with minimal thinking. The pre-warmed process already gets about 3 s, so the key would save at most 1-2 s more, and it needs a key and separate billing.

## What was built (small commits on this branch)

1. `quota.js`, `core.js`: quota flag as above (+ tests, 5 old quota tests replaced).
2. `deskrace.js`: `race()` hedging + deadline, no model knowledge (8 tests with fake calls).
3. `providers.js`: `askClaudeStructured` (not used by Bot; for the Haiku contest), an abort signal that kills the process tree, and a snippet of the raw output in "invalid structured output" errors (6 tests with a fake `claude`).
4. `warmagy.js`: the pre-warmed single-use agy pool (10 tests with a fake `agy`).
5. `frontdesk.js`, `router.js`, `router-brief.md`, `core.js`: Flash low, short briefing, plain JSON (the shape is described in the prompt and checked by `validateDecision`), warm pool, hedging at 7 s, deadline 20 s; the page's log says when a second call was started. Constants at the top of `frontdesk.js`: `FRONT_DESK_MODEL`, `HEDGE_AFTER_MS`, `DEADLINE_MS`, `DESK_CALLS`.
6. Experiment scripts in `experiments/`.

Security: nothing uses `--dangerously-skip-permissions`; the front desk process runs in the empty sandbox folder; the model's reply is still only accepted after `validateDecision`; protected files untouched; the real Bot on port 3000 untouched.

## What Omri needs to decide

1. **Fallback after the 20 s deadline:** keep Claude Sonnet (independent of agy; costs Claude plan) or Gemini Flash (cheap, same agy)? Kept Sonnet.
2. **`CLAUDE.md` says the front desk is "Gemini 3.8 Flash medium" and "Flash on low effort was dropped".** Both are out of date now (I did not edit `CLAUDE.md`).
3. **The answer model is the next bottleneck:** "gemini-flash" answers use Flash medium (about 10 s for the schnitzel answer). Flash low for everyday answers might halve that, but answer quality was not tested here.
4. If the Haiku contest (other session) wins on speed, the same `race()` can run it first with this Gemini desk as the hedge/fallback.

For the other side:
- agy's 5-6 s floor is mostly startup (about 2.2 s) plus thinking; a **single-use pre-warmed process** (start the next one after each reply, write the prompt on stdin in `--input-format stream-json`) cut Flash low to about 3 s with no conversation leaking. The same trick may help `claude -p` startup if it has a similar stream mode.
- **Plain JSON in the prompt, validated in code, beat `--json-schema`** on invalid replies (0 vs 3 in about 300 calls) and on the long-tail hang.
- Thinking effort, not prompt size, sets the time; the same wrong-route-free accuracy held for low effort on 49 messages.
- `experiments/frontdesk-ab2.js` has 49 cases with checkable reminders/calendar answers (fixed "now"), numbered facts and history; variants are `name:` entries and `GAP_MS` simulates a user pause.
- Validate with the **same clock** you put in the prompt (my one "failure" was a test clock mismatch).
