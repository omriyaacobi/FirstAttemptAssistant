// sw.js - Bot's service worker.
// A service worker is a small script the browser keeps running next to the page, even when the page is closed.
// This one is deliberately minimal:
//   - It caches NOTHING and has no fetch handler. Bot's pages and answers are private, and a cache could
//     keep them on the phone or show old data. Every request goes straight to the server.
//   - It lets the page show notifications through registration.showNotification (required on Android).
//   - When you tap a notification it focuses Bot, or opens it.
// Later, push notifications from the PC will arrive here as a "push" event (not built yet).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (windows.length) return windows[0].focus();
      return self.clients.openWindow("/");
    })
  );
});
