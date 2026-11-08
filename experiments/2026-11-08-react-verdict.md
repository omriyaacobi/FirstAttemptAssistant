# Should Bot be rewritten in React + Node? (2026-11-08)

## One-page summary
**Verdict: do NOT rewrite Bot in React.** If the page ever starts to hurt, do the "partial" tidy (split `index.html` into plain ES modules, no build step). If you want React for your career, learn it in a separate small project, not inside Bot.

Why, in three lines:
1. The mess you feel is mostly the back end's size and the pile of notes and branches, not how the page is drawn. The page works, is covered by tests, and the 3,475-line `index.html` is long but not tangled enough to justify a rewrite.
2. Bot rests on three deliberate choices that a React toolchain would break: zero packages (small attack surface on a public repo), no build step (Improve Bot and Argon edit `public/` files directly, and the preview sandbox shows the edited file as it is), and a phone app whose cache is one plain file list.
3. A rewrite costs a lot of your scarce Claude Pro quota and stops new features for days, and the gain (a nicer way to write the page) is small.

**Quota estimate** (details in section 7; confidence low to medium):

| Option | Sonnet | Opus |
|---|---|---|
| Full rewrite (React + Vite, keep plain Node `http`) | about 2.5-4 whole 5-hour windows, about 15-30% of a weekly limit (range 10-40%) | 2-3x more (40-70% weekly): do not do it on Opus |
| Partial: split `index.html` into ES modules, no framework | about 30-50% of one 5-hour window, about 3-6% weekly | 8-15% weekly |
| Learn React on the side (toy project, not Bot) | almost no Claude quota | |

When this was written the plan showed 76% of the 5-hour window and 46% of the weekly limit used, so a full rewrite would not even fit this week.

## 1. Words you may not have met
- **React**: a library from Meta for building pages out of **components** (small reusable pieces, each a function that returns what to show). You describe "what the screen looks like for this data" and React updates the real page for you.
- **State**: the data the screen depends on (the list of messages, which tab is open). In React, changing state redraws the parts that depend on it. In Bot today, functions like `draw()` redraw by hand.
- **JSX**: HTML-looking syntax inside JavaScript. Browsers cannot read it, so it must be translated.
- **Build step / bundler**: a program that translates and packs source files into the files the browser gets. **Vite** is the common modern one (fast dev server plus a `build` command). It needs Node packages (`node_modules/`, often 100-300 MB, thousands of files).
- **Vanilla JS**: plain JavaScript with no framework, which is what `public/` is now.
- **Supply chain**: every package brings dependencies written by strangers; a bad update can run code on your PC. Bot has none today.
- **Preact / Lit**: small (3-5 KB) alternatives. Preact works like React; Lit builds browser-native "web components".

## 2. What the real code looks like (measured)
- `public/index.html`: 3,475 lines / 202 KB (CSS, HTML and one big script, about 133 functions, 113 `addEventListener` calls). `public/study.js`: 511 lines. `public/sw.js`: 30 lines. Back end: `server.js` 759 lines plus about 60 modules.
- Rendering is by hand with `createElement` / `textContent`; `innerHTML` appears 3 times in total. The page is protected by tests that read the file as text or run it in a fake DOM (eight test files look at `index.html`: `page`, `phone-ui`, `phoneapp`, `thread-page`, `polish`, `markdown`, `calendar-add`, `selfedit-argon`).
- Confirm cards are drawn by the page from checked fields on purpose (a model cannot inject markup). The preview sandbox serves the edited `index.html` with a fake API and `connect-src 'none'`. The phone app caches a fixed list in `sw.js`.

## 3. What React would actually fix here
Real, but modest:
- **Redraw bugs.** The earlier bug where the typing box lost focus because `draw()` rebuilt the screen is exactly what React avoids by design. It is fixed and has a test.
- **One 3,475-line file.** Components are a natural way to cut it (ES modules are another).
- **Ecosystem.** Ready-made widgets and good tooling.

Not fixed by React: the back end's size, the routing logic, the notes pile, the number of branches, model-quality issues. Those are most of why the project feels messy.

