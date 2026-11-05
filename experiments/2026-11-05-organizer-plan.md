# Bot as your organizer: design plan (for approval)

Date: 2026-11-05. Plan only, no feature code. Replaces the three options in `2026-11-05-calendar-options.md`; that file still has the facts about your Google calendar.

## The idea in one paragraph
Bot keeps its own private planner: your weekly school timetable, your tasks (with deadlines) and your one-off events. You just talk ("homework in Algorithms due Sunday", "padel Tuesday at 8") and Bot files it. Bot then looks after the planner on its own: a morning message, deadline nudges, suggested study time. Google Calendar is not the home. It is a place Bot can *show* the plan, and a source Bot can *read*.

## 1. The planner is the source of truth (I agree with this)
- One private file `data/planner.json` (gitignored, written safely like `reminders.json`): `timetable` (class, weekday, start, end, room, semester start/end dates, and cancelled dates), `tasks` (text, optional deadline, done or not), `events` (title, start, end), `settings` (quiet hours), and a short `history` of changes for Undo.
- Filing from chat, no confirm card: the front desk model only extracts fields (like it does for reminders). Code validates every field (real date, sane length, max counts) and saves. Nothing outside Bot changes, so this is safe to do without asking.
- Bot always echoes what it filed with the weekday: "Filed: Algorithms homework, due Sun 8 Nov. [Undo]". A misread date is caught right there, and Undo removes it. One small disagreement: for a *deadline* a wrong date does real harm, so the echo is not optional.
- Honest limit: Bot runs on your PC. If the PC is off at 07:30 the morning push comes late (same catch-up as reminders).

## 2. What Bot does by itself
| Thing | Model needed? |
|---|---|
| Morning push at a set time: today's classes, tasks, deadlines (default 07:30) | No, code only |
| Deadline nudges (3 days, 1 day, morning of) | No |
| "What do I have today / this week / what's due?" | No (code writes the answer) |
| Finding free gaps and proposing study blocks | Code finds gaps; a rule-based first version needs no model |
| Smarter advice ("what should I do first?") and the weekly review wording | Yes, one Flash call, only when you ask or once a week |
| Exam season (late January): countdown plus study blocks backwards from each exam | Code plans, you approve the blocks |
Quiet hours (default 22:00 to 07:00): nothing is pushed in that time, it waits for morning. Study suggestions are only suggestions until you accept them.

## 3. Google Calendar as output and input
- **Input, read only:** Bot keeps reading your main calendar for things like flights or bookings Google made from Gmail, and shows them in the agenda marked "from Gmail". The read-only proof already does this.
- **Output:** Bot writes to its OWN secondary calendar called "Bot". I checked Google's documentation: the scope `calendar.app.created` is described as "make secondary calendars and manage events on calendars the app created" ([Google Calendar API scopes](https://developers.google.com/calendar/api/auth)), so it cannot touch your main calendar. Because that is true, Bot can add, move and delete on the Bot calendar freely, with no card.
- **A security win:** with that scope, Bot's token for your real calendar can drop write power completely (`calendar.events.readonly` for reading + `calendar.app.created` for the Bot calendar). Today's scope `calendar.events` can write to your real calendar. This needs one new login.
- Sync is one-way: planner to the Bot calendar. If you edit the Bot calendar in Google, Bot will not read those edits back.
- What you do: one more consent screen, then on the phone make sure the "Bot" calendar is ticked in the Google Calendar app. I have not tested how it shows on the S23. Also, the 7-day login problem still needs "publish app to production" (see the options file).
- I would do this late. The morning push and the page already show your plan; the Google calendar is a nice extra, not the core.

## 4. Trust levels
- **Your own chat messages** can change the planner.
- **Anything from outside** (Gmail-made events, invitations, web pages, text inside a photo of a schedule you did not take) is data. It is shown, never filed, and never triggers anything. To use one, you say "add it" in chat.
- A model may read your planner only inside a fenced block marked as data, with no tools, in the empty sandbox. The advice call never sees Gmail or invitation titles unless you ask.

## 5. Getting the timetable in
Send a photo of it. Gemini reads it into a list (class, day, start, end, room). Bot shows the list as one card and you confirm once, fixing errors by chat ("Algorithms is 10:00 not 12:00"). This one confirm is worth it: every later plan depends on the timetable. Semester start/end dates and holidays are asked once ("no class Monday" adds a cancelled date).

## 6. Order of work (each step usable alone)
1. Planner file + timetable from photo + "what do I have today/this week" (reuses `calendar-chat.js` formatting; merges planner with Google read).
2. Tasks and events from chat, echo and Undo.
3. Morning push, deadline nudges, quiet hours (one small `server.js` change to start the scheduler, done by Claude Code).
4. The Bot calendar (new scope, one-way sync).
5. Study planning and weekly review (the only step that uses models regularly).
**The read-only proof:** keep it. Its day-range checking and code-written reply become the core of step 1. Its Google reading moves to a smaller scope in step 4. Nothing is thrown away. Its "calendar" front desk action will be renamed "agenda" when step 1 is built.

## 7. Cost and speed
- Filing a task or event is the *same single front desk call* every message already makes (about 12-20 s today), so no extra model call. Planner questions answered by code add 0 s.
- Per day: morning push 0 calls; 5-10 filings and questions = 5-10 Flash calls you would make anyway; advice 0-2 extra calls. Timetable photo: one Gemini call, once. Weekly review: 1 call.
- Speed: I will not paste the planner into the front desk prompt (it would slow every message). It only gets one line: "the planner exists". The planner is read only when the message needs it. Omri's slowness comes from the 12-20 s front desk call, which this plan does not change; a faster front desk is a separate task.

## Where `profile-memory` ends and the planner starts
- **Planner:** anything with a date or time, or that can be ticked off (classes, deadlines, events, tasks, exams, quiet hours as a setting). Code reads it.
- **Profile memory:** facts about you that stay true without a date (your degree, how you like to study, "bad at Algorithms", dog's name).
- Test: "does it have a date or can I mark it done?" Planner. Otherwise profile. "I have an exam on 28 Jan" -> planner. "I study best in the morning" -> profile (and the planner may *read* it when proposing study blocks, as data).
- Neither writes into the other by itself; one chat message can fill both, filed by two separate validated paths.

## What you need to decide
1. OK to make the planner (not Google) the home, with filing from chat without a confirm card but always with an echo and Undo?
2. Quiet hours and morning push time: 22:00-07:00 and 07:30 OK?
3. Do you accept that the push only works while the PC is on?
4. Send your timetable photo when step 1 is built; any semester dates you know.
5. Do you want the "Bot" calendar in Google at all (step 4), or is the page plus phone push enough for now? I suggest deciding after step 3.
6. Start with step 1? (Recommended: a fresh session, Sonnet, plan first, since it touches `core.js`, `frontdesk.js` and the page.)
