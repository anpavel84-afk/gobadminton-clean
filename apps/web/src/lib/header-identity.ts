"use client";

import { useEffect, useState } from "react";
import { getMe, getMySocialProfile } from "./api-client";
import type { PlayerAvatar } from "./consumer-types";
import { privateActor } from "./foreground-updates";

type HeaderIdentity = { name: string; avatar?: PlayerAvatar };

/** Mirror the existing owned-media and VK/Yandex bounds at the image sink. */
export function headerAvatarUrls(avatar?: PlayerAvatar): string[] {
  const urls: string[] = [];
  if (avatar?.uploadedUrl && /^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(avatar.uploadedUrl)) urls.push(avatar.uploadedUrl);
  if (avatar?.providerUrl) {
    try {
      const url = new URL(avatar.providerUrl);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
          (url.hostname === "avatars.yandex.net" || url.hostname.endsWith(".userapi.com"))) urls.push(url.href);
    } catch { /* Unknown sources use initials. */ }
  }
  return [...new Set(urls)];
}

/** Component-owned, current-session view. No shared identity cache or polling. */
export function useHeaderIdentity(pathname: string) {
  const [identity, setIdentity] = useState<HeaderIdentity | null>(null);
  const [imageGeneration, setImageGeneration] = useState(0);
  useEffect(() => {
    let live = true, generation = 0;
    let confirmed: { actor: string; identity: HeaderIdentity } | undefined;
    let running: object | undefined, dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = (value: HeaderIdentity | null) => { setIdentity(value); setImageGeneration(n => n + 1); };
    const clear = () => {
      ++generation; running = undefined; dirty = false; confirmed = undefined;
      clearTimeout(timer); timer = undefined; paint(null);
    };
    async function refresh() {
      timer = undefined;
      if (!live || document.visibilityState === "hidden" || running) return;
      const operation = {}; running = operation;
      const currentGeneration = generation;
      const current = () => live && currentGeneration === generation && running === operation;
      try {
        const me = await getMe();
        if (!current() || dirty) return;
        if (!me.ok) { confirmed = undefined; paint(null); return; }
        const actor = privateActor(me.data);
        // A different authenticated session never inherits a previous picture.
        if (confirmed?.actor !== actor) { confirmed = undefined; paint(null); }
        const social = await getMySocialProfile();
        if (!current() || dirty) return;
        if (!social.ok && social.status === 401) { clear(); return; }
        const next: HeaderIdentity = social.ok
          ? { name: social.data.displayName.trim() || me.data.displayName.trim(), avatar: social.data.avatar }
          : (social.status === 0 || social.status === 408 || social.status >= 500) && confirmed?.actor === actor
            ? confirmed.identity : { name: me.data.displayName.trim() };
        confirmed = { actor, identity: next }; paint(next);
      } finally {
        if (running === operation) {
          running = undefined;
          if (dirty) { dirty = false; schedule(); }
        }
      }
    }
    function schedule() {
      if (!live || document.visibilityState === "hidden" || running || timer !== undefined) return;
      timer = setTimeout(() => void refresh(), 30);
    }
    const profileChanged = () => {
      // Reconcile again if a successful write arrived during an older read.
      if (running) dirty = true;
      schedule();
    };
    const sessionChanged = () => { clear(); schedule(); };
    const expired = () => { clear(); };
    const visible = () => { if (document.visibilityState !== "hidden") schedule(); };
    schedule();
    window.addEventListener("gb-session-changed", sessionChanged);
    window.addEventListener("gb-private-expired", expired);
    window.addEventListener("gb-profile-changed", profileChanged);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false; ++generation; running = undefined; confirmed = undefined; clearTimeout(timer);
      window.removeEventListener("gb-session-changed", sessionChanged);
      window.removeEventListener("gb-private-expired", expired);
      window.removeEventListener("gb-profile-changed", profileChanged);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname]);
  return { identity, imageGeneration };
}
