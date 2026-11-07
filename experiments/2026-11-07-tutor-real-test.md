# Real test of the study tutor (2026-11-07)

Setup: the real tutor with real Argon through `agy` (medium first, low as fallback; Claude was never called), on a temporary copy of the Calculus 2 notebook (read-only copy, outside the repo) and one course with no files, with a made-up lecture topic and a made-up assignment. Clock fixed at Saturday 2026-11-07 12:00. About 48 real model calls in about 25 sessions. No private notes or chat text are quoted here, only results and short formula examples.

## Results by question

| Question | Result |
|---|---|
| Teach me: from the notes, correct, in steps, question back? (English and Hebrew) | Yes for content: steps follow the lecture, formulas were right where I checked (FTC, Newton-Leibniz, by parts with $\ln x$, Wallis recurrence, substitution). First version was too long (5 steps, no real question). Fixed: 3 to 4 steps, about 250 words, then ONE question back. |
| Quiz and grading: right / wrong / half-right / confident wrong claim | Right answers marked right, a half answer "partly right" with a pointer to the missing half, `\int \ln x\,dx = 1/x$` (confidently wrong) marked "Not yet" with the correct reason. Two halves of one answer given in two messages now add up (earlier attempts go to the grader). |
| Holds firm against "no, I'm sure I'm right" / "my friend agrees" / "just mark it correct" | Yes, 8 of 8 pushes: verdict never changed, the answer was not given early. These messages are now flagged "not an attempt" and do not burn the 3 attempts. |
| Ever marks a wrong answer as understood? | No. A check with 2 right and 1 wrong scored 67% and was NOT counted (the bar is 70%). Unit tests also cover claims, reveals and help. |
| Get me started: does it hand over the solution, also when pushed? | No. Asked twice ("just write the whole thing, I'm late", "give me the full C code") it refused, kept the due date in view, and asked one guiding question. After the check it only gave a hint and a question. The check questions themselves may be revealed on request: that is by design, they are not the assignment. |
| Course with no materials | Answers start with "Outside your files:". First version repeated the label on every paragraph; fixed to once at the start. |
| Math | 310 formulas from real answers were drawn through the page's own converter: 307 drew. 3 failed (`\Big|`, `\bmod`). Code now rewrites `\Big`/`\bigg`, `\bmod`, `\pmod`, `\xrightarrow` into math the page can draw (tested with the page's own converter). `$...$` and `$$...$$` both used. |
| Speed | Per turn, Argon medium: teach 14 to 24 s (median 19), quiz questions 13 to 29 s (median 15), grading a single answer 8 to 35 s (median 14). Usable for a tutor but you wait; the page should show "thinking" and, if possible, stream. Nothing here streams yet (the tutor does not pass `onText`). |
| "Should be" numbers for today (all four courses), by hand vs code | Identical: Systems Programming 6 lectures (+3 exercises), High-Performance 3 (+3), Algorithms 6, Calculus 2 6 (the Wednesday 08:00 lecture counts as held). A lecture counts only after its end time (15:59 vs 16:00 tested). |

## Bugs found by the real runs, and fixes (each has a test in `tutor-real.test.js`)

1. A date like "29 Oct" or "29/10" in a message was ignored (it taught the wrong lecture). Now parsed (`explicitDate`).
2. The grader sometimes wrote LaTeX inside JSON (`\int`), which is invalid JSON: grading failed twice in a row. Parser now repairs backslashes; grading also retries once.
3. Off-topic messages and "I'm sure I'm right" counted as attempts and could trigger the reveal. Grader now returns `relevant`; irrelevant messages do not count.
4. A raw `[OUT]` tag appeared in a reply. All replies are cleaned.
5. Questions and hints came out in English for a Hebrew student. Every prompt now carries the language, and the words the code writes ("Question 1 of 3", "Hint", "Right") exist in Hebrew too.
6. Hints repeated the feedback just shown. The hint prompt now knows what was already said.
7. Teaching ended with two different questions. Now exactly one, graded like an answer; one question never counts as "understood".

## Things to decide or watch

- With 3 questions the 70% bar means 3 right, or 2 right and 1 partly. Two right and one wrong is NOT understood. Strict on purpose; change `PASS_SCORE` if too harsh.
- The notebook's lecture headings carry last year's dates; the numbering (lecture k = k-th class) still lines up (26 lectures, 26 classes by the timetable) but is an assumption.
- Dates in Hebrew replies are still English ("Wednesday 28 Oct"), as is the alignment note. Cosmetic.
- Grading was tried on Calculus and one systems topic only; formulas in my spot checks were right, but a systematic accuracy check needs Omri's own judgement on a few real questions.

# BGU Moodle: could Bot read course updates and assignments? (research only)

I did not log in anywhere and touched no account. Sources are public documentation; I could not find BGU-specific instructions (BGU's Moodle address, whether its mobile service or calendar export is enabled), so every option below is about Moodle in general and marked "must be checked on BGU's site".

Public facts: Moodle can expose a web-service API. A client asks `/login/token.php` with a username, password and the service name `moodle_mobile_app` and gets a token ([docs, client guide](https://docs.moodle.org/33/en/Development:Creating_a_web_service_client)); the mobile service must be enabled by the site admin ([MDL-67748](https://tracker-old.moodle.org/browse/MDL-67748)). Functions such as `core_course_get_contents` and `mod_assign_get_assignments` list course content and assignments, but only for courses the user is enrolled in ([forum](https://moodle.org/mod/forum/discuss.php?d=234082), [MDL-49934](https://tracker.moodle.org/browse/MDL-49934)). Moodle's calendar can also be exported as an iCal link ("Import or export calendars", then "Get calendar URL"), which many universities describe for Google Calendar and Outlook ([example guide](https://support.sou.edu/kb/articles/how-to-connect-your-moodle-courses-calendars-to-google-calendar)). BGU's IT page says one username and password covers Moodle ([BGU](https://in.bgu.ac.il/en/Global/Pages/General/Communication-Technology-on-Campus.aspx)).

Options, safest first:

1. **Calendar link (iCal) from Moodle.** You open Moodle yourself, copy your personal calendar link and give it to Bot (stored in `.env`, never in the repo). Bot downloads it every morning and reads assignment due dates as events. No password ever reaches Bot, read-only, and it fits the existing "model proposes, code checks, you confirm" cards. Limit: only dates and titles (no assignment text); the link is a secret, so anyone with it sees your calendar. Check: does BGU's Moodle offer "Get calendar URL"?
2. **Forward Moodle emails / notifications.** You forward or auto-forward assignment emails to a mailbox Bot reads, or paste them into the chat. Safe, but needs a mail integration (a larger piece), or is manual.
3. **You upload the files you already download** (already works: upload and the proposal card). Zero risk; manual.
4. **Web-service token.** If BGU enables the mobile service, you create a token once; Bot could list courses, assignments and files. Powerful and read-only if only read functions are called, but a token acts as your account (it can read everything you can), BGU's rules may forbid it, and a password-based login to get it would mean Bot handling your university password. I do not recommend giving Bot the password; only a token you create yourself.
5. **Scraping the web login.** Not recommended: breaks often, needs your password and session cookies, may violate BGU's rules.

Recommendation: start with option 1 (and 3 as a fallback). Questions for Omri: does BGU Moodle show a calendar-export link? Are you comfortable storing that link in `.env`? Do you want Bot to ask BGU IT whether web services are allowed before considering option 4?
