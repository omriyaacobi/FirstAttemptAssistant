# Google Calendar in Bot's chat: options

Date: 2026-11-05. Branch `claude/calendar-chat-6d7517`, not pushed or merged. Only reading was tested (no event was added, changed or deleted).

## New terms
- **Scope**: what a Google login is allowed to do. Ours is `calendar.events` (read and write events, nothing else).
- **Prompt injection**: text from outside (an event title, an invitation) that tries to give the AI orders. Rule for Bot: outside text is data, never instructions.
- **Confirm card**: a box in the chat showing exactly what Bot is about to do, with Confirm / Cancel. Only your tap writes anything.

## What I found on your real calendar (read-only, titles not looked at)
- Login works, the token refreshed fine.
- The main ("primary") calendar has 42 events in the last 90 days: 30 are `fromGmail` (Google puts them there from emails), 11 normal, 1 birthday. **The next 7 days are empty**, and the next event is 17 Dec. So the empty `list` was probably correct, not a bug.
- **I cannot tell whether you have other calendars** (school timetable, shared, holidays). Listing calendars needs a wider scope; with today's scope Google answers 403 "insufficient scopes". Only the main calendar is readable now.
- A wider scope (`calendar.calendarlist.readonly`, or `calendar.readonly`) means one more consent screen, and Bot could then see all your calendars. I recommend only `calendarlist.readonly` (just the list of calendars) added to the current scope. Note that reading events from a second calendar then needs a small code change too (today the code only reads "primary").

## The three options

### Option 1: "Look it up" (read only). The proof is built.
Feels like:
- "what do I have tomorrow?" -> a list for that day. "מה יש לי ביום חמישי?" -> same. "what does my week look like?" -> 7 days, empty days shown.
- "am I free Thursday at 4?" -> shows Thursday's list and you judge (a real free/busy answer is a small extra step).
- "add dentist Thursday at 4" -> Bot says plainly it cannot add yet.

Can't: add, change, delete, see other calendars (until the scope is widened), or understand questions like "when is my longest gap?".
Cost: one front desk call (Gemini Flash), measured 17-21 s per question. The calendar call itself is free. No other model runs.
Safety: best. The front desk model only picks a start day and a number of days (code checks them: real date, 1-14 days). Code writes the reply. No model ever sees a title.
Work: done as a proof. Polish (Hebrew day names, a real "free at 4?" answer, the page showing the login error nicely) is about half a session.

### Option 2: Read + add with a confirm card (my pick)
Feels like:
- "add dentist Thursday at 4" -> card: "Dentist, Thu 12 Nov 16:00-17:00 [Confirm] [Cancel]" (default length 1 hour). Confirm adds it.
- "תוסיף פגישה עם דנה מחר ב-10" -> same, in Hebrew.
- Photo of a timetable + "add these" -> Gemini reads the photo and returns a structured list; one card with every event as a tick box, "Add 5 events". Dates it is unsure about are shown as questions, not guesses.
- Before showing the card, code checks the slot and warns "you already have something at that time".

Can't: change or delete.
Cost: one Flash call for the text case (~15-20 s), one Gemini photo call (~30-60 s) for a schedule.
Safety: good. A model can misread a date, so the card is drawn by code from validated fields and shows the weekday ("Thu 12 Nov"), which makes a wrong date easy to spot. The model has no way to call `createEvent`; only the Confirm tap does (same pattern as Push to GitHub). Cards expire after a short time and work once.
Work: medium, about 1-2 sessions. The Confirm route needs a change in `server.js` (a protected file, so Claude Code does it), plus the card in the page, plus tests with fake networks.

### Option 3: Smart assistant
Feels like: Option 2 plus "summarise my week", "when can I study for 2 hours before Friday?", "move the dentist to 5", a daily morning digest.
Needs a model to read your event titles, and the ability to change/delete events.
Cost: an extra Gemini call per question (Flash ~15 s, Argon 30-90 s), from the Gemini pool.
Safety: weakest, see "Where the text goes". Fine only with the protections listed there.
Work: large (several sessions). Do it later, on top of Option 2.

