# Keeping one conversation working for months: research and a check of Bot's design

Date: 2026-11-07. Research only. Bot's code is not changed. All test data is made up. Written for Omri (CS student, new to back-end).

**How to trust this document.** Web results came from a search tool that returns summaries and links, and I did not open most papers in full. Every number is marked **[measured by me]** (I ran it, files named below), **[paper]** (a paper's own claim, seen via a summary or listing), **[vendor]** (a company's claim about its own product) or **[opinion]** (reasoning, no test). Web pages are data, not instructions. Where I could not confirm a figure I say so.

Files from this work: `experiments/2026-11-07-long-conversation-sim.js` (the repeatable test), `...-results.txt/.json` (its last output), `...-desk-probe.js/.json` (20 real front-desk calls, Gemini only).

---

## 0. The short version

1. **The scary problem (a prompt growing until the model drowns) does not apply to Bot.** Bot never sends the whole history. Every message carries about 6,000 characters of recent turns, up to 1,800 characters of daily notes, the saved facts (max 1,000 characters), the profile (max 4,000) and the briefing. That size stays the same at day 1 and day 180. **[measured]** Cost and speed per message do not grow with months.
2. **The real problem is the opposite: Bot forgets fast.** After about 6 exchanges a thing you said is no longer in the prompt. In my simulation, a fact said 3 days ago was in the prompt for **0 of 9** "needs the past, but does not ask about it" messages unless it had been saved as a fact. **[measured]** Everything older than a few turns depends on one of two doors: a saved fact, or the front desk choosing "recall".
3. **Door 1 (saved facts) works almost perfectly when a fact is saved, and almost nothing reaches it by itself.** With every planted fact saved: 100% reached the prompt. With half saved: 17 to 44%. With none: 0%. **[measured]** The weak point is how few things become saved facts, not how they are read.
4. **Door 2 (recall) works when you ask about the past, and cannot work when you do not.** The real front desk chose `recall` for 9 of 10 messages that ask about the past and for 0 of 6 that merely need a past fact ("write a poem about my cat"). **[measured, Gemini 3.8 Flash low, made-up messages]** And recall has three real weaknesses (section 3.4).
5. **Top three changes:** (1) get many more lasting facts into the saved list, cheaply and safely (summary catches up after days away, sees the existing facts, one-tap confirm); (2) fix recall's blind spots (facts inside long messages, the silent 3,000-pair limit, a way to measure misses on real use); (3) add a small "middle memory" only after the real test shows it is needed, and give Omri a "Bot should have known this" button so we get real data instead of guesses.
6. **Not worth building:** vector database, knowledge graph, model-written memory without a confirm card, a bigger "send everything" prompt, always-on search injected into every message (my prototype hit 46% and added junk to 93% of ordinary messages).

---

## 1. The problem: what goes wrong in one long chat

