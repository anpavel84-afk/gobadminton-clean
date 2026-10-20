import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ memo: undefined as { deps: unknown[]; value: unknown } | undefined }));
vi.mock("react", async original => ({ ...await original<typeof React>(), useEffect(fn: () => void) { fn(); }, useMemo(fn: () => unknown, deps: unknown[]) {
  if (!h.memo || deps.some((v, i) => v !== h.memo?.deps[i])) h.memo = { deps, value: fn() };
  return h.memo.value;
} }));
import { SelectedVenueCover, useSelectedVenueCover } from "../src/components/consumer/venues/SelectedVenueCover";
import { VenueCover } from "../src/components/consumer/venues/VenueCover";
import type { VenueSummary } from "../src/lib/consumer-types";
const url = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const court = "/discovery/badminton-courts.jpg";
class ImageNode {
  parentNode: Slot | null = null; loading = ""; decoding = ""; alt = "";
  value: string | null = null; writes: string[] = [];
  listeners = new Map<string, Set<() => void>>();
  set src(value: string) { expect(this.loading).toBe("eager"); expect(this.decoding).toBe("async"); this.value = value; this.writes.push(value); }
  addEventListener(type: string, fn: () => void) { const list = this.listeners.get(type) ?? new Set(); list.add(fn); this.listeners.set(type, list); }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  removeAttribute(key: string) { expect(key).toBe("src"); this.value = null; }
  remove() { if (this.parentNode) this.parentNode.child = null; this.parentNode = null; }
  saved(type: string) { const fn = [...this.listeners.get(type) ?? []][0]; if (!fn) throw new Error("Missing listener"); return fn; }
}
class Slot {
  dataset: Record<string, string> = {}; child: ImageNode | null = null;
  appendChild(node: ImageNode) { node.remove(); this.child = node; node.parentNode = this; }
}
const nodes: ImageNode[] = [];
function span(slot: Slot) { return slot as unknown as HTMLSpanElement; }
function resource(id = "a", uploadedUrl: string | null = url, cityId = "city", name = "Зал") {
  return useSelectedVenueCover(cityId, { id, name, cover: { uploadedUrl } } as VenueSummary);
}
function image(slot: Slot) { if (!slot.child) throw new Error("Missing image"); return slot.child; }
beforeEach(() => { h.memo = undefined; nodes.length = 0; vi.stubGlobal("document", { createElement: vi.fn((tag: string) => { expect(tag).toBe("img"); const node = new ImageNode(); nodes.push(node); return node; }) }); });
afterEach(() => vi.unstubAllGlobals());
it.each([null, "invalid", "https://evil.invalid/photo.png", url])("normalizes %s, preserves metadata and only selected covers are eager", value => {
  const r = resource("a", value); expect(nodes).toHaveLength(0);
  const compact = new Slot(); r.compact(span(compact)); const node = image(compact);
  expect(node.value).toBe(value === url ? url : court);
  expect(node.alt).toBe(value === url ? "Обложка: Зал" : "Бадминтонный корт");
  expect(compact.dataset).toEqual(value === url ? { cover: "uploaded" } : { cover: "default", fallback: "court" });
  expect(renderToStaticMarkup(<VenueCover />)).toContain('loading="lazy"');
  expect(SelectedVenueCover({ resource: r, mode: "compact", className: "gb-venue-preview-cover" }).props.children).toBeUndefined();
  r.compact(null);
});
it("moves one loaded node through stable commit refs without assigning src again", () => {
  const r = resource(); const compact = new Slot(); const full = new Slot(); r.compact(span(compact));
  const node = image(compact); node.saved("load")();
  expect(resource()).toBe(r);
  for (let i = 0; i < 2; i++) {
    r.info(span(full)); expect(image(full)).toBe(node); expect(compact.child).toBeNull();
    r.info(null); expect(image(compact)).toBe(node);
  }
  expect(nodes).toHaveLength(1); expect(node.writes).toEqual([url]); r.compact(null);
  expect(node.value).toBeNull(); expect([...node.listeners.values()].flatMap(set => [...set])).toEqual([]);
});
it("refreshes the name without replacing the resource, refs, image or source", () => {
  const r = resource(); const compact = new Slot(); const full = new Slot();
  r.compact(span(compact)); const node = image(compact); node.saved("load")();
  const refreshed = resource("a", url, "city", "Новое название");
  expect(refreshed).toBe(r);
  expect(refreshed.compact).toBe(r.compact); expect(refreshed.info).toBe(r.info);
  expect(node.alt).toBe("Обложка: Новое название");
  refreshed.info(span(full)); expect(image(full)).toBe(node);
  refreshed.info(null); expect(image(compact)).toBe(node);
  expect(nodes).toHaveLength(1); expect(node.writes).toEqual([url]);
  refreshed.compact(null);
});
it.each(["same-url", "different-url", "same-venue", "city"])("invalidates %s and ignores saved callbacks after change/cleanup", change => {
  const old = resource(); const slot = new Slot(); old.compact(span(slot)); const node = image(slot);
  const load = node.saved("load"); const error = node.saved("error");
  const next = resource(change === "same-venue" || change === "city" ? "a" : "b", change === "same-url" || change === "city" ? url : url.replace("a".repeat(64), "b".repeat(64)), change === "city" ? "other" : "city");
  old.compact(null); next.compact(span(slot)); const current = image(slot);
  load(); error(); expect(image(slot)).toBe(current); expect(node.value).toBeNull(); expect(current.writes).toHaveLength(1);
  next.compact(null); load(); error(); expect(current.value).toBeNull();
});
it("falls back once, ignores old source events, and safely registers after final detach", () => {
  const r = resource(); const compact = new Slot(); const full = new Slot(); r.compact(span(compact));
  const node = image(compact); const error = node.saved("error"); const load = node.saved("load");
  r.info(span(full)); error(); error(); load(); node.saved("error")();
  expect(node.writes).toEqual([url, court]); expect(full.dataset).toEqual({ cover: "default", fallback: "court" });
  r.info(null); expect(image(compact)).toBe(node); expect(compact.dataset.fallback).toBe("court");
  const fallbackError = node.saved("error"); r.compact(null); r.compact(span(compact));
  const fresh = image(compact); error(); fallbackError(); load(); expect(fresh.writes).toEqual([court]); expect(node.value).toBeNull(); r.compact(null);
});
it("default error never retries", () => {
  const r = resource("a", null); const slot = new Slot(); r.compact(span(slot)); const node = image(slot);
  node.saved("error")(); node.saved("error")(); expect(node.writes).toEqual([court]); r.compact(null);
});
