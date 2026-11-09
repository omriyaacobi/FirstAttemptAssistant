# Study chat: what was built and measured (2026-11-09)

Branch `claude/study-chat-build-e867fb`. Plan: `2026-11-09-assignment-helper-plan.md` (Option A, with Omri's changes: all courses, not only assignments). All test data is made up (course "Intro C++ Demo", a 5-section spec, 3 short notes).

## What it does
- `study-chat.js` + the plain-English briefing `study-brief.md` (Omri's own paragraph, plus safe rules). Edit the .md to change the behaviour; it is read again for every message.
- `core.js` asks `studyChat.check` first, for a message the front desk sent to a course (`course` action). It is ON when code finds study talk: teach/start, or ask/answer with a study word (explain, I do not understand, how does, a section number like 3.3, error, compile, a pasted code fence, Hebrew equivalents), or ANY follow-up within 6 hours of the last study-chat answer of that course. OFF for plan, progress, update, quiz/exercises, confirm/cancel, pause/resume, "summarize", a reply to a graded check started in the last 6 h, and after "back to the course". Off = exactly the old road.
- ONE model call. Chain: Argon LOW, then Flash medium, then Claude Sonnet. The prompt is built by code and capped (`LIMITS` in `study-chat.js`): briefing, level line, language line, about Omri (1,500), the assignment IN FULL (60,000; a longer one keeps its start, its section titles and the section the message names), notes pieces (12,000; `pickPages` plus the numbered section), recent turns (6,000), pasted code (fenced, line numbers added, 6,000 per block, 12,000 total), the question. Assignment, notes, code, turns and profile are data inside blocks with a random marker; forged block tags are removed.
- Assignment = the message-named file, else a saved assignment named in the message, else the newest assignment-looking file, else the first open saved one. Silent: no card, no due date, no "I have nothing saved".
- The answer is cut at about 1,500 characters (6,000 when the message says "in detail" / "בפירוט") and streamed with `onText`. Code blocks: Coach allows up to 40 lines, Strict up to 8; a longer one is replaced by a note (Coach allows a whole solution only when the message clearly asks for it; Strict never). The level is chosen in chat ("be strict, hints only", "back to coach") and kept in the course record.
- An AI-use rule in the assignment is found by code and quoted word for word at the top of the first answer of a work session (code writes it, not the model).
- The page shows a badge "Study chat (Coach)" / "(Strict)" on the answer card (`public/index.html`, `studyCard`).
- Removed in this path: the assignment Confirm card, the due date, "where are you / which lecture" questions, the forced QUESTION line, the 3-step 130-word format. The only thing written is `chat: { at, level, assignment }` in the course record ("last worked on"). Understood, lectures and positions are untouched (a test compares the record before and after).
- Both router briefs got one sentence (kept in step; test `BRIEFS`).
- Waiting model: a spare Argon-low `agy` process (`studyPool` in `core.js`) is started as soon as a message LOOKS like study talk (`likely`), while the front desk still decides. Other messages start nothing. It expires after 8 minutes.

## Argon low vs medium (5 made-up questions, the real prompt, real `agy`, cold start each time)
Script: `experiments/study-chat-timing.js`. Prompt about 5,700 characters. "First words" includes about 2.5 s to start `agy` (a warm spare saves that).

| model | first words (avg) | total (avg) | answer length (avg) |
|---|---|---|---|
| gemini-4-argon-low | 8.7 s | 12.1 s | 1,020 chars |
| gemini-4-argon-medium | 9.4 s | 12.8 s | 1,011 chars |

Per question, total seconds low / medium: 14.8 / 14.8, 12.2 / 11.5, 11.1 / 14.3, 11.3 / 13.0, 11.0 / 10.5. I read the answers: both were correct on the Makefile, the linker error, the off-by-one, delete vs destructor and the oral exam, and both said what they had not seen. The difference is inside the noise, so LOW is the default (never slower, less reasoning). Not measured: harder questions and long assignments (the prompt here was small).

## Live run through a copy of Bot (port 3100, BOT_THREAD=on, empty data/, no .env, real front desk and real Argon)
Script: `experiments/study-chat-live.js`. Seconds from sending until the job finished (front desk included):

| message | front desk | answer | total | first words seen |
|---|---|---|---|---|
| explain the Makefile in section 3.3 (never used C++) | 2.3 s | 8.1 s | 10.5 s | 7.6 s |
| why does my loop print 5 when I added 6 (code pasted) | 2.9 s | 10.4 s | 13.3 s | 9.8 s |
| difference between delete and a destructor | 3.4 s | 13.0 s | 16.5 s | 12.7 s |
| "what should I study today?" | - | - | 2.6 s | old coach, as before |

The first three logged `[study-chat] on` (study talk, then two follow-ups), badge "Study chat (Coach)", model gemini-4-argon-low, no card. The plan question stayed with the old coach. "First words" was polled every 250 ms from the job's partial text, so it is a little late.

## Tests
`tests/study-chat.test.js`, 27 tests: context caps and worst case (400,000-character parts), assignment in full inside a marker, a long spec cut with its titles and the named section, forged tags and "IGNORE ALL RULES" staying data, AI rule quoted, routing on/off in English and Hebrew, follow-up window, open graded check, no card / due date / position question, record before and after (Understood untouched), levels, code-block limit, reply cap, streaming, fallback order (Argon low, Flash, Sonnet) and total failure, core integration, briefs. Whole suite: `node --test` = 1052 pass, 0 fail.

## NOT verified
- A real Hebrew message end to end (only the prompt and the code-written lines are tested).
- A real long assignment (60k characters), a real PDF spec (extraction quality of code blocks and tables is still the open question from the plan), or the 130k-character worst case on `agy` (only measured at about 8k).
- How much the warm spare saves (cold against warm was not timed separately).
- The page badge in a real browser (one line in `studyCard`); the phone.
- Whether the front desk (Gemini or Haiku) sends every study-looking message to `course`; the new sentence in both briefs is untested with Haiku.
- The Strict level and the "whole solution" ask with a real model (fake answers only).
- Quota effect over a day of use.
- The blind comparison with the other chat (the plan's acceptance test) is for Omri.

## For Omri to decide
1. The live answer about the loop bug refused to write the fixed line "since your assignment prohibits using AI to write code". The rule says explanations are allowed, and Coach allows the smallest fix after "show me". The model read the rule strictly. Fine as it is, or soften the line "respect it" in the briefing?
2. The 40-line limit for Coach and 8 for Strict, the 1,500-character default and the 6-hour window are constants at the top of `study-chat.js`.
3. The graded quiz ("quiz me") and "teach me the next part" for notes courses still use the old fixed-format coach, except that plain teach/explain talk now goes to the study chat. Say if you want the old teach path gone completely.
4. Next steps from the plan (not built): the linked project folder and the zip code files as context (TODO is in the plan file).