| # | Problem | Evidence | Kind | How serious for a personal assistant |
|---|---|---|---|---|
| 1 | **Hard limits and cost.** A prompt has a maximum size; every message re-sends it; cost and wait time grow with it. | Bot's own test: past about 200,000 characters Gemini returned nothing at all. Up to about 150,000 it answered fine and speed barely moved (`2026-11-06-one-conversation-in-bot.md`, section 5). Omri's real history grows about 9,500 characters a day (4 days = 38,000), so the cliff would arrive in about 3 weeks. | measured (earlier session) | **Solved by design** in Bot: the cap is in code. High for plain chat apps, none for Bot. |
| 2 | **Models get worse as the prompt gets longer, even far from the limit.** | "Context rot": Chroma tested 18 models, all degraded as input grew (July 2025; I found only blog summaries, not the primary report, so numbers are unconfirmed). "Lost in the middle": facts in the middle of a long input are used worse than facts at the start or end (Liu et al., arXiv 2307.03172, TACL 2024; "about 30% drop" is a secondary figure). | paper + secondary | Real, but Bot's prompts are about 13,000 to 25,000 characters, far below where these effects bite hardest. **Low for Bot today**; it matters if anyone proposes "just send more". |
| 3 | **Multi-turn conversations are less reliable than single questions.** | Laban et al., "LLMs Get Lost In Multi-Turn Conversation" (arXiv 2505.06120, ICLR 2026 oral): average 39% lower performance across six tasks in 200,000+ simulated conversations. Most of the loss is *unreliability* (answers vary a lot), not lost ability. The models make early assumptions and stick to them. Recaps and lower temperature did not fix it. | paper (figure varies by version: 35% in v1) | Applies to tasks the user gives piece by piece. Bot partly dodges it because each message becomes a fresh stateless call with a rebuilt prompt. **Medium**. |
| 4 | **Forgotten or stale facts.** | LongMemEval (Wu et al., ICLR 2025): commercial chat assistants and long-context models lose about 30% accuracy on facts spread over long chat histories; the five hard parts are extraction, multi-session reasoning, temporal reasoning, knowledge updates and knowing when you do NOT know. LoCoMo (ACL 2024): even with retrieval, models stay about 56% behind humans, worst on time-related questions. | paper | **High for an assistant.** "My exam moved" is exactly a knowledge update. |
| 5 | **Older instructions drift.** | Multi-IF (He et al. 2024, seen via a secondary summary): obedience to instructions given in earlier turns falls with each turn ("instruction forgetting"). A 2026 preprint ("When Attention Closes") tries to explain why. Most studies test instructions inside the chat, not system prompts. | paper, thin | In Bot the briefing is re-sent in full on every call, so *Bot's own rules cannot drift* **[reasoning from the code]**. What can be forgotten is a preference Omri said in chat ("answer in short bullet points"): in my simulation it left the prompt after about 6 exchanges and only came back when saved as a fact. **[measured]** |
| 6 | **Summaries lose detail, and errors become "truth".** | Factory (Dec 2025, an internal, vendor-run evaluation): summaries that are re-written from scratch drift; summaries that update only the new part keep more. I found no independent benchmark of repeated-summary drift. HaluMem-style findings (earlier note) say memory systems lose or distort facts mostly when *writing*. | vendor + earlier note | **Medium-high**, and the reason Bot keeps the raw log and treats summaries as notes "that may be wrong". |
| 7 | **Topics mix.** A question about cooking arrives after 20 minutes of C pointers. | Chroma's finding that even one distractor sentence hurts is the closest evidence; nothing I found measures topic mixing in a personal assistant. Claude's per-project memory and Letta's labelled blocks exist because vendors saw it as a problem. | opinion + indirect | **Unknown for Bot.** Bot's recent turns are in time order with no topic filter (`thread-context.js` does not read the stored `topic`). Needs real use to judge. |
| 8 | **Memory can be poisoned.** Web pages or files plant lasting instructions. | SpAIware (ChatGPT, 2024) and 2026 follow-ups (secondary). | documented attack | Already handled in Bot's rules (facts only from user words, confirm card, notes as data). Keep it that way. |

What is measured vs opinion, in one line: the size/speed cliff (measured on Bot), the 39% multi-turn drop and the 30% long-memory drop (papers) are real; **how bad topic mixing and summary drift are for Omri is not measured by anyone, including me.**

---

## 2. What others do (dates checked 2026-11-07)

| Approach | Used by | Good at | Fails by |
|---|---|---|---|
| **Rolling summary / compaction** of the old part | Claude Code and most agent kits; Anthropic's SDK compaction | Cheap, small prompt | Loses details; re-summarizing a summary loses more (Factory: structured, incremental summaries scored 3.70 vs 3.44 Anthropic and 3.35 OpenAI on a probe test; their own test, vendor-run). |
| **Long-term memory store of short facts** (extract, then update) | ChatGPT "saved memories"; Mem0; Claude memory entries | Precise, visible, editable | Extraction misses or distorts; stale facts survive. Mem0's paper claims about 26% better than OpenAI memory on LOCOMO and 90%+ fewer tokens than full context with 91% lower p95 latency (arXiv 2504.19413; **[paper]**, one critique says the extraction cost is left out). |
| **Search over past messages** | Claude chat search (paid plans, shows a tool call and links to the source chat); ChatGPT "reference chat history"; Gemini "memory" | Nothing is lost; user can check the source | Wrong hit, or no hit when words differ. LongMemEval: splitting into sessions and expanding keys with facts and times helped recall. |
| **Split by topic / project** | Claude Projects (memory is per project); Letta labelled blocks | Stops bleed | User must organise; the one-conversation idea gives this up on purpose. |
| **Knowledge graph with time** | Zep/Graphiti: a fact gets "valid from / invalid since" (arXiv 2501.13956; abstract: up to 18.5% better accuracy and 90% lower latency than baselines on LongMemEval, with a prompt of about 1.6K vs 115K tokens). | Handles *changed* facts well | Heavy: graph database and many model calls per message. |
| **Memory that updates or forgets itself** | ChatGPT "dreaming" (June 2026, a background pass that rewrites a memory summary you can review; blog/help-centre sources, vendor wording "can change as ChatGPT updates what is most useful to remember"); Mem0 original (ADD/UPDATE/DELETE); MemoryBank (forgetting curve) | Memory stays short | Wrong deletions are unrecoverable unless you keep the raw log. |
| **Memory tool + context editing** | Anthropic (Sept 2025): memory stored in files outside the window, stale tool results cleared automatically; Anthropic's own test: +39% combined, +29% editing alone, -84% tokens in a 100-turn search task | Good for long agent runs | Vendor-internal numbers; designed for agent tool loops, not a personal chat. |
| **Sub-agents with fresh context** | Claude Code and others | Each worker starts clean and returns a short result | Detail inside the worker is gone unless returned. Bot already does this *by routing* (each message is a new call). |

