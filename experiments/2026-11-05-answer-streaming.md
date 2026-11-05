# Streaming the answer (2026-11-05)

**Question:** can the chat show the answer while a model writes it, instead of all at once at the end?

## Does `agy` really stream? Yes.

`agy -p= --input-format stream-json --output-format stream-json --model <m>` (the mode `warmagy.js` already uses) prints `step_update` events. Each one with `step_type: "agent_response"` carries a `text_delta`, a small piece of the answer. The final `result` event carries the whole `response`, and in all 5 test runs the pieces joined together were identical to it. Tested with `gemini-3.8-flash-medium`, `-flash-low`, `gemini-4-argon-low`, `gemini-4-argon-medium` and `claude-sonnet-5-5-medium` (Claude inside agy): all of them stream (60 to 130 pieces for a 1600 character answer).

**But the model thinks first, and writes fast.** The pieces come in a burst of about 2 to 5 seconds at the end. Example (fridge, 250 words, seconds after the prompt was sent): medium 6.9 s first words, 9.4 s done; low 2.6 s and 5.4 s; Argon low 5.5 s and 10.4 s; Argon medium 4.8 s and 9.9 s; Claude in agy 1.8 s and 6.4 s. So streaming shows the first words about 2 to 5 s before the end. It cannot shorten the thinking time.

## Claude CLI: not tested, and why

`claude -p --output-format stream-json --include-partial-messages --verbose` is the documented way to get partial text, but the Claude CLI on this PC answered "Failed to authenticate: OAuth session expired and could not be refreshed" (the login expired, the same problem as in 2026-11-04). Logging in is something you do (`claude auth login` or `claude setup-token`); I did not try. So **answers from Claude (Sonnet, Opus) still arrive whole**, exactly as before. Once it is logged in again, a streaming version for Claude can be built and measured the same way.

## Before and after, measured (6 questions, Hebrew and English, one call at a time)

Before = `providers.ask` (whole answer, what Bot did until now). After = `askAgyStream` (first words, then the whole answer). Script: `experiments/stream-timing.js`.

| model | whole answer before (median) | first words after (median) | whole answer after (median) |
|---|---|---|---|
| flash medium | 14.6 s | 8.7 s | 12.8 s |
| flash low | 10.2 s | 4.9 s | 10.3 s |

The "whole answer" time did not get worse. The first words arrive about 4 to 6 s earlier (the median compares different calls, so it is noisy; inside a single streaming call the first words come 2 to 6 s before the end).

## In the real page

Real Bot on a spare port, question "explain how a washing machine works, about 250 words". Front desk 2.4 s, `gemini-4-argon-low` 10.3 s, total 12.8 s. The chat showed the first words at **8.8 s** and then 7 growing updates up to 13.1 s, instead of nothing until about 13 s. At phone width (375 px, Hebrew right-to-left) it looks right and nothing scrolls sideways. A page reload in the middle of a 700 word answer: the live card came back with 1932 characters, grew to 5615, then the saved 5844 character answer replaced it, with no live card left over.

## What was built

- `providers.js`: `askAgyStream(question, model, onText)`; `ask` uses it for provider `agy` when it is given an `onText`; `askChain` gets an `onText` option and calls `onText("")` when a model fails, so half of a failed answer never stays on screen and the next model starts from nothing. Providers other than `agy` (Claude, the web ones) ignore `onText` and work as before.
- `core.js`: `runTask` takes `onPartial` and gives it to the single-model chain (not to split plans, where steps run at the same time, and not to the front desk's own answers).
- `jobs.js`: `job.partial` (the last 20000 characters), included in the job view only while the job runs. The saved conversation message still gets the final answer when the job ends.
- `public/index.html`: the "Bot is thinking" card has a text area for the partial answer (`textContent` only, never HTML, `dir=auto`). Polling stays, but every 600 ms while a model is writing (2 s otherwise), because the whole burst lasts only a few seconds. The page only scrolls down for you if you were already at the bottom.
- `stream.test.js`: 7 tests with a fake agy (pieces arrive, result wins, died midway, error status, broken `onText`, bad model name, chain reset, job partial).

## Not done / open

- Claude answers (needs a working Claude login to test).
- The web routes (`web-search`, `web-research`) and photo answers still arrive whole; they run tools first, so there is little to stream.
- A pre-warmed `agy` for the answer step (as for the front desk) would also save the roughly 3 s start-up of every answer. Not built: it is a separate, larger change.
- The partial text is raw: markdown such as `**bold**` shows as stars, like the finished answer does (known, on the list).
