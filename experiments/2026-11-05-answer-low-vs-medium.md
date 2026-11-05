# Answer step: Flash low vs Flash medium (2026-11-05)

**Question (Omri):** if the `gemini-flash` destination used `gemini-3.8-flash-low` instead of `-medium`, how many more mistakes would it make? "I'd rather get higher accuracy than fast results."

**Short answer:** on 48 everyday questions (96 answers per model) I found **no factual error in either model** and **no incomplete answer that differed between them**. The only defects were one small text glitch in a low answer and one mistranslated word in a medium answer. Low was about 1.4 s faster at the median (8.6 s against 10.0 s). This test cannot show a difference smaller than a few percent, and it did not include hard questions. There is **no recommendation to switch**: the data does not show low is worse, but it also does not prove it is as good.

Live routing was not changed in this part.

## What was run

- Harness: `experiments/answer-low-vs-medium.js` (the 48 questions and their fact checks are in it). Grading tool: `experiments/answer-low-vs-medium-grade.js`.
- **The call is the real one**: `providers.ask("agy", model, personalize(chain, question, about))`, which is what `core.js` runs for a `gemini-flash` task. One message in a fresh chat, so no history; the profile block was empty on this machine (no `data/profile.md`).
- 48 questions, about 42% Hebrew (20) and 58% English (28): home and cooking (egg, rice, pasta, buttermilk, fridge, kettle, stain, bread, steak, units), car (oil light, ABS light, tyre pressure, oil change, jump start, 95 vs 98, Israeli annual test), study explanations (primary key, stack vs queue, binary search, derivatives, DNS, TCP vs UDP, Newton, Pythagoras, photosynthesis, inflation, KiB), translation (Hebrew to English and back, 5 items), summaries (English and Hebrew, 2 items), a polite rewrite.
- Each question went to **both models, 2 times** = 192 calls, 0 failed. Calls ran 3 at a time in random order, so network moments hit both models alike. Seconds are the real wall time of one call (includes agy start-up, about 3 s).
- Raw answers and the blind key: `side-session-notes/.../answer-speed/` (not in the repo: 400 KB of model text).

## How I graded (blind)

1. A script shuffled all 192 answers and gave each a random code (`b1`..`b192`). The file I read has the question, the required answer language and the answer. **No model name and no timing.** The key that maps codes to models was only opened after all grades were written.
2. I (Claude Sonnet 5.5) graded each answer for three things: **factual error** (a wrong fact or wrong number), **incomplete answer** (misses what was asked), **language mistake** (wrong language, garbled or broken wording).
3. Depth of reading, honestly: answers b1 to b24 I read in full. For b25 to b192 I read the first 700 characters of each answer (about a third of the text on long answers). A wrong statement hidden in the rest of a long answer could have been missed, for both models equally. The second check below covers the key facts over the full text.
4. Second, mechanical check over the **full** text of all 192 answers: regular expressions for the key fact of each question (for example 9 or 10 or 11 or 12 minutes for the egg, 74 or 165 for chicken, `1989`, `3x^2`), for known wrong values, and for answer language. It flagged 6 low and 4 medium answers; every flag was a false alarm after reading (the summaries that left out the 7:2 vote, translation answers that explain in the question's language, and the Israeli test answer that mentions a 6-month test for very old cars).
5. Things I could not verify: Israeli test rules for cars older than 19 years and for brake certificates (both models say the same), and whether "הטמעה" is a good Hebrew word for photosynthesis (both models use it). Not counted as errors.

## Results

| | low | medium |
|---|---|---|
| answers | 96 | 96 |
| **factual errors** | **0** | **0** |
| **incomplete answers** | **0** | **0** |
| **language mistakes** | **1** | **1** |
| answers with any problem | 1 | 1 |
| median seconds | **8.6** | 10.0 |
| mean seconds | 8.8 | 11.4 |
| slowest 10% (p90) | 11.9 | 17.4 |
| slowest single answer | 16.9 | 29.3 |
| Hebrew answers, median | 8.6 | 11.6 |
| English answers, median | 8.3 | 9.3 |
| average answer length (characters) | 1011 | 1055 |

Low was faster in 84 of the 96 matched pairs (same question, same repetition).

### The mistakes found (all of them)

- **Low, language/format, question 35 (Pythagoras):** the answer printed a stray duplicated heading before the real one:
  `### The` / `### The Theorem`. Harmless, but a visible glitch.
- **Medium, language, question 46 (dry bread, Hebrew):** wrote "ברד פודינג" for bread pudding. "ברד" means hail; the Hebrew would be "פודינג לחם". The line was "ברד פודינג (מאפה לחם מתוק מנחם)".
- Not counted, but worth knowing: in the English summary question, 2 of 4 low answers and 2 of 4 medium answers dropped the "7 to 2" vote and kept the 3 km, 12 million, March and 80 parking spots. Both models do it equally. Example (low): "The city council approved a 12-million-shekel plan to extend the Herzl Street bike lane by 3 kilometers, with construction slated to start in March. However, opponents criticized the decision because the project will eliminate 80 parking spaces."

There is no worse low-effort mistake to quote, because there was no factual error.

## What this does and does not show

- With 0 errors in 96 answers, the real error rate of low on this kind of question is probably under about 3% (rule of three, 95% confidence). Medium is the same. A difference of one or two extra mistakes per hundred is **below what 96 answers can show**.
- These are the easy, checkable questions that `gemini-flash` mostly gets. Questions that need several steps of reasoning, long study explanations, or rarely known facts were not tested, and that is where a lower effort setting is most likely to hurt.
- One grader, and it is a model. A person grading the same answers might see more language slips in the Hebrew (the answers are long and full of formatting).
- Speed was measured while 3 calls ran at once, which is also how Bot sometimes runs. The gap between the two models should be similar when it runs alone. Medium had slow outliers (29.3 s and 22.5 s at the 90th percentile for Hebrew).
- The answer step is only a part of the wait: the front desk (about 2-6 s) and agy start-up come first. Low saves about 1.4 s at the median here, not the 6 s the front desk saved.

## If you want more evidence before deciding

Run the same harness with 30 to 40 harder questions (multi-step math, a long study explanation, Hebrew with specific facts) and grade them the same way. The harness takes the question list as an array, so it is a copy-and-edit job. I would not change the destination before that.
