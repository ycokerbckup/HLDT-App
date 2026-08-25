import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

// App shell + static assets get precached for offline load.
precacheAndRoute(self.__WB_MANIFEST);

// Supabase API calls are always network-first, never served stale —
// attendance/dues/chat need to be current, not cached.
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly()
);

// Show a system notification when a push arrives, even if the app
// isn't open. Payload is JSON: { title, body, url }.
self.addEventListener("push", (event) => {
  let payload = { title: "Display Team Ops", body: "You have a new notification." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // ignore malformed payloads, fall back to the default above
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
    })
  );
});

// Clicking the notification focuses an existing tab if one's open,
// otherwise opens a new one at the right place.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