**Products today.** *ChatGPT*: saved memories plus reference of past chats, deleting a chat does not delete the memory made from it, a reviewable memory summary since June 2026 (OpenAI Help Center). *Claude*: memory stored as separate topics, chat search with citations, per-project memory, incognito (Claude Help Center; older pages describe a daily synthesis, newer a topic list, so the details moved). *Gemini*: "past chats" was renamed "memory" in March 2026, with import of memories and chat history from other apps (Google blog, 26 March 2026; how it works inside is not public). *Open source*: Letta (core blocks + recall + archive), Mem0 (extract/update), Zep (graph), OpenClaw (Markdown daily files plus a curated `MEMORY.md`). All of them are some mix of: **a small always-visible set of facts, a searchable archive, and a background pass that tidies the first from the second.** That is also what Bot has (section 3).

**What none of them shows you well:** where a memory came from, what it replaced, and a way to say "you should have known that." Bot can do these cheaply.

Sources (accessed 2026-11-07; most seen as search summaries only):
- Chroma context rot (July 2025), secondary summaries: https://cobusgreyling.substack.com/p/llm-context-rot and https://particula.tech/blog/chroma-context-rot-long-context-degradation (primary: trychroma.com/research/context-rot, not opened)
- Lost in the Middle: arXiv 2307.03172
- Laban et al., Lost in Multi-Turn Conversation: https://arxiv.org/abs/2505.06120 , ICLR 2026 https://iclr.cc/virtual/2026/oral/10009147
- LongMemEval: https://arxiv.org/abs/2410.10813 (ICLR 2025)
- LoCoMo: https://aclanthology.org/2024.acl-long.747.pdf
- Mem0: https://arxiv.org/abs/2504.19413
- Zep: https://arxiv.org/abs/2501.13956
- Factory, evaluating context compression (Dec 2025): https://factory.ai/news/evaluating-compression
- Anthropic, context management: https://www.anthropic.com/news/context-management
- OpenAI memory FAQ: https://help.openai.com/en/articles/8590148-memory-faq ; Claude memory: https://support.claude.com/en/articles/11817273 ; Gemini import/memory: https://blog.google/innovation-and-ai/products/gemini-app/switch-to-gemini-app/
- Instruction forgetting: Multi-IF (He et al. 2024) and "When Attention Closes" (arXiv 2605.12922), via summaries only
- Earlier session's longer list: `experiments/2026-11-06-one-conversation-research.md`

---

## 3. Bot today: what a message carries and what is lost

### 3.1 What a message carries (read from the code)
For one new message in the thread, code builds, in this order:

