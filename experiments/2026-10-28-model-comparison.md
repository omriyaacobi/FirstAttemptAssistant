# Model comparison, 2026-10-28

**Question:** Is Claude inside `agy` (paid from the Google AI Pro plan) as good as Claude through the `claude` CLI (paid from the Claude plan)? And how do the quotas compare with Gemini 4 Argon?

**Setup:** 3 prompts x 3 routes, each run once, all from an empty folder so project notes could not influence answers. Script: `experiments/compare.js` (re-run with `node experiments/compare.js`; it writes `compare-results.json`, which is git-ignored).

| Route | Tool | Model |
|---|---|---|
| A | `agy` | Gemini 4 Argon (medium) |
| B | `agy` | Claude Sonnet 5.5 (medium) |
| C | `claude` CLI | Sonnet (resolved to `claude-sonnet-5-5`) |

Prompts: **logic** (3 mislabeled fruit boxes, "under 80 words"), **bug** (off-by-one in `average()`, "under 100 words"), **explain** (what an API is, "exactly 3 sentences").

## Quality

| | Correct? | Followed the length limit? (words, rough count) | Style |
|---|---|---|---|
| A Argon, logic | yes | yes (73) | tight, bulleted |
| B agy-Sonnet, logic | yes | **no (94 vs 80)** | clear but too long |
| C CLI-Sonnet, logic | yes | yes (63) | shortest, a bit casual |
| A / B / C, bug | all found both bugs (`<=` and empty array) and gave working fixes | all yes (75 / 81 / 78) | nearly identical code |
| A Argon, explain | yes | 3 sentences | accurate but dense and jargon-heavy |
| B agy-Sonnet, explain | yes | 3 sentences (119 words) | restaurant analogy, third sentence clumsy |
| C CLI-Sonnet, explain | yes | 3 sentences (103 words) | cleanest, restaurant analogy |

**Reading:** on these easy tasks all three are correct. I could not separate them on correctness. Sonnet 5.5 behaved similarly through both routes; the CLI version was a little more concise and followed the word limit, the `agy` version broke it once. That is one run each, so it could just be randomness. Argon was the most compact and the least friendly for the beginner explanation. These prompts are too easy to say which model is *smarter*; harder tasks are needed for that.

## Quota and cost

| Route | Tokens per call | Quota effect (from `agy -p "/usage"`) |
|---|---|---|
| A Argon x3 | about 7,100 in, 120-480 out (21.8k total) | Gemini pool and Argon weekly limit stayed at **100%** |
| B agy-Sonnet x3 | about 5,600 in (5,167 of it cached), about 200 out (17.4k total) | "Claude and GPT models" pool dropped **100% -> 98%** (weekly and 5-hour) |
| C CLI-Sonnet x3 | about 38,000 in (mostly cached), 135-205 out | not measured; interactive `/usage` only. API-price equivalent was about $0.128 total (not what the plan charges) |

**Reading:**
- The Claude/GPT pool inside `agy` is the **scarcest** resource: 3 tiny calls cost 2% of it, while the Gemini pool did not visibly move. This matches forum complaints about Pro users running out of it.
- The `claude` CLI sends about 6x more input per call (about 38k vs about 6k tokens) because of Claude Code's built-in system prompt and my global notes. For tiny questions that is a lot of overhead. I did not read the Claude plan percentage, so I cannot say how much quota that costs.
- Argon also has the longest responses to simple prompts (it "thinks" 133-361 tokens), but it was not slower to the point of mattering (10-13s vs 6-12s).

## What this means for the router
1. Default most tasks to Gemini (Argon for hard, Flash for quick): quota barely moves and quality was comparable.
2. Keep the `claude` CLI for coding or when we want Anthropic's own tooling. It is the only route whose plan usage we cannot read automatically, so check `/usage` in an interactive `claude` session now and then.
3. Use Claude inside `agy` only as an overflow or fallback, not a default, because its pool is small.
4. Next experiment when needed: harder prompts (longer code, multi-step reasoning), and several runs per prompt.