## 4. What it would cost (specific to Bot)
1. **A build step and `node_modules`** in a project whose rule is "no packages". On a public repo that means more supply-chain surface, a lockfile, and updates to babysit.
2. **Improve Bot and Argon** edit `public/index.html` directly, and `selfedit.js` lets Argon write only under `public/` (audited in code). With React the source would be `src/*.jsx` built into `dist/`. Every self-edit would need a build, and the protected-file, "only under `public/`" and diff checks would all have to be redesigned. This is the biggest hidden cost: those checks are security features.
3. **Preview sandbox**: it serves one HTML file under a strict policy. A bundle can be served too, but the fake API and the headers must be reworked and re-tested.
4. **Phone cache**: `sw.js` caches a fixed list. Hashed bundle names change on every build, so the list must be generated; a mistake leaves the phone with an old or broken page that is hard to fix remotely.
5. **Tests**: eight page tests read the HTML as text and would be rewritten around components (and testing libraries = more packages).
6. **Time**: nothing new for you while it happens, and a half-finished rewrite is worse than either end.

## 5. The options
| | Idea | Verdict |
|---|---|---|
| A. Keep as is | Leave the page; clean the repo (done on this branch). | **Recommended now.** |
| B. Split into ES modules | Browsers run `<script type="module">` natively: cut `index.html` into `public/js/chat.js`, `cards.js`, `improve.js`... No build, no packages, Improve Bot still edits plain files. Needs the `sw.js` list updated, tests that read files adjusted, and `server.js` serving `/js/` (a protected file, so you or Claude Code edit it). | **Do later if the file keeps growing.** Best learning per risk. |
| C. Preact or Lit, no build | Copy one pinned library file into `public/vendor/` (no npm). | Only for a new page; still code you must trust and update. |
| D. Vite without React | Same build costs, fewer benefits. | No. |
| E. React for new pages only | A separate `web/` folder with its own build. | Only as practice; two front ends double the upkeep. |
| F. Full rewrite React + Node (Express) | Everything above, plus Express adds packages for a server that already works with plain `http`. | **No.** |
| G. Learn React elsewhere | A small separate repo (a todo list, then a timetable viewer with fake data). | **Yes, if you want React on your CV.** |

Express: keep plain `http`. Bot's server is about 760 lines and tested; Express would add packages for routing you already have. Learn Express in a toy project if you want it.

## 6. Honest note on learning value
React is the most common front-end skill in job listings and you will meet it in courses and internships. But a learning project is best used for what is hard to learn elsewhere: servers, APIs, security checks, testing, working with agents. Rewriting the page would mostly teach you to look after a build tool. A weekend React toy project teaches the React part cleanly, and nothing in Bot can break.

## 7. Quota estimate
Data used: `get_usage` at the time (5-hour 76%, weekly 46%, weekly resets 2026-11-13 15:00); the quota report on `claude/quota-why-0c9eaf` (about 80,000 tokens of fixed starter pack per turn; cost grows with context; Sonnet chats of 300-490k context re-read tens of millions of tokens each; several parallel Sonnet chats of a few hours moved the weekly figure 5-10 points); and a QA run of about 40 messages costing about 7% of a 5-hour window and 1% weekly.

Reasoning: the front end is about 230 KB (about 65,000 tokens) to read once and write again, plus `sw.js`, preview, server edits, eight rewritten test files and several repair rounds. That is roughly 6-10 Sonnet chats of 100-250 turns each; earlier chats of that size moved the week by about 3-5 points each.
- **Full rewrite, Sonnet: 2.5-4 whole 5-hour windows, 15-30% of a weekly limit, range 10-40%.** Confidence low to medium: the plan gives no per-model line or history, and the unknown is the number of repair rounds.
- **Opus: about 2-3x, so 40-70% weekly.** Not recommended.
- **Partial (option B): 30-50% of one 5-hour window, 3-6% weekly on Sonnet, 8-15% on Opus.** Confidence medium.

How to split a rewrite if you still choose it: day 1 plan and build setup on Opus once (about 5% of a window); days 2-6 one fresh Sonnet chat per page area (chat, cards, courses/study, Improve, phone), never more than 2 in parallel, stop when the 5-hour figure passes 70%; day 7 a review of the sandbox, service worker and security checks on Opus (about 10% of a window).

## 8. Staged plan if you ever choose B
1. Make one small piece a `<script type="module">` (the Confirm card drawing), keep the rest. Run `node --test`, check Preview and the phone cache list.
2. Move piece by piece; one commit per piece.
3. Only afterwards think about Preact for a new page.
