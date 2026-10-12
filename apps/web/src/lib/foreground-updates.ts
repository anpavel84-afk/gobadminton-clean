import type { ApiResult } from "./api-client";

type Cycle = { signal: AbortSignal; resume: boolean };
type Entry = {
  load: (cycle: Cycle) => Promise<ApiResult<unknown>>;
  listeners: Set<(result: ApiResult<unknown>) => void>;
  resume: boolean; interval: number; due: number; failures: number; busy: boolean; dirty: boolean;
  retryUntil?: number; controller?: AbortController; cached?: ApiResult<unknown>; inbox: boolean;
};

/** One document owner. Timers, retries and cache publication never belong to components. */
export class ForegroundUpdates {
  private entries = new Map<string, Entry>();
  private actor = "";
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private active = () => document.visibilityState !== "hidden" && navigator.onLine !== false) {}

  get hasSession() { return !!this.actor; }
  get currentGeneration() { return this.generation; }
  session(actor: string) {
    if (this.actor === actor) return;
    this.clear(); this.actor = actor;
  }
  clear() {
    ++this.generation;
    clearTimeout(this.timer);
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      for (const listener of entry.listeners) listener({ ok: false, status: 401, error: "Требуется вход" });
    }
    this.entries.clear(); this.actor = "";
  }
  subscribe<T>(key: string, interval: number, load: (cycle: Cycle) => Promise<ApiResult<T>>, listener: (result: ApiResult<T>) => void, inbox = false) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { load, interval, listeners: new Set(), resume: false, due: 0, failures: 0, busy: false, dirty: false, inbox };
      this.entries.set(key, entry);
    }
    const receive = listener as (result: ApiResult<unknown>) => void;
    entry.listeners.add(receive);
    if (entry.cached) receive(entry.cached);
    this.schedule();
    return () => {
      entry.listeners.delete(receive);
      if (!entry.listeners.size) { entry.controller?.abort(); if (this.entries.get(key) === entry) this.entries.delete(key); }
      this.schedule();
    };
  }
  invalidate(prefix = "") {
    for (const [key, entry] of this.entries) if (key.startsWith(prefix)) {
      // Respect server Retry-After even for focus or command invalidation.
      if ((entry.retryUntil ?? 0) > Date.now()) continue;
      if (entry.busy) entry.dirty = true; else entry.due = 0;
    }
    this.schedule();
  }
  foreground() {
    for (const entry of this.entries.values()) {
      entry.resume = true;
      if (!this.active()) { entry.controller?.abort(); continue; }
      if ((entry.retryUntil ?? 0) > Date.now()) continue;
      if (entry.busy) entry.dirty = true; else entry.due = 0;
    }
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.active()) return;
    const inbox = [...this.entries.values()].some(e => e.inbox);
    const pending = [...this.entries].filter(([key, e]) => !e.busy && !(key === "counts" && inbox));
    if (!pending.length) return;
    const delay = Math.max(0, Math.min(...pending.map(([, e]) => e.due)) - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }
  private tick() {
    if (!this.active()) return;
    const inbox = [...this.entries.values()].some(e => e.inbox);
    for (const [key, e] of this.entries) if (!e.busy && e.due <= Date.now() && !(key === "counts" && inbox)) void this.run(key, e);
    this.schedule();
  }
  private async run(key: string, entry: Entry) {
    entry.busy = true;
    const resume = entry.resume; entry.resume = false;
    const generation = this.generation, controller = new AbortController(); entry.controller = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<ApiResult<unknown>>(resolve => {
      controller.signal.addEventListener("abort", () => { clearTimeout(timeout); resolve({ ok: false, status: 0, error: "Не удалось обновить данные" }); }, { once: true });
      timeout = setTimeout(() => controller.abort(), 10000);
    });
    const result: ApiResult<unknown> = await Promise.race([entry.load({ signal: controller.signal, resume }).catch(() => ({ ok: false as const, status: 0, error: "Не удалось обновить данные" })), expired]);
    clearTimeout(timeout);
    if (generation !== this.generation || this.entries.get(key) !== entry) return;
    entry.busy = false;
    if (!result.ok && result.status === 499) { entry.due = 0; this.schedule(); return; }
    if (!result.ok && result.status === 401) { this.clear(); if (typeof window !== "undefined") window.dispatchEvent(new Event("gb-private-expired")); return; }
    entry.cached = result;
    if (result.ok) entry.failures = 0; else ++entry.failures;
    const retry = !result.ok && result.retryAfterSeconds !== undefined ? result.retryAfterSeconds * 1000 : Math.min(30000, 3000 * 2 ** Math.min(entry.failures - 1, 4)) * (1 + Math.random() * .1);
    entry.retryUntil = !result.ok && result.status === 429 ? Date.now() + retry : undefined;
    entry.due = Date.now() + (result.ok ? entry.dirty ? 0 : entry.interval : retry);
    entry.dirty = false;
    for (const listener of entry.listeners) listener(result);
    this.schedule();
  }
  publish<T>(key: string, data: T) {
    const entry = this.entries.get(key);
    if (!entry) return;
    const result: ApiResult<T> = { ok: true, status: 200, data };
    entry.cached = result;
    for (const listener of entry.listeners) listener(result);
  }
}

export const foregroundUpdates = new ForegroundUpdates();
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => foregroundUpdates.foreground());
  window.addEventListener("focus", () => foregroundUpdates.foreground());
  window.addEventListener("online", () => foregroundUpdates.foreground());
  window.addEventListener("offline", () => foregroundUpdates.foreground());
  window.addEventListener("gb-inbox-changed", () => { foregroundUpdates.invalidate("inbox:"); foregroundUpdates.invalidate("counts"); });
  window.addEventListener("gb-session-changed", () => foregroundUpdates.clear());
}

export const privateActor = (me: { id: string; csrfToken: string }) => `${me.id}:${me.csrfToken}`;
