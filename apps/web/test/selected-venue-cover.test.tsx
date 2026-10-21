import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ slots: [] as { deps: readonly unknown[]; value: unknown }[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  useMemo(factory: () => unknown, deps: readonly unknown[]) {
    const i = hooks.cursor++; const previous = hooks.slots[i];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) hooks.slots[i] = { deps, value: factory() };
    return hooks.slots[i]?.value;
  },
  useEffect(effect: () => void) { hooks.effects.push(effect); },
}));
import { SelectedVenueCover, useSelectedVenueCover } from "../src/components/consumer/venues/SelectedVenueCover";
class Slot {
  dataset: Record<string, string> = {};
  children: Photo[] = [];
  appendChild(photo: Photo) { photo.remove(); this.children.push(photo); photo.parentNode = this; }
}
class Photo extends EventTarget {
  parentNode: Slot | null = null;
  loading = ""; decoding = ""; alt = "";
  sources: string[] = []; settings: string[][] = [];
  listeners = new Set<EventListenerOrEventListenerObject>();
  saved: EventListenerOrEventListenerObject[] = [];
  set src(value: string) { this.sources.push(value); this.settings.push([this.loading, this.decoding]); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null; }
  removeAttribute = vi.fn();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) { if (listener) { this.listeners.add(listener); this.saved.push(listener); } super.addEventListener(type, listener); }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) { if (listener) this.listeners.delete(listener); super.removeEventListener(type, listener); }
}
const uploadedUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const court = "/discovery/badminton-courts.jpg";
let photos: Photo[] = [];
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; photos = [];
  vi.stubGlobal("document", { createElement: vi.fn((tag: string) => { expect(tag).toBe("img"); const photo = new Photo(); photos.push(photo); return photo; }) });
});
afterEach(() => vi.unstubAllGlobals());
function render(city = "city", id = "venue", url: string | null = uploadedUrl, name = "Зал") {
  hooks.cursor = 0;
  return useSelectedVenueCover(city, { id, name, cover: { uploadedUrl: url } });
}
function commit() { hooks.effects.splice(0).forEach(effect => effect()); }
function attach(resource: ReturnType<typeof render>, position: "compact" | "info", slot: Slot | null) { resource[position](slot as unknown as HTMLSpanElement | null); }
function photoAt(index = 0) { const photo = photos[index]; if (!photo) throw new Error("Missing photo"); return photo; }
function stale(photo: Photo) { for (const listener of photo.saved) { if (typeof listener === "function") listener.call(photo, new Event("error")); else listener.handleEvent(new Event("error")); } }
it.each([null, "invalid", "https://external.invalid/image.png", uploadedUrl])("commits eager/async before source and preserves media classes: %s", url => {
  const resource = render("city", "venue", url); expect(photos).toHaveLength(0);
  const compact = new Slot(); attach(resource, "compact", compact); commit();
  const photo = photoAt(); expect(photo.settings).toEqual([["eager", "async"]]);
  expect(photo.sources).toEqual([url === uploadedUrl ? uploadedUrl : court]);
  expect(photo.alt).toBe(url === uploadedUrl ? "Обложка: Зал" : "Бадминтонный корт");
  expect(compact.dataset).toEqual(url === uploadedUrl ? { cover: "uploaded" } : { cover: "default", fallback: "court" });
  expect(SelectedVenueCover({ slotRef: resource.compact, position: "compact" }).props.className).toBe("gb-venue-cover gb-venue-preview-cover");
  expect(SelectedVenueCover({ slotRef: resource.info, position: "info" }).props.className).toBe("gb-venue-cover gb-venue-sheet-cover");
  attach(resource, "compact", null);
});
it.each([false, true])("load/cold → open → close → open moves one resource; rename changes only alt (%s)", loaded => {
  const resource = render(); const compact = new Slot(); const info = new Slot();
  attach(resource, "compact", compact); commit(); const photo = photoAt();
  if (loaded) photo.dispatchEvent(new Event("load"));
  attach(resource, "info", info); expect(photo.parentNode).toBe(info);
  attach(resource, "info", null); expect(photo.parentNode).toBe(compact);
  attach(resource, "info", info); expect(photo.parentNode).toBe(info);
  expect(render("city", "venue", uploadedUrl, "Новое имя")).toBe(resource); commit();
  expect(photo.alt).toBe("Обложка: Новое имя"); expect(photos).toHaveLength(1); expect(photo.sources).toEqual([uploadedUrl]);
  attach(resource, "info", null); attach(resource, "compact", null);
});
it.each(["compact", "info"] as const)("falls back once in %s; ignores saved events after fallback and cleanup", position => {
  const resource = render(); const compact = new Slot(); const info = new Slot(); attach(resource, "compact", compact); commit();
  if (position === "info") attach(resource, "info", info);
  const photo = photoAt(); photo.dispatchEvent(new Event("error"));
  expect(photo.sources).toEqual([uploadedUrl, court]); expect(photo.alt).toBe("Бадминтонный корт");
  expect((position === "info" ? info : compact).dataset).toEqual({ cover: "default", fallback: "court" });
  stale(photo); photo.dispatchEvent(new Event("error")); expect(photo.sources).toHaveLength(2);
  attach(resource, "info", null); attach(resource, "compact", null);
  expect(photo.parentNode).toBeNull(); expect(photo.listeners.size).toBe(0); expect(photo.removeAttribute).toHaveBeenCalledWith("src");
  stale(photo); expect(photo.sources).toHaveLength(2);
  attach(resource, "compact", compact); commit(); expect(photos).toHaveLength(2); expect(photoAt(1).sources).toEqual([uploadedUrl]);
  attach(resource, "compact", null);
});
it.each([["other", "venue", uploadedUrl], ["city", "other", uploadedUrl], ["city", "venue", `/v1/media/venue-covers/${"b".repeat(64)}.png`]])("replaces selection identity immediately and invalidates old events: %s/%s", (city, id, url) => {
  const resource = render(); const compact = new Slot(); attach(resource, "compact", compact); commit(); const old = photoAt();
  const next = render(city, id, url); expect(next).not.toBe(resource);
  attach(resource, "compact", null); expect(compact.children).toHaveLength(0);
  attach(next, "compact", compact); commit(); stale(old); old.dispatchEvent(new Event("load"));
  expect(old.sources).toEqual([uploadedUrl]); expect(photoAt(1).sources).toEqual([url]); expect(compact.children).toEqual([photoAt(1)]);
  attach(next, "compact", null);
});
