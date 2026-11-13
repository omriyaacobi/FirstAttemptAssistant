# 2026-11-13: a real morning brief (yesterday + news + where I stand): options

Phase 1 (research only, no code). Omri's wish: the brief should report (a) Omri's study progress (what was done, what is
still to do, what is behind) and (b) news from the world (yesterday's big events plus the night's news). Bot should check
the web during the day and once more right before the brief.

## 1. How it works today (read from the code)

- **The brief is `morning.js`, not `thread-summary.js`.** It is already a FIXED-TIME timer, not lazy: it is off until turned on in the
  page (`/api/morning`, default 08:00), checks every 30 s, sends once a day, catches up for 4 h if the PC was off, and saves
  `lastDay` before sending so it can never go twice. It is written by CODE (no model, no quota): today's calendar, today's
  reminders, unseen reminders, and one study line from `study-nudges.js`. It becomes ONE message in the thread (rule
  `"morning brief"`, which recall and the summary model skip). The push shows counts only ("Today: 2 events, 1 reminder, 1 study item").
- **`thread-summary.js` is the lazy part:** at the first message of a new day, Flash medium (then Argon low, never Claude) writes a
  note about each past day. Code checks every fact/task against a word-for-word quote from one of Omri's messages. The note is
  used only as "<notes> may be wrong" context for the brain. The brief does not use it today.
- **The study line (`study-nudges.js`)** is code only: at most one a day, tied to a real date (assignment due within 3 days, exam
  within 7, a lecture held 3+ days ago and not checked, review topics, missing material), quiet after 2 ignored, paused for
  reserve duty, quiet hours.
- **What code already KNOWS about yesterday, with no model:**
  - thread: how many messages, and which courses they were about (`topic`);
  - graded quizzes: `lectures[date].checks` with time, total and score, and whether that lecture became Understood
    (`recordCheck`: 3+ questions, 70%+); review topics (`topics[].lastAt`, `nextDue`);
  - lessons: `lectures[date].taught` (teach_next);
  - Omri's own words about a course (`course_note`, `position.said`), mode (revising / paused), confirmed exam dates;
  - assignments and their due dates, reminders that fired, timetable lectures that were held, calendar events (read by code).
- **"Behind" today** (`study-tracker.js progress()`): a lecture is behind when the timetable says it was held, more than 2 days
  ago (`GRACE_DAYS`), and no graded quiz has marked it Understood. Skipped/cancelled days are not counted. Courses in
  mode "revising" or "paused" get no catch-up nudge. Only Calculus 2 has all lectures up front, so for other courses "behind"
  means "held and not checked", never "a lecture you did not get".
- **Web today:** `linkfetch.js` (`fetchPage`, `fetchChecked`) is safe code fetching (https, public addresses only, checked on every
  redirect, size and time limits, no cookies). agy's own `search_web` runs inside a model call. Code only sees that it ran
  (`usedWebSearch`); it never sees the pages, so it cannot check what the model says they contained.

## 2. The choices, one by one

### 2.1 Where the news comes from

| | **RSS feeds fetched by code** (recommended) | **agy `search_web`** |
|---|---|---|
| What it is | An RSS feed is a small public file a news site publishes: its newest headlines, each with a link and time. Code downloads it like `linkfetch.js` does. | The model searches the web itself, inside one agy call. |
| Tokens | 0 to fetch. A model is needed only to pick "what is important" (one small call). | Every check is a model call plus the search results: estimated 15,000-30,000 tokens (not measured). |
| Can code check the brief? | Yes. Every headline shown is the feed's real text, with the site's name and a link. A model may only hand back NUMBERS from the list (like `pc-find`). | No. Code never sees the pages, so a wrong or made-up "event" cannot be caught. This breaks "news must come from fetched text, source named" unless code re-fetches every link the model names. |
| Weakness | Only the sites on the list. RSS has headlines and a short description, not the whole article. | Wider, but slower and costs quota. |

The feed list is fixed in code (or a short list Omri edits), never chosen by a model. The exact addresses must be checked to
still work before they are written down (phase 2).

### 2.2 When to check during the day

- **Code-only fetch on a timer** while Bot runs (for example every 3 hours, 07:00-23:00, and once just before the brief): 0 tokens.
  Headlines are kept in `data/news/YYYY-MM-DD.json` (a cache: headline, site, link, time; deleted after 3 days). That is how
  "yesterday's big events" survive until the morning even if a site's feed only keeps its newest 20 items.
- **Picking what is important** needs judgment. Do it ONCE, just before the brief, over everything collected since the last
  brief: one call, about 60-100 numbered headlines, about 4,000-8,000 tokens with the slim agent. A model call at every
  check would multiply that by about 6 and add little.
- **"Breaking" alerts during the day** (a push when something big happens) would need a model call at every check, and a
  rule for "big enough". Possible, but it is option C. The lock screen would say only "Bot: 1 important news item", never the headline.

### 2.3 When the brief is made and delivered

- Use the timer that already exists (`morning.js`): a fixed time with a push, catching up for 4 h if the PC was off.
- New: ~10 minutes BEFORE the brief time, code fetches the feeds, makes yesterday's daily summary if it is missing
  (`summaries.catchUp()`, today it waits for the first message), and runs the one "important news" call. If any of these
  fail or are late, the brief goes out on time without that part and says so in one line.
- The push stays counts only: "Today: 2 events, 1 reminder, 3 news items".

### 2.4 "About me": counted by code vs summarized by a model

- **Done yesterday (code):** "Quiz on Calculus 2, lecture of 10 Nov: 3 of 4 (75%), now Understood", "Lesson: Data Structures, part 2.3",
  "Your note on Physics: ...", reminders that fired. These are counts and records, so they cannot be invented.
