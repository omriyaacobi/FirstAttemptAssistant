# Making Bot a better personal assistant: memory (2026-11-06)

## What was true before

- Bot's memory had never been used: 13 saved chats, 32 messages, 0 "remember" cards, and no `memory.json`. Only the counts were read, not the content.
- Every saved fact was pasted into every prompt, newest first, up to 2000 characters. Older facts were silently dropped. So a full memory cost the most, and still lost things.
- A saved-fact number was worked out twice (for the prompt, then again for the action), so if the list changed in between it could point at another fact.
- A new chat knew nothing about earlier chats.
- Bot never did anything by itself except fire reminders.

## What the research says

- **The usual loop is extract, then update.** Mem0, the best documented system, pulls facts from each exchange, then decides ADD, UPDATE, DELETE or nothing by comparing with similar saved facts. Bot already has this shape (`remember`, `replaces`, `forget`). What it lacked was showing the model the right saved fact to compare against, which search now does. [Mem0 paper](https://www.arxiv.org/pdf/2504.19413)
- **How you search matters more than how you write.** One controlled study on the LoCoMo benchmark found accuracy moved 20 points across retrieval methods but only 3 to 8 across write strategies. So search was the right first step. [arXiv 2603.02473](https://arxiv.org/abs/2603.02473) (checked in the abstract only)
- **Adding embeddings to keyword search (BM25) helps, but a little.** On one person's private history (201 queries), fusing BM25 with vector search scored MRR 0.759 against 0.745 for the best single method. [arXiv 2603.13017](https://arxiv.org/html/2603.13017v1) That is one person's data in a preprint, but it is the closest match to Bot found. Embeddings would need a package or a paid API call per message, so that small gain does not pay for them yet.
- **Memory is an attack surface.** "Memory poisoning" means text from a page or document gets stored as a fact and steers later sessions. Filters at the moment of asking miss it, because it was written weeks ago, and defenses built to spot instructions miss payloads with no visible pattern. The advice is to control the write path and keep track of where a fact came from. [arXiv 2606.04329](https://arxiv.org/html/2606.04329), [arXiv 2605.15338](https://arxiv.org/html/2605.15338) This is why a fact's words have to come from Omri's own message, and why pasted text never saves.
- I found no primary source on how ChatGPT's or Claude's consumer memory works inside, so nothing here relies on that. No source tested "ask the user before saving" directly either; that rule comes from Bot's own safety rules.

## What was built

1. **Only the facts that matter reach a prompt** (`pickFacts` in `profile.js`). Everything if it fits in 1000 characters. Otherwise: pinned facts, then search matches, then the 4 newest. It reuses `search.js` (BM25 on 3-letter pieces, which handles Hebrew), drops everyday words, and adds small word families so "what should I cook?" finds "is vegetarian". One numbered list per message.
2. **Saving with less friction, inside clear limits** (`explicitRemember`). Saved at once, with an Undo button, only if ALL of this holds: the user's own message opens or closes with an explicit "remember that" / "תזכור ש", it is one line of at most 300 characters, it has no link, and at least half of the fact comes from that message. Plain statements ("I'm vegetarian") and any change to a saved fact still need a tap. Text that reads like an order to Bot is refused, like secrets are.
3. **Fixing and forgetting.** Search puts the right fact in front of the front desk, so it can name it. If it names none, a forget request offers the closest fact on the card. A star in the sidebar pins a fact to every prompt.
4. **Recall** (`recall.js`, front desk action `recall`). "What did we decide about the laptop?" searches earlier chats. A cheap model answers from the excerpts, marked as data, with no web. If it fails, the excerpts are the reply. "What do you know about me?" is answered by code. Calendar replies and morning briefs are left out of the search, so no model reads an event title.
5. **Morning brief** (`morning.js`). Off until turned on in the page. Code writes today's calendar and reminders into a new chat. The push only carries counts, because it shows on the lock screen. Catch-up lasts 4 hours. Turning it on after today's time starts it tomorrow. No model and no fact can reach these settings.

## Measurements

All facts, chats and profiles in these runs were made up. Scripts: `experiments/memory-desk-timing.js`, `memory-recall-eval.js`, `memory-desk-check.js`.

**Does the needed fact reach the prompt?** 100 facts, 24 questions, English and Hebrew, no model involved:

| | Question shares a word with the fact | No shared word | Fact characters per prompt |
|---|---|---|---|
| Old way | 0 of 12 | 0 of 12 | 1987 |
| Keywords only | 12 of 12 | 1 of 12 | 185 |
| Keywords + word families (Bot now) | 12 of 12 | 9 of 12 | 240 |

Read this with care. The old way's 0 is built into the test, which makes the needed facts the oldest ones. I also wrote both the questions and the word families, so 9 of 12 flatters it. The 3 misses ("can I bring a pet on the train?", "I need a workout plan", "help me plan my study schedule") are the real limit of keyword search. Size is the solid result: about 2000 characters down to about 240.

**Front desk speed.** Real `decide`, 60 calls, 10 messages, 3 s between calls, 100 facts:

| | Before | After |
|---|---|---|
| Median | 3.98 s | 3.08 s |
| 9 in 10 calls under | 10.6 s | 7.5 s |
| Slowest call | 12.9 s | 16.9 s |
| Mean | 4.99 s | 4.06 s |
| Needed a second call | 21 | 13 |
| Failed | 0 | 0 |
| Profile and facts block | 4602 chars | about 3330 chars |

Not slower, and that is all this shows. The tail is random per call, so 60 calls cannot prove a speed-up, and the slowest call got worse. It also measures a FULL memory. With today's empty memory the prompt grows slightly (the `recall` line and one key). Picking the facts takes about 1.2 ms for 100 facts.

**Front desk decisions.** Real Gemini desk, 19 messages twice, English and Hebrew: 38 of 38 right, including the 6 new `recall` questions and "my bike is red" correctly changing a saved fact.

**Not checked:**
- Claude Haiku (the backup desk) on `recall`: every call in the worktree stopped at Claude's login. Only the test that the two briefings match has covered it.
- A real push reaching a real phone, and a real Google Calendar in the brief (the trial used a made-up calendar). The login expiry path is covered by a test only.
- A brief firing at its real time on the running Bot; the timer logic is tested with a fake clock.
- Real use: all of this rests on made-up data.

## Decided not to build

- **Embeddings:** need a package or a paid call per message, against Bot's no-install rule. The word families cover the common gaps cheaply. Worth another look if real use shows misses.
- **Facts saved from plain statements without a tap:** that is exactly the write path memory poisoning uses. Not worth it.
- **Automatic chat summaries:** cost quota on every chat and can state wrong things as memory. Recall searches the real text instead.
- **Facts that expire:** no real data yet to show it is needed. Bot has saved no facts so far.
- **Unprompted suggestions beyond the brief:** Omri should first see whether the brief itself is useful.
