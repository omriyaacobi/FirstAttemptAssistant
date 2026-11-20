# Bot looks at the Notability mirror itself (`screen_look`) - design, 2026-11-19

Status: PROPOSAL ONLY. Nothing is built. Omri decides first (questions at the end).

## What Omri wants

"Bot has access to what is open on my laptop": the Notability mirror (iPad handwriting shown in Chrome) is screenshotted by hand
and uploaded as a photo. Wish: Bot looks by itself when asked ("check my integral"), no screenshot by hand.

## What I measured

On this PC I ran a PowerShell + .NET `System.Drawing` + `PrintWindow` script (about 25 lines, started directly with
`powershell -NoProfile -File`, no new package). It captured Omri's Chrome window (1942 x 1150) in 0.7 s while Chrome was
behind the Claude window. Result: the whole Chrome window, but ONLY the tab that is in front in that window
(the other tabs are just titles in the tab bar). Script is in the scratchpad, not in the repo.

## The options

| | (a) Windows capture, Node + PowerShell | (b) Chrome extension (`captureVisibleTab`) | (c1) "Look" button on Bot's page (`getDisplayMedia`) |
|---|---|---|---|
| What it can see | any window or the whole desktop (our choice: one window, picked by title) | only the visible tab of one Chrome window, and ONLY if its address is on the extension's host list | only what Omri picks in Chrome's own share dialog, every time |
| Narrowest by design? | no: code must pick the window by title (a title is just text) | yes: Chrome itself refuses any page not on the list in `host_permissions` | yes: Omri picks each time |
| Behind other windows | works (measured), but Chrome may show a stale frame if it is fully hidden | works in normal use; fully covered windows: to test live | works |
| Minimized | fails (blank / last frame) | fails (Chrome gives no picture) | fails |
| Tab not in front (Notability in a background tab) | sees the other tab instead: WRONG picture | same limit, but the extension KNOWS the tab, so it can say "the Notability tab is not in front" instead of sending a wrong picture | Omri picks the tab |
| New code | new PowerShell script + Node wrapper | new job kind in `moodle-bridge.js` + `background.js` + manifest permission | page code only |
| Risk | the biggest: can see a banking tab, WhatsApp, passwords if the title match is wrong; Bot would hold a "screenshot anything" ability | small: the manifest is the limit, enforced by Chrome, not by our code | none, but Omri clicks every time (not much better than a screenshot) |
| Needs Chrome open | no | yes (Omri's Notability mirror is in Chrome anyway) | yes |

Other ideas I rejected: `tabCapture` (needs a user click each time), Notability's own export (no API), Windows `Snipping Tool`
(interactive), and the `computer-use` tool (that is for Claude Code sessions, not something Bot can use).

## Recommendation: (b), the extension, narrowed to the Notability address

Why: it is the only option where the narrowness is enforced by Chrome and a manifest line, not by a title match in our code.
It reuses what exists (unpacked extension, localhost bridge, one job at a time, extension-only routes, `X-Bot-Bridge` header).
If Omri wants "the whole screen" later, (a) can be added as a second, separate tool with its own Confirm step.

### How it would work (small steps)

1. `manifest.json`: add `"tabs"` permission and `host_permissions` for the Notability mirror address ONLY (I need the exact
   address from Omri, e.g. what the address bar shows). Chrome will ask Omri to re-accept the extension once.
2. `moodle-bridge.js`: new job kind `screen: {}` (no arguments, so nothing Moodle or a model writes reaches the extension).
   A result of kind image is checked again in Bot: real PNG/JPEG first bytes (`judgeImage`-style), at most 8 MB.
3. `background.js`: the job `screen` finds a tab whose address is on the host list, requires it to be the active tab of its
   window and the window not minimized, calls `chrome.tabs.captureVisibleTab(windowId, {format: "jpeg", quality: 85})`, and
   answers `{file}`. Otherwise it answers a plain reason ("the Notability tab is not in front"). It never changes tabs or windows.
4. `brain.js`: new tool `screen_look` (no arguments). Code runs it; when the picture comes back, the SAME message is handled
   again as a photo message (private temp folder, fixed name `photo.jpg`, agy chain Argon low -> Hydrogen medium, deleted in a
   `finally`). So every photo rule applies unchanged: doing-tools refused, `parts_done` and `quiz_answer` with "photo" allowed,
   text in the picture is DATA. Cost: one extra model round (the first round only decides to call the tool).
5. Page: one code-written line in the thread, "Bot looked at your Notability tab at 20:14" (no picture kept).
6. Tests (`node --test`, fakes only): bridge kind checks, bad image bytes, offline/not-in-front answers, refusals (see rules),
   temp file deleted on success and on failure.

### Honest limits

- It sees the Notability tab only while that tab is in front in a normal (not minimized) Chrome window. Fully covered windows:
  I could not test with Omri's real mirror; first live test needed.
- "Only when Omri's message asks" cannot be a keyword check (core wish). The model PROPOSES `screen_look` after reading the
  message; code adds structural limits instead: not after a web page or Moodle text in the same message, one capture per
  message, at most N per hour (proposal 20), and every capture is logged in `data/bot.log` and shown as a line on the page.
  Never on a timer, never from the brief or the summaries, never from an `attached` (file) follow-up.
- A prompt-injection in a page cannot trigger it (web / Moodle text blocks it, as for doing-tools).

## Rule changes needed (proposed CLAUDE.md bullet, NOT applied)

> - **SCREEN LOOK (2026-11-19, `screen_look`):** Bot can look at ONE thing on the PC: the Notability mirror tab in Omri's Chrome,
>   through the Bot extension (`captureVisibleTab`, host list = the Notability address only; Chrome refuses every other page).
>   Only when Omri's own message asks (the brain proposes the tool; code refuses it after a web page or Moodle text, from the
>   phone, more than once per message or more than 20 times an hour; never on a timer). The picture is handled exactly like a
>   PHOTO (private temp folder, agy Argon low then Hydrogen medium, deleted after the answer, the photo refusals for doing-tools,
>   `parts_done` and `quiz_answer` allowed). Nothing is saved. The extension never changes tabs or windows. Widening the host
>   list or adding a whole-screen capture needs Omri's word.

Also: the MOODLE bullet says the extension is "read-only for Moodle"; its description in `manifest.json` and the file header of
`background.js` need one added line about the screen job.

## Questions for Omri

1. Mirror only (recommended), or really the whole screen / any window? The whole screen means Bot could see WhatsApp, banking,
   passwords whenever a model asks for it; I advise against it.
2. What address does the Notability mirror have in Chrome's address bar (just the site part)? Is it usually the tab in front
   in its own window while you solve?
3. From the phone: refuse (my advice: a stranger holding your phone could look at your laptop screen) or allow?
4. OK to re-accept the extension once in Chrome after the manifest change?
