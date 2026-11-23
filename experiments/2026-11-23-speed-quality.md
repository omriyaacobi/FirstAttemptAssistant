# Speed changes: do they hurt answers? (A/B quality test, 2026-11-23)

Asked by Omri through the manager after speed rounds 1 and 2. **A = main** (21cd973), **B = this branch** (01af586: round 1's
warm-up and Moodle cache, round 2's thinking line, file list, download-first, quick finish, 0.1 s Moodle pause).

## Short answer

- **B was not worse on 14 of 15 questions.** The math answers were the same and correct in both arms, and so were the code
  findings (checked against the real code by hand). The no-solution rule held in every answer, and the clarifying question,
  the Hebrew answer and the long-file-list open came out the same.
- **B was worse on 1 question: "download X from Moodle and open it".** B downloaded the file but did **not** open it. The cause
  is the new `moodle_fetch` quick finish (details and a suggested fix below). Nothing was changed; this is for Omri to decide.
- **B was faster:** 12.9 s against 15.2 s per message on average (-2.3 s, -15%), with the same number of model calls (1.5 per
  message) and about the same tokens. The model's hidden thinking was lower in B on 11 of 15 questions.

## How it was run (`experiments/speed-quality.js`)

- Two scratch checkouts (main and this branch). Each one's `data/` was a junction to its own temp copy of Bot's real data, both
  made from one snapshot. So reminders, downloads and other doing-tools touched only the copies. The live Bot was never contacted.
- The brain was built as `server.js` builds it, with the real tools, except:
  - Neon low was the ONLY model: no fall-through, no Claude plan.
  - open_on_pc only recorded what it would open.
  - A downloaded file was filed into the copy but not read by a model.
  - The recent talk was the copy's thread, the same for both arms.
- Moodle used Bot's own token route (read-only, token loaded by Bot's code, never printed). One real file was downloaded,
  into B's temp copy only.
- 15 questions, written for this test and shaped like Omri's real use. 13 were run twice per arm and the 2 Moodle ones once,
  with arms alternating. **56 messages, 84 Neon low calls, 0 failures.**
- I judged every answer myself, reading A and B side by side. The answers' text stays in the scratchpad (private); this note
  has only numbers and verdicts.

## Results

| question | what it checks | A s | B s | A / B model calls | verdict |
|---|---|---|---|---|---|
| ftc | derivative of an integral with variable limits | 7.4 | 6.9 | 1 / 1 | same (both right, same steps) |
| improper | two improper integrals, one converges, one does not | 10.3 | 9.5 | 1 / 1 | same (both right) |
| critique | a wrong-looking proof (∫ 1/x² over [-1,1] = -2) | 9.4 | 6.9 | 1 / 1 | same overall (see note 1) |
| trap | "integrable implies F' = f everywhere?" (false) | 10.8 | 8.3 | 1 / 1 | same (both say no, same counterexample) |
| gamma | prove ∫₀^∞ x^p e^-x converges iff p > -1 | 12.7 | 9.4 | 1 / 1 | B a bit better (note 1) |
| code | leaks / overflows in a linked-folder C file | 27.1 | 21.6 | 2 / 2 | same (both found the one real edge case) |
| grep | malloc without a NULL check (there is none) | 22.5 | 23.0 | 3 / 3 | same (both: "nowhere", with lines) |
| nosol | explain question 2 of sheet 1 without solving | 23.0 | 19.9 | 2.5 / 2 | same (no solution in any answer; note 2) |
| hint | assignment part + a hint, no code | 20.9 | 17.8 | 2 / 2 | same |
| multi | find in notes + reminder + one-line concept | 10.2 | 8.6 | 1 / 1 | same (all three parts done in every run) |
| vague | "open it and move it to the other folder" | 6.5 | 6.5 | 1 / 1 | same (both ask which file and which folder) |
| hebrew | absolute vs conditional convergence, in Hebrew | 11.8 | 10.1 | 1 / 1 | same (right, Hebrew, examples) |
| longlist | open mission 2's README in a 71-file course | 7.3 | 6.1 | 1 / 1 | same (the right README opened) |
| moodledl | "download the newest practice file and open it" | 15.4 | 15.1 | 2 / 2 | **B worse** (see below) |
| moodlenew | what's new on Moodle in all courses | 50.6 | 35.8 | 3 / 3 | same content; B 15 s faster (round 1's cache) |
| **all** | | **15.2** | **12.9** | 1.5 / 1.5 | |

Thinking tokens per message, A against B: lower in B on 11 of 15 questions (for example: critique 635 vs 327, gamma 850 vs 510,
multi 710 vs 521). Higher in B on nosol (1082 vs 1244), vague (350 vs 407), and on grep (+0.3%) and moodlenew (+5%).

**Note 1, short "check yourself" replies.** Twice the model answered with the start of the work and a question instead of
the whole answer. Once in B (critique: it said "no" and why it cannot be -2, but left the reason for Omri to find) and once
in A (gamma: it split the integral and then asked a question instead of finishing). That is the tutor style in the briefing,
it happens in both arms (1 of 2 each), and it is not caused by the speed changes.

**Note 2, which sheet is "the first exercise sheet".** In 3 of 4 runs both arms read the worksheet `Cal_2_2026 (10)`. In one
A run the model read practice session 1 instead. Both are fair readings of the words; B was consistent.

## The one problem: the moodle_fetch quick finish drops "and open it"

What happened in B: in round 2 the model wrote ONE call, `moodle_fetch`, with no words under it. It meant to open the file
in round 3. The download fully worked, so the new quick finish ended the message with the code-written line "Downloaded from
Moodle into ...". The open never happened. (A did something different: it opened the PDF version already in the course
instead of downloading. That did what Omri asked, though not with the newest copy.)

Why: the manager's rule allows the quick finish "with the model's own words under its CALL lines, OR a code-written line".
A bare CALL line with no words means the model may still have a next step. The other quick-finish tools already need the
model's own words for exactly this reason.

**Suggested fix (NOT applied, for Omri to decide):** drop the code-written fallback. A full `moodle_fetch` may end the
message only when the model wrote its own words under its CALL lines, as for every other doing-tool. A bare
`CALL moodle_fetch` then gets the normal next round: about 4-8 s more, but the "and open it" is done. In `brain.js` that is
removing one line (the `if (!said && ...) said = ... fullFetch ...` line). The test "a full Moodle download with no words
from the model ends with a line code wrote" in `tests/moodle.test.js` then flips to expect a second model call. A second,
more complex option is to keep the code line only when the message asked for nothing else, but code cannot know that
without reading Omri's words, which the design forbids.

## Verdict

The speed changes do not hurt answer quality on hard math, code, rules or several-things-at-once messages. They save about
2.3 s per message on average here, and 15 s on a Moodle "what's new". One real regression was found, caused by the
code-written fallback of the new `moodle_fetch` quick finish ("download and open" stops after the download). Dropping that
fallback fixes it, at a cost of 4-8 s on bare-download messages.

## Limits

- 2 runs per question per arm (1 for Moodle): enough to see a clear regression, not to rank small differences.
- One model (Neon low). The recent talk was fixed (the real thread at the time of the copy).
- Opening was faked, so whether the right file opens on screen was judged from the tool call and its target only.
