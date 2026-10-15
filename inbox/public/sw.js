// Ravenpost's inbox as an app (the dashboard, /stats): its notifications (a
// data job finished, the morning's digest) and a word when the phone is
// offline. Hearthtale's push-sw.js, in Ravenpost's colours.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m;
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { title: event.data ? event.data.text() : "Ravenpost" };
  }
  event.waitUntil(
    self.registration.showNotification(m.title || "Ravenpost", {
      body: m.body || "",
      icon: "/icon-192.png",
      tag: m.tag,
      data: { url: m.url || "/stats" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/stats", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// (the page always from the network: the numbers are the day's; offline, a word)
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ravenpost</title><body style="font:16px system-ui;background:#16130f;color:#e8dcc2;display:grid;place-items:center;height:90vh;margin:0"><p>Offline. The numbers come back with the network.</p>',
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});
