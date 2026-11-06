# Why answers still feel slow, and what was done (measured 2026-11-06)

Branch `claude/frontdesk-speed-01ec9f` (main `394d450` merged in first). Not pushed, not merged.
Raw data for every run below (JSON and logs) is in the shared notes folder, `answer-breakdown/`, not in the repo.
All runs used the **real profile block** and the real `agy`, one call after another unless a line says otherwise. Other sessions were sometimes using the laptop, so compare numbers inside the same table, not across tables.

## 1. Did it get slower after the changes? (the honest check)

**No. The front desk got much faster and the answer step did not change; the answer step is now most of the wait.**

The air fryer question, newest first, from the saved chats: 12.7 s (front desk 2.8 s + Flash medium 9.9 s), 16.3 s (6 s + 10.3 s), 40 s (25.7 s + 9.2 s), and on 2026-11-05 67 s (front desk 49.8 s + 12.4 s). The Flash-medium step is **9.2-12.4 s in every one of them**, so nothing slowed it. The total fell from 67 s to 12.7 s, but the feeling can still be "slow" because:

- the part that is left (about 10 s) is a model thinking and writing, and the front desk's 2.8 s no longer hides that;
- the page used to wait up to 2 s before showing a short reply (see section 4), which does not show up in any saved timing.

Checked directly: the streaming mode that answers use since yesterday is **not** slower than the old one-shot call (section 5b: median 10.6 s against 11.7 s), and the profile block is **not** slower than no profile (section 2).

## 2. Where the ~10 s of an answer go (Flash medium, 24 real calls with the profile, stream-json events with a clock)

| part | median | share |
|---|---|---|
| `agy` start-up (until its "init" event) | 2.6 s | 23 % |
| the model thinks before the first word (after the prompt is sent) | 6.0 s | 53 % |
| the model writes the answer | 2.5 s | 22 % |
| **total** | **11.5 s** | |

- agy's own token counts for a call: about **7,560 input tokens, 425 thinking tokens, 812 output tokens** (so about 390 visible tokens). Time to the first word is about 3.3 s plus about 7 ms per thinking token; writing runs at about 140 visible tokens per second. So **the time is mostly thinking and writing, which depend on the model and its effort**, not on the network or on Bot.
- **The profile block** adds about 600 input tokens and changed nothing measurable: median total 11.5 s with the profile against 12.3 s without it (24 calls each, taking turns; the profile even made answers a little shorter).
- Start-up is the only part Bot can remove (23 %), by starting agy before the question arrives.

## 3. What was built

1. **Pre-warmed answer process** (`warmagy.js` `askText`, wired in `core.js`). One `agy` waits ready for the model behind `gemini-flash` (Flash medium); the question is written to it when it arrives. It is started when a message arrives, and again after each answer. **Same rules as the front desk's:** ONE process per message (killed afterwards, nothing leaks between messages), the **same flags** as the normal streaming call (`-p= --input-format stream-json --output-format stream-json --model <m>`, no `--dangerously-skip-permissions`, empty sandbox folder), a dead or old spare is replaced at once, shell commands stay refused. 10 new tests with a fake `agy` (`warmagy-text.test.js`). A waiting process uses about **314 MB of RAM and no model quota** (measured); two of them (front desk and answer) are about 0.6 GB.
2. **Speculative answer** (`core.js`, switch `SPECULATE_ANSWER = true`). The `gemini-flash` model is asked **at the same moment as the front desk**, with exactly the prompt the real call would get. If the front desk then picks `gemini-flash`, that answer is used; for any other decision the call is killed at once. It is not started when the Gemini quota pool is nearly empty, for a forced chain, for a photo or for plan-only; if the speculative call fails, the normal chain runs, so nothing is lost; text written while the front desk is still deciding is not shown until the decision is `gemini-flash`. 10 tests (`core-speculate.test.js`).
3. **Page polling** (`public/index.html`): while a task is in its first 40 s the page asks every 0.6 s (it asked every 2 s while the front desk worked, and every 0.6 s only once a model was "asked"). 1 test.
4. Experiment scripts in `experiments/`: `answer-breakdown.js`, `answer-warm-ab.js`, `answer-speculative.js`, `answer-e2e.js`, `answer-check.js`, `answer-oneshot-vs-stream.js`.

## 4. The page's share (real page in the browser pane, spare ports, `hi`-type messages the front desk answers itself)

