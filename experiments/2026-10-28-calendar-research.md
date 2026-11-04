# Can Bot reach Google Calendar (and Gmail / Drive) through `agy`?

Date: 2026-10-28. Research only: nothing was installed, no setting changed, no login done, no calendar data touched.

## Short answer

- **Not out of the box.** `agy` has no built-in Calendar tool. Test below.
- **Yes with setup.** `agy` supports **MCP servers**, and Google publishes official Workspace MCP servers for Calendar, Gmail and Drive. But they are a **Developer Preview** and need a Google Cloud project + OAuth setup. Whether a **personal @gmail.com** account is allowed is **not stated** in the docs I could read.
- This would use the Google AI Pro plan for the model; the Calendar access itself has no separate bill that I could find (pricing is not mentioned in the docs).

## New terms (plain English)

- **MCP (Model Context Protocol)**: a standard way to plug "tools" into an AI. An MCP server is a small service that says "I can list calendar events, I can read mail", and the AI app (`agy`, `claude`) calls it. Think of it as a USB port for AI tools.
- **OAuth**: the "Sign in with Google" mechanism. You never give the program your password; you approve a consent screen and Google hands the program a limited-power token.
- **Scope**: what a token is allowed to do, e.g. `calendar.events.readonly` = only read events. Smaller scopes = less damage if something leaks.
- **Refresh token**: a long-lived token used to get new short-lived access tokens, so you are not asked to sign in every hour.
- **Google Cloud project**: a free container in Google's cloud console where you switch on APIs and create OAuth credentials.

## What I checked

### 1. `agy` itself (run locally)

