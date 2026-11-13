// sw.js - Bot's service worker.
// A service worker is a small script the browser keeps running next to the page, even when the page is closed.
// It is deliberately small:
//   - It NEVER stores Bot's pages or answers. Bot's data is private, and a stored copy could show old data. Every
//     request goes to the server as before. (The browser's own cache may keep the page FILE, but the server says
//     "no-cache", so the browser asks the PC every time and gets a tiny "304 not modified" when nothing changed.)
//   - When the PC cannot be reached while OPENING Bot (laptop off, asleep, no internet), it shows a short page that
//     says so and tries again by itself, instead of Chrome's error page. That page is written below, in this file.
//   - SHARE: Bot is in Android's Share menu (manifest.webmanifest, "share_target"). Android sends what you shared to
//     /share-target. This script catches it ON THE PHONE (it never reaches the PC), keeps the first file and the
//     words for a moment in a cache named "bot-share", and opens Bot. The page takes them out at once, deletes them,
//     and puts them in the message box. Nothing is sent until you press Send, and then it takes the normal upload road
//     (/api/thread/upload, with all its checks and the login).
//   - It lets the page show notifications through registration.showNotification (required on Android).
//   - When you tap a notification it focuses Bot, or opens it.
//   - Push notifications from the PC arrive here as a "push" event, even when Bot's page is closed.
//     The browser has already decrypted the message (see webpush.js); we just show it.

const SHARE_CACHE = "bot-share";
const SHARE_MAX_BYTES = 200 * 1024 * 1024; // the most Bot takes (a zip); anything bigger is refused here, the page says why
const SHARE_MAX_TEXT = 8000; // the most a message may be (MAX_TASK_CHARS in server.js)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  // anything from the old versions of this file that stored things: gone
  caches.keys().then((names) => Promise.all(names.filter((n) => n !== SHARE_CACHE).map((n) => caches.delete(n)))),
])));

// What was shared, made into the message box's words: the title (if it is not already in the text), the text, the link.
// Android puts a shared link in "text" (sometimes "title"), never in "url"; all three are joined and cut to the message limit.
function sharedWords(form) {
  const part = (name) => { const v = form.get(name); return typeof v === "string" ? v.trim() : ""; };
  const title = part("title"), text = part("text"), url = part("url");
  const pieces = [];
  if (title && !text.includes(title)) pieces.push(title);
  if (text) pieces.push(text);
  if (url && !text.includes(url)) pieces.push(url);
  return pieces.join("\n").slice(0, SHARE_MAX_TEXT);
}

async function takeShare(request) {
  let note = "";
  try {
    const form = await request.formData();
    const words = sharedWords(form);
    const files = form.getAll("file").filter((f) => f && typeof f === "object" && typeof f.name === "string");
    const file = files[0] || null; // Bot takes one attachment per message
    if (files.length > 1) note = "many";
    const cache = await caches.open(SHARE_CACHE);
    await cache.delete("/shared/file");
    if (file && file.size > SHARE_MAX_BYTES) note = "big";
    else if (file && file.size > 0) {
      await cache.put("/shared/file", new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream", "X-Bot-Name": encodeURIComponent(file.name.slice(0, 200)) } }));
    }
    await cache.put("/shared/meta", new Response(JSON.stringify({ words, note, at: Date.now() }), { headers: { "Content-Type": "application/json" } }));
  } catch (error) {
    note = "failed";
    try { await (await caches.open(SHARE_CACHE)).put("/shared/meta", new Response(JSON.stringify({ words: "", note, at: Date.now() }))); } catch (inner) { /* nothing more to do */ }
  }
  return Response.redirect(new URL("/?shared=1", self.location.origin).href, 303);
}

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bot</title><meta name="theme-color" content="#0c0b10"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0b10;color:#e8e6f0;font:16px/1.5 system-ui,sans-serif;padding:0 16px}
main{max-width:26rem;text-align:center}h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#a9a5b8;margin:.4rem 0}
button{margin-top:1rem;font:inherit;padding:.6rem 1.4rem;border-radius:.6rem;border:0;background:#7c6cf0;color:#fff}
</style></head><body><main><h1>Bot isn't reachable right now</h1>
<p>The laptop is off or asleep, or this phone or the laptop has no internet.</p>
<p id="s">Bot tries again every 10 seconds.</p><button id="b">Try now</button></main>
<script>
async function again(){try{const r=await fetch("/manifest.webmanifest",{cache:"no-store"});if(r.ok)location.reload();}catch(e){document.getElementById("s").textContent="Still not reachable. Bot tries again every 10 seconds.";}}
document.getElementById("b").onclick=again;setInterval(again,10000);
</script></body></html>`;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // not ours: the browser handles it as usual
  if (request.method === "POST" && url.pathname === "/share-target") return event.respondWith(takeShare(request));
  // Opening Bot (a page navigation): straight to the PC; only when that FAILS, the "not reachable" page. Nothing is stored.
  if (request.mode === "navigate" && request.method === "GET") {
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
  }
  // every other request (all of /api, the files): no respondWith, so the browser sends it to the PC exactly as before
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { body: event.data ? event.data.text() : "" }; }
  const title = typeof data.title === "string" ? data.title.slice(0, 100) : "Bot";
  const body = typeof data.body === "string" ? data.body.slice(0, 500) : "";
  event.waitUntil(self.registration.showNotification(title, { body, tag: typeof data.tag === "string" ? data.tag : undefined, icon: "/icon-192.png", badge: "/icon-192.png", vibrate: [200, 100, 200] }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (windows.length) return windows[0].focus();
      return self.clients.openWindow("/");
    })
  );
});
