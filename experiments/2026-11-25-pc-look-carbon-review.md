# PC LOOK: what the Opus build took from the Carbon build (2026-11-25)

Omri chose the Opus build (`experiments/2026-11-24-pc-look-opus.md`, branch `claude/nice-taussig-45f5b4`). The manager asked me to read
Carbon's build (`refs/heads/claude/pc-look-carbon-final`, note `experiments/2026-11-24-pc-look-carbon.md` there) and take ONLY what it did
clearly better, without forcing changes, keeping my stricter rules and NOT taking its long list of Israeli banks. Then add Omri's own bank.
Reviewer: Claude Opus 5.5, started 00:38. No model calls; Carbon's branch was only read with `git show` / `git diff`.

## Omri's bank

`OMRI_BANK = "fibi.co.il"` (the First International Bank of Israel, הבינלאומי) heads `NEVER_BANK_HOSTS` in `pc-look.js`. A host is refused
when it IS that name or ends with `.fibi.co.il`, so `www.`, `online.` and deeper addresses are refused; `notfibi.co.il` is not.
fibi.co.il was already in the list, but nothing tested it, and nothing said it is Omri's own bank. The new test covers: the
addresses above, upper case with a trailing dot, a port, `moodle.bgu.ac.il@online.fibi.co.il` (the real host is the bank), a tab
list ("never looked at"), adding it by `change`, by Omri's words, or by hand in the lists file, a card, a text look and a picture look
(the extension is never asked), and a tab that showed Moodle when listed and the bank when read.

## Taken from Carbon (each one small, each with a test)

| What | Why it is clearly better | Where |
|---|---|---|
| An old extension's "unknown job" becomes "reload the extension once (chrome://extensions ...)" | Until Omri reloads the extension, every tab tool would have failed with a bare "unknown job". Now Bot says the one step to take. | `ask()`, `RELOAD_HINT` in pc-look.js |
| `SetProcessDPIAware()` before the window size is read | On a scaled screen (125%, 150%: most laptops, or a second monitor) the picture would be cut off. This PC is at 100%, so my real check could not show it. | pc-windows.ps1 |
| Picture folders older than an hour (only `bot-look-*`) are deleted at the next picture look | Bot deletes each picture after its answer, but a crash or a watchdog restart in the middle skipped that and left a screenshot in %TEMP%. | `sweepStale()` |
| After a PC list or look, `remember` only makes a card | "remember that ..." saves at once when Omri's words match the fact. A fact taken from a tab could match well enough. Now a tap is always needed. | brain.js `remember` |
| "on your PC" / "במחשב" in the code line when Omri asked from the phone | Spec point 6 says the look happens on the PC. From the phone, the line now says so. | `handleAndRefresh` |
| Hebrew password-manager window titles (מנהל הסיסמאות, מנהל האישורים) and Vaultwarden | My title check was English only. | `PASSWORD_TITLE` |

## Looked at and left (mine is already fine, or stricter)

- **Carbon's bank list and bank-name patterns.** The manager said not to take them. Mine stays: any host label with "bank", plus a short named list.
- **A password-manager check on TAB titles.** I tried it, and my own fixture showed the problem: a normal page titled "...allow bitwarden"
  (or "How to use Bitwarden") would be refused. The known vault sites are already blocked by address, and Chrome's own password page is
  `chrome://`. So tabs are judged by their address only. Window titles keep the check.
- **Pictures of browser windows.** Carbon allows them, with a title check. Mine never takes them: a bank in the front tab would be in the picture.
- **A tab that moved to another ALLOWED site.** Carbon reads it. Mine reads only the same site that was listed, which is stricter.
- **Short app names.** Carbon has a hand-written list of names ("word" -> WINWORD.EXE, "settings" -> SystemSettings.exe). Mine matches against the
  programs in the last window list, so it needs no list to keep up to date.
- **Private (incognito) windows.** Carbon's extension lists them. Mine never does.
- **Running PowerShell with the script inline (`-Command`).** Carbon had to do this, because it could not add a .ps1 file. A separate .ps1 is easier to read.
- **Counting looks that are still running.** Carbon counts them for the hour limit. Mine increments both counters before any `await`, so
  looks run at the same time are already counted.
- **The PNG -> JPEG fallback and `PrintWindow` flag 0 as a second try.** Mine always writes a JPEG at quality 80, and flag 2 works on Windows 11.
- **Running the extension code with `vm.runInNewContext`.** My test already runs the real `background.js` against a fake `chrome` object.

## Checks

- PC LOOK tests: `tests/pc-look.test.js` 23 -> 28, `tests/brain-pclook.test.js` 10 -> 12, `tests/refusal-rules.test.js` 197 (unchanged), all pass.
- Real check on this PC after the script change (nothing looked at): the window list took 0.70 s and found 10 windows. One VS Code
  picture took 0.62 s (178 KB). It was deleted right away and I did not open it.
- Full suite (`node --test`, 00:48:52 to 00:50:01): 1548 tests, 1547 pass, 0 fail, 1 skipped (the same old pc-open file-link test).
  Before this review: 1541. The first run had one failure: `tests/model-choice.test.js` allows the model name "Carbon" only in the
  files that use the model, and my comments said "idea from the Carbon build". The comments now say "the other contest build".
- `git merge-tree main HEAD`: no conflicts with main (`e9e5840`).
- Commits: `79ebb06` (bank + ideas + tests), `554788e` (comment wording), and the one that adds this note. Ended 00:51, about 13 minutes.
