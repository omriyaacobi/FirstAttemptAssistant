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

## Accuracy
