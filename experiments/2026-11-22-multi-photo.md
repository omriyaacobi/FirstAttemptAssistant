# Several photos in one message: does agy really look at all of them? (2026-11-22)

Question before building: when agy runs in a folder that holds several pictures, does it open every one, or only the first?
Asked for something only the LAST picture could answer, so a model that skipped it would be caught.

## Setup

- Three small PNGs made with Windows' own System.Drawing (no install): yellow "APPLE 17", blue "ZEBRA 42", green "MANGO 88".
- Copied into one fresh empty temp folder as `photo1.png`, `photo2.png`, `photo3.png` (the names Bot now uses).
- One call each through `askAgyStream` (the brain's streaming call, the same photo time limit), no slim agent, exactly as a photo
  message runs. Prompt: "There are N pictures in your current folder: photo1.png, ... Open and look at each of them. What word and
  number are written in photoN.png? Then list the word in every picture in order."

## Result

| Model | Pictures | Answer | read_file steps | Time | Tokens (in / out) |
|---|---|---|---|---|---|
| gemini-4-argon-low | 2 | "ZEBRA 42"; APPLE, ZEBRA | 2 | 13.4 s | 12,498 / 220 |
| gemini-4-hydrogen-medium | 3 | "MANGO 88"; APPLE, ZEBRA, MANGO | 3 | 7.3 s | 14,535 / 372 (+221 thinking) |

Both are the models of the photo chain (Argon low, then Hydrogen medium). Both opened every picture (one read_file per picture,
seen in agy's own step events) and answered from the last one correctly. Each extra picture cost about 1,000 input tokens here
(tiny pictures; real phone photos cost more).

## Side note

Deleting the folder right after the call failed once with EPERM (agy still held it for a moment). Bot's `cleanWorkDir` already
retries (8 x 250 ms) and the start-up sweep removes leftovers, so nothing new was needed.

## What was built

Up to 4 pictures (`MAX_PHOTOS` in photo.js) per message, in the thread and in Improve Bot planning. See the commit
"Several photos per message" on branch claude/multi-photo-62df10.
