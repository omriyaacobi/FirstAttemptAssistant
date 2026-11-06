# Why the timetable photo took 414 s (2026-11-06)

Real case: chat `271f4a6b2968cc78`, a timetable photo plus a long Hebrew request with three changes (replace a class, delete one, move one). Bot answered after 414.6 s, by Flash MEDIUM, the first model of the photo chain. `askAgyWithImage` had no time limit, so a stuck first model could never hand over to Argon.

Test (harmless fake timetable, 10 Hebrew rows, rendered with headless Edge; same note as the real path, `photoCalendarNote`; one call each, from `providers.askAgyWithImage`):

| model | request | time | result |
|---|---|---|---|
| gemini-3.8-flash-medium | the real 3-change request | 135 s | EMPTY answer |
| gemini-3.8-flash-medium | simple "every week until end of January" | 32 s | valid JSON |
| gemini-3.8-flash-low | the real 3-change request | 12 s | valid JSON, all three changes applied |
| gemini-4-argon-low | the real 3-change request | 24 s | valid JSON, changes applied |
| gemini-3.8-flash-high | simple request | 55 s | valid JSON |

Cause: not tools or the image. Flash with more thinking (medium, high) is slow on a task that mixes reading a table with several edits, and medium sometimes ends with no answer at all. Low effort did the harder request in 12 s.

Changes: calendar photos ask Flash low first, then Argon low, then Flash medium (`PHOTO_CALENDAR_CHAIN` in core.js). Every photo call now has a limit, 90 s for Flash and 150 s for Argon (a good answer needs 12-35 s), after which the process tree is killed and the next model is tried (`imageTimeoutFor` in providers.js).

Not verified: one run per cell, so the numbers are samples, not averages. The original photo is gone, and a handwritten or photographed (not rendered) timetable may take longer.
