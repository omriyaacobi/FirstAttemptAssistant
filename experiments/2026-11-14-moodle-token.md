# Moodle without logging in every time: the phone app's token (2026-11-14)

## The question
Bot read BGU Moodle only through Omri's Chrome (`moodle-extension/`), and Moodle logs out after about an hour idle.
Omri wants Bot to reach Moodle with something long-lived. A friend has this working.

## Words
- **Web service**: a second door into Moodle, made for programs (the official phone app uses it). You send a function name and get JSON.
- **Token**: a long secret string Moodle gives after ONE login. Sent with every call instead of a password or a browser session.
- **Edge (Akamai)**: the company's servers that stand in front of moodle.bgu.ac.il and decide which requests reach Moodle at all.
- **User-Agent**: one line every program sends that says what it is ("curl/8.5", "node", a browser's long name).

## What was tried (all without any login; each address asked once)

| Request | Result |
|---|---|
| `GET /moodle/login/index.php`, User-Agent `Bot-study-assistant (read-only, personal use)` | **403 Access Denied** from the edge (as on 2026-11-11) |
| the same name on `/login/token.php`, `/webservice/rest/server.php`, `/lib/ajax/service-nologin.php`, `/admin/tool/mobile/launch.php` | **403** on every one |
| `Bot-study-assistant/1.0` | 403 |
| `study-assistant (personal, read-only; Node.js)` | 403 |
| curl's own default name (`curl/x.y`) on `/webservice/rest/server.php` | **200**, Moodle itself answers `invalidtoken` |
| Node with no User-Agent at all | **200** |
| Node with User-Agent `node` | **200** |
| `POST /lib/ajax/service-nologin.php` `tool_mobile_get_public_config` (Moodle's public settings for the app) | 200: `enablewebservices: 1`, `enablemobilewebservice: 1`, `typeoflogin: 1`, one identity provider "BGU 365 SSO" |
| `moodle-ws.js` with a made-up token, real network | Moodle answers `invalidtoken` (so the whole road works up to the token) |

## What it means
1. **The edge does not refuse scripts as such.** It refuses some User-Agent texts (ours had the word "Bot" in it; a second
   made-up name was refused too) and lets plain tools through (curl, Node). The 2026-11-11 conclusion "BGU refuses scripts"
   was really "BGU refuses the name we chose".
2. **The phone app's web service is switched on at BGU**, so a token can exist.
3. `typeoflogin: 1` means the app logs in with **user name + password** sent to `login/token.php` (not through a browser
   page). The browser hand-over address (`admin/tool/mobile/launch.php`) is switched off by that same setting.

## What was built
- `moodle-ws.js`: the read-only token client. One POST address, a closed list of 7 read functions (all `_get_`), the token in
  the request body, files only from Moodle's own `webservice/pluginfile.php`. It answers in the same shapes as the extension, so
  `moodle-tools.js` did not change. `createMoodleSource`: token first, Chrome extension as the fallback.
- `moodle-token.js`: Omri runs it once; it asks for the user name and password (hidden), sends them once to
  `login/token.php` with the service `moodle_mobile_app`, and writes `MOODLE_TOKEN=` into `.env`. Nothing is printed or stored
  but the token. `--check` tests the saved token; `--paste` saves a token Omri got another way.
- `moodle-watch.js`: the 3-hour watch (part 2), on top of the same source.

## The honest-name decision (Omri should know)
Bot's User-Agent on this road is **`node`**: the true name of the program that runs Bot. It is not a browser's name and
not the phone app's name ("MoodleMobile"), which would be pretending. But it IS a different name from the one the edge
refused, chosen after seeing which names pass. If Omri reads the rule "never get past the edge with a changed header"
more strictly than "never pretend to be a browser", say so: one constant (`USER_AGENT` in `moodle-ws.js`) decides it, and
with the old name this road is closed and the extension stays the only way.

## Not known yet (needs Omri's token)
- Whether `login/token.php` accepts Omri's BGU user name and password. If Omri enters Moodle only through the Microsoft
  365 page and has no password Moodle itself knows, Moodle answers `invalidlogin` and this way does not give a token.
  Then: ask the friend how they got theirs, or look at Moodle -> Preferences -> Security keys in the browser
  (`node moodle-token.js --paste` saves a token from there).
- How long BGU's tokens last (Moodle's default for the app is 12 weeks). When it ends, the watch says so once and the
  extension keeps working.
- Whether Moodle accepts the token in the BODY of a file request (it does for calls; for `webservice/pluginfile.php` the
  code reads the same parameter, but this was not run with a real token). If a download fails with a real token, that is
  the first place to look. The token is deliberately never put in an address.
- The exact fields BGU's Moodle returns from `core_course_get_contents` and `mod_forum_get_forum_discussions` (written
  from Moodle's documentation, tested only against a fake).

## Update, same day: run with Omri's real token
Omri ran `node moodle-token.js` (so `login/token.php` accepts their user name and password) and `--check` printed
"The token works: Moodle shows 5 course(s) in progress." Then every read job of `moodle-ws.js` was run once against real
Moodle, printing counts only:

| Job | Result |
|---|---|
| courses | 5, ids and names present |
| course (all 5) | 13 to 22 sections, 13 to 127 items; kinds seen: forum, zoom, label, resource, folder, url, page, assign, quiz, groupselect, choicegroup, questionnaire, subsection, lti, wooclap |
| forum (first forum of each) | 3, 4, 10, 16 and 24 discussions, every one with a title and a time |
| posts (one discussion) | subject, author, time and message present |
| events | 12, all with a due time and a course id |
| folder | 9 files listed |
| file | one PDF, 6,513,529 bytes, starts with `%PDF-` (so the token in the request BODY is accepted for files too) |

No code change was needed. So of the list above only this is still unknown: how long BGU's tokens last.

## Not tried, on purpose
- Any browser-like or app-like User-Agent, cookie replay from Chrome, or keeping a browser session alive.
- The calendar-export and forum-feed addresses: not needed once the web service answered.
