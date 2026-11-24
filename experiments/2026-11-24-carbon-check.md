# Carbon check, 2026-11-24: can Omri's Google AI Pro plan use Gemini 4 Carbon in agy?

**Verdict: usable on Pro: YES in practice (all four Carbon models I tried answered with no error), even though Google's public pages say Carbon is Ultra-only. Pool: "Gemini Models" (the same pool as Neon and Hydrogen). Caveat: agy does not say which model really answered, so a silent fallback cannot be fully excluded.**

## What Google / the press say (web search, 2026-11-24)
- Several news and blog pages (Android Authority, 9to5Google, mixed-news, SmartScope, towardsai "Gemini 4 Carbon isn't in Google AI Pro") say Carbon launched for **Google AI Ultra** (Gemini app, AI Mode, Antigravity). Pro gets Argon, not Carbon.
- A third-party copy of the Antigravity "Choose a model" table lists Carbon for Ultra and Enterprise only (I could not verify it on Google's own page).
- Carbon reached paying developers/enterprise on 2026-11-10 (one source; another source disagrees). On 2026-11-11 Google's Varun Mohan reportedly said "broader rollout" is still being worked out, with no date for Pro.
- Google's own help page in the results was outdated (Gemini 3 era), so not useful.

## Live test (from an empty temp folder, no dangerous flags)
`/usage` before: Gemini Models weekly 88%, 5-hour 98%; Claude and GPT models weekly 46%, 5-hour 100%.

| Call | Model | Answer |
|---|---|---|
| 1 | gemini-4-carbon-low, "Reply with the single word ok." | `ok`, exit 0 |
| 2 | carbon-low, 17 x 23 | `391` (correct) |
| 3 | carbon-low, is 91 prime | "No ... 1, 7, 13, 91" (correct) |
| 4 | carbon-low, derivative of x^3 sin x | 3x^2 sin x + x^3 cos x (correct) |
| 5 | gemini-4-carbon-medium, "ok" | `ok`, exit 0 |
| 6 | gemini-4-carbon-high, "ok" | `ok`, exit 0 |
| 7 | gemini-pro-orchestrator, "ok" | `ok`, exit 0 |

No refusal, no error, no "upgrade to Ultra" message for any of them. I did not test gemini-pro-orchestrator-neon / -argon (not needed).

## Quota effect
- After call 1 nothing moved (one tiny call is under a point).
- After calls 1-4: **Gemini Models 5-hour went 98% -> 97%**; weekly stayed 88%; the Claude and GPT pool did not move (its 5-hour reset timer ticked only because time passed).
- After calls 5-7: no further visible change (still 97%, weekly 88%).
- **No new pool row appeared.** So Carbon spends the shared "Gemini Models" pool. Caveat: the evidence is one point of 5-hour movement, i.e. weak but consistent with Argon's 2026-11-23 behaviour; the quota guard saw "spent 0 of 2.64 points" (week level did not change).

## Plain explanation
The model name was accepted and answered. Google's pages say Pro should not get Carbon, so either agy/the server does not enforce it yet (rollout gap), or agy quietly answers with another model when the one asked for is not allowed. I cannot tell these apart from outside, because the answers to "ok" and easy math look the same on any model. A real test would be a hard question where Carbon is known to beat Neon, or checking whether per-call token/cost numbers differ from Neon. Access may also be removed later without warning (like Argon's pool changed), so a trial result today is not a promise.

## Calls made
7 model calls in total (limit was 10); 1 web search. Quota guard `begin --share 3` budget 2.64 points, spent 0 points by its week-level measure. No `.env`, Bot code or `data/` was touched.