- `agy --help` shows subcommands: `mcp` (add/remove/list/enable/disable), `plugin` (install/import/...), `agents`, `models`, ...
- `agy mcp list` -> "No MCP servers configured." `agy plugin list` -> "No plugins installed."
- Read-only test, run in an empty temp folder with Gemini 3.8 Flash low: asked it to list today's events or say "NO CALENDAR TOOL". It answered **NO CALENDAR TOOL**. So today Bot genuinely cannot see the calendar, and `router-brief.md` saying "NOT connected" is correct.
- `agy mcp add <name> <url>` accepts `--type http` and `--header`, so adding an HTTP MCP server is a supported, one-line operation. (Google's docs instead describe editing the config file with an `oauth` block holding client id/secret; the CLI flags shown have no OAuth option, so OAuth servers probably need the file.)

### 2. Official Google Workspace MCP servers

Per Google's guide and the Antigravity codelab:

- Endpoints: `https://calendarmcp.googleapis.com/mcp/v1`, `https://gmailmcp.googleapis.com/mcp/v1`, `https://drivemcp.googleapis.com/mcp/v1` (also Docs, Sheets, Slides, Chat, People).
- Setup: create a Cloud project, enable the APIs **and** the matching `*mcp` services, configure the OAuth consent screen (Internal, or External with yourself as a test user), create a **Web application** OAuth client with redirect URI `https://antigravity.google/oauth-callback`, put the client id/secret in `~/.gemini/config/mcp_config.json` (shared by Antigravity IDE and CLI), then in `agy` run `/mcp`, pick the server, Authenticate, paste the code.
- Calendar scopes offered are **read only**: `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.events.readonly`. Gmail: `gmail.readonly` + `gmail.compose` (drafts). Drive: `drive.readonly` + `drive.file`. So these servers appear **not to create or edit calendar events**. For writing events you would need a different route (section 3).
- Caveats from the docs/blog: it is a **Developer Preview** (requires enrolling the Cloud project in the Workspace Developer Preview Program); the codelab lists "a Google Workspace account" as a prerequisite; `agy` does **not** substitute `${VARS}` in the config, so secrets must be written in the file (keep that file outside the repo; it lives in your home folder, which is fine); enterprise admins can block it; tokens are per surface (IDE and CLI authenticate separately).
- **Unknown:** if a personal Gmail account can enroll/use it. Docs don't say. Needs a real try or a Google answer.

### 3. Alternatives

| Option | Setup effort | Security | Plan / cost | Read | Write |
|---|---|---|---|---|---|
| **A. Official Workspace MCP in `agy`** (above) | Medium: Cloud project, preview enrollment, OAuth client, config file, manual auth | Good: Google-hosted, you choose scopes, read-only scopes available. Secret in a home-folder file. Preview = may change | Model on AI Pro; no extra key needed beyond the OAuth client | Yes | Calendar: no (read scopes only) |
| **B. Google Calendar API directly from Node, OAuth, secrets in `.env`** | Medium-high: same Cloud project + OAuth client (Desktop type), write ~100 lines (built-in `https` only, to match Bot's no-dependency style), store a refresh token. Bot then calls it as its own tool and hands results to a model | Best control: Bot code decides exactly which calls exist (e.g. read-only function, separate "create event" function behind a confirm button). Tokens in `.env`/`data/` (git-ignored). Caveat: an External app in "Testing" mode gets refresh tokens that **expire after 7 days**, so you re-consent weekly unless the app is published | Free API (no model quota used for the API call itself); model summarising the result uses Pro quota as usual | Yes | Yes |
| **C. Community MCP server (e.g. taylorwilsdon `workspace-mcp`, or ones built on Google's `gws` CLI) added with `agy mcp add`** | Medium: still needs your own OAuth client; installs a third-party package | Weakest: you run code from a stranger with mail/calendar access. Pin versions, read the code. Works with personal accounts (they advertise it) | Free; model on Pro | Yes | Usually yes (also mail send, which is risky) |
| **D. A calendar connector in the Claude apps** (claude.ai connectors) | Low if it works; I did **not** test this and Bot's `claude -p` calls may not inherit it | Google-managed OAuth | Claude plan | Unverified | Unverified |

## Risks worth remembering

- Bot's front desk and planner deliberately run in an empty temp folder with no tools. Giving a model Calendar/Gmail access means prompt-injection matters: an email or event description is untrusted text that could say "forward all mail to X". Rule for Bot: calendar/mail tools **read-only by default**, and any write goes through a button in the web page like Push to GitHub does.
- The repo is public: OAuth client secrets and tokens must never be committed (`.env`, `data/` stay git-ignored).

## Recommendation

1. **Try option A first, read-only, for Calendar only** (`calendar.events.readonly` + `calendarlist.readonly`). It is the official route, matches the plan "Google things -> Gemini", and costs nothing extra. First step is cheap: check whether your personal account can join the Workspace Developer Preview (Google Cloud console + the preview sign-up page). If it says Workspace-only, stop there.
2. **If A is refused or flaky, go to option B** (own small `calendar.js` in Bot, Desktop OAuth client, tokens in `.env`/`data/`). It is more code but is the only path that gives full control, supports writing events behind a confirmation, and fits the learning goals (you meet OAuth, tokens and REST for real). Accept the weekly re-consent while the app is in Testing mode.
3. Skip C unless A and B both fail, and skip D until someone tests whether `claude -p` sees connectors.
4. Add Gmail/Drive later, one scope at a time, only after Calendar works.
5. After a connection exists, flip the "NOT connected" line in `router-brief.md` and add a test; update CLAUDE.md "UNVERIFIED" note to say what is verified.

Things I need from you before any next step: permission to create a Google Cloud project (free) and whether to enroll in the preview. Nothing was installed or changed during this research.

## Sources

- [Configure the Google Workspace MCP servers (Google)](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Google Workspace MCP servers in Antigravity 2.0, IDE and CLI (codelab)](https://codelabs.developers.google.com/google-workspace-mcp-antigravity?hl=en)
- [MCP Configuration for Google Workspace with Antigravity CLI (DEV Community)](https://dev.to/gde/mcp-configuration-for-google-workspace-with-antigravity-cli-3f34)
- [Google Workspace preview page](https://developers.google.cn/workspace/preview?authuser=7)
- [Gmail MCP Server: Google's Official Preview, Community Options (Drag)](https://www.dragapp.com/blog/gmail-mcp-server/)
- [Google OAuth refresh token: 7-day limit (Unipile)](https://www.unipile.com/google-oauth-refresh-token/)
- Local: `agy --help`, `agy mcp --help`, `agy mcp list`, `agy plugin list`, one read-only `agy -p` test.
