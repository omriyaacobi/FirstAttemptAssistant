# Moodle from a logged-in browser: what works (2026-11-11)

## Why a browser at all
A script from Node (`experiments/moodle-probe.js --look`, honest User-Agent "Bot-study-assistant") gets **403 Access Denied
from Akamai** (the CDN in front of moodle.bgu.ac.il, error link on errors.edgesuite.net) before Moodle is reached. Bot will NOT
pretend to be a browser to get past that (that is bypassing bot detection). So the plan is: Omri's own Chrome, logged in by
Omri, does the reads; Bot asks for them. `moodle.js` (the Node client) stays in the repo, unused, in case BGU ever opens a route.

## The test
Claude in Chrome, Omri already logged in, one tab, read-only calls only, run from inside the Moodle page (same origin, Omri's
session; that is exactly what a small Bot extension would do). Theme `bguacademi`, Moodle 4.x (courseformat state API exists).

| What | How | Result |
|---|---|---|
| Logged in? | `M.cfg.sesskey` + a logout link on `/my/` | yes |
| My courses | ajax `core_course_get_enrolled_courses_by_timeline_classification` (`classification: "inprogress"`) | 5 courses: id, full name (Hebrew or English), short name (a code like 232120310120271), category, start date |
| One course's contents | ajax `core_courseformat_get_state {courseid}` (returns a JSON string) | Systems Programming (68510): 22 sections, 125 items. Each item: id, name, module (forum, zoom, page, url, resource, folder, lti, assign, quiz, wooclap, questionnaire, choicegroup), section, url |
| Announcements list | GET `/mod/forum/view.php?id=<cm id>` and parse `discuss.php?d=` links + `data-timestamp` (the first forum is "לוח הודעות") | works; titles and times |
| One announcement | ajax `mod_forum_get_discussion_posts {discussionid}` | subject, created time, HTML message, attachment names |
| Deadlines | ajax `core_calendar_get_action_events_by_timesort {timesortfrom, limitnum}` | name, course, due time, module (assign) |
| A file | GET `/mod/resource/view.php?id=<cm id>` -> redirected to `/pluginfile.php/.../examples.zip`, content-type and length given | works (8 KB zip) |
| Recorded lectures | the course page links `/blocks/video/videoslist.php?courseid=..`; that page mentions Kaltura, no mp4/m3u8/vtt in its HTML | needs a look at ONE lecture page (step 4 of the task) |

Notes:
- `core_course_get_contents` was not tried (state API was enough).
- Opening `mod/resource/view.php` may record "viewed" in Moodle's log, the same as a click. It changes nothing else.
- Every read above is on the read-only allowlist of `moodle.js` (`READ_PATHS`, `READ_METHODS`), which the extension must copy.
- Session time-out: Moodle logs Omri out after about an hour idle. Bot will say "log in to Moodle in Chrome" and never keep the
  session alive in the background.

## Next (agreed in chat)
A small Chrome extension (plain files in the repo, loaded unpacked once by Omri) that asks Bot on localhost for waiting
Moodle reads, runs them with Omri's session (allowlist enforced in the extension AND checked again in Bot), and sends the
text/files back. Bot files files through `addUpload` / `addZip` as untrusted data. Claude Code is not needed at run time.
