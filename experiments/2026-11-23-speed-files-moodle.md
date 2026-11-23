# 2026-11-23: Why do course files and Moodle feel slow? (follow-up of t19)

Companion to `experiments/2026-11-23-speed.md`, which shows that a model call costs about 4 s plus about 1 s per 200 tokens
written, and that agy itself takes 3.4 s to start.

Everything below was measured read-only:
- The real thread log, 17-23 Nov: 134 answers that used a file, Moodle or PC tool.
- The real tool code run on the real `data/` folder, with a fake model and a fake "opener", so no app was started and no
  model was asked.
- About 25 Moodle READ requests through the token route. The token stayed inside `moodle-ws.js` and was never printed. The
  three test downloads went into memory only.

Nothing was written into Bot's data, and no message went to Bot's thread.

## Short answer (simple words)

- **The tools themselves are fast, apart from Moodle.**

  | tool | time | what was measured |
  |---|---|---|
  | course_read | 8-62 ms | |
  | course_search | 24-124 ms | |
  | pc_find | 25-85 ms | |
  | project_read | 1-20 ms | |
  | open_on_pc on a course file | 2-3 ms, plus about 0.1 s | the 0.1 s is copying a 46 MB file before opening |
  | a Moodle download | 0.6-0.9 s | 0.75-3.7 MB files |

- **What makes these messages slow is the number of model ROUNDS.** Every extra round is a full model call of about 7-10 s.
  "Open exercise sheet X from Moodle" took 4 model calls: 10.2 + 8.0 + 7.2 + 7.1 s, plus 7.3 s of tools, 39.8 s in all.
  Three rounds were avoidable:
  1. **Round 1 was only `course_files`, to learn the file's exact name.** The prompt lists only the assignment files and the
     4 newest files of each course, so the model has to ask for the rest.
  2. **The download and the open ran at the same time.** Bot runs all calls of a round together (`Promise.all`), so
     `open_on_pc` looked for a file that `moodle_fetch` had not filed yet. In the other "download and open" message
     (29.3 s), the open had to be asked for again in the next round.
  3. **After `moodle_fetch` the model is always asked once more, just to say what was downloaded.** `moodle_fetch` is not a
     "quick finish" tool. This happened in all 6 download messages, and cost 3.4-9 s each time.
- **Moodle reads are slow because they run one request at a time, with a 0.3 s pause after each, and repeat themselves.**
  - One Moodle request is about 0.3 s on the network plus the 0.3 s pause, so about 0.6 s.
  - `moodle_course` takes about 2.3 s: the course contents, then ALL deadlines (about 1.0 s), then the forum.
  - `moodle_news` takes about 3.2 s: the contents again, the forum again, then 3 posts one after another.
  - The worst real message asked about 4 courses: 4 × `moodle_course`, then 4 × `moodle_news`. It spent **37.7 s in Moodle
    tools** plus 37.8 s of model.
  - In that message the all-courses deadline list was read 4 times, and each course's contents and forum list twice.
- **Two smaller things in Bot's own code:**
  - `course_files` on the biggest course (71 files, 494 pages) takes **0.76 s**. For every file that shares a name, it re-reads
    all 494 pages to find that file's first line. The other courses take 0-3 ms.
  - The linked folder of one course (a WSL folder) costs **about 0.5 s on every message in that course**. Listing it takes
    0.24 s and the "where does Omri work now" check takes 0.27 s, and both walk the same folder.
- **The one "open_on_pc alone took 46 s" message was not the tool.** It waited for a file that was still being read (the
  agreed WAIT FOR FILES rule).

## 1. The real log (`node experiments/speed-measure.js` style, 17-23 Nov; tools per round from the log lines)

Some typical file and Moodle messages ("other" = tool time plus prompt building, about 0.9 s of which is the prompt):

| what (rounds: tools asked in each) | total s | model calls (s each) | other s |
|---|---|---|---|
| course_files → moodle_course + course_read → moodle_fetch + open_on_pc → reply | 39.8 | 10.2, 8.0, 7.2, 7.1 | 7.3 |
| course_files + moodle_course → moodle_fetch + open_on_pc ×2 → open_on_pc again | 29.3 | 7.2, 7.8, 8.0 | 6.3 |
| talk_course + moodle_courses → moodle_course ×4 → moodle_news ×4 → reply | 75.5 | 16.7, 6.2, 6.5, 8.4 | 37.7 |
| course_files + moodle_course → open_on_pc | 52.9 | 23.5, 6.5 | 22.9 |
| moodle_course + course_files → reply | 33.0 | 4.7, 8.2 | 20.1 |
| moodle_course ×2 → open_on_pc ×2 | 28.2-30.3 | 4.8-7.5, 6.3-9.2 | 13.6-17.1 |
| moodle_fetch → reply (4 messages) | 14.4-18.1 | 2 calls | 3.1-5.7 |
| pc_find → open_on_pc | 22.0 | 5.8, 15.0 | 1.2 |
| project_read (×1-6) → reply (typical) | 12-25 | 2 calls | 0.6-1.9 |