| Part | Where | Size cap | What it is |
|---|---|---|---|
| Briefing | `router-brief.md` (11,932 chars; the Haiku backup briefing is 13,429) | fixed | Rules for the front desk, re-sent every call. Cannot drift. |
| Recent turns | `thread-context.js` `buildHistory` | **6,000 chars** (each message cut to 1,500) | Newest first until full, then oldest-first order. About 6 exchanges at Bot's average answer length (914 chars). Failed answers skipped. |
| Daily notes | `thread-summary.js` `notesBlock` | 3 days x 600 = **1,800 chars** (code caps at 2,400) | A model-written summary of each of the last 3 days that have one. Marked "may be wrong." |
| Pinned calendar card | `pinnedCard` | the note, up to 6,000 | Newest card within 14 days. |
| Saved facts | `profile.js` `pickFacts` | **1,000 chars**; max 100 facts | All if they fit; else pinned, then best BM25 match to the message plus the previous user message, then 4 newest. No dates shown to the model. |
| Profile | `profile.js` | 4,000 chars | Hand-written by Omri. |
| Study state | `study-coach.js` `studyLine` | one line | Code-written from the tracker (exact counts and dates; **not** from the chat). |
| "Still working on" | `buildHistory` | 5 x 140 | Pending messages. |
| Recall excerpts | `recall.js` + `core.js` | up to 4 x (500 + 500) chars | **Only if the front desk chooses `recall`.** |

Total for a normal message: roughly 13,000 to 25,000 characters (about 3,500 to 7,000 tokens), flat over time. **[computed from the caps in the code, and the simulation printed history sizes of 5,500 to 6,000 characters at every stage; token counts are estimates, Hebrew uses more tokens per character]**

### 3.2 What is lost (design, not bugs)
- Anything said more than about 6 exchanges ago is gone from the prompt unless it is (a) a saved fact, (b) in a daily note of the last 3 days, (c) a calendar card, or (d) fetched by recall.
- Daily summaries are only made for days in the **last 7**, 3 days per run (`LOOKBACK_DAYS`, `MAX_DAYS_PER_RUN`). After a 10-day reserve-duty absence the days before day 7 never get a note, and so never offer their facts for confirmation. **[reasoning from the code]**
- The summary model is not shown the existing saved facts, so it cannot say "this replaces fact 3." Replacement only happens if the front desk is shown the old fact (number) when Omri says the change; `pickFacts` shows the old fact only if it matches the message or is among the newest. **[reasoning from the code]**
- There is no layer between "last 3 days" and "everything older through recall." Months 1 to 6 exist only as raw messages and saved facts.

### 3.3 What works well (keep it)
Raw log never deleted by a model, 30-day trash only by user; quote-verified summary items; facts only from user words; every fact a confirm card; notes inside a "may be wrong" marker; structured study state in code, not in the chat; cross-language search words; flat cost.

### 3.4 Where it will fail over time (with the numbers)

Simulation (made up): 182 days, 2,614 messages, 859,000 characters. Averages of about 7 exchanges a day, the length of Bot's real answers. Real use measured earlier is about twice that in characters, so double the sizes below. **[measured]**

