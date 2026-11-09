# Can Bot log into Moodle? (research, 2026-11-09)

Research only. No code changed, nobody logged in, no password or token used.

## Summary (plain English)

- **Probably yes, but not by "logging in".** The clean way is a Moodle **token** (a long secret string that works like a key for your account). With it, Bot asks Moodle's official Web Services API (a set of web addresses that return data as JSON, the format Bot already uses) for your courses, files, assignments and deadlines. Bot never needs your password.
- **I could NOT verify BGU's own setup.** `moodle.bgu.ac.il` answers automated requests with HTTP 403 (blocked), and searches found no BGU page about the Moodle app, SSO or 2FA. So: which login method BGU uses, which Moodle version, and whether the "mobile web service" is switched on are all **unknown**. Omri has to check in his own browser (10 minutes, steps below).
- **Best route, in order:** (1) the personal iCal calendar link (deadlines only, easiest, almost always works); (2) a mobile-service token from Preferences > Security keys, if BGU shows one; (3) the official Moodle-app login flow (works even with SSO) to get that same token; (4) browser-cookie scraping or Playwright only as a last, fragile resort.
- **First step for Omri:** open Moodle in his browser, go to Calendar > Export calendar, and see if it gives a URL. Then look at Preferences > Security keys.
- **Out of scope, on purpose:** submitting assignments, writing anything to Moodle.

## 1. Which Moodle does BGU use?

Verified (from search results only): the address is `https://moodle.bgu.ac.il/moodle/` (courses at `/moodle/...`, a custom plugin page `/moodle/local/mydashboard/`). It is a Moodle. The home page tells students to use Chrome and mentions "Course media" (recordings) in each course's side menu. Student email is `@post.bgu.ac.il`; password reset is `tamrur.bgu.ac.il`; there is also a student portal `portal.bgu.ac.il`.

NOT verified:
- Moodle version (needs the login page source or `/moodle/lib/upgrade.txt`; the server blocked my fetch with 403).
- Login method: plain username+password, or SSO (Shibboleth/SAML, Microsoft, Google), and whether 2FA is on. I found nothing public. Omri can tell by looking at the login page: if it redirects to another site (microsoft, google, a BGU identity page) it is SSO.
- Whether BGU allows the official Moodle app. Another Israeli university (Tel Aviv) says its app is not supported, which shows universities differ. I found no BGU statement.

The 403 also matters for design: BGU may block non-browser clients (scripts) at the server edge. Then even a valid token may be refused from Node. Only a test from Omri's PC can tell.

## 2. The ways in

Legend: SSO = works when login goes through the university identity page.

### (a) Web Services REST API with a mobile-app token
- How: `POST /moodle/login/token.php` with username, password, service `moodle_mobile_app` returns `{"token": "..."}`. Then call `/moodle/webservice/rest/server.php?wstoken=TOKEN&wsfunction=NAME&moodlewsrestformat=json`.
- SSO: **No.** `token.php` needs a real Moodle password. A site using SSO often has no usable Moodle password (and the admin docs say sites with a protected `/login` folder, common with Shibboleth, must open `login/token.php` for the app). Use (b) instead.
- Functions (checked on the Moodle docs; items marked * only from a summary of the docs page, less certain): `core_enrol_get_users_courses` (course list), `core_course_get_contents` (sections, modules, file links), `core_calendar_get_action_events_by_timesort` and `core_calendar_get_calendar_upcoming_view` (deadlines), `core_webservice_get_site_info`* (who am I, Moodle version, which functions are allowed), `mod_assign_get_assignments`* (assignment text, due dates), `gradereport_user_get_grade_items`* (grades), `mod_forum_get_forums_by_courses`* (forums; announcements are a forum). Note the dev docs page I could read is the 3.11 snapshot, so BGU's newer version may differ; `core_webservice_get_site_info` lists exactly what a token may call.
- Files: the `fileurl` from `core_course_get_contents` is downloaded by adding the token (`...webservice/pluginfile.php/...?token=TOKEN`, or `/tokenpluginfile.php`). Confirmed in Moodle developer docs and bug reports (MDL-58800); the mobile service must allow file download. Redirect-style repositories (Google Docs/OneDrive links) do not download this way.
- Cannot do: anything the admin did not expose to the mobile service; functions a teacher did not enable in a course; some plugin content (BGU has custom plugins such as `local/mydashboard`).
- Policy: this is the official Moodle app's own road, so it is the most "legitimate" one, but only if BGU enabled "Enable web services for mobile devices". If not, it is off for everyone.
- Fragile: low. Stable, documented.
- Expiry: admin setting "User created token duration" (default three months, Moodle 3.4+; the admin can change it). When it expires calls return an error (invalid/expired token) and you fetch a new one. Bot should say so plainly and stop, not retry.

