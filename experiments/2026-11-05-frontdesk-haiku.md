# Front desk on Claude Haiku (measured 2026-11-05)

**Update (after merging main):** Omri chose Haiku as the BACKUP desk, not the main one. The `FRONT_DESK` setting, the Flash fallback and the 5-minute cool-down described below were removed. In the merged code the Gemini desk (Flash low, warm, hedged) is first, and `frontdesk.decide` asks Haiku (`router-brief-haiku.md` as system prompt, compact schema, 25 s limit, same `validateDecision`) only when Gemini fails or hits its deadline; if Haiku fails too, `core.js` uses Claude Sonnet. The speed and quality numbers below are for Haiku itself and still apply to the backup path. Real test: `frontdesk.backup.test.js`.

Branch `claude/frontdesk-haiku-d42fac`. (Originally Haiku was built as an opt-in main desk: `FRONT_DESK = "flash"` default, `"haiku"` one-word switch.)

Test set: 55 messages (`experiments/frontdesk-haiku.js`): the 21 of `frontdesk-ab.js` plus Hebrew/mixed, web-search vs web-research, reminders with checked local times, calendar ranges, numbered remember/forget, improve, clarify, split, history follow-ups, a prompt-injection try. A made-up profile with 3 numbered facts is used (not Omri's). "Right" means the action/destination is one a sensible person accepts, and extra checks pass (exact reminder moment, calendar range, fact number). Calls run one after another. The other session was also using the laptop at times, so look at the spread, not single numbers.

## Results

| Setup | calls | median | p90 | slowest | errors | invalid | right |
|---|---|---|---|---|---|---|---|
| Flash medium, full briefing, forced JSON (agy) | 55 | 12.8 s | 17.4 | 32.3 | 0 | 0 | 55/55 |
| Haiku, full briefing in the message, forced JSON | 55 | 4.9 | 6.1 | 6.7 | 0 | 0 | 53/55 |
| Haiku, same, repeated (nothing else of mine running) | 110 | 4.5 | 5.6 | 24.4 | 0 | 0 | 108/110 |
| Haiku, short briefing in the message | 110 | 4.7 | 5.7 | 6.9 | 0 | 0 | 108/110 |
| Haiku, plain-text JSON (no `--json-schema`), checked in code | 110 | 5.8 | 7.2 | 11.3 | 0 | 1 | 109/110 |
| Sonnet, new setup | 55 | 4.7 | 8.9 | **93.1** | 0 | 0 | 54/55 |
| Sonnet low effort, new setup | 55 | 3.9 | 8.5 | 13.1 | 0 | 0 | 54/55 |
| Haiku low effort, new setup | 55 | 3.8 | 4.9 | 6.0 | 0 | 0 | 54/55 |
| **Haiku, new setup, production code path (`frontdesk.decide`)** | **165** | **3.8** | **4.9** | **8.4** | **0** | **0** | **164/165** |

The Flash numbers are one run (the Flash side measures its own more carefully). On this laptop Haiku's front desk is about 3x faster than Flash's at the median and the worst case is much smaller.

### The new setup (what made 4.5 s into 3.8 s)

1. **The briefing is Claude's system prompt**, from a file that *replaces* Claude Code's own long system prompt (`--system-prompt-file`). The message only holds what changes (time, history, saved facts, the user's text).
2. **Compact schema**: only `action` and `reason` are required, so Haiku leaves out the 8 empty fields. Output dropped from ~300-490 tokens to ~270 on average. `validateDecision` already treated missing fields as empty. A full-schema run of the same setup was 4.4 s vs 3.9 s.
3. **A Haiku-specific briefing** (`router-brief-haiku.md`): the short one, plus "all code work goes to claude-sonnet" (fixes the two wrong routes below), eleven one-line examples, "reason at most 10 words", and "this week = 7 days".

Not worth it (within noise, ≤0.5 s): `--effort low` (4.7 vs 4.9 s on the old setup, 3.8 vs 3.9 s on the new), `--setting-sources ""`, `--disable-slash-commands`, `--strict-mcp-config`, `--no-chrome`, `--safe-mode`, `--exclude-dynamic-system-prompt-sections`. `claude -p` itself costs about 2 s to start (trivial "Reply OK": 3.8-5 s, of which API time ~1 s). Nothing I found makes it start much faster. There is no warm mode for `-p` as far as `claude --help` shows (`--input-format stream-json` keeps a process open, but I did not build on it; see "not tried"). `--bare` needs an API key, so it is out.

Which Haiku: the alias `haiku` resolves to `claude-haiku-5-5`.

## Quality: every disagreement with Flash, and who was right

Flash (full briefing) got 55/55 on my expectations. Haiku disagreed with those expectations (and so with Flash) in these cases:

| Case | Haiku | Flash | Who was right |
|---|---|---|---|
| code-debug ("EADDRINUSE", old setup) | gemini-flash | claude-sonnet | Flash, by the briefing (code goes to Sonnet). Fixed in Haiku's briefing, 0 repeats after. |
| code-review (var/setTimeout, old setup, 3 of 4 runs) | gemini-flash | claude-sonnet | Flash, same fix. |
| cal-week ("מה המצב שלי השבוע?", on Thursday) | 3 days (Thu-Sat) | 7 days | Arguable. Fixed with a rule in the briefing: "this week = 7 days from today". 0 repeats after. |
| rem-hebrew ("תזכור שאני לא אוהב תשובות ארוכות מדי", 1 of 3 runs) | answer: "I already saved that you prefer short answers" | remember | Haiku, I think: fact 2 already says it. A duplicate would have been noise. I count it as a miss in the table anyway. |
| remind-utc ("15:00 New York time tomorrow") | reminder at 22:00 Jerusalem | same moment | Both right: same instant. My first check wrongly required the zone name; fixed in the script. |
| remind-notime ("remind me to call the bank") | plain-text variant only: invalid reply | clarify | Plain-text mode lost once. |

Everything else matched: Hebrew and mixed messages, web-search vs web-research (5/5 and 3/3), reminders with exact local times (tomorrow 09:00, in 2 hours, Sunday 18:00, tonight 20:00, "tomorrow morning" in mixed language), numbered remember/replace/forget, calendar ranges, improve in both languages, clarify, split, follow-ups needing history, the injection try (answered normally, no unlisted destination).

**Zero wrong routes in the final setup across 165 calls except the one debatable "already saved" case.** Nothing invalid.

## Valid replies (forced schema vs plain text)

- Forced schema (`--json-schema`): 0 invalid in about 600 Haiku calls; the reply arrives in `structured_output`.
- Plain-text JSON checked in code: 1 invalid in 110, and 1.3 s slower at the median (it writes the empty fields and parses text). So on Haiku the forced schema is better, the opposite of what the Gemini side saw on Flash.
- Either way `validateDecision` checks everything. The new test also checks that a compact reply with missing fields validates.

## Quota (honest, partly estimated)

- Per message, Haiku reads about 3k tokens (the system prompt and Claude's tool-free boilerplate), writes about 2k, and outputs about 270 (measured from the CLI's `usage`). Cost shown by the CLI is about $0.004 API-equivalent per message. Caching works through the CLI (`cache_read_input_tokens` is non-zero) but my 1.7k-token briefing is under the minimum size Haiku caches on its own, so most of it is "written" each call; I did not get a clean cache hit on the briefing.
- 30-50 messages a day is roughly 150-250k Haiku tokens a day. Anthropic does not publish Pro's token allowance, and I cannot read the usage meter from here, so I cannot say what percent that is. Haiku is the lightest model, and these are small prompts, but the pool is shared with Claude Code, and the front desk runs on *every* message including the ones Gemini answers. Omri said quota is not a concern; if it ever is, switch back to `"flash"`.
- If Claude hits a limit or is logged out, the fallback below keeps Bot working.

## Fallback (built and tested)

`frontdesk.decide` with desk `"haiku"`: if Claude fails (login 401, limit, 25-40 s timeout, spawn error) or returns something `validateDecision` refuses, Flash decides that message. After a failed *call* Claude is skipped for 5 minutes, so the next messages do not each pay for a failed call. If Flash also fails, `decide` throws and `core.js` hands the message to Claude Sonnet as today.

Live check with a deliberately invalid token: Claude failed in about 2-3 s, Flash answered, total 15.0 s for the first message (Flash alone is about 10 s); the second message went straight to Flash (8.9 s). Logged as `[frontdesk] claude/haiku failed (...); gemini-3.8-flash-medium answers instead`. Tests with fakes cover: success, failure, cool-down and retry after it, invalid reply (no cool-down), both failing, unknown desk. `node --test`: 310 pass.

## Not tried

- `--input-format stream-json` to keep one `claude` process open (would remove the ~2 s start). The Gemini side found this works for `agy`; on Claude it would need a careful per-message reset of context, so I left it. A good next experiment.
- Hedging (ask Haiku and Flash together, take the first valid answer). Cheap to add on top of `decide`, but it spends Gemini quota every time.

## What Omri must decide

1. Make Haiku the front desk (`FRONT_DESK = "haiku"`)? On these numbers it is faster (3.8 s vs 12.8 s median) and as accurate as Flash. The price is Claude Pro quota on every message.
2. Keep two briefings (`router-brief.md` for Flash, `router-brief-haiku.md` for Haiku)? The Haiku one is shorter and has examples; the existing test checks both mention every destination and action. Changes to routing rules have to be made in both.

For the other side: (1) on Haiku, forced JSON schema was *better* than plain text (0 vs 1 invalid, 3.8 s vs 5.8 s); (2) a shorter briefing did not make Haiku faster either (4.7 vs 4.5 s); what helped was moving the briefing into the system prompt and requiring only two fields in the schema (fewer output tokens: less to write); (3) the output length is the lever, since each call spends ~2 s on startup and ~1-2 s on writing; (4) low effort did nothing for Haiku speed; Sonnet is not faster or better than Haiku here and had a 93 s outlier; (5) a code question like "why does this print 3 3 3" gets sent to Flash by a brief without an explicit "all code to Sonnet" line.
