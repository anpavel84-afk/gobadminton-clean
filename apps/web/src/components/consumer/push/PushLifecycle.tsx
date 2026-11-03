"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  clearPushLocalBinding,
  ensurePushServiceWorker,
  getPushState,
  setServiceWorkerFence,
} from "../../../lib/push-client";

/**
 * Narrow global push lifecycle via ConsumerShell / auth session events.
 * Does not prompt for permission on page load. Settings mount is not required.
 */
export function PushLifecycle() {
  const router = useRouter();

  useEffect(() => {
    let live = true;
    let fenceGeneration = 0;

    const onNavigate = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "gb-push-navigate") return;
      const path = typeof data.path === "string" ? data.path : "/messages";
      router.push(path.startsWith("/messages") ? path : "/messages");
    };

    const clearLocal = () => {
      ++fenceGeneration;
      void clearPushLocalBinding();
    };

    const syncFence = () => {
      const generation = ++fenceGeneration;
      // Invalidate before async so a delayed prior response cannot restore an old fence.
      void clearPushLocalBinding().then(async () => {
        if (!live || generation !== fenceGeneration) return;
        await ensurePushServiceWorker().catch(() => undefined);
        if (!live || generation !== fenceGeneration) return;
        const result = await getPushState();
        if (!live || generation !== fenceGeneration) return;
        if (result.ok && result.data.accountFence) {
          await setServiceWorkerFence(result.data.accountFence);
          return;
        }
        await clearPushLocalBinding();
      });
    };

    void ensurePushServiceWorker().catch(() => undefined);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", onNavigate);
    }
    window.addEventListener("gb-session-changed", syncFence);
    window.addEventListener("gb-private-expired", clearLocal);
    syncFence();

    return () => {
      live = false;
      ++fenceGeneration;
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onNavigate);
      }
      window.removeEventListener("gb-session-changed", syncFence);
      window.removeEventListener("gb-private-expired", clearLocal);
    };
  }, [router]);

  return null;
}
