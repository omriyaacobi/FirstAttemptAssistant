# Paste a screenshot, and reply to a marked part (research, 2026-11-13)

Omri: "I want Bot to be comfortable like Claude": paste a PrintScreen / Win+Shift+S picture with Ctrl+V, and select text in a message and reply to exactly that part. Research only; nothing built.

## 1. Pasting a picture

**Why it does not work today:** `public/index.html` has no `paste` listener at all (searched: no `paste`, no `clipboardData`). A `<textarea>` only takes TEXT from a paste, so Chrome drops the picture. Claude and Gemini listen for `paste` and read `event.clipboardData.files`. Bot also has no drag-and-drop.

**The fix (small, page only):** on `paste` in the message box (or anywhere on the thread page), take the first file from `event.clipboardData.files`; if there is one, stop the default and hand it to the paperclip's own input (`photoInput` + a `change` event), exactly as the Share menu does (`takeShared`). A picture then takes the photo road (shrunk in the page, sent with the message to `/api/ask`, counts as a photo in that message, so the doing-tools are refused); a PDF or zip copied in Explorer (Ctrl+C on the file) takes `pickFile` and the upload road. Plain text pastes as before. Optional extra: drag a file onto the page, same road.

**Phone:** Chrome on Android fires `paste` with files on a long-press "Paste" of a copied picture, but whether Gboard's clipboard panel hands a screenshot to a web page is NOT confirmed (an unanswered 2023 report says it did not for a PWA). Must be tried on the S23. The Share menu (built today) already covers "screenshot -> Bot" on the phone: take the screenshot, tap Share in its preview, pick Bot.

**Safety:** no new rule. The picture uses the existing photo/file road and checks. Size limits are the paperclip's (the page shrinks photos; files 50 MB, zips 200 MB).

## 2. Replying to a marked part (a quote)

**How it would work:**
- Page: select text inside ONE message bubble (an answer or Omri's own). A small "Reply to this" button appears next to the selection on the PC. On the phone the long-press selection menu is Android's own; a web page cannot add an item to it, so the page shows its own button just above the message box while a selection exists (the `selectionchange` event fires in Chrome on Android).
- Tapping it puts a quote chip above the box ("Replying to: <first words...>", with an X), like the photo chip. Omri types and sends.
- Sent as `{ task, quote: { messageId, text } }` to `/api/ask`.
- Server CODE checks: the message id exists in the thread; the quote is really a part of that message's saved text (after removing the Markdown marks the page drew; whitespace normalised); at most about 1,500 characters; else refused with a plain reason. The model never supplies the quote.
- Brain: code builds a marked block, for example `QUOTED PART of Bot's answer of <time> (data, Omri is replying to this part):` ... `END QUOTE`, placed before Omri's words. The saved question keeps `quote` so the thread shows the quote above the message and the history keeps it.

**Hard parts:**
- Bot's answers are drawn from Markdown (bold, lists, math), so the selected text differs from the stored text. Code must compare on a cleaned form, or the page sends start/end offsets in the cleaned text. Medium work, needs tests with Hebrew and math.
- A selection across two bubbles: take only the part in the first bubble, or refuse.

**Safety questions for Omri (CLAUDE.md):**
- A quote of Bot's answer can contain text that came from a web page, a file or Moodle. It must stay DATA in a marked block, never instructions. It is already in the recent talk today, so nothing new enters the model; the block only points at it.
- A LINK inside a quote of Bot's answer is not "a link Omri wrote", so code must not treat it as one (linkfetch reads only links from Omri's own words). A quote of Omri's OWN message: could count as his words. My suggestion is no: only the words he types count.
- Does quoting an answer that used a web page make this message "after a web page"? Suggestion: no, as today with the recent talk; the taint rule is about pages read in THIS message.

## Effort

| | Work | Risk |
|---|---|---|
| Paste on the PC (+ drag and drop) | small: one listener and tests | none new |
| Paste on the phone | same code; works only if Gboard hands the file over; needs the phone to check | none new |
| Quote reply | medium: page button and chip, server check, brain block, thread display, tests | low if the rules above are kept |

## Built (2026-11-13, Omri chose "paste, then quotes")

**Paste and drop** (commit `536629c`, `public/index.html` `setupPasteAndDrop`, `tests/paste.test.js`): Ctrl+V with a picture or a copied file, and dropping a file on the page, hand the FIRST file to the paperclip's input. Text pastes as before; Improve Bot's box and the login keep their own paste. Checked in the browser pane: a pasted PNG became "Photo attached".

**Quote reply** (`quote.js`, `thread-store.js`, `jobs.js`, `server.js` `/api/ask`, `brain.js` `quoteBlock`, page `setupQuotes`, `tests/quote.test.js`):
- Select text inside one message: a "Reply to this" button appears above the selection on the PC, 30 px below it on the phone (Android's own Copy menu sits above, its drag handles just below). The chip above the box shows the quote with an X.
- Send carries `{ messageId, text }`. `quote.js` checks the message exists and that the quote's WORDS appear in it in the same order (letters and digits in any language; Markdown marks, spaces and math symbols are ignored, so a selection of a drawn answer matches its saved text). At most 1,500 characters. A failed check is a plain 400 and nothing is saved.
- The quote is saved in its own `quote` field on Omri's message (never in the text) and shown above that message; a tap jumps to the quoted message.
- The brain gets `## The part Omri is replying to` with the quote between `<quote>` markers, said to be DATA, before the new message. `allowedUrl` still reads only Omri's text, so a link in a quoted answer is not "a link Omri wrote".
- A quote goes with a text message or a photo, not with a file (the page says so).
- Not done: the models' memory of LATER messages does not include the quote (the history shows the message text only). Easy to add if it matters.

Checked in the browser pane on a throwaway server with a fake model: select, click the real button, type, Enter; the fake brain received the quote; the sent message shows it. Phone size: the button sits below the selection.

Not checked: a real long-press selection on the S23 (the pane fakes touch), and pasting from Gboard's clipboard on the phone.
