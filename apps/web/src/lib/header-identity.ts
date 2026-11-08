"use client";

import { useSyncExternalStore } from "react";
import { getMe, getMySocialProfile } from "./api-client";
import type { PlayerAvatar } from "./consumer-types";
import { privateActor } from "./foreground-updates";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "./original-http-authority";

type HeaderIdentity = { name: string; avatar?: PlayerAvatar };

export type HeaderIdentitySnapshot = {
  identity: HeaderIdentity | null;
  imageGeneration: number;
};

const EMPTY_SNAPSHOT: HeaderIdentitySnapshot = { identity: null, imageGeneration: 0 };

/** Mirror the existing owned-media and VK/Yandex bounds at the image sink. */
export function headerAvatarUrls(avatar?: PlayerAvatar): string[] {
  const urls: string[] = [];
  if (avatar?.uploadedUrl && /^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(avatar.uploadedUrl)) urls.push(avatar.uploadedUrl);
  if (avatar?.providerUrl && httpUrlAgreesWithOriginalAuthority(avatar.providerUrl, forbiddenUrlScalars)) {
    try {
      const url = new URL(avatar.providerUrl);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
          (url.hostname === "avatars.yandex.net" || url.hostname.endsWith(".userapi.com"))) urls.push(url.href);
    } catch { /* Unknown sources use initials. */ }
  }
  return [...new Set(urls)];
}

function presentationKey(identity: HeaderIdentity | null): string {
  if (!identity) return "";
  const urls = headerAvatarUrls(identity.avatar);
  return urls.length > 0 ? `img:${urls.join("|")}` : `name:${identity.name}`;
}

type HeaderIdentityStore = {
  snapshot: HeaderIdentitySnapshot;
  confirmed?: { actor: string; identity: HeaderIdentity };
  generation: number;
  running?: object;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  started: boolean;
  listeners: Set<() => void>;
};

/** Browser-document store only — never populated during SSR module evaluation. */
let boundWindow: Window | null = null;
let browserStore: HeaderIdentityStore | null = null;
let sessionListenersInstalled = false;

function createStore(): HeaderIdentityStore {
  return {
    snapshot: EMPTY_SNAPSHOT,
    generation: 0,
    dirty: false,
    timer: undefined,
    started: false,
    listeners: new Set(),
  };
}

function emit(store: HeaderIdentityStore) {
  for (const listener of store.listeners) listener();
}

function paint(store: HeaderIdentityStore, value: HeaderIdentity | null) {
  const previousKey = presentationKey(store.snapshot.identity);
  const nextKey = presentationKey(value);
  const imageGeneration = previousKey === nextKey
    ? store.snapshot.imageGeneration
    : store.snapshot.imageGeneration + 1;
  store.snapshot = { identity: value, imageGeneration };
  emit(store);
}

function clearStore(store: HeaderIdentityStore) {
  ++store.generation;
  store.running = undefined;
  store.dirty = false;
  store.confirmed = undefined;
  clearTimeout(store.timer);
  store.timer = undefined;
  paint(store, null);
}

async function refresh(store: HeaderIdentityStore) {
  store.timer = undefined;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (store.running) return;
  const operation = {};
  store.running = operation;
  const currentGeneration = store.generation;
  const current = () =>
    browserStore === store && currentGeneration === store.generation && store.running === operation;
  try {
    const me = await getMe();
    if (!current() || store.dirty) return;
    if (!me.ok) {
      store.confirmed = undefined;
      paint(store, null);
      return;
    }
    const actor = privateActor(me.data);
    // A different authenticated session never inherits a previous picture.
    if (store.confirmed?.actor !== actor) {
      store.confirmed = undefined;
      paint(store, null);
    }
    const social = await getMySocialProfile();
    if (!current() || store.dirty) return;
    if (!social.ok && social.status === 401) {
      clearStore(store);
      return;
    }
    const next: HeaderIdentity = social.ok
      ? { name: social.data.displayName.trim() || me.data.displayName.trim(), avatar: social.data.avatar }
      : (social.status === 0 || social.status === 408 || social.status >= 500) && store.confirmed?.actor === actor
        ? store.confirmed.identity
        : { name: me.data.displayName.trim() };
    store.confirmed = { actor, identity: next };
    paint(store, next);
  } finally {
    if (store.running === operation) {
      store.running = undefined;
      if (store.dirty) {
        store.dirty = false;
        schedule(store);
      }
    }
  }
}

function schedule(store: HeaderIdentityStore) {
  if (browserStore !== store) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (store.running || store.timer !== undefined) return;
  store.timer = setTimeout(() => void refresh(store), 30);
}

function activeStore(): HeaderIdentityStore | null {
  return browserStore && boundWindow === (typeof window !== "undefined" ? window : null)
    ? browserStore
    : null;
}

function ensureSessionBindings() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (sessionListenersInstalled && boundWindow === window) return;
  sessionListenersInstalled = true;
  boundWindow = window;
  const profileChanged = () => {
    const store = activeStore();
    if (!store) return;
    // Reconcile again if a successful write arrived during an older read.
    if (store.running) store.dirty = true;
    schedule(store);
  };
  const sessionChanged = () => {
    const store = activeStore();
    if (!store) return;
    clearStore(store);
    schedule(store);
  };
  const expired = () => {
    const store = activeStore();
    if (!store) return;
    clearStore(store);
  };
  const visible = () => {
    const store = activeStore();
    if (!store) return;
    if (document.visibilityState !== "hidden") schedule(store);
  };
  window.addEventListener("gb-session-changed", sessionChanged);
  window.addEventListener("gb-private-expired", expired);
  window.addEventListener("gb-profile-changed", profileChanged);
  window.addEventListener("focus", profileChanged);
  document.addEventListener("visibilitychange", visible);
}

function getBrowserStore(): HeaderIdentityStore | null {
  if (typeof window === "undefined") return null;
  if (boundWindow !== window) {
    browserStore = null;
    sessionListenersInstalled = false;
    boundWindow = window;
  }
  if (!browserStore) browserStore = createStore();
  ensureSessionBindings();
  return browserStore;
}

function subscribe(onStoreChange: () => void): () => void {
  const store = getBrowserStore();
  if (!store) return () => {};
  store.listeners.add(onStoreChange);
  if (!store.started) {
    store.started = true;
    schedule(store);
  }
  return () => {
    store.listeners.delete(onStoreChange);
  };
}

function getSnapshot(): HeaderIdentitySnapshot {
  return getBrowserStore()?.snapshot ?? EMPTY_SNAPSHOT;
}

function getServerSnapshot(): HeaderIdentitySnapshot {
  return EMPTY_SNAPSHOT;
}

/** Drop browser-document presentation state between Vitest harness windows. */
export function resetHeaderIdentityStoreForTests() {
  if (browserStore) {
    clearTimeout(browserStore.timer);
    browserStore.listeners.clear();
  }
  browserStore = null;
  // Keep sessionListenersInstalled for the current window; handlers no-op until a store exists.
}

/**
 * Current-browser-document presentation snapshot shared across header remounts.
 * Display only — never auth proof. Empty on the server; no cross-request SSR cache.
 */
export function useHeaderIdentity(_pathname?: string): HeaderIdentitySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
