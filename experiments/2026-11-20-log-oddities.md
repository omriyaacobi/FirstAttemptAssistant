# Two oddities in the log of 2026-11-19

## 1. "Two identical answers to one message" (about 11:30 Israel time = 09:30 UTC)

**Cause: not a bug. Two real messages.** The thread has two user messages 2.4 s apart (09:30:10 and 09:30:13 UTC),
each 2 characters, with different ids and different text: the first is the English-keyboard letters that a
Hebrew-layout "yes" gives when the layout is wrong, the second is the same "yes" typed in Hebrew. Each was its own
job, and each got ONE answer (two assistant messages, each with its own `replyTo`). Both asked the same thing
(open two Moodle items), so both ran the same tools and said nearly the same words (112 vs 123 characters).
No job posted twice, no retry, no fallback model after an answer (each log shows one "answered by" line).

**Evidence:** 2 user messages / 2 answers / 2 "answered by" lines, 28.2 s and 30.3 s. No repeated user id.

**Fix:** none. A server guard by text would compare Omri's words, which the rules forbid, and the ids differ, so an
id-based guard would not have caught it either. Nothing was changed for this one.
(Side effect worth knowing: the PC opened the two Moodle pages twice.)

## 2. A question over several Moodle courses took 75 s

**Cause:** the calls of one round already run together (`Promise.all` in `brain.js`). The 75.5 s were 4 model calls
(about 117,000 tokens) in 3 tool rounds: round 1 `moodle_courses`; round 2 `moodle_course` for 4 courses (together);
round 3 `moodle_news` for the same 4 courses (together). The model asked for the courses' pages and for their news in
two separate rounds, though it could have asked for both in round 2. Each extra round is a whole model call plus
the slot wait.

**Fix:** one plain-English sentence in `brain-brief.md`: once the courses are known, ask for what you need from all
of them in the same round. Test: `tests/brain-brief.test.js` (the sentence is there). No code changed;
`brain.js` untouched. `moodle-ws.js` keeps its own one-at-a-time pause (300 ms), so the lookups of one round still go
to Moodle in turn, which is why running them together in code would not have saved much.
