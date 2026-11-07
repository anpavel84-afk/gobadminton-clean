"use client";

import { useEffect } from "react";
import {
  bumpPushFenceGeneration,
  clearPushLocalBinding,
  ensurePushServiceWorker,
  getPushFenceGeneration,
  getPushState,
  setServiceWorkerFence,
} from "../../../lib/push-client";
import { getSessionPresence } from "../../../lib/session-presence";

/** Same-origin /messages* only — never protocol-relative or absolute URLs. */
function sanitizePushNavigatePath(raw: unknown): string {
  if (typeof raw !== "string") return "/messages";
  if (
    !raw.startsWith("/messages") ||
    raw.startsWith("//") ||
    raw.includes("://") ||
    raw.includes("\\") ||
    raw.includes("#")
  ) {
    return "/messages";
  }
  return raw;
}

/**
 * Narrow global push lifecycle via ConsumerShell / auth session events.
 * Does not prompt for permission on page load. Settings mount is not required.
 * Fence writes/clears share push-client's serialized generation chain.
 * Navigation uses window.location.assign (no App Router hook) so SSR/unit
 * shells outside NextAppRouter remain valid; effects do not run during SSR.
 */
export function PushLifecycle() {
  useEffect(() => {
    let live = true;

    const onNavigate = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "gb-push-navigate") return;
      const path = sanitizePushNavigatePath(data.path);
      window.location.assign(path);
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
        // Guest without session cookie: clear stale SW binding only — no private GET.
        if (getSessionPresence() === "absent") return;
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
  }, []);

  return null;
}