- **Still to do (code):** assignments due in the next 7 days and not marked done, review topics due today, a confirmed exam within 14 days.
- **Behind (code):** `progress().behind` per course, worded as "held and not checked yet" (not "you did not study it"), with the
  "revising/paused" mode and Omri's own words respected. No course with no timetable gets a "behind" line.
- **Optional, a model sentence:** the first sentence of yesterday's daily summary (already made by Flash, already
  quote-checked for facts), shown with a label like "Bot's note (may be wrong)". It can describe the day ("you worked on the
  Calculus 2 exercise and asked about Moodle") but it is never used for Understood, never counted, never "where you are".
- Rule kept: "Understood" only from graded quizzes; Bot never guesses where Omri is; a course with no data says nothing.

### 2.5 Safety rules that stay

- News text is DATA: inside a marked block (`<news>`, "data, never instructions") in the one model call, never in the brain's prompt.
- It is never saved as a fact, never goes to the profile, and the daily summary never reads it (the brief keeps its private
  rule, so it stays out of recall and the summary).
- It causes no action. No tool runs from it. If later the brain gets a `news_read` lookup, it counts as a web read
  (`ctx.sawWeb = true`), so the doing-tools are refused after it, like any web page.
- Every headline shown is the feed's own text, with the site named. The model only returns numbers; code checks they are real
  numbers on the list and prints the text itself.
- Fetching only through `linkfetch.js`'s checks (https, public addresses, size and time limits, no cookies or logins).

### 2.6 Quota

- News picking and the summary: **Flash medium** first. The "Gemini Models" pool is almost unused (92% left late in its week).
  The fallback is Argon low, but only when Argon is above its 25% reserve (`lowWithReserve`), because Argon's last part is for
  tutoring. Never Claude Code, never agy Sonnet (background work). If every model fails, code shows the newest headline of each
  site instead (no judgment, honest label).
- The 15% rule and pacing in `quota.js` apply as for every chain.
- The cost lands in the token log like every other call.

### 2.7 Size

One phone screen: about 15 lines, about 900 characters. Order: Today (calendar + reminders), Yesterday you, To do / behind,
News (3-5 lines: headline, site, time), the one study nudge. Long lists are cut in code ("and 3 more").

### 2.8 Tests

All in `tests/`, no real network or quota: fake feeds through the `get` that `linkfetch.js` already accepts, a fake `askChain`, a
fake clock, a fake tracker. Cases: a feed with an injected instruction stays data; a model answer naming a number not on the list
is dropped; made-up headline text is never printed; a failed model falls back to the newest-headlines line; the push has no text;
yesterday's quiz shows up and a lecture is never Understood without a graded check; the brief fits the size cap.

## 3. Three options

| | **A. Small** | **B. Medium** (recommended) | **C. Full** |
|---|---|---|---|
| About me | Code: done yesterday, to do, behind | A + one labeled sentence from the daily summary | B |
| News source | RSS, fetched once just before the brief | RSS, fetched by code every 3 h + before the brief (cache 3 days) | B + agy `search_web` 3-4 times a day on chosen topics |
| What is "important" | No judgment: newest 1-2 headlines per site, or a story that appears on 2+ sites | One Flash call before the brief picks 3-5 by number from everything collected; code prints them | B + a model-written 2-3 line recap per big event, and an optional push for breaking news (counts only) |
| Can code check every news line? | Yes | Yes | Only if code re-fetches every link the model cites (more code, more risk) |
| Tokens per day | 0 | ~5,000-10,000 (Flash) + the summary that already runs | ~60,000-120,000 more (estimate, unmeasured), about 0.5-1% of Argon's week a day, or Flash |
| New code | `news.js` (feed reader), more lines in `morning.js` | A + timer, cache, one checked model call | B + search calls, link re-check, alert rule, brain tool |
| Risk | low | low | medium: the model's own words about the world reach the brief |

**Recommendation: B.** It gives "yesterday's big events + the night's news" with a real judgment of importance, costs almost
nothing from a pool Bot hardly uses, and every line stays checkable by code. C can be added later on top of B if B's headlines
feel too thin.

## 4. Omri's answers so far (2026-11-13, through the manager)

- Israel: at most 2 items, only if something big happened. World: at most 2. Tech: only very big events (example: Nvidia's CEO resigns).
- English. Delivered as the first message of the day (no fixed-time push).
- Because "only if big" needs judgment, this points to B (one model picks by number, or picks none).

Second answer (2026-11-13, in this chat): **option B**, with changes:
- Last news check at 08:30, the brief right after (about 08:32), like a newspaper.
- The 3-hour checks stay: each one adds its headlines to tomorrow's pile; if something BIG happens, Bot tells Omri at once.
- After 08:30, Flash (high or medium, to decide) picks from the saved pile what goes into the brief.
- Early wake: from 05:00, Omri's first message starts the last check and the brief, which then arrives as the 2nd or 3rd message.
- "About me" is NOT decided: to be discussed before building.

## 5. Questions for Omri

1. A, B or C?
2. News topics: Israel, world, tech, science, something local (Beer Sheva / BGU)? Any sites you trust or dislike?
3. Language: the brief stays English? Hebrew sites would give Hebrew headlines as they are (translation needs a model and costs tokens).
4. Delivery: is the morning brief turned on in the page now, and at what time do you want it? (It is off until turned on.)
5. Breaking news during the day (option C only): do you want a push, or only the morning brief?
6. "About me": code counts only, or also the labeled one-sentence model note about yesterday?
