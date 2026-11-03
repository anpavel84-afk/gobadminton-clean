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
      void getPushState().then((result) => {
        if (!live) return;
        if (result.ok && result.data.accountFence) {
          void setServiceWorkerFence(result.data.accountFence);
          return;
        }
        void clearPushLocalBinding();
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
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onNavigate);
      }
      window.removeEventListener("gb-session-changed", syncFence);
      window.removeEventListener("gb-private-expired", clearLocal);
    };
  }, [router]);

  return null;
}
