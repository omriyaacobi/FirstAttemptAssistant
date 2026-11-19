# 2026-11-20: why does Hydrogen medium fail with "agy status ERROR"?

**Short answer: not found yet, because Bot threw agy's reason away. Now it is logged.** Nothing else was changed (no retries, no order change).

## Evidence (from the job logs in `data/thread/*.jsonl`; `data/bot.log` has none of these lines)
- 15-19 Nov: 357 first-choice asks to Hydrogen medium, 50 failed, ALL as "agy status ERROR" (14%). Argon low failed twice in the same days (a 240 s timeout, one early close) and never with status ERROR.
- Per day (asks / failures): 15 Nov 22/1, 16 Nov 41/3, 17 Nov 85/12, 18 Nov 158/30, 19 Nov 51/4. The 19th is no better than the 17th in rate; the 18th is the worst (19%).
- Time to failure: 7.7 to 18.7 s (one 70.6 s). So it is not a timeout; agy answered quickly with a failed result.
- First round of a message: 44 of 240 failed (18%). Later tool rounds: 6 of 117 (5%). The first round is the one with the long context.
- Not the warm spare's age: by the gap since the previous message the rate is flat (about 15-20% for gaps under 8 minutes, 7-13% above; no pattern).
- Three real calls from an empty folder under `bot-brain` (prompts of 3.7k, 22.7k, 22.7k tokens): all SUCCESS in 4-5 s. A plain call cannot reproduce it, so it depends on something in the real call (the content, load, or Google's side).

## What Bot threw away
agy's last event is `result` with `status`, `response`, `usage`... and on a failure probably `error` (`selfedit.js` already reads `result.error`). `providers.js` and `warmagy.js` (the brain's road) kept only `"agy status " + status` and dropped `error`; stderr was dropped too. So the log could not say whether it was a rate limit, a safety block, a server error or a crash.

## Change
- `providers.js`: new `agyFailure(result, stderrTail)`: message becomes `agy status ERROR: <reason>` (agy's `error` text or `error.message`, else the last bit of stderr; one line, last 200 characters). The start of the message is unchanged, so everything that matches "agy status ERROR" still works. `askAgyStream` keeps a stderr tail.
- `warmagy.js`: the warm pool (the brain's real road) uses the same helper and keeps a stderr tail.
- `tests/agy-failure.test.js`: helper cases, stream and warm pool, `error` field and stderr only.
- Not touched: `brain.js`, the model order, the protected files.

## Next
Read `[brain] ... failed after N s: agy status ERROR: <reason>` in the next thread job logs. Then decide: a rate limit or server error (Google's side: leave it, Argon takes over), or something about the content (a Bot fix).