On 19 Nov, `moodle_course` took 13-23 s of "other". That is far more than the 2.3 s measured today: Moodle itself was slow
then, or the token route was failing and the Chrome bridge was used. The token route has a 45 s limit per request.

## 2. The tools, timed directly

| tool | course A (9 files, 115 pages) | B (49 files, 172 pages) | C (71 files, 494 pages) | D (13 files, 139 pages) |
|---|---|---|---|---|
| course_files | 3 ms | 2 ms | **760 ms** | 0 ms |
| course_read (biggest file, 14k characters back) | 27 ms | 62 ms | 40 ms | 8 ms |
| course_search | 61 ms | 124 ms | 84 ms | 24 ms |
| open_on_pc course file (up to the app start) | 3 ms | 3 ms | 2 ms | 3 ms |

| other | time |
|---|---|
| pc_find (3 queries over the search roots) | 25-85 ms |
| project_files: the linked WSL folder (80 files) / a Windows folder (15 files) | 242 ms / 8 ms |
| project_read | 1-20 ms |
| workingNow (runs on EVERY message in a course with a linked folder): WSL / Windows | 265 ms / 2 ms |
| copying a 46 MB original before opening it | 102 ms |

Moodle, token route (each request listed in order; the 0.3 s pause between requests is included in the totals):

| tool | total | requests |
|---|---|---|
| course list | 0.5-0.65 s | 1 (cached 10 min afterwards) |
| moodle_course | 2.2-2.4 s | contents 0.6, deadlines (all courses) 0.9-1.1, forum 0.65 |
| moodle_news (3 posts) | 3.0-3.5 s | contents 0.6, forum 0.6, post 0.6 × 3, one after another |
| a file download, into memory only | 0.57-0.90 s | 1 (0.75-3.7 MB) |

## 3. The waste, and ideas (largest saving first)

| # | idea | where | saving | touches an agreed rule? |
|---|---|---|---|---|
| 1 | In a round, run `moodle_fetch` / `save_link(s)` FIRST and the other calls after it, so an `open_on_pc` in the same round finds the new file | brain.js (the round's `Promise.all`) | one full round, about 8 s, on "download and open" (2 of 2 real cases) | no |
| 2 | Put the focused course's full file list (names and labels) in the prompt | brain.js `coursesText` / `prefetch` | the `course_files` round, about 8-10 s, on "open sheet X" | the prompt grows a little (a few hundred tokens): Omri's quota call |
| 3 | Let a fully successful `moodle_fetch` finish without one more model call: the reply is the code-written result, or the model's own words written under its CALL lines | brain.js quick finish | 3.4-9 s on every download (6 of 6) | yes: today only "doing" tools may quick-finish. Ask Omri |
| 4 | Moodle: keep the all-courses deadline list for a few minutes, and the course contents and forum list for the same message (or 1-2 min), instead of re-reading them in every `moodle_course` / `moodle_news` | moodle-tools.js / moodle-ws.js | about 1 s per extra course in `moodle_course`, 1.2 s per `moodle_news` after `moodle_course`; about 12 s in the 4-course message | no ("a direct question always reads fresh" stays true once per message) |
| 5 | Moodle: shorter pause between requests (0.3 s → 0.1 s) | moodle-ws.js `PAUSE_MS` | 0.2 s per request: 1 s per `moodle_news`, about 5 s in the 4-course message | a politeness choice; probably fine, but ask |
| 6 | `course_files`: read the course's pages once, not once per shared-name file | brain.js `firstLine` / `fileLabel` | 0.75 s on course C | no |
| 7 | The linked folder: one walk for both `listFiles` and `workingNow`, kept for about 30 s | brain.js `prefetch`, project-folder.js | about 0.25-0.5 s on every message in that course | no |
| 8 | `moodle_news` could take its posts from one request less (the forum list is also read by `moodle_course` just before) | moodle-tools.js | 0.6 s | no (same as 4) |

Already fine: course_read, course_search, pc_find, project_read and open_on_pc are all well under 0.2 s. The copy before
opening (0.1 s for 46 MB) is a safety rule (never open the original) and costs almost nothing.

Not waste: running the Moodle requests one at a time. Parallel requests would save more time, but they look less like the
phone app and may trip Moodle's limits. Keep them serial, and cut the repeats instead (4, 5, 8).

## Limits

- The Moodle numbers come from one afternoon on the token route. On 19 Nov the same tools took 13-23 s.
- The log's split of tools per round comes from the `[brain] asking` / `[brain] tool` log lines. A failed model try shows as
  a round with no tools (the "-" rounds on 17-18 Nov).
- Course names are left out on purpose (A-D = the four Bot courses, by size).
