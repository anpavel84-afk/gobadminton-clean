/* GoBadminton #456 — push-only service worker. No fetch interception / cache / sync. */
/* global self, clients */

const FENCE_KEY = "gb-push-account-fence";
const INSTALL_KEY = "gb-push-installation-id";

function readFence() {
  try {
    return self.registration && typeof self.cookieStore === "undefined"
      ? null
      : null;
  } catch {
    return null;
  }
}

async function activeFence() {
  try {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      // Fence is mirrored via postMessage into SW registration; prefer Cache Storage opaque slot.
    }
  } catch {
    /* ignore */
  }
  try {
    const cache = await caches.open("gb-push-meta");
    const res = await cache.match("/__gb_push_fence");
    if (!res) return null;
    const data = await res.json();
    return data && typeof data.fence === "string" ? data.fence : null;
  } catch {
    return null;
  }
}

async function clearLocalNotifications() {
  try {
    const list = await self.registration.getNotifications();
    for (const n of list) n.close();
  } catch {
    /* ignore */
  }
  try {
    await caches.delete("gb-push-meta");
  } catch {
    /* ignore */
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = {};
      }
      const title =
        typeof data.title === "string" && data.title.length > 0
          ? data.title
          : "Новое сообщение";
      const path =
        typeof data.path === "string" && data.path.startsWith("/messages")
          ? data.path
          : "/messages";
      const tag =
        typeof data.tag === "string" && data.tag.startsWith("gb-msg-")
          ? data.tag
          : "gb-msg";
      const fence = typeof data.fence === "string" ? data.fence : null;
      const local = await activeFence();
      if (!fence || !local || fence !== local) {
        // Account-switch race: do not show as the new account's notification.
        return;
      }
      await self.registration.showNotification(title, {
        body: "",
        tag,
        renotify: false,
        data: { path, fence },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.path === "string" &&
    event.notification.data.path.startsWith("/messages")
      ? event.notification.data.path
      : "/messages";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "gb-push-navigate", path });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(path);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "gb-push-set-fence" && typeof data.fence === "string") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open("gb-push-meta");
        await cache.put(
          "/__gb_push_fence",
          new Response(JSON.stringify({ fence: data.fence }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      })(),
    );
  }
  if (data.type === "gb-push-clear") {
    event.waitUntil(clearLocalNotifications());
  }
});

void FENCE_KEY;
void INSTALL_KEY;
void readFence;
