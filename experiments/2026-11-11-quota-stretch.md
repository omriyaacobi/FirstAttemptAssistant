# Quota stretch: what can answer when Argon's weekly pool runs low (2026-11-11)

Question: Gemini 4 Argon weekly was at 32% (resets 2026-11-13 23:56 UTC) and falls fast now that Omri uses Bot every day.
How can the brain keep answering well WITHOUT handing real answers to Gemini Flash (which made real math errors before)?

## 1. Which models can agy run on Omri's plan?

`agy models` (2026-11-11):

| id | pool in `/usage` |
|---|---|
| gemini-4-argon-low / -medium / -high | Gemini 4 Argon (weekly only) |
| gemini-3.8-flash-low / -medium / -high | Gemini Models (weekly + five hour) |
| claude-sonnet-5-5-low / -medium / -high | Claude and GPT models (weekly + five hour) |
| claude-opus-5-5-low / -medium / -high | Claude and GPT models |
| gpt-oss-120b-medium | Claude and GPT models |

**Gemini 3.1 Pro is not in agy.** `agy -p "Say OK" --model gemini-3.1-pro` (and `-medium`) answers
`model gemini-3.1-pro is not recognized as a known model`. That is why the earlier attempt failed: 3.1 Pro exists only in the
Gemini app (gemini.google.com), which has no command line. Through the Gemini API (AI Studio key) 3.1 Pro looks paid-only;
the free API tier covers Flash models, and a Gemini app subscription does not pay for API use. So 3.1 Pro is not an option
without paying per token. (Gemini 4 Carbon shows up in agy only with Google Cloud ADC login, also not Omri's plan.)

The "Claude and GPT models" pool inside agy is **separate from the Claude Pro plan** that `claude -p` (Claude Code) spends.
It was at 100% and Bot barely used it (only as a last resort in a few chains).

## 2. How it was measured

A script (kept out of the repo) ran the REAL `brain.js` (real `brain-brief.md`, real context building, real tool loop) with
Omri's real course text (read-only), a fake calendar week, and fake stores (no reminder or card was really made).
Only the model changed. 7 real-shaped messages:

| id | message | needs |
|---|---|---|
| calc | Calculus 2: explain the ratio test + a series where it says nothing | course answer |
| remind | remind me tomorrow at 9 to submit PS4 | `CALL set_reminder` |
| event | add office hours Thursday 14:00-15:00 | `CALL add_events` |
| hebrew | מה יש לי השבוע ובמה כדאי לי להתמקד היום? | calendar context, Hebrew |
| code | decode loop copies decoded[temp_length]; hint only | assignment hint, no solution |
| math | does Σ 1/(n ln n) converge? | correct math |
| search | what do the HPSP notes say about cache locality? cite the file | `CALL course_search / course_read` |

The pools were read with `agy -p "/usage"` before and after each model's 7 messages.
Note for Git Bash: write `MSYS_NO_PATHCONV=1 agy -p "/usage"`, or Git Bash turns `/usage` into a path and the MODEL answers instead.

## 3. Results

Time = whole message, including tool rounds (s). "Model calls" = rounds (each round spends quota).

| model | calc | remind | event | hebrew | code | math | search | total time | model calls |
|---|---|---|---|---|---|---|---|---|---|
| Argon low (today's default) | 19.6 | 8.9 | 10.9 | 27.2 | 32.5 | 13.0 | 26.9 | 139 s | 11 |
| agy Claude Sonnet 5.5 low | 6.2 | 4.7 | 5.8 | 7.3 | 14.2 | 5.2 | 11.9 | 55 s | 9 |
| agy Claude Sonnet 5.5 medium | 6.0 | 5.6 | 5.6 | 13.3 | 19.6 | 5.4 | 11.3 | 67 s | 11 |
| agy GPT-OSS 120B medium | 5.8 | 6.1 | 5.9 | 7.9 | 4.7 | 4.2 | 9.1 | 44 s | 7 |
| agy Claude Opus 5.5 low | 6.3 | 5.2 | 5.7 | 14.6 | 14.6 | 5.8 | 14.3 | 67 s | 10 |

Quota spent by the 7 messages:

| model | pool | weekly | five hour | about per message |
|---|---|---|---|---|
| Argon low | Gemini 4 Argon | 32% -> 30% | (none) | 0.3% weekly |
| Claude Sonnet low | Claude and GPT | 99 -> 92% | 98 -> 85% | 1% weekly, 2% five-hour |
| Claude Sonnet medium | Claude and GPT | 92 -> 84% | 85 -> 69% | 1.1% weekly, 2.3% five-hour |
| GPT-OSS 120B | Claude and GPT | 84 -> 84% | 69 -> 68% | ~0 |
| Claude Opus low | Claude and GPT | 84 -> 70% | 68 -> 40% | 2% weekly, 4% five-hour |

(Percent readings are whole numbers, so small numbers are rough.) In plain words: the Claude-and-GPT pool holds about
**100 Sonnet-low messages a week, about 50 in five hours**. Argon's 30% holds about 100 more. Today Omri sent 38 messages.

CALL lines: every Claude and Argon run wrote valid `CALL {json}` lines that the brain accepted (0 broken).
GPT-OSS wrote one broken CALL line (search: 1 line, 0 parsed) and then answered without the tool.

## 4. Quality (I read every answer)

- **Argon low**: all correct (ratio test, 1/(n ln n) diverges by the integral test, right weekdays, good hint without the
  solution, search cited Lecture 3 pages 23-34). Slowest (9-33 s).
- **agy Claude Sonnet low**: all correct, 2-3x faster. Best hint (points at the mismatch encoded/decoded, asks a question,
  no solution). Search cited Lecture 3 slides 23-25 with real numbers from the slides. Hebrew natural (uses "אתה", as Argon does).
  Small flaw: the event reply said the clash twice.
- **agy Claude Sonnet medium**: correct, but the code hint gave away more of the solution (`encoded[len - 1 - i]`). No gain over low.
- **agy Claude Opus low**: correct and good, but costs twice Sonnet's quota. Not worth it for everyday messages.
- **GPT-OSS 120B: rejected.** Wrong weekdays in Hebrew (called Wednesday "Sunday" and Thursday "Monday"), gave the code
  solution outright ("replace with '_'"), said the reminder needs a tap (it does not), answered an English question in Hebrew
  without searching the notes. Nearly free, but not trustworthy.

## 5. Side finding (not fixed here)

`providers.ask("agy", model, prompt)` WITHOUT `onText` puts the prompt on the command line. The brain prompt is far longer
than Windows allows, so it fails at once with `spawn ENAMETOOLONG`. The live brain works only because the thread passes
`onPartial` (streaming goes through stdin). Any brain fallback to a non-Argon agy model without streaming fails this way.
Fix: the brain should always use the streaming call for agy.

## 6. Proposal (waiting for Omri's OK)

See the chat; summary: brain chain Argon low -> agy Claude Sonnet low -> Claude Code Sonnet (Pro plan); Flash leaves the
brain chain; Argon steps aside for everyday chat when it falls under a reserve, so its last part stays for tutoring and PDFs.