### (b) The official Moodle mobile app token flow (the SSO answer)
- How: the app opens `/moodle/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=SOMENUMBER` in a browser. You log in the normal way (SSO, 2FA all work, because it is your normal browser). Moodle then redirects to `moodlemobile://token=BASE64`; the base64 decodes to colon-separated values including the token. Bot can read that final redirect.
- Admin docs confirm: for SSO sites the admin sets "Type of login" to browser window/embedded browser; the app does not support MFA natively, so the browser route is the workaround. I could not fetch the page text for `launch.php` and `moodlemobile://token=` itself from the official docs (only from bug-tracker posts), so the exact steps need a test.
- Practical for Bot: Omri opens that launch URL by hand in his browser, logs in, and copies the address that fails to open (`moodlemobile://token=...`) or reads it from the browser dev tools network tab. The decoded token goes into `.env` by Omri himself. Fiddly but once per token lifetime.
- Cannot do / policy / fragile / expiry: same as (a). Extra risk: admins can turn the mobile login off, or use a custom-branded app URL scheme that stops the official flow.

### (c) Security keys page and calendar export link
- Calendar export (Calendar > Export calendar > Get URL): produces an `.ics` link with an `authtoken` in it. Anyone with the link sees your calendar without login. Verified in the Moodle docs ("without actually logging into the site"). Works with SSO, since it is generated while logged in normally.
- Reads: dated events only (assignment due dates, quiz times, course events), with titles and sometimes short descriptions. NOT files, NOT assignment text, NOT grades.
- Policy: the university offers it to students on purpose. Fragile: very low. Expiry: lasts until you press "reset" on it; no timeout.
- Preferences > Security keys: the docs I could read describe it for the RSS key and for web-service keys, require the `moodle/webservice:createtoken` capability, and say it cannot make keys for admins. Whether BGU shows a "Moodle mobile web service" row there is NOT verified (my sources did not confirm that name). If it shows, that token is the same as (a).
- RSS: only helpful if forum RSS is enabled; low value, skip.

### (d) Browser-session scraping (cookies)
- Copy the `MoodleSession` cookie from a logged-in browser; Bot fetches normal pages and parses HTML. Works with SSO and 2FA (the browser did the login).
- Reads everything you can see; can break whenever the page layout changes (BGU has custom plugins), the cookie dies after a short idle time (hours), and cookie copying is the least clean option. A scraped session cookie is a full login, much more powerful than a read-only token. Policy: most universities' terms discourage automated scraping; bot-detection or 403 blocks (as I got) may stop it. Last resort.

### (e) Browser extension or Playwright
- Playwright (a library that drives a real browser) can log in with Omri sitting at the screen for SSO/2FA, then save the session and fetch pages. Extension: runs inside Omri's own logged-in browser and sends pages to Bot at localhost.
- Works with SSO, reads what the browser sees, heavy (needs an install, which breaks the "no packages" rule in CLAUDE.md), fragile like (d). A reasonable fallback only if (a)-(c) are all closed.

## 3. Read-only design for Bot