| When | Thread size (sim / if like Omri's first 4 days) | What a message carries | What happens |
|---|---|---|---|
| Day 1 to 3 | roughly 10,000 to 30,000 chars | same as always (about 6,000 recent) | Whole conversation fits, nothing is lost. |
| **1 month** | 130,000 / 285,000 chars, about 390 messages in the sim | still about 6,000 recent + 1,800 notes + facts | A fact from week 1 is gone from the prompt. 0% of past facts reachable without a saved fact or a recall. Recall search is still well under a second. |
| **3 months** | 450,000 / 860,000 chars | same | Facts saved before still work. A *changed* fact is only right if the old one was replaced. |
| **6 months** | 860,000 / 1,700,000 chars, about 2,600 messages | same; the saved-fact list may be full (100 max) and only 1,000 chars of it fit | `findInThread` rebuilds the BM25 index from every pair on every recall: **228 ms** at 1,300 pairs (sim), so about 0.5 s at the 3,000-pair cap. Fine. **But the cap `MAX_THREAD_PAIRS = 3000` silently makes the oldest pairs unsearchable**: at 30 messages a day (15 pairs) that is reached in about **7 months**, at Omri's measured 19 messages a day (about 9 pairs) in about 11 months. |

Retrieval misses, measured on the 68 questions (every number is the share of questions where the right answer was inside the prompt; detail tables are in `...-results.txt`):

1. **A fact is said in passing and never saved (the biggest miss).**
   | Age of the fact | nothing saved | half saved | all saved | all saved + 60 other facts |
   |---|---|---|---|---|
   | same day, 1 day | 89% | 89% | 89% | 89% |
   | 3 to 30 days | **0%** | 44% | 100% | 100% |
   | 60 days | 0% | 38% | 100% | 88% |
   | 90 days | 0% | 17% | 100% | 100% |
   This is "write a poem about my cat" or "suggest a dessert for my guests" (a pistachio allergy said in Hebrew weeks ago). Recall does not run for these: the real desk picked `recall` for 0 of 6 such messages. The 60 extra facts cost 12 points at 60 days: the 1,000-character box is where facts start crowding each other out.
2. **A fact inside a long message.** The recall excerpt is the first 500 characters of the message. A rent date at the end of a 1,400-character paste was found by the search in neither my prototype nor today's code: **0% for the landlord fact**. This one is certain by reading `cut(q.text, 500)`; and the BM25 pieces ("and" inside "landlord") let short messages outrank it. Hebrew words with prefixes and English words with common 3-letter pieces both hit this.
3. **Recall on explicit questions is good but not perfect:** with a good query, about **90%** overall (nothing saved); a decision stated in a message where the long answer from Bot dilutes the match was found only **43%** of the time (rank 2 or not at all); my prototype that indexed only the user's own messages found it 100%, but did *worse* on the cat name (71% vs 100%) and on an English-only query for a Hebrew fact (43% vs 71%). **So I do not recommend swapping the scoring; the evidence is mixed.** Cross-language: a Hebrew fact asked in English works at 100% only when the query holds both languages (the briefing already asks for that, and the real desk did it in 9 of 9 recalls).
4. **Changed facts.** In recall, both dates came back and the *newest* date was present 100% of the time (n=2, too few). The risk is not found here; it is in saved facts (no dates shown; replacement depends on the desk seeing the old fact's number).
5. **The desk can fail to choose recall.** 1 of 10 explicit past questions ("who is Mr Katz?") became a clarifying question instead. 10%.
6. **Always-on search is not the answer.** Injecting the top 2 snippets of the user's own old messages into *every* message: reached the right fact 46% of the time (vs 100% via saved facts), and added something to 93% of ordinary study questions. Needs an absolute score threshold to be usable; not recommended.

### 3.5 What I did not test (honestly)
- Summary quality. My fake summary model is perfect (it includes the planted sentence), so "notes" numbers are an upper bound, and notes only cover 3 days anyway.
- Hebrew-only or heavily mixed days, typos, voice-to-text, real answer styles; my filler is random words, so retrieval is probably *easier* here than in real use (real chats share more vocabulary, more near-duplicate facts).
- Whether the *answering* model uses the context well once it is there. I only checked that it reaches the prompt.
- Topic mixing and the effect of irrelevant recent turns.

---

## 4. The test (item 4)

`node experiments/2026-11-07-long-conversation-sim.js [prefix]` takes about 25 seconds, uses no model, no network, and writes only to a temp folder it deletes. It uses **Bot's real code** (`createThreadStore`, `buildHistory`, `createSummaries`, `pickFacts`, `findInThread`) over a made-up 182-day thread (seeded random, so the result repeats): 10 planted facts (3 pets, an allergy in Hebrew, an exam that moves, a wedding in Hebrew, a decision, a rent date buried in a long paste, a style preference), asked at ages 0, 1, 3, 10, 30, 60, 90 days, in an explicit and an implicit form, under four "how many facts got saved" scenarios. It prints the tables used in section 3.4. To use it as a regression test later, compare the printed percentages; to try an idea, change `protoRecall` (the prototype is in the same file).

`node experiments/2026-11-07-long-conversation-desk-probe.js` makes 20 real front-desk calls (Gemini 3.8 Flash low through `agy`, never Claude, about a minute) over made-up messages and prints which action the desk chose. Result: explicit past questions 9/10 `recall`, needs-the-past-but-does-not-ask 0/6, ordinary 0/4.

**Next step for the test (needs real use, not in this repo):** the "Bot should have known this" button (recommendation 3) creates a private list of message ids; a local script then replays those messages through the same context builder and says which door should have caught each. That keeps real text out of the public repo.

---

## 5. Recommendations, ranked

Sizes: S = under half a day, M = a day or two, L = more. "Quota" is Gemini or Claude spending.

**1. Get many more lasting facts into the saved list. (Biggest lever.)**
- *Problem:* measured 0% to 44% of planted facts reach the prompt after 3 days unless saved; saving is rare because only an explicit "remember" or a daily-summary proposal creates a fact, and summaries only look back 7 days.
- *Change:* (a) let the summary catch up over 30 days after an absence (or at least on the first message back); (b) show the summary model the existing saved facts so it can say which one a new fact replaces (code still checks the quote and the number); (c) make the confirm card a single tap and show the quote, the date and "replaces: <old fact>"; (d) treat "from now on ..." style statements as proposals too (checkFact already allows them). All proposals stay confirm cards, user words only.
- *Size:* M. *Quota:* none extra (the same Argon summary call, slightly longer prompt; at most a few more calls after a long absence).
- *How we know:* rerun the simulation with a real "saved" step instead of the 0/50/100% scenarios; in real use, the share of lasting things Omri says that appear as a fact within 2 days, target 80% or more of what he would himself call worth keeping; and the acceptance rate of cards (if under about 50%, the proposals are noise).

**2. Fix recall's known blind spots.**
- *Problem:* facts inside long messages are cut off (0% in the test); the 3,000-pair window silently drops the oldest; a missed `recall` choice (1 in 10).
- *Change:* (a) excerpt a window around the matching words, not the first 500 characters (about 15 lines, shown in `protoRecall`); (b) replace the 3,000-pair cap by indexing per day (or build the index once and keep it in memory, updating it when a message is added); (c) when the desk answers "I don't know" style or clarifies on a question that starts with "my/our/I said", let code run one recall as a second chance. **Do not change the scoring (user-only index, thresholds) yet**: my prototype was better on one fact and worse on two.
- *Size:* S for (a), S to M for (b), M for (c). *Quota:* none.
- *How we know:* the simulation's per-fact table (landlord from 0%, decision up); a test that 3,001 pairs are all still found.

**3. A "Bot should have known this" button, and a weekly self-check.**
- *Problem:* nobody, including vendors, has measured topic mixing or summary quality for a person like Omri; guessing is how a memory system gets overbuilt.
- *Change:* a small button on any answer that stores only the message id and a note in `data/` (never in the repo). A local script replays those messages and reports which door should have caught each. Optional: ask the same 10 made-up questions each week against the simulation to catch regressions.
- *Size:* S to M. *Quota:* none. *How we know:* after two weeks we have a list of real misses, sorted by cause.

**4. Show dates and sources on saved facts, in the prompt and on the page.**
- *Problem:* facts have no date for the model, so "the facts win over the profile" cannot tell old from new; a stale exam date stays until someone removes it.
- *Change:* print `(saved 12 Mar)` after each fact; let a fact carry an optional end date (the exam day) after which code moves it out of the prompt (never deletes it); the page's "what Bot remembers" list shows the quote and the message it came from with a link.
- *Size:* M. *Quota:* none. *How we know:* a test that an expired fact is not in the prompt but is still in the list.

**5. Only if the real test shows the gap: a weekly "middle memory".**
- *Problem:* nothing sits between 3 days of notes and raw search. The earlier research and Factory's findings warn about summaries of summaries, so: build each weekly note from the raw days (not from the daily notes), with word-for-word quotes checked like today, and show only the last 3 weeks in the prompt, 400 characters each.
- *Size:* M. *Quota:* one Argon call a week. *How we know:* the button list from recommendation 3 shows "I asked about last week and Bot knew nothing" as a common miss. If it does not, skip it.

**6. Topic-aware recent turns (maybe).** If real misses show wrong follow-ups after a topic switch, drop recent turns whose stored `topic` differs from the new message's topic when that is clear. *Size:* S to M. *Quota:* none. Evidence is indirect, so wait for data.

### What should NOT be built
- **A vector database or embeddings.** Not needed at this size; the misses above are about *what is saved*, not about finding similar words. Revisit only if the button list shows paraphrase misses.
- **A knowledge graph (Zep/Graphiti style).** Heavy; the one good idea (a fact is valid from/until a date) is recommendation 4.
- **Models that edit memory by themselves** (Mem0 original, MemGPT-style tool calls every turn). More model calls, more silent write errors, and it breaks Bot's rule that a model never writes a fact without a confirm card.
- **Sending more or all of the history**, or a rolling summary of the whole thread. This is the path that failed in the 200,000-character test, and summaries of summaries lose detail.
- **Always-on search injected into every message.** 46% reach, junk in 93% of ordinary messages.
- **Automatic forgetting by decay.** Keep the raw log; "forget" = moves out of the prompt, never erased by a model.
- **A sub-agent per topic.** Bot already routes each message to a fresh call; per-topic agents add cost without a measured need.

---

## 6. Could this be a real advantage over using Gemini or Claude directly?

Yes, but not because it remembers more; the big apps now have memory (ChatGPT, Claude, Gemini all do). Bot's possible edge, in order of how real it is:
1. **One memory across several models.** ChatGPT's, Claude's and Gemini's memories are locked to one vendor. Bot routes cheap and strong models from both vendors and gives them all the same memory, so Omri can switch models without losing his history. (Gemini's import tool shows people want portability, but it is a one-time copy.)
2. **Memory he can inspect, correct and trust.** Every fact has a quote and a date and was confirmed by him; notes are labelled "may be wrong." The vendors' memories are summaries he cannot fully see or verify. This is the answer to "AI memory is untrustworthy" and costs little.
3. **Exact state for the things that must be exact.** Calendar cards, study progress and "Understood" come from code, not from what a model remembers. No chat app does this for a student's timetable.
4. **Hebrew and English in one memory**, with search words written in both languages (`crosslang.js`).
5. **Proactive use of the past**: the morning brief, study nudges tied to real dates. A chat app waits until you type.
The honest risk is the opposite: if Bot forgets things the Gemini app would remember, none of this matters. That is why recommendation 1 comes first.

## 7. What to watch while testing over the next few days

Write down (a line each is enough; no chat text needed in the repo):
- **"I told you this."** Any time Bot asks again for, or gets wrong, something Omri said. Note: how long ago (minutes, hours, days), and whether he said "remember" or not. If it is within the same conversation but more than about 6 exchanges ago, that is the known 6,000-character window, not a bug.
- **Did a confirm card for facts appear, and was it right?** After the first full day, count: cards shown, accepted, dismissed; any invented fact ("no car"); any lasting thing he said that got no card.
- **A fact that changed.** Say one thing, change it a day later, then ask. Does Bot give the new one? Is the old one still listed?
- **Standing preferences.** "From now on answer in short bullets": does it hold the next day?
- **Asking about the past in different ways**: "what did I say about X?" (should work), "make me a plan for X" (relies on saved facts), a question in Hebrew about something said in English and the reverse, and a question about something said in a *long* message.
- **After a day or two away**, does the first message feel oriented? Are the notes sensible?
- **Wrong topic carry-over**: after switching from study to something else, does the follow-up use the right topic?
- **Speed and cost**: does the 20th message of the day feel as fast as the 1st? (It should; the prompt does not grow.)
- **Quota**: whether the daily summary and confirm cards use Argon only (they should, never Claude).
- **Phone**: the same checks once from the phone.

## 8. Open decisions for Omri
1. Approve recommendation 1 (summary catches up 30 days, sees existing facts, one-tap cards)? It is the largest change in what gets remembered, and it only ever creates cards.
2. Do you want a "Bot should have known this" button (private note of message ids only)? It is the only way to get real numbers.
3. Should facts expire on a date (recommendation 4) and be shown with a date?
4. Is it acceptable that recalling something older than the last few turns depends on the front desk choosing `recall` (9 of 10 in the probe), or should code add a second chance?
5. How many facts do you expect to keep? At 100 facts and a 1,000-character box, long lists compete; raise the box to 1,500 or keep the cap?
6. Run the simulation and the probe again after each change, and keep their last output in `experiments/`? (Recommended.)

## 9. Limits of this research
- Web evidence was gathered through a search tool; primary papers were not opened. Chroma's primary report was not seen. Treat all outside numbers as approximate.
- The simulation uses made-up random-word chatter; real chat will share more words between facts and filler, so real retrieval is probably harder than the numbers here.
- The 20-call desk probe is small (one run, one model, clean messages, a tiny made-up history); it shows the pattern (explicit yes, implicit no), not an exact rate.
- Claude was not used anywhere. Nothing on port 3000, `.env` or `data/` was touched.
