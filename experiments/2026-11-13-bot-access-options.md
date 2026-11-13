# How Bot is reached: web page, PWA, app, Telegram or server (2026-11-13)

Research only, no code changed. Question from a friend: "why is there no real phone app?"
The phone is an Android Samsung S23 (`tailscale status`), so iPhone limits do not apply.

## What Bot already is

Bot is already half a phone app (a PWA, "progressive web app": a web page the phone can install like an app):

- `public/manifest.webmanifest`: name, icons, `display: standalone` (opens without the browser bar).
- `public/sw.js`: a service worker (a small script the browser keeps alive next to the page). It caches NOTHING on purpose and only shows notifications.
- `webpush.js`: real Web Push with Node built-ins only (encrypted, VAPID). Notifications arrive with the page closed.
- `auth.js`: the phone logs in once and gets a 30-day HttpOnly cookie; Tailscale (`tailscale serve`) carries the HTTPS.

What it is missing: a share target (Bot is not in Android's "Share" menu), any offline behaviour, compression, and caching of the page code.

## Measurements (2026-11-13, laptop, Bot running)

| What | Size | Time |
|---|---|---|
| `index.html` (whole page, all code inline) | 196,992 B, sent uncompressed, `Cache-Control: no-store` | 2 ms on 127.0.0.1 |
| same, gzipped (what it COULD be) | 54,265 B (-72%) | |
| `/api/thread?limit=50` (the page asks for 50) | 78,076 B uncompressed, 13,774 B gzipped (-82%) | 8 to 36 ms |
| manifest + sw.js + icons | about 6 KB | |
| `/api/jobs` while idle | 11 B body | 1 ms |
| `/api/usage` (only when the quota window is open) | 699 B | 3.3 to 4.8 s (asks agy) |
| Any request to `http://localhost:3000` instead of `127.0.0.1` | | **+0.2 s per new connection** (Windows tries IPv6 `::1` first, Bot listens on IPv4 only) |
| Through Tailscale (`https://desktop-md3gtot...ts.net`, from the laptop) | 401 without login | 32 to 163 ms (first one pays the TLS handshake) |
| Phone link | `direct` (same Wi-Fi now; not relayed) | |
| A model answer (earlier notes) | | Argon whole answer about 10 s, first words about 8.8 s; brain with tools 10 to 20 s |

Tailscale `serve` did not compress either (no `Content-Encoding` with `Accept-Encoding: gzip, br`).

So:

- **Time:** a model answer (10 to 20 s) is about 100 times the network round trip (30 to 160 ms) and 5,000 times the page time on the laptop. Model time dominates, as expected. No front end can make the model faster. The page can only feel faster: show the page at once, and get the first words sooner.
- **Data, per page open on the phone:** about 280 KB today (197 page + 78 thread + small files), downloaded fresh every time because of `no-store`. Gzip alone makes it about 70 KB. Caching the page code (it is public on GitHub anyway) makes a re-open about 15 KB.
- **Data, per message (estimate from the code, not measured):** while an answer streams, the page polls `/api/jobs` every 600 ms and each poll returns the WHOLE answer so far (`job.partial`, up to 20,000 characters). A 15 s answer with 4 KB of text is about 25 polls, roughly 40 to 80 KB, then one thread refresh. Idle with the page visible: one tiny poll every 10 s (about 0.5 KB with headers), about 180 KB an hour. Hidden: nothing.
- **Quota:** the front end does not touch tokens. A message costs what the brain's prompt costs (about 20,000 to 33,000 tokens, see 2026-11-12-quota-max.md), whether it came from a page, an app or Telegram. One thing to check, separate from this note: The Register (14 May 2026) reported that from 15 June 2026, `claude -p` on Pro plans draws from a separate monthly "programmatic" credit, not the normal Pro limits. Anthropic's help page does not say so. If true, Bot's Claude Code fallback already uses that credit today.

## The options

### A. Finish the PWA (recommended)

What: keep the web page, and add what a real app gives:
1. Compression (gzip with Node's built-in `zlib`) for the page and the thread JSON.
2. Cache ONLY the page code (`index.html`, `study.js`, icons) in the service worker, with a version check, so the page opens at once and shows "Bot is not reachable" when the laptop is off. Never cache `/api/*` (private data stays off the phone, as `sw.js` promises now).
3. A Web Share Target: Bot appears in Android's Share menu. A photo, PDF or link shared from Gallery, Chrome or WhatsApp lands in the thread's existing upload road (`/api/thread/upload`, same checks). Needs the installed app (Chrome's "Install app", not a plain shortcut).
4. App shortcuts in the manifest (long-press the icon: "New message", "Today").
5. Optional later: stream the answer with Server-Sent Events (one open connection that only sends the NEW words) instead of polling the whole text every 600 ms.
6. On the laptop: install the same page as a Chrome app window (its own taskbar icon, no tabs), and use `127.0.0.1` in `start-web.cmd`'s address (saves 0.2 s per new connection) or make Bot also listen on `::1`.

Gains: quota none; UI same page, feels like an app; access big (share menu, instant open, offline message); speed: instant open, earlier first words with SSE; data about -75% per open, -50% or more per message with SSE.
Cost: small, all JavaScript in files Bot already has. No installs, no accounts, no money, no build step.
Risks to the rules: a shared item is a FILE or PHOTO, so it must go through `thread-files.js` and count as a photo/file in that message (doing-tools refused), exactly like an upload. A shared link is text Omri chose to share, but it arrives in `text`, so code should treat it like a link Omri wrote only after he taps Send. The cache must be shell-only and versioned so an Improve Bot change is never hidden by an old cached page.

### B. A wrapped Android app (TWA / Capacitor / Kotlin)

What: an `.apk` installed on the phone. A TWA (Trusted Web Activity, made with Google's Bubblewrap or PWABuilder) is the same web page in a full-screen Chrome with an app icon. Capacitor puts the page inside a native shell with plugins. Kotlin, React Native or Expo would be a new app written from scratch.
Gains over A: almost nothing on Android. Share target, notifications and full screen already work with A. A native app could add a home-screen widget or a share sheet that works when the laptop is off (it would queue the file).
Cost: Java + Android SDK installs (several GB), a signing key to keep safe, a build step (against the project rule), new languages for Kotlin/React Native. Install by side-loading: free now; Google's developer verification starts globally in 2027, with a free hobbyist account (up to 20 devices) and ADB still working. Play Store is a one-time 25 USD and a review.
Risks: a second code base that can drift from the page; a TWA needs a Digital Asset Links file served by Bot.
Recommendation: not now. Revisit only if A leaves a real gap (for example a widget).

### C. Telegram as a second door (WhatsApp rejected)

What: a Telegram bot. Bot asks Telegram for new messages by long polling (an outgoing request, no open port), answers in the chat, and Confirm cards become buttons.
Gains: very comfortable access (Telegram is already open, sharing into it is native, notifications are reliable, messages wait if the laptop is off and are answered when it is back); tiny data. Quota: none.
Cost: a Telegram account plus a bot token from BotFather in `.env`; a new adapter file; files over 20 MB cannot be downloaded by a bot (Bot's own limit is 50 MB).
Risks: every message, photo, course file and answer passes through Telegram's servers, and bot chats are not end-to-end encrypted. Anyone who finds the bot's name can message it, so code must accept one chat id only. Card buttons must be tied to that id and to Bot's checked card, never to model text. The rich page (quizzes, Improve Bot, preview, calendar card details) does not fit in a chat, so this is a second door, not a replacement.
WhatsApp: the Cloud API needs a Meta business account, a phone number and a PUBLIC webhook (Bot would be open to the internet). Rejected.
Recommendation: a long shot. Only if Omri wants "chat from anywhere" more than he dislikes Telegram seeing his course talk.

### D. A desktop wrapper (Electron / Tauri) vs a Chrome app window

What: Electron ships its own Chrome (100+ MB, npm packages). Tauri needs the Rust toolchain. A Chrome app window (Chrome menu, "Install Bot") gives a window of its own with a taskbar icon for free.
Gains of a wrapper over the Chrome window: a tray icon and global hotkey. Everything else is the same page.
Cost: installs, packages and a build step, all against the project rules.
Recommendation: use the Chrome app window (it is part of A). No wrapper.

### E. Move Bot to a server or the cloud

What: run Bot on a small rented machine (about 5 USD a month) so it works when the laptop is off.
What breaks: PC hands, linked folders and opening files (they need THIS PC); the Moodle bridge (the extension talks to Bot on localhost; BGU refuses scripts); `agy` (a desktop tool with a Google login); the Claude Code Pro login on a server (a gray area in the terms, and the possible separate "programmatic" credit); `data/` with Omri's profile and course files would live on someone else's machine; backups and Push to GitHub change.
Gains: always on even when the laptop sleeps. Quota none; speed none (the model is still the slow part); data none.
Recommendation: no. "Always up" is already covered by the scheduled task (2026-11-12-always-up.md); the only gap is a sleeping laptop, which option A's offline message and option C's queue address more cheaply.

## Summary table

| | Quota | UI / workflow | Access | Speed | Data | Cost | Rule risk |
|---|---|---|---|---|---|---|---|
| A. Finish the PWA | none | same page, app-like | share menu, instant open, offline note | instant open; SSE earlier words | -75% per open | small, no installs | low (share = upload) |
| B. Android app | none | same or new | widget possible | none | like A | SDK, signing, build | medium |
| C. Telegram | none | chat only | best | none | tiny | account, token | high (privacy) |
| D. Electron/Tauri | none | tray icon | small | none | none | installs, build | low |
| E. Server | none (maybe worse) | same | works with laptop off | none | none | money, logins | very high |

Sources: Chrome's Web Share Target docs (developer.chrome.com/docs/capabilities/web-apis/web-share-target); Android developer verification reports (androidauthority.com, 9to5google.com, Aug to Sep 2026); Telegram Bot API limits (grammy.dev/guide/files); The Register, 14 May 2026, on `claude -p` billing; Anthropic help article 11145838.