- Token or iCal link only in `.env` (`MOODLE_URL`, `MOODLE_TOKEN`, `MOODLE_ICAL_URL`), listed in `.gitignore`, never logged, never in the page, never in prompts.
- New file `moodle.js`, same style as `calendar.js`: plain Node `https`, GET only (the only POST allowed is `token.php`, not needed if Omri pastes the token). An explicit allow-list of function names; the code refuses any `wsfunction` not on it (nothing that starts with `mod_assign_save_`, `submit`, `update`, `delete`, `add` etc.), so no bug or model can write.
- Sync (button on the Study page, plus once a day, with a minimum gap): `core_enrol_get_users_courses` -> map to Bot's existing courses (new ones are a Confirm card, matching is by code, never by a model); `core_course_get_contents` -> list new files; download each through the existing upload road (`thread-files.js` checks real bytes, type and size, no duplicates, `unzip.js` for zips), into the matching course; assignment text from `mod_assign_get_assignments` is saved as a text file in the course the same way; deadlines go into the study tracker (`study-tracker.js`), dedupe by Moodle event id; announcements show in the morning brief as quoted data.
- Bot's rules kept: models only PROPOSE (e.g. "this file looks like Assignment 3"); code checks (course ids from the real list, dates real); Omri confirms anything that changes his data (new course mapping, a changed deadline, first import of a big batch); everything fetched is untrusted data, never instructions, never a fact (like web and photo text); nothing is ever sent to Moodle except read requests; no submit, no forum post, no message.
- The "just tell Bot what I need" goal: a chat message like "get assignment 2 of Calculus" becomes a lookup in the already-synced archive, or a one-off targeted fetch, instead of Omri uploading files.
- Out of scope: submitting assignments for him, and anything that writes to Moodle. A write-capable function must never be added without asking him.

## 4. Risks (honest)

- **Academic integrity and terms:** the API is the official route, and reading your own courses is normal. Risks come from using Bot to do the work for him: the project already forbids giving assignment solutions. The university's acceptable-use terms were not found online; a quick email to IT removes doubt. Scraping (d/e) is the part most likely to be against terms.
- **Token theft:** the token reaches everything the app can read, in his account, until it expires or is reset. It sits in `.env` on his PC; whoever reads that file (malware, a backup that is not encrypted, a leaked screen share) has it. Mitigations: `.env` stays out of git and out of the encrypted backup unless intended, reset the key in Security keys if in doubt, and prefer the iCal link (calendar only) if that is enough. Note `backup.js` backs up `data/`, not `.env`; keep it that way.
- **Rate limits:** Moodle has no standard published limit, but a university can throttle or block a client that makes many calls. Be gentle: sync at most a few times a day, one request at a time, a pause between downloads, cache with "modified since" times, stop on any 403/429 and report.
- **If the mobile service is disabled:** ask BGU IT / Moodle support (helpdesk@bgu.ac.il was in the search results; verify before using): "Can students use the Moodle mobile web service or a personal read-only token for a personal study tool running on my own computer? If not, is the calendar export enabled?" Name exactly what it does (read-only, own account, no sharing).
- **Other:** SSO or 2FA changes can break the flow; token durations change; BGU may block non-browser requests (my 403 hint).

## 5. Recommendation

### Omri's 10-minute check (by hand; never paste a password or token into chat)
1. Log into Moodle in your normal browser. Note: does the login page send you to another site (SSO)? Is there a 2FA step?
2. Calendar (side menu or `/moodle/calendar/view.php`) > **Export calendar**: choose "All courses", "Custom range" or "Recent and next 60 days", press **Get calendar URL**. If a link appears, it works. Do not paste it here.
3. Profile menu > **Preferences** > **Security keys**. Write down only the NAMES of the rows you see (e.g. "Moodle mobile web service", "iCal export", "RSS"), no values.
4. (Optional) On a phone with the Moodle app, see whether `moodle.bgu.ac.il` logs in.
5. Put any link or token into `.env` yourself, for example `MOODLE_ICAL_URL=...`. Tell Bot only "yes / no" for each step.

