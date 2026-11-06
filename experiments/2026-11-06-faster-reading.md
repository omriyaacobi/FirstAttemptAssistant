# Faster reading of big PDFs (2026-11-06)

Test file: Omri's 46 MB, 87-page Calculus 2 notebook. Its content stays out of the repo; only numbers and method are here.
All timings ran while a real whole-file read of the same PDF was running in the real Bot, on one laptop and one Gemini quota, so they are upper bounds.

## What the file really is

Not a scan. It is an iOS notes export: PDF 1.3, one classic table of contents, no object streams, no encryption.
95% of its bytes (43.7 MB) are the pages' own drawing commands, about 500 KB a page: 2 million pen and grid strokes. Images are only 2 MB.
The handwriting-style fonts have no character map (10 of 94 fonts have one), so the text layer comes out as garbage. A model must read the picture.

## Where the time goes: opening the file

| What agy gets | Pages asked | Time | Tokens | Per page |
|---|---|---|---|---|
| Whole 46 MB file (earlier measurement) | 1 | 205 s | | 205 s |
| Whole 46 MB file (earlier measurement) | 15 | 389 s | | 26 s |
| Cut file, 0.5 MB | 1 | 67 s | 31k | 67 s |
| Cut file, 2.8 MB | 5 | 110 s | 50k | 22 s |
| Cut file, 5.2 MB | 10 | 150 s | 50k | 15 s |
| Cut file, 11 MB | 20 | 303 s | 78k | 15 s |

With a cut file agy reaches the file in about 10-15 s instead of about 200 s. The rest is the model working.
A cut takes 2-11 ms (56 ms to open the file), with Node built-ins only (`pdfcut.js`).
10 pages is the best size: as fast per page as 20, half the tokens per page of 5, and one failure loses less than with 20.

Flash LOW is not an option: it returned nothing after 8 s. It tried `run_command`, was refused, and stopped with no text.
This is one real cause of the empty answers.

## Accuracy: the real discovery

Faster alone would have been a step back. Compared with the page itself, Flash does not transcribe, it rewrites: wrong bounds on integrals,
one term swapped for another with a different meaning, fifth roots for fourth roots, a heading it added. Agreement between readers hid this, because two readers can agree on
a confident guess. So every number below comes from looking at the handwritten page.

Page 10 has a checklist of 22 items (headings, bounds, key words), written from the picture before scoring. "Strict" is a prompt that says copy word
for word, never rephrase, never correct, never fill in, and write [?] for an unreadable word.

| Reader | File | Prompt | Time | Page 10 score |
|---|---|---|---|---|
| Flash medium | whole, 20 pages | old | about 8 min | 13/22 |
| Flash medium | cut, 10 pages | old | 150 s | 9/22 |
| Flash medium | cut, 10 pages | strict | 255 s | 16/22 |
| Flash high | cut, 5 pages | strict | 216 s | 17/22 |
| Sonnet (claude CLI) | cut, 5 pages | old | 57 s | 19/22 |
| Sonnet (claude CLI) | cut, 5 pages | strict | 68 s | 20/22 |
| Argon low | cut, 5 pages | strict | 60 s | 21/22 |
| Argon low, the full read below | cut, 10 pages | strict | about 110 s | 22/22 |

The same pattern on two more pages, each compared with the picture by hand:
- Page 45: every reader had every formula right. Hebrew word slips: Argon 2, Sonnet 2, whole-file Flash 6.
- Page 73 (dense matrices and roots): Argon had no error that matters. Whole-file Flash wrote fifth roots for fourth roots throughout, which is a wrong answer, added a name to a heading, and garbled a line.

Limits of this check: three pages by hand, and the checklist exists for one of them. It shows which reader is better, not that a read is free of errors:
Argon too swapped one word for a similar one on page 45. Argon sometimes describes a diagram in English; this does no harm (the search words stay mixed).

## The full read

87 pages, Argon low, strict prompt, 10-page cuts, 3 at once, real agy, nothing else running:

| | Before (Flash, whole file) | After |
|---|---|---|
| Time | about 40 min | 5 min 48 s |
| First pages usable | at the very end | after 110 s |
| Calls | chunks of 20, with failures | 9, none failed, no empty answer |
| Pages | 87, after retries | 87 |
| Hand-checked page | 13/22 | 22/22 |
| Quota | Gemini pool | Argon weekly 77% -> 69%; Gemini and Claude unchanged |

So a file like this costs about 8 points of Argon's weekly pool: about 12 such files a week. Argon's pool is separate from the Flash pool the chats use.
Each call took 91-135 s, the same as alone (98-120 s), so 3 at once really is 3 times as fast. A higher limit was not tried: 3 is already well under 6 minutes, and more only spends quota faster.

## Decisions

Built: `pdfcut.js`; 10-page chunks; 3 at once; the strict prompt; chain Argon low, then Sonnet, then Flash, in order of accuracy.

Rejected, with the reason:
- Flash on low effort: returned nothing.
- Flash high: slower than Argon (216 s for 5 pages) and less accurate.
- 5-page or 20-page chunks: the numbers above.
- Sonnet as the first reader: nearly as good, but it spends the Claude plan, which Bot cannot see, and that plan also runs Claude Code and the backup front desk. It is the fallback.
- Pulling the text out of the PDF with no model: the fonts have no character map, so it is garbage.
- A Hebrew-English glossary for search: 15 of 15 Hebrew and English question pairs already overlap in their top 6 pages, because the KEYWORDS line mixes both.

Not built: a PDF with object streams (most LaTeX and Word exports) cannot be cut yet, so it stays on the old whole-file path with Flash first. It is logged. The fix would be about 25 lines in `pdfcut.js`, but no such real file was available to test it on.
Not measured: the direct Gemini API. It needs a key Bot does not have. If it ever looks worth it, Omri would create a key in Google AI Studio and put it in `.env`.

Scripts stayed in a scratch folder, since they hold paths to private files and the checklist quotes the notebook.