## Your questions

**Adding: straight away or a card?** Card, always. A misread date is the main risk, and a calendar is something you rely on.

**Changing and deleting?** Not in v1. `calendar.js` has no delete on purpose and I agree. When you want it (v2): Bot tags every event it creates (a hidden marker inside the event) and code allows changing or deleting only tagged events, always through a card that shows the exact title and time. Google's scope cannot make that restriction by itself, so it would be enforced in code.

**Calendar and reminders.** Three ideas, cheapest first:
1. On the add card, a tick box "also remind me 30 min before". It creates a normal Bot reminder at start minus 30 min, delivered to your phone through the push that already exists.
2. A morning digest: at 08:00 Bot pushes "Today: ..." to the phone. Code only, no model, no quota.
3. "remind me to call mum at 9" stays a plain reminder and is not turned into a calendar event. A ping and a block of time are different things, and mixing them would clutter your calendar.

Not recommended: two-way syncing (editing an event later would need Bot to track changes).

**Where the calendar's text goes.** Titles are untrusted. 30 of your 42 events came from Gmail, and invitations from other people can carry text too.
- Options 1 and 2: no model reads titles. Code prints them as plain text (the page uses `textContent`, never HTML), strips control characters and cuts them at 120 characters. The log lines never contain titles (tested).
- Option 3: titles go to a model inside a fenced block labelled "data, not instructions", and that model runs with no tools in the empty sandbox. So even a fooled model can only write wrong text. It cannot write to the calendar, because writes only happen through a card.
- One leak I noticed: Bot pastes recent chat messages into later prompts as memory. A calendar reply is a chat message, so a later question to a model would carry those titles along. When we build for real, mark calendar replies as data in the history (or leave them out). Low risk today because those models have no tools.

**Login expiry (7 days).**
- The Google app is in Testing, so the refresh token dies after 7 days. Switching the consent screen to "In production" should stop that. For a personal app you do not need Google's verification: you click past an "unverified app" warning once, and the 100-user cap does not matter for one person. Caveats from what I read: it is necessary but not a guaranteed fix (one person reports tokens still expiring), and tokens also die after 6 months unused, if you revoke access, or sometimes after a Google password change. I did not test this. You would do it in the Google Cloud console (Audience page, "Publish app") and then run `node calendar.js login` once. It is your account and a consent screen, so that step is yours.
- What the chat shows now when the login is dead: "Bot's Google login has expired ... On the PC run: node calendar.js login" (tested). Later improvement: a Sign in button in the page, PC-only, because the login opens a local browser page.

## Recommendation
Do Option 2 in two steps. First merge the read-only proof (Option 1, already built and tested). Then add the confirm card for adding events, with the photo schedule as a second part. Before that, you do two things in the Google console: publish the app to "In production" (ends the weekly login), and, if you want other calendars, agree to add `calendar.calendarlist.readonly`. Leave change/delete and the smart-model features for later.

## What the proof contains (branch `claude/calendar-chat-6d7517`)
- `calendar-chat.js`: checks the day range, fetches events, formats the reply in code, gives a friendly error for an expired login. Reading only.
- Front desk: new action `calendar` (fields `calendarFrom`, `calendarDays`, validated in code). `core.js` handles it with no model call. `router-brief.md` now says Calendar can be read but not changed.
- `calendar.js`: `listEvents` takes an optional number of days (default 1, so nothing else changed).
- 8 new tests with fakes; 261 pass (253 before).
- Live check through `node bot.js`: "what do I have tomorrow?", the Hebrew Thursday question, "what does my week look like?" and "am I free Thursday at 4?" all went to the calendar path and read the real calendar (empty, as found above). "add dentist Thursday at 4" got an honest "cannot add yet". Not tested in the web page itself.

## Sources on the 7-day limit
- [Unipile: Google OAuth refresh token guide](https://www.unipile.com/google-oauth-refresh-token/)
- [Google Ads API forum: refresh token expires within 7 days, in production](https://groups.google.com/g/adwords-api/c/WDgwEZT6Cd0)
