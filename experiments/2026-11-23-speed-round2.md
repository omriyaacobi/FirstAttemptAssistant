# 2026-11-23: Bot's speed, round 2: the model's own 8-10 seconds (to-do t19)

Round 1 (`2026-11-23-speed.md`) fixed agy's start-up delay. This round attacks the big part: the time the model spends
thinking and writing. A typical Neon low call is 8-9 s, and the first words show only at the end of the thinking.

Scripts (all in `experiments/`, invented prompts only, Bot's real `brain-brief.md` at the head):
- `speed-timeline.js`: one agy call, event by event, with timestamps (kinds and sizes only, never text).
- `speed-round2.js`: the lab. `arms` = the same question with different prompt lines; `cache` = a round-1 call and then the
  same prompt plus a tool result (a real tool round); `floor` = a tiny prompt; `table` prints the results.
- Raw numbers: `speed-round2-results.json`. The answers' text was saved outside the repo and read by hand for correctness.

Spend: 145 Neon low calls (the "Gemini Models" pool), one at a time, arms alternating. No Claude plan. Nothing went through the
running Bot.

## Short answer (simple words)

- **Most of what the model "writes" is hidden thinking.** agy's `output` count INCLUDES the thinking tokens (round 1 added them
  up as if separate). In Bot's real answers Neon low writes about 570 tokens per call, and about 390 of them are thinking. The
  visible reply is only about 180 tokens (about 700 characters). So **the answers are already short. Thinking is the lever.**
- **Nothing shows on the page while the model thinks.** agy sends no events at all during the thinking. Example timeline (one
  long answer): prompt written at 0 s, then nothing until 8.6 s, then 82 text pieces until 12.1 s, then the result at 12.2 s.
- **One line right after Omri's message cut the thinking by 30% and the call by about 0.8 s:**
  `(Answer at once. Plan only as much as this message needs: a clear question or a clear tool call needs almost no planning.
  Then write.)` Over 98 calls: thinking 401 -> 272 tokens, call 6.5 -> 5.7 s, first words 5.8 -> 5.0 s. Every answer was still
  right (math, two trap questions, tool calls, reminders, two things in one message). **Built** (its own commit).
- **The same rule written into the briefing did NOT help** (6.9 s, thinking 469). The models listen to what sits next to the message.
- **Asking for shorter answers did nothing** (6.5 s, the same as without). The visible text is already small.
- **Prompt caching never happens for Neon low through agy:** 0 cached tokens in all 145 calls. That includes 5 real
  tool-round pairs, where the second call repeats the first call's 20,000-token prompt a few seconds later. Bot's briefing is
  already first in the prompt, so no layout change can help.
