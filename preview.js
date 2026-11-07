// preview.js
// Builds the page for the "Preview" button of Improve Bot: the CHANGED version of public/index.html,
// taken from the private copy, so you can see a new look before you approve it.
//
// Why this is safe: the page was written by an editor model, so it is treated like a stranger's page.
//   - server.js sends it with a Content-Security-Policy "sandbox" (without allow-same-origin). The
//     browser then gives it an empty identity: it cannot send your login cookie, read your chats or
//     call Bot's API (so it cannot approve itself), and it cannot make any network request at all.
//   - Because it cannot call Bot, this file puts a small fake API in front of it (fakeApi below), with
//     one sample chat. So the preview shows the LOOK and layout, never your real chats or data.
//   - Scripts the page loads (like /study.js) are put inline, because a sandboxed page cannot fetch them.

const fs = require("node:fs");
const path = require("node:path");

// Runs inside the sandboxed page, before the page's own scripts. It answers /api/... calls with sample data.
function fakeApi() {
  const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
  const now = Date.now();
  const demo = {
    id: "demo",
    title: "Sample chat (preview)",
    messages: [
      { role: "user", text: "What is a good way to study for a data structures exam?", at: now - 60000 },
      {
        role: "bot",
        at: now - 50000,
        text: "Practice by writing the structures yourself.",
        result: {
          mode: "single",
          answer: "Practice by writing the structures yourself, then explain each one out loud.\n\n```js\nclass Stack { push(x) {} pop() {} }\n```\n\nThis is sample text: the preview never shows your real chats.",
          used: { provider: "gemini", model: "flash" },
          rule: "front desk",
          reason: "everyday question",
          seconds: 3.2,
        },
      },
    ],
  };
  // A sandboxed page may not even look at navigator.serviceWorker (it throws); the page registers one at its end.
  try { Object.defineProperty(Navigator.prototype, "serviceWorker", { get: () => ({ register: () => Promise.reject(new Error("preview")), ready: new Promise(() => {}) }) }); } catch (error) { /* fine */ }
  window.fetch = (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = String((options && options.method) || "GET").toUpperCase();
    if (method !== "GET") return json({ error: "Preview only: nothing is saved here." }, 403);
    if (url.pathname === "/api/session") return json({ remote: false, loggedIn: true, images: true, pushKey: null });
    if (url.pathname === "/api/conversations") return json({ conversations: [{ id: "demo", title: demo.title }] });
    if (url.pathname === "/api/conversations/demo") return json(demo);
    if (url.pathname === "/api/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/usage") return json({ rows: [{ pool: "Gemini Models", window: "Five Hour Limit Remaining", remaining: 72, resets: new Date(now + 3600000).toISOString() }, { pool: "Claude Models", window: "Weekly Limit Remaining", remaining: 41, resets: new Date(now + 86400000).toISOString() }] });
    if (url.pathname === "/api/reminders") return json({ reminders: [], due: [] });
    if (url.pathname === "/api/memory") return json({ facts: [], profile: { loaded: false } });
    return json({ error: "Preview only" }, 404);
  };
}

const STUB = `<script>(${fakeApi.toString()})();</script>`;

// Replaces <script src="/x.js"> by the file's own text, when that file exists in the folder.
function inlineScripts(html, dir) {
  return html.replace(/<script\s+src="\/([\w.-]+\.js)"\s*><\/script>/g, (whole, name) => {
    try {
      const code = fs.readFileSync(path.join(dir, name), "utf8");
      return `<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`;
    } catch (error) {
      return ""; // not there: a sandboxed page could not load it anyway
    }
  });
}

// The page for a folder (the private copy's public/ folder). Returns null if it has no index.html.
function buildPreviewHtml(dir) {
  let html;
  try {
    html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  } catch (error) {
    return null;
  }
  html = inlineScripts(html, dir);
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => tag + STUB) : STUB + html;
}

// The header that makes the browser treat the page as a stranger's (see the top of this file).
const PREVIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-ancestors 'self'";

module.exports = { buildPreviewHtml, fakeApi, PREVIEW_CSP };
