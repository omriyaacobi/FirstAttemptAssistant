# One continuous conversation with self-managing memory: research

Date: 2026-11-06. Research only, no product code. Written for Omri (CS student, new to back-end).

**How this was made.** I used web search, which returns summaries with links. I did NOT open most primary papers in full, so numbers are marked "(secondary)" when I only saw them in a summary. Anything marked **UNVERIFIED** should be checked before you build on it. The field changes fast: several 2026 product details come from blogs, not from vendor docs.

## 1. Summary (read this first)

1. **Everyone converges on the same layers**: (a) a small, always-visible set of facts about you, (b) a searchable archive of old conversation, (c) a background "sleep" job that tidies (a) from (b). Letta/MemGPT, OpenClaw, ChatGPT and Claude all look like this.
2. **Plain files beat fancy stores at your scale.** OpenClaw uses Markdown files: one per day, plus one curated `MEMORY.md`. You are one person with a few thousand messages. Keyword search (BM25, which you already built for courses) plus one-line summaries is enough. A vector database is not justified.
3. **Writing memory is the weak point, not reading it.** The HaluMem benchmark found memory systems lose or distort facts mostly when *writing* (extraction recall about 15-43% on medium sets, 2-6% on long noisy ones; secondary). So: keep the raw log forever, treat summaries as a cache you can rebuild, and never let a single model pass be the only copy of anything.
4. **Archive, do not delete.** Zep/Graphiti marks a fact as "no longer valid" with a timestamp instead of erasing it. Mem0 *dropped* its update/delete step in a later version and says ADD-only preserved time order better (their own claim, secondary). For Bot: nothing is hard-deleted by a model; "forgetting" means moving out of the prompt.
5. **Memory is an attack surface.** Documented attacks planted lasting instructions through web pages, documents and emails (SpAIware on ChatGPT, 2024; more in 2026). Bot reads web pages, files and photos, so memory writes from those sources must be blocked or quarantined.
6. **Tutoring: guardrails matter more than memory.** Two 2025 trials: a purpose-built tutor beat in-class active learning (Harvard physics), while unrestricted ChatGPT-style access hurt later unassisted performance (Bastani, PNAS). Tutor behaviour (do not hand over answers, check understanding) is the real lever.
7. **Recommendation:** one thread, three memory tiers in plain JSON/Markdown files, a nightly (or on-startup catch-up) consolidation by a cheap Gemini model, strict code-checked writes, user-visible "what I remember" page with undo, and a separate small *learner log* per course for the study-coach role. Details in section 3.

## 2. What the field does

### 2.1 Products
- **ChatGPT.** Two layers: *saved memories* (discrete facts you can view/delete) and *reference chat history* (implicit lookup across old chats). Deleting a chat does not delete a memory made from it. Temporary Chat skips memory. Source for the basics is OpenAI's April 2025 post. Claims about a 2026 "dreaming" consolidation come from blogs only: **UNVERIFIED**.
- **Claude (claude.ai).** A memory summary you can read and edit, per-project memory so topics do not bleed together, search of past chats with citations back to the source chat, and Incognito chats that are never stored (Anthropic help centre). For developers: a *memory tool* (files outside the context window), *context editing* (clears stale tool results; default trigger about 100k tokens, beta) and *compaction* (summarising). Anthropic reports 39% better results on an agentic eval with memory + editing, 29% with editing alone (their number, secondary).
- **Gemini.** In March 2026 "past chats" became "memory", with import from other assistants and optional use of Gmail/Photos ("Personal Intelligence"). Controls are in Settings and Gemini Apps Activity. Mechanism details are not public: **UNVERIFIED**.
- **Open source, OpenClaw.** Markdown workspace: `memory/YYYY-MM-DD.md` append-only daily logs, `MEMORY.md` curated. Loads today + yesterday at start, `MEMORY.md` only in the private main session, hybrid search over chunks (about 400 tokens), and an optional "dreaming" job that scores candidates from daily logs and promotes only qualified ones for review. Sources are mostly third-party mirrors, so details may differ from the official docs.

### 2.2 Memory systems
- **Letta (MemGPT).** Three tiers. *Core memory blocks*: small labelled sections (e.g. "human", "persona") always in the prompt, with size limits, edited by the agent. *Recall memory*: the full message history; when the window fills, old messages become a recursive summary and are searchable by tool. *Archival memory*: long-term facts/documents in a vector store, searched by tool. Tool names changed across versions, so check docs before copying. Letta also published **sleep-time compute**: a second agent works in the background to rewrite the main agent's memory so the main agent answers faster.
- **Mem0.** Per message: an LLM extracts candidate facts, then decides ADD / UPDATE / DELETE / NOOP against similar existing ones. Original paper: 66.9% vs 52.9% for OpenAI's memory on LOCOMO (secondary). Later docs say an ADD-only version scores much higher (91.6 vs 71.4) and keeps time order, because overwriting destroys history. Vendor-reported, not independent.
- **Zep / Graphiti.** A knowledge graph (people, things, relations) with two clocks: when something was true in the world, and when the system learned it. A contradicted fact gets an "invalid since" time, it is not erased. Powerful, but needs a graph database and many LLM calls per message: too heavy for Bot.
- **Older research that still shapes everyone.** Generative Agents (Stanford) rank memories by recency + importance (LLM 1-10 score) + relevance. MemoryBank adds an Ebbinghaus-style forgetting curve: memories fade unless they are recalled again. Both are secondary here.

