# Notability pages: Bot scrolls a note and reads its pages (t40, 2026-11-25)

Omri writes his notes in Notability on the iPad and opens the same note on notability.com in Chrome. He wants to ask Bot
"what did I write last?" or "read pages 3-5" without scrolling himself. PC LOOK (experiments/2026-11-24-pc-look-plan.md) could take only
one picture of the visible part of a tab, and handwriting is drawn, not page text. Omri approved Bot SCROLLING an allowed tab for this
(2026-11-25). Scrolling is the only new kind of control: Bot still never clicks, types, opens a note or switches tabs.

## How the Notability web note is built (measured 2026-11-25 in Omri's Chrome, read-only, plus one test scroll that was put back)

No note content and no note titles here (the repo is public).

- Address: `https://notability.com/app/note/<id>`.
- The ink is drawn on ONE WebGL canvas the size of the view (1600 x 767 CSS px on a 1920 x 855 window). Pages are NOT DOM elements,
  and there is no page text to read.
- The page box: `[data-testid="page-navigator"] input` (`aria-label` "Current page N", `min` 1, **`max` = the number of pages**).
  Next to it are "Previous page" and "Next page" buttons. Bot does not use them (they would be clicking).
- A thin custom scrollbar (an 8 px `div` whose class has `overflowY_scroll`, with a child of `height` = `scrollHeight`) always shows the
  true position: `scrollTop` and `scrollHeight` (10,882 px for 11 pages, so about 989 px a page). **Setting its scrollTop does NOT move
  the note.**
- **A script-made `WheelEvent` (deltaY in pixels) on the element at the canvas center DOES move the note, exactly:** -1000 moved
  scrollTop from 4300 to 3300, and the page box went from 5 to 4. Page N starts at `(N-1) * scrollHeight / pages`; this was checked at
  page 1, page 2 and the end (max scrollTop = scrollHeight - clientHeight).
- The page's left and right edges: `[data-testid="page-bounds-gutter-left"]`'s right side and `...-right`'s left side (the page was
  765 px wide here). The editing toolbar floats over the bottom ~85 px of the canvas, so one page (989 px) needs 2 screens.
- The note opens where Omri last was (page 5 here), so Bot must put the scroll back.
- The last page was EMPTY (Notability keeps a blank page at the end), so "last" must skip empty pages.

## What was built

- **Extension job `tab_pages {tabId, from, to}`** (`moodle-extension/background.js`; `from = 0` means "the last page with writing").
  Only on `https://notability.com/app/note/...`, only on the tab in front of a visible window (like `tab_shot`). The page script
  `noteProbe` is fixed code, and only a number goes in. For each page it scrolls with one wheel event, waits until the position holds
  (plus 350 ms to draw) and takes one `captureVisibleTab` per screen, at least 550 ms apart (Chrome allows 2 a second). It then
  **joins the screens into ONE picture per page**, cut to the page's edges (OffscreenCanvas, JPEG 85). For "last" it starts at the
  last page and goes back while `inkShare` finds no ink (dark or strongly colored pixels; paper and light grid lines are not ink), at
  most 4 pages. A dark paper counts as all ink, so then nothing is skipped (the safe side). If the tab leaves the note or goes behind
  another tab in the middle, it stops. **It always scrolls back** (in `finally`). Limits: 4 pages, 14 screen captures.
- **Bridge** (`moodle-bridge.js`): kind `tab_pages` (whole numbers only), an answer may carry `files` (at most 4, only for this kind,
  base64 checked, 50 MB together), and the time limit is 90 s.
- **pc-look.js**: `checkPages` reads the model's `pages` argument: "last", 3, "3-5", "3 to 5", [3, 5] or {from, to}. Whole numbers
  1-300, at most 4 pages, never backwards. `look(t, "pages", pg)` works on a Notability note tab only, in front only. It checks the
  answer again: the same note, the pages asked for, every picture real JPEG/PNG at most 8 MB, each in its own private folder. If one
  is bad, none is kept. The look card carries the pages to the grant ("Just this once" reads the same pages).
- **brain.js** `pc_look {kind:"tab", number, pages}`: a page series is **ONE look** toward the 3 a message, and **every page counts**
  toward the 30 an hour ("last" counts 1). All pictures of a message must fit in one model call (`MAX_PHOTOS` = 4). The slots are
  reserved BEFORE the look, because several CALL lines of one round run together (a test caught two `pages:"1-3"` calls passing at
  once). The pictures reach agy as `photo1..photoN`, named "the notability.com tab, page N of M", and are deleted after the answer.
  All the old rules hold: refused after a web page, Moodle text or with a photo; doing-tools refused after a look.
- **brain-brief.md**: one paragraph. The model decides "last" or which pages from Omri's words. Code has no word lists.
- **Page** (`public/index.html`): the look card says "scroll the note for pages 3-4, one picture per page, then scroll back".

## Why 4 pages, not 8

One agy call takes at most 4 pictures (`photo.js` MAX_PHOTOS, the multi-photo limit checked on 2026-11-22). Raising it would change
photo uploads too and needs a new real check with agy, so it stays 4. "Read pages 1-8" becomes two messages, and the refusal says so.

## What Omri must do

1. Reload the Bot extension once: chrome://extensions, "Bot Moodle reader", the reload arrow (version 1.2). No new permission is
   asked.
2. Allow notability.com once ("allow Bot to look at notability.com", or "Always allow" on the first card).
3. Try it: open a note on notability.com in Chrome (the tab in front), then ask Bot "what did I write last in my Notability note?"
   or "read pages 2-3 of my note". Bot lists the tabs, scrolls, answers, and the note jumps back to where it was.

## Not done / limits

- "Last" means the last page that has ink, not the last stroke in time. Notability's web app shows no stroke times.
- If Notability renames its `data-testid`s or the scrollbar class, the job answers "the note has not finished loading (no pages
  found)" and nothing is scrolled. The probe is the one place to fix.
- The bottom ~85 px of the LAST page can be under the toolbar (the note cannot scroll further). That page is normally the empty one.
- Live check with the real extension: not done in this session (Bot was not restarted and the extension not reloaded). The scroll and
  the page math were checked by hand in Omri's Chrome. The joining and the ink check run only in fakes so far.