### Build plan (after the check; each step is its own small commit)
1. `moodle-ical.js`: read the iCal link, parse deadlines, show them in the Study page and the tracker, Confirm card for the first import. Small (about 150 lines + tests). Needs only step 2 of the check.
2. `moodle.js` read-only API client with an allow-list, `site_info` self-test, and a clear "token expired / service off" message. Small-medium (about 200 lines + tests with a fake Moodle server). Needs a token (check step 3 or the launch flow).
3. Course list and course contents sync, files through the existing upload road, assignment text saved to the course. Medium (a day of work, mostly tests for filing and duplicates).
4. Morning-brief lines and chat lookup ("what is due this week", "get the file for lecture 5"). Small.
5. Only if all else fails: Playwright, which breaks the no-packages rule, so ask first.

Suggested way to work: one fresh chat for step 1 (Sonnet is enough, plan first is not needed); steps 2-3 deserve a short plan first because they touch the upload road; context stays low if each step is a fresh chat.

## What I could not verify
- Everything specific to BGU (version, SSO provider, 2FA, whether the mobile service and file download are enabled, token duration, whether scripts get 403).
- `launch.php` / `moodlemobile://token=` step-by-step (only bug-tracker posts, not an official page I could read).
- That the Security keys page lists a "Moodle mobile web service" token (the docs page I read only covers RSS and web-service keys).
- Exact parameters for `mod_assign_get_assignments`, `gradereport_user_get_grade_items`, `mod_forum_get_forums_by_courses` (names reported by a summary of the 3.11 dev page; check with `core_webservice_get_site_info` on the real site).

## Sources
- Moodle app guide for admins: https://docs.moodle.org/en/Moodle_app_guide_for_admins
- Security keys: https://docs.moodle.org/en/Security_keys
- Mobile web services: https://docs.moodle.org/en/Mobile_web_services
- Calendar export: https://docs.moodle.org/405/en/Calendar_export
- Web service functions (3.11): https://docs.moodle.org/dev/Web_service_API_functions
- File handling for external services: https://moodledev.io/docs/apis/subsystems/external/files
- Mobile SSO launch flow: https://tracker-old.moodle.org/browse/MDL-56905
- Token file URLs: https://tracker-old.moodle.org/browse/MDL-58800 , https://tracker-old.moodle.org/browse/MDL-58823
- BGU Moodle (search result pages only, direct fetch blocked): https://moodle.bgu.ac.il/

## Update 2026-11-09 (evening): what Omri's own tests showed

Omri's goal is bigger than deadlines: files, assignments and lecture summaries. He does not mind the account risk.

Tests done by Omri in his browser:
- Calendar export works (iCal link exists), but it only gives deadlines. Not enough.
- Preferences > Security keys shows ONLY the RSS key. No "Moodle mobile web service" row.
- `admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodlemobile` returns a red error, in Hebrew roughly "the plugin is not defined or not available" (my translation, not certain). Read as: the mobile login is not offered at BGU. So routes (a), (b) and the Security-keys token are probably closed unless BGU IT enables them.

Still open / unverified: whether the login is one Moodle form or a redirect (SSO), whether a script on his PC gets 403 (my fetch tool did; a permission rule stopped a retry that faked a browser User-Agent, so test with a plain `curl` by Omri himself).

Lecture recordings, from a search of BGU pages (snippets only, the PDF and Moodle pages could not be fetched):
- Zoom meetings started from a course are auto-published to the "Course Media" block. A lecturer guide says students get viewing without a download option. Which video platform sits behind it is NOT confirmed.
- If a platform is Kaltura, captions can sometimes be fetched by API; Panopto's API is more limited (forum posts, may be dated). Neither applies until we know the platform.
- So summarising lectures is the weakest part: possible only if Bot can get a transcript, or audio/video, from the page Omri's browser sees.

Revised recommendation:
1. Files and assignments: a tiny Chrome extension (plain JS, no packages) in his own logged-in Chrome sends course lists, files and assignment text to Bot at localhost. Works with SSO/2FA and avoids server blocking of scripts. Read-only, results are untrusted data, Confirm card for anything that changes his data.
2. Direct password login from a script: possible only if the login is a plain form and BGU does not block scripts; the password would sit in `.env` and likely unlocks more than Moodle. Try only after the two checks above.
3. Lectures: look at one real lecture page first (domain, player, any caption or download option); then decide between transcript capture, audio capture in the browser, or "not possible".