How long after the server finished did the answer appear on screen (8 greetings, English and Hebrew):

| page | median delay | range |
|---|---|---|
| old (polls every 2 s while the front desk works) | **0.85 s** | 0.4-1.8 s (7 of 8 finished in time) |
| new (polls every 0.6 s for the first 40 s) | **0.30 s** | 0.2-0.5 s |

So a front-desk-only reply (greeting, reminder, vague question) shows up about 0.5 s sooner on average and up to 1.4 s sooner in the worst case. For a model answer the page already polled every 0.6 s once the model was asked, so it adds 0.3 s there. The server's own overhead (`jobs.js`, saving the chat) is milliseconds. The first words appear on the page as soon as the poll sees them.

## 5. Cold vs pre-warmed, same model and same prompt (36 matched pairs, 12 questions, Hebrew and English, 3 rounds)

| | cold (today's main) | warm (a spare waits) | spare started 3 s earlier |
|---|---|---|---|
| median to the full answer | 12.1 s | **8.4 s** | 7.8 s |
| 90th percentile | 17.3 s | 14.1 s | 13.7 s |
| slowest | 23.1 s | 18.4 s | 19.3 s |
| median to the first words | 9.4 s | 5.9 s | 5.6 s |
| errors | 0 | 0 | 0 |

Warm was faster in **34 of 36 pairs**, a median of **3.2 s** saved. Quality check on all 108 answers (`answer-check.js`: the facts a good answer cannot skip, language, length): **0 missed facts, 0 wrong-language answers, 0 cut-short answers in every variant**, and the median length was the same (1,078 against 1,076 characters). It is the same model and the same prompt, so the answers only differ the way two answers from the same model differ.

### 5b. Did streaming (added 2026-11-05) slow the answer step? One-shot `agy -p` against stream-json, same model and prompt, 16 pairs, taking turns

| | one-shot (before streaming) | stream-json (now) |
|---|---|---|
| median | 11.7 s | **10.6 s** |
| 90th percentile | 20.5 s | 18.7 s |
| slowest | 21.9 s | 19.7 s (one more call hung, see below) |

In the 15 pairs where both calls finished, stream minus one-shot was a **median of -0.8 s** (stream slower in 5 of 15). **Streaming did not slow answers down.** One stream call of the 16 (the béchamel question) **hung until the 90 s Flash limit** and the chain moved on; it did not happen again in the roughly 110 other stream-mode answers made for these tests, so I cannot say if it is rarer than 1 in 100 or specific to streaming; the 90 s limit is what catches it (a lower limit for answers would make the fall-back start sooner, at the risk of cutting off a slow but valid answer).

## 6. Speculative answer: time saved and what it costs (16 questions x 2 rounds, both arms with warm processes)

| | sequential (desk first) | speculative |
|---|---|---|
| median total for the answers that went to `gemini-flash` (17 each) | 11.8 s | **7.5 s** |
| median front desk time | 2.6 s | 2.9 s (+0.3 s) |

Matched pairs where both arms chose `gemini-flash`: **4.0 s saved** (median, 14 pairs). **Cost:** the speculative call is wasted when the desk picks something else. In this test that was **15 of 32 messages (47 %)**, but the test set deliberately holds many non-everyday questions (code, web, reminders, proofs); on everyday traffic it would be lower. A wasted call is one Flash-medium call that is killed as soon as the desk decides (about 3 s of work, an average input of 7,500 tokens), from the Gemini pool; it never touches the Claude plan. Switch it off with `SPECULATE_ANSWER = false` in `core.js`.

## 7. Before and after, 28 real messages per arm through the real `handleTask`, taking turns

Before = what Bot did when this work started (the answer model starts its own agy when the front desk is done). After = the defaults now. 14 messages x 2 rounds: 12 everyday questions (Hebrew and English), a reminder, a greeting; 10 s between messages like in a chat. The front desk's own decisions vary from run to run, so the two arms did not always take the same route (15 against 17 messages went to `gemini-flash`).

| | before | after |
|---|---|---|
| **median, all 28 messages** | 12.6 s | **9.0 s** |
| 90th percentile | 24.3 s | 18.1 s |
| slowest | 29.5 s | 21.2 s |
| answers from `gemini-flash`: median | 13.0 s (15 messages) | **7.8 s** (17 messages) |
| answers from `gemini-flash`: 90th percentile | 24.3 s | 13.9 s |
| first words on the page: median | 11.6 s | **5.7 s** |
| errors / wrong language | 0 / 0 | 0 / 0 |
| missed facts (answer-check) | 1 | 0 |

By message (28 pairs): after was faster in **20 of 28**, median saving **4.0 s**; for the **13 pairs where both arms went to `gemini-flash`** the median saving was **5.2 s**. The 8 pairs where after was not faster: 5 took a different route in the two arms (for example the chicken question was answered in one line by the front desk in 2.7 s in the before arm and went to Flash medium for a full answer in the after arm, 5.2 s; "difference between TCP and UDP" went to Argon low before and Flash medium after, 11.65 against 11.68 s), 2 were front-desk-only replies (a reminder, a greeting: +1.7 s and +0.4 s, noise, since nothing on that path changed), and **2 were the same Argon-low route (+1.9 s and +0.4 s)**. Answers from other models (Argon low or medium) are not sped up by this work, and the wasted speculative call runs next to them for about 3 s; I cannot rule out a small cost there, but 2 samples within the normal spread show no clear one.

Worth knowing: in this run the front desk answered an everyday question itself (a one-line reply) on 3 messages in the before arm (the egg once, the chicken twice) and on 1 in the after arm (the egg), besides the 2 greetings in each arm. That is the desk's own choice (the briefing allows 1-2 sentence answers) and not part of this work, but those answers are far shorter than a `gemini-flash` answer; if Omri wants full answers for questions like "how long to boil an egg", the briefing line for the `answer` action is where to tighten.

## 8. Tried and rejected, with numbers

- **Hedging the answer** (start a second call if the first is slow): worked out from the 36 warm and 36 cold answer times. The second call has to be cold (the spare was used by the first) and takes 8+ s itself, so it almost never wins: **hedging at 8, 10, 12 or 15 s left the median (8.4 s), 90th percentile (14.1 s) and slowest (18.4 s) exactly the same**, and it would have started a second call on 61 %, 36 %, 28 % and 6 % of the messages. Rejected: all cost, no gain.
- **Lower effort for answers (Flash low):** not tried here, on instruction. (An earlier session measured low at 8.6 s against 10.0 s for medium with equal quality on 48 questions; that is a decision for Omri.)
- **Shorter prompt / dropping the profile:** no gain (section 2). Not done.
- **Shorter answers by asking for brevity:** would shorten the 22 % writing part and some thinking, but it changes what the user gets, so it was not tried without Omri's decision.
- **A lighter `agy` agent or settings (`--agent`, `--settings`):** `agy --help` shows these flags, but nothing in them removes thinking time, and `agy` always adds about 6,500 tokens of its own prompt. Not tried.
- **Standing spares for the Argon models:** 314 MB each, for destinations used less. Not done; `WARM_ANSWER_MODELS` in `core.js` is the one list to extend.

## 9. What cannot get faster

The thinking and writing of a medium-effort model (about 8.5 of the 11.5 s) is the model's own time: it depends on effort and on how long the answer is, not on Bot. What Bot could remove, it now removes: the 2.6 s start-up, the 3 s the front desk takes (overlapped by the speculative call), and up to 1.4 s of page delay. The remaining floor for an everyday Flash-medium answer is about 5.5 s to the first words and 7.5-8 s to the full answer.

## 10. Tests

`node --test --test-timeout=250000`: **406 tests, 3 full runs in a row, all passing.** Plus 10 repeated runs of `warmagy.test.js`, `warmagy-text.test.js` and `core-speculate.test.js` together, all passing. No test starts a real `agy` (every fake dependency set has `speculate: null` and a fake prewarm).

## 11. For Omri to decide

1. **Keep the speculative answer on?** About 4-5 s faster for the most common route, at the price of a wasted Flash-medium call on messages that do not go to `gemini-flash` (47 % in my mixed test set). One line: `SPECULATE_ANSWER` in `core.js`.
2. **RAM:** two waiting `agy` processes, about 0.6 GB.
3. The front desk's own short answers to everyday questions (section 7).
4. Flash low for answers, if Omri ever wants about 1.4 s more (earlier session's data; accuracy first).

For the other side: nothing new beyond the notes in `2026-11-05-frontdesk-speed.md`; the same single-use pre-warmed process rule is now used for answers too.
