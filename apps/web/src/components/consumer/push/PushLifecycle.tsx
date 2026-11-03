"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  bumpPushFenceGeneration,
  clearPushLocalBinding,
  ensurePushServiceWorker,
  getPushFenceGeneration,
  getPushState,
  setServiceWorkerFence,
} from "../../../lib/push-client";

/**
 * Narrow global push lifecycle via ConsumerShell / auth session events.
 * Does not prompt for permission on page load. Settings mount is not required.
 * Fence writes/clears share push-client's serialized generation chain.
 */
export function PushLifecycle() {
  const router = useRouter();

  useEffect(() => {
    let live = true;

    const onNavigate = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "gb-push-navigate") return;
      const path = typeof data.path === "string" ? data.path : "/messages";
      router.push(path.startsWith("/messages") ? path : "/messages");
    };

    const clearLocal = () => {
      void clearPushLocalBinding();
    };

    const syncFence = () => {
      const generation = bumpPushFenceGeneration();
      // One generation for clear→fetch→set so a delayed prior SW update cannot
      // restore an old fence or clear a newer one after this sync starts.
      void (async () => {
        await clearPushLocalBinding(generation);
        if (!live || generation !== getPushFenceGeneration()) return;
        await ensurePushServiceWorker().catch(() => undefined);
        if (!live || generation !== getPushFenceGeneration()) return;
        const result = await getPushState();
        if (!live || generation !== getPushFenceGeneration()) return;
        if (result.ok && result.data.accountFence) {
          await setServiceWorkerFence(result.data.accountFence, generation);
          return;
        }
        await clearPushLocalBinding(generation);
      })();
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
      bumpPushFenceGeneration();
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onNavigate);
      }
      window.removeEventListener("gb-session-changed", syncFence);
      window.removeEventListener("gb-private-expired", clearLocal);
    };
  }, [router]);

  return null;
}
