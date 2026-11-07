/* GoBadminton #456 — push-only service worker. No fetch interception / cache / sync. */
/* global self, caches, Response */

/** Serializes fence/cache-clear mutations; catch keeps the chain usable. */
let metaChain = Promise.resolve();

function enqueueMeta(task) {
  const run = metaChain.then(() => task());
  metaChain = run.catch(() => {});
  return run;
}

async function activeFence() {
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

function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("://") || value.includes("\\") || value.includes("#")) {
    return "/messages";
  }
  if (value.startsWith("/messages")) return value;
  // Game/results click targets — ordinary same-origin routes only.
  if (/^\/games\/[0-9a-f-]{36}$/i.test(value)) return value;
  if (/^\/my-games\/[0-9a-f-]{36}\/results$/i.test(value)) return value;
  if (value === "/games" || value === "/my-games") return value;
  return "/messages";
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // Wait for committed fence metadata; do not join the writer chain (no deadlock).
      await metaChain;
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = {};
      }
      const title =
        typeof data.title === "string" && data.title.length > 0
          ? data.title
          : "Уведомление GoBadminton";
      const path = safePath(data.path);
      const tag =
        typeof data.tag === "string" &&
        (data.tag.startsWith("gb-msg-") || data.tag.startsWith("gb-game-"))
          ? data.tag
          : "gb-push";
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
  const data = event.notification && event.notification.data
    ? event.notification.data
    : {};
  const path = safePath(data.path);
  const noteFence = typeof data.fence === "string" ? data.fence : null;
  event.waitUntil(
    (async () => {
      const local = await activeFence();
      // Old-account notification: suppress navigation into the wrong fence.
      if (noteFence && local && noteFence !== local) {
        return;
      }
      // No local fence (logged out / cleared): auth fallback to messages root.
      const target = local ? path : "/messages";
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "gb-push-navigate", path: target });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "gb-push-set-fence" && typeof data.fence === "string") {
    event.waitUntil(
      enqueueMeta(async () => {
        const cache = await caches.open("gb-push-meta");
        await cache.put(
          "/__gb_push_fence",
          new Response(JSON.stringify({ fence: data.fence }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
  }
  if (data.type === "gb-push-clear") {
    event.waitUntil(enqueueMeta(() => clearLocalNotifications()));
  }
});