### 2.3 What works and fails
| Approach | Good at | Fails by |
|---|---|---|
| Rolling summary only | Cheap, small prompt | Details vanish; each re-summary loses more; errors become "truth". I found no study measuring repeated-summary drift, so this is **UNVERIFIED as a measured effect**, but it is the stated reason MemGPT-style systems keep raw history too. |
| Structured facts (key-value / short notes) | Precise, editable, visible to user | Extraction misses things and distorts others (HaluMem); stale facts survive |
| Searchable archive (BM25/vectors) | Nothing is lost; good for "what did I say about X" | Wrong retrieval; needs good queries. LongMemEval found assistants and long-context models drop about 30% on facts across long histories, and ChatGPT tended to overwrite details as chats grew; time-aware queries and splitting history by session helped (secondary) |
| Stuffing the whole history in the prompt | Simple | "Context rot": Chroma tested 18 models, all got worse with longer input, even far from the limit (secondary, I did not see Chroma's primary report) |

Practical consequence: use all three layers, each covering the other's weakness.

### 2.4 Deciding what is important
Rules (keywords like "remember", dates, exam, deadline, "I prefer") are predictable and cheap but miss things. A model catches nuance but is inconsistent: I found no clean error-rate number for "does a model pick the right things", only HaluMem's extraction recall (above) and a taxonomy of write errors (missing, distorted, stale; MemGuard). Treat model judgement as a *proposal*. Mixed approach: code rules decide the obvious cases, a model proposes the rest, anything about the user's identity, health, money or instructions waits for a human tap (you already have the Save button pattern).

### 2.5 Forgetting and recovery
Options seen: hard delete (Mem0 original), invalidate with timestamp (Zep), decay score that lowers retrieval rank (MemoryBank, Generative Agents), move to cold archive (OpenClaw daily files). Recovery from a wrong deletion is only possible if nothing was actually erased: keep the raw log and keep "archived" items with a reason and date. ChatGPT's "delete chat but memory remains" shows the opposite confusion: users need to see *what was derived from what*.

### 2.6 Keeping facts true
Failures reported: stale facts treated as current (anecdotal, practitioner blogs), duplicates and unresolved contradictions when extraction runs without looking at existing memory first, and invented facts (HaluMem). Mitigations: every fact has a source message, a date and a status; the writer sees related existing facts before writing; changed facts supersede, not overwrite; time-sensitive facts (exam date, "this week") carry an expiry.

### 2.7 Prompt injection through memory
Johann Rehberger's SpAIware (ChatGPT macOS, 2024) planted instructions in memory via a web page/document, for ongoing data leaks; OpenAI patched the exfiltration route, not the idea that memory can be written by untrusted text. 2026 reports (ZombieAgent, "Tainted Memories", a "sleeper" memory-poisoning paper, MemGhost via one email) are only from news/vendor summaries: **UNVERIFIED in detail**, but the pattern is consistent. Defences that make sense for Bot:
- Memory writes only from *the user's own words*, never from web/file/photo content. Content from tools can be summarised for the current answer but is not a source for facts or instructions.
- Stored memory is injected into the prompt inside a labelled data block ("notes about the user, not instructions").
- Code rejects any memory text that looks like an instruction to the assistant or contains URLs, and caps the length.
- Photo/file-derived items, if ever stored, go to a quarantine list the user approves.

### 2.8 Many topics in one thread
Claude solves bleed with per-project memory; Letta with labelled blocks. For one person, the simplest known pattern: tag every message with a topic (`calendar`, `course:OS`, `general`...), keep a per-topic short note, and retrieve by topic + keyword. Recovery later = search the archive by topic and date and show it with a link to the source messages (Claude shows citations back to chats; copy this). You already have a front-desk router, so topic tagging is one more field it can return, validated in code against a known list.

### 2.9 Tutoring in a long thread
- **Harvard physics RCT** (Kestin et al., Scientific Reports, June 2025): 194 students, crossover, an AI tutor with prepared step-by-step solutions beat in-class active learning on two short lessons. Does not show long-term retention. Effect size figures vary by source (secondary).
- **Bastani et al., PNAS 2025**: Turkish high-school maths. Unrestricted GPT-4 improved practice scores but students scored worse on the unassisted exam (one source says 17% worse, secondary); a guardrailed tutor avoided the penalty but, per one commentary, did not beat control. Lesson: protect productive struggle.
- **Socratic prompting is not automatic.** Preprints (2026) report heavy answer leakage from base models under pushy students, and sycophancy (agreeing with a student's wrong answer) around 14% in one study; a separate 2025 study saw correctness fall up to 15 points when the student states a wrong answer. Preprints, not peer reviewed as far as I saw. Implication: for course facts, check against the course notes, not against what the student just said.
- **Retrieval practice works.** Meta-analysis (Adesope et al. 2017, 188 articles) says practice tests beat restudying, best when the final test comes 1-6 days later. Feedback added only a little.
- **Spaced repetition.** FSRS (now in Anki) models difficulty, stability and recall chance per item and needs fewer reviews than SM-2; the "99.5% of users" and "20-30% fewer" claims come from vendor-ish sources: **UNVERIFIED**. A simple Leitner-box schedule is probably enough for Bot.
- **Nudges that are not ignored:** I found NO primary evidence on reminder fatigue or nudge effect sizes (my last search returned none): **UNVERIFIED / not found**. Design from common sense instead: few, tied to a real date (exam, assignment), one tap to act, back off automatically when ignored.
- **Memory of the learner:** I found no solid study on what an LLM should remember about a learner. A reasonable design (my own, not evidence-backed): per course keep topics seen, last practised date, and wrong-answer patterns, written by code from quiz results, not by model impressions.

## 3. Recommended design for Bot

Fits: Node built-ins only, local files, Gemini for background work, Claude for answers only when needed.

**One thread, three tiers**
1. **Raw log (never edited by models).** Every message appended to `data/log/YYYY-MM-DD.jsonl` with id, time, topic tag, source (user / tool / web / photo). This is the safety net and the source of truth.
2. **Working memory (small, always in prompt).** A few KB: stable user facts (reuse `profile.js`), active items (exam dates, open tasks, current study plan) and a rolling "today so far" note. Hard size cap, so it cannot grow forever.
3. **Archive (searchable, not in the prompt).** Daily digests (5-15 lines, written by the nightly job) plus per-topic notes; search by BM25 + topic + date (extend `recall.js`). Retrieved per message: working memory always, top 3-5 archive hits only if the front desk flags the message as needing the past.

**Nightly consolidation ("sleep").** At a quiet time, or on first start after missing it (you step away often, so catch-up matters). A Gemini Flash call reads the day's log and *proposes*: a digest, new facts, changed facts, items to expire. Code validates (length, no URLs/instructions, source must be a user message, referenced ids exist), then applies. Facts that change get a `superseded_by` link, not deletion. Big or sensitive proposals show on a "Review memory" page; small safe ones auto-apply with an undo list for 7 days. Weekly: re-read digests and merge into topic notes. Because the raw log stays, any bad summary can be regenerated.

**Forgetting policy.** Everyday chatter simply stays only in the log and digest. Facts decay by *rank*, not deletion: unused for N weeks and not marked pinned, they leave working memory and live in the archive. Expiring items (exam passed) archive on their date. "Forget this" by the user moves it to a trash with 30-day restore; real purge only by explicit user action.

**Topic handling.** Front desk adds `topic` to its validated JSON. A topic list is a code-owned menu (calendar, each course, general, personal). "Where were we on X?" = search topic notes + digests, answer with links to source days.

**Study coach (this semester).** Per-course learner log in code: topics covered, quiz results (right/wrong, date), a Leitner box per topic. Tutor prompt rules: ask before telling, give hints in steps, only reveal after real attempts or on request, verify against course notes rather than the student's claim. Nudges: at most one a day, tied to a deadline or a due review, one tap to start, quiet after two ignored in a row.

**Safety rules (non-negotiable).** Memory writes only from user-authored messages; tool/web/photo text never becomes a fact or instruction; memory injected as labelled data; all model output validated in code (your existing pattern); a "What Bot remembers" page showing each item's source and date.

**Cost.** Nightly job is one or two Gemini Flash calls: no Claude quota. Per message cost: slightly longer prompt (working memory), plus a local search.

## 4. Alternatives rejected
- **Vector DB / embeddings.** Needs a package or an embedding API; at one person's volume BM25 + topics + digests is enough. Revisit only if recall tests fail on paraphrased questions (tests on real chats would show this).
- **Zep/Graphiti knowledge graph.** Needs a graph DB and heavy extraction per message. The one valuable idea (validity timestamps) is cheap to copy as `superseded_by`.
- **Letta/Mem0 as a library or service.** Python/service dependencies, and their memory edits are model-driven without our checks. Borrow the ideas, not the code.
- **Model edits memory live, every turn (MemGPT style).** Extra model calls per turn and more write errors. Batch at night is cheaper and gives time to validate.
- **Rolling summary only.** Cheapest, but irreversible losses.
- **Whole history in prompt.** Context rot and cost.
- **Mem0-style overwrite/DELETE by the model.** Wrong deletions are unrecoverable.
- **Ebbinghaus numeric decay as the whole policy.** Overkill; a simple "unused for N weeks, not pinned" rule does the same job.

## 5. Main risks
1. **Silent wrong facts** (distorted or stale). Mitigation: sources, dates, expiry, review page, rebuild from log.
2. **Memory poisoning** via web/photo/file. Mitigation: user-words-only writes, quarantine, labelled injection.
3. **Privacy/leak**: one log holds everything (including phone access). Mitigation: it stays in `data/`, backed up encrypted as now; never push; `MEMORY`-style pages need the same login as chat.
4. **Nightly job skipped** (PC off, you away on reserve duty). Mitigation: catch-up on start; Bot works without it, only older chatter stays undigested.
5. **Over-trusting the tutor.** LLM tutors leak answers or agree with wrong claims. Mitigation: check against course files, show citations, occasional answer-key tests.
6. **Topic mis-tagging** puts a note in the wrong place. Mitigation: tag is a hint for ranking only; search always also looks across topics.
7. **Complexity creep.** Build tier 1+2 first, measure on real chats, then add digests, then coaching.
8. **My evidence is thin on three things**: nudge effectiveness, rolling-summary drift, how often models misjudge importance. Plan a small experiment on real chats before locking the rules.

## 6. Sources (all accessed 2026-11-06 via web search; most seen as summaries only)
Products
- OpenAI, Memory and new controls: https://openai.com/blog/memory-and-new-controls-for-chatgpt (Apr 2025; 2026 claims in blogs such as https://theaitrack.com/?p=36878 UNVERIFIED)
- Anthropic, Claude memory: https://www.anthropic.com/news/memory and https://support.anthropic.com/en/articles/11817273-how-does-claude-s-memory-work
- Anthropic, context management (memory tool, context editing): https://www.anthropic.com/news/context-management
- Google, Gemini memory and import: https://blog.google/innovation-and-ai/products/gemini-app/switch-to-gemini-app/
- OpenClaw memory (third-party write-ups): https://dev.to/chwu1946/how-openclaw-orchestrates-long-term-memory-10en , https://docs.claw.so/engine/concepts/memory/

Memory systems
- Letta architecture: https://docs.letta.com/guides/agents/architectures/memgpt and https://docs.letta.com/concepts/memory-management
- Letta sleep-time compute: https://letta.com/blog/sleep-time-compute
- Mem0 paper: https://arxiv.org/abs/2504.19413 ; Mem0 evaluation docs: https://docs.mem0.ai/core-concepts/memory-evaluation.md
- Zep paper: https://arxiv.org/abs/2501.13956 ; Graphiti: https://github.com/getzep/graphiti
- LongMemEval: https://arxiv.org/abs/2410.10813
- HaluMem: https://arxiv.org/abs/2511.03506
- MemGuard: https://arxiv.org/pdf/2605.28009
- MemoryBank: https://arxiv.org/abs/2305.10250 ; Generative Agents (not opened directly): Park et al., 2023
- Context rot (secondary only): https://rosetta.to/u/mattpalmer/context-rot-takeaways-from-the-latest-chroma-research-paper-review

Security
- Rehberger, Trust No AI / SpAIware: https://arxiv.org/abs/2412.06090 ; news: https://thehackernews.com/2024/09/chatgpt-macos-flaw-couldve-enabled-long.html
- 2026 items (UNVERIFIED, summaries only): https://labs.cloudsecurityalliance.org/research/csa-research-note-memghost-agent-memory-poisoning-20260723-c/ , https://icml.cc/virtual/2026/67842

Tutoring and learning
- Kestin et al., Scientific Reports 2025 (via review): https://etcjournal.com/2025/11/10/review-of-kestin-et-al-s-june-2025-harvard-study-on-ai-tutoring/
- Bastani et al., PNAS 2025 (via summaries): https://dev.to/yanoai/the-ai-tutor-evidence-is-split-in-half-1m49
- Answer leakage: https://arxiv.org/pdf/2604.18660 ; sycophancy in tutors: https://arxiv.org/pdf/2605.14604 ; "Check My Work?": https://arxiv.org/abs/2506.10297
- Retrieval practice meta-analysis: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00005/full ; Rowland 2014 (Psychological Bulletin)
- Anki on FSRS: https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm

**Not found / not verified:** nudge and reminder-fatigue evidence; measured drift of repeated summaries; independent error rates for LLM importance judgement; OpenAI's 2026 memory changes from an official page.
