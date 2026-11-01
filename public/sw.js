// sw.js - Bot's service worker.
// A service worker is a small script the browser keeps running next to the page, even when the page is closed.
// This one is deliberately minimal:
//   - It caches NOTHING and has no fetch handler. Bot's pages and answers are private, and a cache could
//     keep them on the phone or show old data. Every request goes straight to the server.
//   - It lets the page show notifications through registration.showNotification (required on Android).
//   - When you tap a notification it focuses Bot, or opens it.
//   - Push notifications from the PC arrive here as a "push" event, even when Bot's page is closed.
//     The browser has already decrypted the message (see webpush.js); we just show it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