- **The floor:** a 5-word prompt answered "OK" still takes 2.5 s to its first word (agy and Google's own time).
- **Racing a second model ("hedging") does not pay.** It cuts at most 0.1 s on average, even in the best case, and fires on 19-59%
  of calls. Simulated on 121 real Neon low first calls.
- **Tool rounds:** running a tool takes about 0.1 s, so fetching its result early in parallel saves nothing. The cost is the extra
  model round (on real 2-call messages: round 1 is 6.0 s just to write the CALL line, round 2 is 11.4 s). The only cure is to make
  the round unneeded. **Built:** the course's whole file list now rides along for the course the talk is in (it is small).

## 1. Inside one call (`speed-timeline.js`, `floor`)

| what | seconds |
|---|---|
| agy start-up to "init" (hidden by the warm spare since round 1) | 2.2 |
| prompt written -> agy says "got it" | 0.07 |
| -> first visible word (thinking 682 tokens, 20k prompt) | 8.6 |
| -> last word (1,447 characters in 82 pieces) | 12.1 |
| -> result | 12.2 |
| floor: 5-word prompt, answer "OK" (5 runs, median) | 2.5 to first word, 2.6 total |

agy streams only the visible text (`agent_response` steps with `text_delta`), never the thinking. So the page cannot show
anything sooner, except a "thinking" sign, which it already shows as the step line.

**Correction to round 1:** `output_tokens` already contains `thinking_tokens`. Here, text characters / (output - thinking) is
2.4-3.9 characters per token for every call, a normal rate. Without subtracting it would be under 1, which is impossible. So
round 1's "every 200 tokens of answer is about 1 s" is right, but most of those tokens are thinking. Round 1's recommendation
"shorter answers are the biggest lever" is replaced by "less thinking" (below).

## 2. Less thinking: one line next to the message (`speed-round2.js arms`, Neon low)

Six questions, in an invented Calculus/Systems context like Bot's real prompt (about 20k tokens):
math (the end points of a power series), tool ("my main.c crashes, look why": the right reply is project_read), cal
("what do I have tomorrow, remind me 30 min before": set_reminder + the answer), multi (a reminder AND a math answer in one
message), trap ("it converges by Leibniz, right?": it does not), pval (for which p does sum 1/(k (ln k)^p) converge).

| question | base n | base s | base first words s | base thinking | quick n | quick s | quick first words s | quick thinking |
|---|---|---|---|---|---|---|---|---|
| math | 13 | 6.4 | 5.5 | 268 | 9 | 5.9 | 5.0 | 246 |
| tool | 13 | 6.2 | 5.7 | 369 | 9 | 5.6 | 5.0 | 276 |
| cal | 13 | 7.2 | 6.7 | 574 | 9 | 5.9 | 5.3 | 317 |
| multi | 8 | 7.3 | 6.4 | 478 | 4 | 6.4 | 5.3 | 308 |
| trap | 5 | 6.7 | 5.8 | 333 | 5 | 5.7 | 4.8 | 214 |
| pval | 5 | 4.8 | 4.0 | 158 | 5 | 4.7 | 4.0 | 154 |

All arms (median per call):

| arm | n | s | first words s | thinking | output (incl. thinking) |
|---|---|---|---|---|---|
| base (Bot today) | 57 | 6.5 | 5.8 | 401 | 483 |
| quick (the line after the message) | 41 | 5.7 | 5.0 | 272 | 360 |
| short ("at most about 6 sentences") | 15 | 6.5 | 5.8 | 352 | 457 |
| quicktop (the same rule inside the briefing) | 16 | 6.9 | 6.1 | 469 | 567 |

- The line cuts thinking where the model over-plans (a calendar question: 574 -> 317) and leaves it alone where it is needed or
  already small (pval: 158 -> 154). That is what it should do.
- **Correctness, read by hand:** every answer in both arms was right. The trap was caught every time ("terms k do not go to 0, it
  diverges"), with p > 1 by the integral test. The reminder was always 09:30 / 09:00 tomorrow, and both parts of "multi" were
  done every time. The tool question always asked for main.c (plus list.c, list.h). One quick math answer gave the end-point
  series a step earlier than the others. That is a hint, not a solution.
- Noise: the same arm moved by up to 1.5 s between batches (tool base: 7.1 s in the first batch, 5.6 s in the second). So the
  first batch was confirmed with a second one (32 calls, arms alternating). The direction held on tool, cal and multi. Math was
  flat in the second batch.
- **What it is worth in Bot:** about 0.8 s per model call, so about 1.6 s on a 2-call message, and about 120 fewer output tokens
  per call (a small quota saving, not a cost). On a 14 s answer that is about 6-10%.
- Not tested with a photo, so it is off for photos (reading a photo carefully matters more than a second).

## 3. Time to the first words on the page

The whole path was read: `warmagy.js` -> `brain.js` stream filter -> `jobs.js` `job.partial` -> the page polls
`/api/thread/jobs`.
- **The answer IS streamed as it is written.** Nothing is held back, except what must be:
  - CALL lines are hidden (by design).
  - The reply a model writes under CALL lines for a doing-tool (a reminder) is shown only after the tools worked. That is
    Omri's rule: "Bot's reply to a doing-tool is shown only if every call worked".
  - The thinking, which agy never sends.
- The page polls every 600 ms while an answer runs, so the first words appear on average about 0.3 s after Bot has them. Pushing
  them instead of polling (server-sent events) would save about 0.3 s. Not built: small, and it would change every page's job
  updates.
- **There is no first sentence to show earlier:** the first sentence comes right after the thinking, and is shown at once.

## 4. Prompt caching (`speed-round2.js cache`)

- Neon low: `cacheRead` was 0 in all 145 calls of this round and all 20 of round 1. The 5 cache pairs are the strongest test: a
  round-1 call, then 0-1 s later the SAME 20k-token prompt plus a tool result (exactly what a Bot tool round sends). The second
  call still read 0 cached tokens and was not faster (its first word at 7.2 s; it thinks more, 538 tokens, because it now
  explains the bug).
- In the real token log, Argon low and Hydrogen medium sometimes report cached tokens (Argon low 2-21k per call on some days),
  Neon medium about 1k, and Neon low none on 20-22 Nov. That is decided by agy/Google, not by Bot.
- Bot's prompt is already in the best order for a cache (briefing first, then time and context, the new message last).
  **Nothing to change.**

## 5. Tool rounds: prefetch or put it in the prompt

- From the real log (20-23 Nov, Neon low, 2-call messages, n 23): **round 1 median 6.0 s** (only to write the CALL lines) and
  **round 2 median 11.4 s**.
- Running a tool is fast (round 1's "other" time on 2-call messages was 1.0 s against 0.9 s for 1-call messages). So starting
  the likely tool in parallel with round 1 would save about 0.1 s and cost a guess. **Not worth it.**
- So the only cure is to make round 1 unneeded, by having the answer's material in the first prompt. Of the first tools in real
  lookup messages:
  - **course_files** (4 of 49 in round 1's window; 5 of 17 on 23 Nov alone). It only LISTS a course's files. The real lists are
    small: 9, 13, 49 and 71 files, which is 377 to 2,852 characters, about 100 to 800 tokens. **Built:** for the course the talk
    is in, the whole list rides along (`fileListText` in `brain.js`, the same text the tool gives), capped at 4,000 characters
    (above that, the tool is still there). Cost: at most about 800 tokens on course messages. One avoided round saves about 25k
    tokens and about 10 s, so it pays for itself if 1 course message in about 30 avoids a round. The real rate looks much higher.
    Not measured live yet (it needs the merge). After the merge, check `First tool asked in those` in `speed-measure.js`:
    course_files should almost vanish.
  - **project_read** (18 of 49). Bot already sends the code file changed last (plus two more from the last 48 hours). Nobody
    knows how often the model re-reads a file that was already there. **Built:** the answer's log line now says
    `N project_read of code already in the prompt`, and `speed-measure.js` counts it. If it is common, the briefing line "the
    newest code is often already shown" needs to be firmer. If the file read is usually a DIFFERENT one, putting more files in
    the prompt is a quota trade for Omri (round 1's proposal 3).
  - **course_read / lecture_parts:** these need pages that are not in the prompt. Prefetching them means guessing pages, and the
    prompt already carries the best-matching pages. Not touched.

## 6. Racing / hedging (real log, simulation)

121 real Neon low first calls (20-23 Nov): median 8.9 s, p90 14.1 s, p95 15.1 s, max 22.7 s. Only 1 failed try in 224 messages.
Simulation of "start a second Neon low call if the first is not done after N s, take whichever ends first". Each call's time is
drawn from that real list, and the two are assumed independent. That is the BEST case: a long answer is slow on both tries.

| N | mean s (no hedge 9.26) | p90 s (no hedge 14.1) | extra calls |
|---|---|---|---|
| 8 | 9.13 | 13.9 | 59% |
| 10 | 9.20 | 14.1 | 29% |
| 12 | 9.23 | 14.1 | 19% |
| 15 | 9.26 | 14.1 | 6% |

At best it saves 0.1 s for 20-60% more calls. The tail is long answers, not slow servers. The lab shows the same: one prompt
repeated gives 9-13 s. "No first word after N s" is no signal either, because no word ever shows before the thinking ends.
**Not worth it.**

## 7. What was changed (this branch)

| change | file | effect |
|---|---|---|
| the "plan only as much as needed" line after Omri's message (not with a photo) | `brain.js` (`QUICK_LINE`, in `tail`) | about -0.8 s per call, -30% thinking tokens |
| the course's whole file list rides along (up to 4,000 characters) | `brain.js` (`fileListText`, `prefetch`, `LIMITS.fileList`) | saves a course_files round (about 10 s) when it would have been needed |
| re-reads of code already in the prompt are counted on the answer's log line | `brain.js` (`ctx.shownCode`, `ctx.rereads`), `experiments/speed-measure.js` | data for the next decision; no effect on answers |
| tests | `tests/brain.test.js` (3 new) | fake models only |

The thinking line is its own commit, so it can be dropped alone (`git revert <that commit>`).

## 8. Ranked recommendation

1. **Keep the thinking line** (built). It is the only thing found that shortens the model's own part: -0.8 s on every call and
   -1.6 s on a 2-call message, with no quota cost (it saves tokens). It changes how the model works, not what Bot says. **Omri's
   yes is needed before merging.** If he wants a quieter start, drop that one commit.
2. **Keep the file list up front** (built). It is within the agreed design ("the courses and their files" are in every context).
   Up to 10 s on the messages it helps, and about 800 tokens at most.
3. **Read the new re-read counter after a few days** (built). It decides whether more linked-folder code should ride along.
4. **Not worth doing:** hedging/racing (about 0.1 s for 20-60% more calls), asking for shorter answers (no gain), prompt
   layout for caching (Neon low never caches; the order is already right), parallel tool prefetch (tools take about 0.1 s).
5. **Small, optional:** pushing the answer to the page instead of polling every 600 ms (about 0.3 s to the first words).

For Omri to know: the picker's **Neon medium** thinks about twice as much (782 thinking tokens per call on 22 Nov) and is about
4.5 s slower per call. The thinking line should shorten it too, but this round did not measure that.

## Limits

- One machine, one afternoon. Batches differed by up to 1.5 s for the same arm, so only the pooled and repeated results count.
- Invented prompts and questions shaped like Bot's (no real chats). The hard questions were math only. A long code review on a
  real file was not tested with the thinking line. Watch the first days after the merge.
- The file-list change was tested with fake models only. Its real effect shows in `speed-measure.js` after the merge.
