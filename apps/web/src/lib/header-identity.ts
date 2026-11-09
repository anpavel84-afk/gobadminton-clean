"use client";

import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { getMe, getMySocialProfile } from "./api-client";
import type { PlayerAvatar } from "./consumer-types";
import { privateActor } from "./foreground-updates";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "./original-http-authority";

type HeaderIdentity = { name: string; avatar?: PlayerAvatar };

export type HeaderIdentitySnapshot = {
  identity: HeaderIdentity | null;
  imageGeneration: number;
  loading: boolean;
  /** Request binding only; never a session token or authentication capability. */
  ownerId?: string;
};

const EMPTY_SNAPSHOT: HeaderIdentitySnapshot = { identity: null, imageGeneration: 0, loading: true };
const HeaderBootstrap = createContext<HeaderIdentitySnapshot>(EMPTY_SNAPSHOT);

/** Request-owned, presentation-only data. No session secret or auth capability. */
export function HeaderIdentityProvider({ snapshot, children }: {
  snapshot: HeaderIdentitySnapshot;
  children: ReactNode;
}) {
  return createElement(HeaderBootstrap.Provider, { value: snapshot }, children);
}

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
  ownerId?: string;
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

function createStore(bootstrap: HeaderIdentitySnapshot): HeaderIdentityStore {
  return {
    snapshot: bootstrap,
    ownerId: bootstrap.ownerId,
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

function paint(store: HeaderIdentityStore, value: HeaderIdentity | null, loading = false) {
  const previousKey = presentationKey(store.snapshot.identity);
  const nextKey = presentationKey(value);
  const imageGeneration = previousKey === nextKey
    ? store.snapshot.imageGeneration
    : store.snapshot.imageGeneration + 1;
  store.snapshot = { identity: value, imageGeneration, loading };
  emit(store);
}

function clearStore(store: HeaderIdentityStore, loading = false) {
  ++store.generation;
  store.running = undefined;
  store.dirty = false;
  store.confirmed = undefined;
  store.ownerId = undefined;
  clearTimeout(store.timer);
  store.timer = undefined;
  paint(store, null, loading);
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
      // Network / timeout / 5xx: keep last confirmed display in the same session.
      // Definitive 401 (and other non-transient) still clears immediately.
      if (
        store.snapshot.identity &&
        (me.status === 0 || me.status === 408 || me.status >= 500)
      ) {
        return;
      }
      store.confirmed = undefined;
      paint(store, null, me.status === 0 || me.status === 408 || me.status >= 500);
      return;
    }
    const actor = privateActor(me.data);
    // A different authenticated session never inherits a previous picture.
    if ((store.ownerId && store.ownerId !== me.data.id) || (store.confirmed && store.confirmed.actor !== actor)) {
      store.confirmed = undefined;
      paint(store, null, true);
    }
    store.ownerId = me.data.id;
    const social = await getMySocialProfile();
    if (!current() || store.dirty) return;
    if (!social.ok && social.status === 401) {
      clearStore(store);
      return;
    }
    if (!social.ok) {
      const transient = social.status === 0 || social.status === 408 || social.status >= 500;
      if (transient && store.snapshot.identity) return;
      store.confirmed = undefined;
      paint(store, null, transient);
      return;
    }
    // Public name comes only from the accepted social profile, never /me provider data.
    const name = social.data.displayName.trim();
    if (!name) {
      store.confirmed = undefined;
      paint(store, null);
      return;
    }
    const next: HeaderIdentity = { name, avatar: social.data.avatar };
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
  const sessionChanged = (event: Event) => {
    const store = activeStore();
    if (!store) return;
    clearStore(store, (event as CustomEvent<{ sessionPresence?: string }>).detail?.sessionPresence !== "absent");
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

function getBrowserStore(bootstrap = EMPTY_SNAPSHOT): HeaderIdentityStore | null {
  if (typeof window === "undefined") return null;
  if (boundWindow !== window) {
    browserStore = null;
    sessionListenersInstalled = false;
    boundWindow = window;
  }
  if (!browserStore) browserStore = createStore(bootstrap);
  ensureSessionBindings();
  return browserStore;
}

function subscribe(bootstrap: HeaderIdentitySnapshot, onStoreChange: () => void): () => void {
  const store = getBrowserStore(bootstrap);
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
 * Display only — never auth proof. SSR reads only its request-owned context.
 */
export function useHeaderIdentity(_pathname?: string): HeaderIdentitySnapshot {
  const bootstrap = useContext(HeaderBootstrap);
  const listen = useCallback((listener: () => void) => subscribe(bootstrap, listener), [bootstrap]);
  const snapshot = useCallback(() => getBrowserStore(bootstrap)?.snapshot ?? bootstrap, [bootstrap]);
  const serverSnapshot = useCallback(() => bootstrap, [bootstrap]);
  return useSyncExternalStore(listen, snapshot, serverSnapshot);
}
