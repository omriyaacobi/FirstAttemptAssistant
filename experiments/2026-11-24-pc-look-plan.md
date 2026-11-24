# PC LOOK: Bot sees what is open on the PC (plan, 2026-11-24)

Omri's decisions (2026-11-24). This file is THE spec for two builders working separately (a contest): Gemini 4 Carbon through
Improve Bot, and a Claude Opus session. Build exactly this. If something here cannot work, do the closest safe thing and say
why in your summary. CONTROL (typing, clicking, writing in apps) is NOT part of this: Bot still never clicks, types, fills forms
or closes windows.

## What Omri wants

1. **Chrome tabs:** Bot can list the TITLE and ADDRESS of every open tab in Omri's Chrome.
2. **Open apps:** Bot can list the apps that have a window open on the PC (Settings, Discord, Chrome, VS Code, Claude, Spotify...)
   with their window titles.
3. **Looking:** Bot can LOOK at one tab (its page text, or a picture of it) or one app window (a picture of it).
4. **Allowed lists:** one list of allowed SITES (by site, e.g. `moodle.bgu.ac.il`) and one list of allowed APPS (by program name,
   e.g. `Code.exe`). Looking at something on its list happens without asking. Looking at anything else shows a **Confirm card**
   with three choices: **"Just this once"**, **"Always allow (add to the list)"**, **"Cancel"**.
5. The lists change ONLY by Omri's own message (e.g. "allow Bot to look at Spotify", the brain proposes, code checks the name is
   really one he wrote) or by his tap on such a card. Never by a model alone, never from page, file, photo or window text.
6. Works from the phone too (the look happens on the PC). Every look is said in the reply ("I looked at your Moodle tab") and
   logged in `data/bot.log` (what was looked at, never its content).

## Safety rules (code, not the model)

- **Titles and page text are UNTRUSTED.** A web page writes its own tab title; any window title can hold an instruction. So:
  - The lists come only through LOOKUP TOOLS, never in the context of every message.
  - After `pc_windows`, `chrome_tabs` or a look ran in a message, the same rule as after a web page applies: the doing-tools that
    act at once are refused in that message (see "RULES THAT STAY IN CODE" in CLAUDE.md; add every new tool to
    `tests/refusal-rules.test.js`). Text comes back inside the usual marked DATA blocks.
  - A look's picture is handled exactly like a PHOTO (private temp folder, fixed name, deleted after the answer; the photo rules).
- **Never allowed, even on a list or with a card:** password managers (e.g. 1Password, Bitwarden, KeePass, the browser's own
  password page), `chrome://` and `edge://` and `about:` pages, `file://` pages, banking. Keep this as a short named constant in
  code; adding to the lists refuses these with a plain reason.
- **Looking needs a real target:** a tab or window from the LAST list Bot read (kept 2 hours, like `pc_find` results), picked by
  NUMBER; a model never hands in an address or a window handle.
- **Limits:** at most 3 looks per message and 30 per hour; a picture at most 8 MB, real JPEG/PNG first bytes checked.
- **Never on a timer**, never from the brief, the summaries or a file follow-up.
- Bot never changes tabs, focuses, moves, closes or types into anything. A minimized window or a tab that is not in front is
  reported plainly ("the Spotify window is minimized, I cannot see it"), never worked around by switching.

## How (suggested; a better way is fine if it keeps every rule above)

- **Chrome tabs:** the Bot extension in `moodle-extension/` (already loaded unpacked, already asks Bot for jobs on localhost
  through `moodle-bridge.js`). Add job kinds with no free-text arguments: `tabs` (returns id, title, address of every tab, via
  `chrome.tabs.query`), `tab_text` (`{tabId}`: the page text of one tab, only if its site is allowed or Omri confirmed it now),
  `tab_shot` (`{tabId}`: `chrome.tabs.captureVisibleTab` of its window, only when it is the active tab of a non-minimized
  window). The `tabs` permission and the host access needed go in `manifest.json` (Omri re-accepts the extension once; say so).
  NOTE: `moodle-extension/` is a guard file for Improve Bot. If you are the Improve Bot editor, write the extension changes into a
  new file `experiments/pc-look-extension.md` (the exact new code for `manifest.json` and `background.js`) and build everything
  else so it works once those are applied; the Opus builder may change the extension itself but must ALSO keep its changes small.
- **Open apps and window pictures:** a small PowerShell script started directly (no shell string, fixed arguments, `-NoProfile`),
  using .NET only (no new package): list top-level visible windows with process name and title; capture ONE window by handle
  with `PrintWindow` (it was measured on this PC: 0.7 s for a Chrome window). A `.ps1` file is a guard file for Improve Bot: if
  you are that editor, run PowerShell with the script passed as a fixed string from a `.js` file, or explain the alternative.
- **Brain tools** (`brain.js`, `brain-brief.md`): lookups `pc_windows`, `chrome_tabs`; doing-tool `pc_look` (`{kind:"tab"|"window",
  number, how:"text"|"picture"}`) that either looks at once (on the list) or makes the Confirm card; `pc_allow`
  (`{site?|app?, remove?}`) from Omri's own words only. Lists in `data/pc-look.json`.
- **Page** (`public/index.html`): the three-button card (like the other cards), and the two lists shown somewhere simple with a
  Remove button each.
- **Tests** in `tests/` with fakes only (no real windows, no real Chrome): list parsing, never-allowed names, numbers from the last
  list only, card choices, the refusal rules, limits, picture checks, temp files deleted.

## Done means

The full suite passes with no fewer tests; a short note `experiments/2026-11-24-pc-look-<builder>.md` says what was built, what
Omri must do by hand (e.g. re-accept the extension), what was not possible and why, and a proposed CLAUDE.md bullet. Do not
merge or push. Do not change CLAUDE.md.
