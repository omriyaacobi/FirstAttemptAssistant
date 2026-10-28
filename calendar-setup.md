# Calendar setup (do this yourself; nobody else should type these values)

Goal: let Bot's `calendar.js` read and add events on your Google Calendar.
Terms: **OAuth client** = an "ID card" for Bot that Google issues; **consent screen** = the page where you approve what Bot may do; **Testing mode** = the app is private, only listed test users can sign in (refresh tokens then expire after 7 days, so re-run `node calendar.js login` weekly).

1. Open https://console.cloud.google.com/ signed in with the Google account whose calendar you want. Accept the terms if asked (that is your decision).
2. Top bar -> project picker -> **New project**. Name: `bot-calendar`. Create, then select it.
3. Menu -> **APIs & Services -> Library**. Search **Google Calendar API** -> **Enable**.
4. Menu -> **APIs & Services -> OAuth consent screen** (may be called "Google Auth Platform"). Click **Get started**.
   - App name `Bot`, support email = yours. Audience: **External**. Contact email = yours. Agree, Create.
5. **Audience** (or "Test users") -> **Add users** -> add your own Gmail address -> Save. Keep publishing status **Testing**.
6. **Data access** -> Add scopes -> add `.../auth/calendar.events` -> Save. (Only this one.)
7. **Clients** (or Credentials -> Create credentials -> OAuth client ID) -> Application type **Desktop app**, name `Bot desktop` -> Create.
8. Copy the Client ID and Client secret. In the project folder: copy `.env.example` to `.env` and paste them after `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=` yourself. Never paste them in chat or commit them.
9. Run `node calendar.js login`, open the printed URL, choose your account. Google will warn "Google hasn't verified this app": that is expected for your own private app; click Advanced -> Go to Bot, then Allow.
10. Check: `node calendar.js list` shows today's events.
