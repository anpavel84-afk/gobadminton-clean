import { Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type StateSlot = { value: unknown; setter: (next: unknown) => void };
type EffectSlot = { setup?: () => void | (() => void); deps: readonly unknown[] | undefined; cleanup?: () => void };
type Store = { slots: unknown[]; cursor: number; alive: boolean };
const runtime = vi.hoisted(() => ({ current: null as Store | null, dirty: false, queue: [] as (() => void)[] }));
function active() { if (!runtime.current) throw new Error("Hook outside component"); return runtime.current; }
function equalDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) {
  return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}
vi.mock("react", async original => {
  const actual = await original<typeof React>();
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const store = active(); const index = store.cursor++;
    const previous = store.slots[index] as EffectSlot | undefined;
    if (previous && equalDeps(previous.deps, deps)) return;
    const slot: EffectSlot = { deps, setup: callback }; store.slots[index] = slot;
    runtime.queue.push(() => {
      previous?.cleanup?.(); if (previous) previous.cleanup = undefined;
      if (store.alive) { const cleanup = callback(); if (cleanup) slot.cleanup = cleanup; }
    });
  };
  return { ...actual,
    useState(initial: unknown) {
      const store = active(); const index = store.cursor++;
      let slot = store.slots[index] as StateSlot | undefined;
      if (!slot) {
        slot = { value: typeof initial === "function" ? initial() : initial, setter: () => {} };
        const owned = slot;
        owned.setter = next => {
          const value = typeof next === "function" ? next(owned.value) : next;
          if (store.alive && !Object.is(value, owned.value)) { owned.value = value; runtime.dirty = true; }
        };
        store.slots[index] = owned;
      }
      return [slot.value, slot.setter];
    },
    useRef(initial: unknown) {
      const store = active(); const index = store.cursor++;
      return store.slots[index] ??= { current: initial };
    },
    useMemo(factory: () => unknown, deps?: readonly unknown[]) {
      const store = active(); const index = store.cursor++;
      const previous = store.slots[index] as { deps?: readonly unknown[]; value: unknown } | undefined;
      if (previous && equalDeps(previous.deps, deps)) return previous.value;
      const slot = { deps, value: factory() }; store.slots[index] = slot; return slot.value;
    },
    useEffect: effect, useLayoutEffect: effect,
    useId() { const store = active(); return `id-${store.cursor++}`; },
    useContext(context: { _currentValue: unknown }) { return context._currentValue; },
    useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => unknown) {
      const store = active(); const index = store.cursor++;
      const slot = store.slots[index] as { value: unknown; unsub?: () => void } | undefined;
      if (!slot) {
        const owned: { value: unknown; unsub?: () => void } = { value: getSnapshot() };
        owned.unsub = subscribe(() => {
          const next = getSnapshot();
          if (store.alive && !Object.is(owned.value, next)) { owned.value = next; runtime.dirty = true; }
        });
        store.slots[index] = owned;
        return owned.value;
      }
      slot.value = getSnapshot();
      return slot.value;
    },
  };
});

class Node extends EventTarget {
  parentNode: Node | null = null;
  children: Node[] = [];
  rendered: Node[] = [];
  props: Record<string, unknown> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style: Record<string, unknown> = {};
  className = ""; textContent = ""; alt = ""; loading = ""; decoding = "";
  /** HTMLImageElement default is draggable; gallery morph must clear it before src. */
  draggable = true;
  srcWrites: string[] = []; source = ""; captured = new Set<number>();
  complete = false; naturalWidth = 0;
  constructor(readonly tag = "div") { super(); }
  set src(value: string) {
    expect(this.loading).toBe("eager");
    expect(this.decoding).toBe("async");
    expect(this.draggable).toBe(false);
    this.srcWrites.push(value); this.source = value; this.attributes.set("src", value);
  }
  get src() { return this.source; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); if (key === "src") this.source = ""; }
  appendChild(child: Node) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
  append(...nodes: Node[]) { nodes.forEach(node => this.appendChild(node)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  replaceChildren() { this.children.forEach(node => { node.parentNode = null; }); this.children = []; }
  get parentElement() { return this.parentNode; }
  get isConnected(): boolean { return this === body || !!this.parentNode?.isConnected; }
  focus() { dom.activeElement = this; }
  contains(node: unknown): boolean { return node === this || [...this.children, ...this.rendered].some(child => child.contains(node)); }
  matches(selector: string): boolean {
    return selector.split(",").some((part): boolean => {
      const value = part.trim();
      if (value === "[hidden]") return !!this.props.hidden;
      if (value.includes("[role=dialog]")) return this.props.role === "dialog";
      if (value.startsWith("dialog")) return this.tag === "dialog" && !!this.props.open;
      if (value.includes(" ")) { const pieces = value.split(" "); const last = pieces.pop(); return !!last && this.matches(last) && !!this.parentNode?.closest(pieces.join(" ")); }
      if (value.startsWith(".")) return this.className.split(" ").includes(value.slice(1));
      if (value.startsWith("button")) return this.tag === "button" && !this.props.disabled;
      if (value === "a[href]") return this.tag === "a" && !!this.props.href;
      if (value === '[tabindex="0"]') return this.props.tabIndex === 0;
      return false;
    });
  }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
  querySelectorAll(selector: string): Node[] { return [...new Set([...this.children, ...this.rendered])].flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { width: 400, height: this.className.includes("full-measure") ? 700 : this.className.includes("compact-measure") ? 172 : 400, top: 0 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
const body = new Node("body");
const created: Node[] = [];
const dom = Object.assign(new EventTarget(), { body, activeElement: null as Node | null, visibilityState: "visible",
  createElement(tag: string) { const node = new Node(tag); created.push(node); return node; },
  createElementNS(_namespace: string, tag: string) { return new Node(tag); },
  querySelector: (selector: string) => body.querySelector(selector),
});
function assignRef(ref: unknown, node: Node | null) {
  if (typeof ref === "function") ref(node);
  else if (ref && typeof ref === "object" && "current" in ref) ref.current = node;
}
const componentIds = new WeakMap<object, number>();
let componentSequence = 0;
class Renderer {
  stores = new Map<string, Store>();
  hosts = new Map<string, { node: Node; ref: unknown }>();
  tree: Node[] = [];
  constructor(public root: () => ReactNode) {}
  render() {
    let rounds = 0;
    do {
      if (++rounds > 20) throw new Error("Exceeded 20 settle renders");
      runtime.dirty = false;
      const seen = new Set<string>(); const next = new Map<string, { node: Node; ref: unknown }>();
      let count = 0;
      const walk = (value: ReactNode, path: string, depth: number): Node[] => {
        if (++count > 10000 || depth > 128) throw new Error("Render traversal limit");
        if (Array.isArray(value)) return value.flatMap((child, index) => walk(child, `${path}.${index}`, depth + 1));
        if (!isValidElement<Record<string, unknown>>(value)) {
          if (typeof value === "string" || typeof value === "number") { const node = new Node("text"); node.textContent = String(value); return [node]; }
          return [];
        }
        let typeId = 0;
        if (typeof value.type === "function") {
          typeId = componentIds.get(value.type) ?? ++componentSequence; componentIds.set(value.type, typeId);
        }
        const key = `${path}:${typeId}:${String(value.key ?? "")}`;
        if (value.type === Fragment) return walk(value.props.children as ReactNode, `${key}.fragment`, depth + 1);
        if (typeof value.type === "function") {
          let store = this.stores.get(key);
          if (!store) { store = { slots: [], cursor: 0, alive: true }; this.stores.set(key, store); }
          seen.add(key); store.cursor = 0; runtime.current = store;
          const output = (value.type as (props: Record<string, unknown>) => ReactNode)(value.props);
          runtime.current = null;
          return walk(output, `${key}.output`, depth + 1);
        }
        if (typeof value.type !== "string") throw new Error(`Unsupported element ${String(value.type)}`);
        const node = this.hosts.get(key)?.node ?? new Node(value.type);
        node.props = value.props; node.className = String(value.props.className ?? "");
        // Preserve imperative slot styles (SelectedVenueCover resource paint) when React omits style.
        if (value.props.style) node.style = { ...(value.props.style as Record<string, unknown>) };
        node.rendered = walk(value.props.children as ReactNode, `${key}.children`, depth + 1);
        node.rendered.forEach(child => { child.parentNode = node; });
        next.set(key, { node, ref: value.props.ref }); return [node];
      };
      this.tree = walk(this.root(), "root", 0);
      for (const [key, host] of this.hosts) if (next.get(key)?.ref !== host.ref || !next.has(key)) assignRef(host.ref, null);
      for (const [key, store] of this.stores) if (!seen.has(key)) {
        store.alive = false;
        for (const value of store.slots) { const slot = value as EffectSlot | undefined; if (slot?.cleanup) { slot.cleanup(); slot.cleanup = undefined; } }
        this.stores.delete(key);
      }
      body.rendered = this.tree; this.tree.forEach(node => { node.parentNode = body; });
      for (const [key, host] of next) if (!this.hosts.has(key) || this.hosts.get(key)?.ref !== host.ref) assignRef(host.ref, host.node);
      for (const [key, host] of this.hosts) if (!next.has(key)) host.node.parentNode = null;
      this.hosts = next;
      runtime.queue.splice(0).forEach(effect => effect());
    } while (runtime.dirty);
  }
  replayRefs() {
    for (const host of this.hosts.values()) {
      assignRef(host.ref, null);
      assignRef(host.ref, host.node);
    }
  }
  replayEffects() {
    for (const store of this.stores.values()) for (const value of store.slots) {
      const slot = value as EffectSlot | undefined;
      if (!slot?.setup) continue;
      slot.cleanup?.(); slot.cleanup = undefined;
      const cleanup = slot.setup();
      if (cleanup) slot.cleanup = cleanup;
    }
  }
  unmount() { this.root = () => null; this.render(); }
  nodes() { return [...this.hosts.values()].map(host => host.node); }
  find(label: string) {
    const node = this.nodes().find(item => item.props["aria-label"] === label || text(item) === label);
    if (!node) throw new Error(`Missing control: ${label}`); return node;
  }
}
function text(node: Node): string { return node.textContent + node.rendered.map(text).join(""); }
const renderers: Renderer[] = [];
function mount(root: () => ReactNode) { const renderer = new Renderer(root); renderers.push(renderer); renderer.render(); return renderer; }
beforeEach(() => {
  runtime.current = null; runtime.dirty = false; runtime.queue = []; created.length = 0; body.rendered = []; body.style = {}; dom.activeElement = null;
  vi.stubGlobal("document", dom); vi.stubGlobal("HTMLElement", Node);
  // VenueGallery adjacent prefetch uses global Image (not DOM img — avoids eager assert / created counter).
  class PrefetchImage { src = ""; decoding = ""; }
  vi.stubGlobal("Image", PrefetchImage);
});
afterEach(async () => { renderers.splice(0).forEach(renderer => renderer.unmount()); await Promise.resolve(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

import { SelectedVenueCover, useSelectedVenueCover } from "../src/components/consumer/venues/SelectedVenueCover";
import { VenueGallery } from "../src/components/consumer/venues/VenueGallery";
import { venueMediaSkeletonStyle } from "../src/lib/venue-illustration";
import { useEffect, useMemo, useState } from "react";
const uploaded = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const uploadedB = `/v1/media/venue-covers/${"b".repeat(64)}.png`;
let city = "city"; let venue = { id: "venue", name: "Зал", cover: { uploadedUrl: uploaded as string | null } };
let info = false;
let resource: ReturnType<typeof useSelectedVenueCover>;
function Selected() {
  resource = useSelectedVenueCover(city, venue);
  return <><SelectedVenueCover slotRef={resource.compact} className="gb-venue-preview-cover" />{info && <SelectedVenueCover slotRef={resource.info} className="gb-venue-sheet-cover" />}</>;
}
function imageAt(index = 0) { const node = created.filter(node => node.tag === "img")[index]; if (!node) throw new Error("Missing image"); return node; }
function expectPendingSkeleton(slot: Node | null | undefined, pending: "uploaded" | "fallback") {
  if (!slot) throw new Error("Missing slot");
  expect(slot.dataset.pending).toBe(pending);
  expect(slot.dataset.cover).toBe("default");
  const skeleton = venueMediaSkeletonStyle();
  expect(String(slot.style.backgroundImage)).toContain("linear-gradient");
  expect(String(slot.style.backgroundSize)).toBe(String(skeleton.backgroundSize));
  expect(String(slot.style.backgroundImage)).not.toContain("data:image/svg+xml");
  expect(String(slot.style.backgroundImage)).not.toContain("/discovery/venue-illustrations/");
}
function expectReadyNeutral(slot: Node | null | undefined, cover: "uploaded" | "default") {
  if (!slot) throw new Error("Missing slot");
  expect(slot.dataset.pending).toBeUndefined();
  expect(slot.dataset.cover).toBe(cover);
  expect(slot.style.backgroundImage).toBe("none");
  expect(slot.style.backgroundColor).toBe("var(--c23-surface)");
}
function expectFailedOrEmpty(slot: Node | null | undefined, state: "error" | "empty") {
  if (!slot) throw new Error("Missing slot");
  expect(slot.dataset.state).toBe(state);
  expect(slot.dataset.pending).toBeUndefined();
  expect(String(slot.style.backgroundImage)).toBe("none");
  expect(String(slot.style.backgroundImage)).not.toContain("data:image/svg+xml");
}
beforeEach(() => { city = "city"; venue = { id: "venue", name: "Зал", cover: { uploadedUrl: uploaded } }; info = false; });
it("creates eager/async before src and moves the same image through load/open/close/open/name refresh", () => {
  const renderer = mount(() => <Selected />); const image = imageAt();
  expect(image.draggable).toBe(false);
  expect(image.srcWrites).toEqual([uploaded]); expect(image.alt).toBe("Обложка: Зал");
  expect(image.parentNode?.className).toBe("gb-venue-cover gb-venue-preview-cover");
  expectPendingSkeleton(image.parentNode, "uploaded");
  expect(image.style.opacity).toBe("0");
  image.dispatchEvent(new Event("load"));
  expectReadyNeutral(image.parentNode, "uploaded");
  expect(image.style.opacity).toBe("");
  info = true; renderer.render(); expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  info = false; renderer.render(); expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  info = true; renderer.render(); venue = { ...venue, name: "Новое имя" }; renderer.render();
  expect(image.alt).toBe("Обложка: Новое имя"); expect(image.srcWrites).toEqual([uploaded]);
  expect(created.filter(node => node.tag === "img")).toEqual([image]);
});
it("initializes the same image from the info slot without a compact preview", async () => {
  function InfoOnly() {
    resource = useSelectedVenueCover(city, venue);
    return <SelectedVenueCover slotRef={resource.info} className="gb-venue-sheet-cover" />;
  }
  const renderer = mount(() => <InfoOnly />);
  const image = imageAt();
  expect(image.srcWrites).toEqual([uploaded]);
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  expectPendingSkeleton(image.parentNode, "uploaded");
  venue = { ...venue, cover: { uploadedUrl: null } };
  // Identity change via city/venue/url remounts resource; info-only null cover is genuine no-media.
  renderer.unmount();
  await Promise.resolve();
  venue = { id: "venue", name: "Зал", cover: { uploadedUrl: null } };
  mount(() => <InfoOnly />);
  const empty = imageAt(1);
  expect(empty.srcWrites).toEqual([]);
  expectFailedOrEmpty(empty.parentNode, "empty");
  expect(empty.style.opacity).toBe("0");
});
it.each([null, "invalid", "https://external.invalid/photo.png"])("uses neutral no-media for %s when venue id is present", value => {
  venue.cover.uploadedUrl = value; mount(() => <Selected />);
  const image = imageAt();
  expect(image.srcWrites).toEqual([]);
  expectFailedOrEmpty(image.parentNode, "empty");
  expect(image.style.opacity).toBe("0");
  expect(String(image.parentNode?.style.backgroundImage)).not.toContain("data:image/svg+xml");
});
it.each([false, true])("fails once in info=%s without illustration filler; rejects stale callbacks", async expanded => {
  info = expanded;
  const add = vi.spyOn(Node.prototype, "addEventListener"); const remove = vi.spyOn(Node.prototype, "removeEventListener");
  const renderer = mount(() => <Selected />); const image = imageAt();
  const stale = add.mock.calls.find(([type]) => type === "error")?.[1];
  const fireStale = () => { if (typeof stale === "function") stale.call(image, new Event("error")); };
  image.dispatchEvent(new Event("error")); fireStale(); image.dispatchEvent(new Event("error"));
  expect(image.srcWrites).toEqual([uploaded]);
  expect(resource.fallback).toBe(true);
  expectFailedOrEmpty(image.parentNode, "error");
  expect(image.style.opacity).toBe("0");
  renderer.unmount(); await Promise.resolve(); fireStale(); image.dispatchEvent(new Event("load")); image.dispatchEvent(new Event("error"));
  expect(image.src).toBe(""); expect(image.parentNode).toBeNull(); expect(image.srcWrites).toEqual([uploaded]);
  // One error + one load for the initial listen generation, then dispose (no illustration second pass).
  expect(remove.mock.calls.filter(([type]) => type === "error")).toHaveLength(1);
  expect(remove.mock.calls.filter(([type]) => type === "load")).toHaveLength(1);
});
it.each(["city", "venue", "url"])("invalidates %s identity, including identical URLs", async identity => {
  const add = vi.spyOn(Node.prototype, "addEventListener");
  const renderer = mount(() => <Selected />); const old = imageAt();
  const stale = add.mock.calls.find(([type]) => type === "error")?.[1];
  if (identity === "city") city = "other";
  if (identity === "venue") venue = { ...venue, id: "other" };
  if (identity === "url") venue = { ...venue, cover: { uploadedUrl: uploaded.replace("a".repeat(64), "b".repeat(64)) } };
  renderer.render();
  expect(old.parentNode).toBeNull();
  if (typeof stale === "function") stale.call(old, new Event("error"));
  await Promise.resolve();
  expect(old.parentNode).toBeNull(); expect(old.src).toBe("");
  if (typeof stale === "function") stale.call(old, new Event("error"));
  old.dispatchEvent(new Event("load")); old.dispatchEvent(new Event("error"));
  expect(imageAt(1).srcWrites).toEqual([venue.cover.uploadedUrl]);
  expectPendingSkeleton(imageAt(1).parentNode, "uploaded");
  imageAt(1).dispatchEvent(new Event("load"));
  expect(imageAt(1).parentNode?.dataset.cover).toBe("uploaded");
});
it("repeated refs are safe, info detaches to compact, final null removes src and listeners", async () => {
  const renderer = mount(() => <Selected />); const image = imageAt(); const compact = image.parentNode;
  resource.compact(compact as unknown as HTMLSpanElement); resource.info(null); resource.info(null);
  expect(image.srcWrites).toEqual([uploaded]); expect(image.parentNode).toBe(compact);
  resource.compact(null); resource.compact(null); await Promise.resolve(); expect(image.parentNode).toBeNull(); expect(image.src).toBe(""); renderer.unmount();
});
it("harness isolates stores, initializes once, stabilizes setters, applies functional updates and dependency length", () => {
  const init = vi.fn(() => 1); const cleanup = vi.fn(); const effects = vi.fn();
  const setters = new Map<string, React.Dispatch<React.SetStateAction<number>>>(); const values = new Map<string, number>();
  let deps: number[] = [1];
  function Counter({ id }: { id: string }) {
    const [value, setter] = useState(init); setters.set(id, setter); values.set(id, value);
    useMemo(() => value, deps); useEffect(() => { effects(); return cleanup; }, deps); return null;
  }
  const renderer = mount(() => <><Counter id="a" /><Counter id="b" /></>);
  const a = setters.get("a"); const b = setters.get("b"); if (!a || !b) throw new Error("Missing setters");
  a(current => current + 1); a(current => current + 1); b(9); renderer.render();
  expect(values).toEqual(new Map([["a", 3], ["b", 9]])); expect(init).toHaveBeenCalledTimes(2);
  expect(setters.get("a")).toBe(a); expect(setters.get("b")).toBe(b);
  runtime.dirty = false; a(3); expect(runtime.dirty).toBe(false);
  deps = [1, 2]; renderer.render(); expect(cleanup).toHaveBeenCalledTimes(2); expect(effects).toHaveBeenCalledTimes(4);
  renderer.unmount(); expect(cleanup).toHaveBeenCalledTimes(4);
});

it("keeps render free of DOM operations until refs commit", () => {
  const renderer = new Renderer(() => <Selected />);
  const create = vi.spyOn(dom, "createElement");
  const store: Store = { slots: [], cursor: 0, alive: true };
  runtime.current = store; Selected(); runtime.current = null;
  expect(create).not.toHaveBeenCalled();
  // This uncommitted render has no resource or listeners to release.
  runtime.queue = []; store.alive = false; renderer.unmount();
});

it("preserves one image/source across StrictMode ref and passive-effect replay", async () => {
  const renderer = mount(() => <Selected />);
  const image = imageAt();
  renderer.replayRefs();
  renderer.replayEffects();
  await Promise.resolve();
  expect(created.filter(node => node.tag === "img")).toEqual([image]);
  expect(image.srcWrites).toEqual([uploaded]);
  expect(image.src).toBe(uploaded);
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  image.dispatchEvent(new Event("error"));
  expect(image.srcWrites).toEqual([uploaded]);
  expect(resource.fallback).toBe(true);
  expectFailedOrEmpty(image.parentNode, "error");
  info = true; renderer.render(); renderer.replayRefs(); renderer.replayEffects();
  await Promise.resolve();
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  expect(image.srcWrites).toEqual([uploaded]);
  renderer.unmount();
  await Promise.resolve();
  expect(image.parentNode).toBeNull(); expect(image.src).toBe("");
});

it("pending skeleton before load, cache/load clear, failed/retry, compact↔info same img", () => {
  const renderer = mount(() => <Selected />);
  const image = imageAt();
  expectPendingSkeleton(image.parentNode, "uploaded");
  expect(image.style.opacity).toBe("0");
  // Cache-complete path: mark complete before synthetic load ownership via resource probe.
  image.complete = true;
  image.naturalWidth = 128;
  image.dispatchEvent(new Event("load"));
  expectReadyNeutral(image.parentNode, "uploaded");
  expect(image.srcWrites).toEqual([uploaded]);
  // Compact → info keeps the single physical img across the already-loaded paint.
  info = true;
  renderer.render();
  expect(created.filter(node => node.tag === "img")).toEqual([image]);
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  expectReadyNeutral(image.parentNode, "uploaded");
  expect(image.srcWrites).toEqual([uploaded]);
  // Photo error → terminal failed (no illustration filler); retry restores pending.
  image.complete = false;
  image.naturalWidth = 0;
  image.dispatchEvent(new Event("error"));
  renderer.render();
  expect(image.srcWrites).toEqual([uploaded]);
  expect(resource.fallback).toBe(true);
  expectFailedOrEmpty(image.parentNode, "error");
  resource.retry();
  renderer.render();
  expect(resource.fallback).toBe(false);
  expect(image.srcWrites).toEqual([uploaded, uploaded]);
  expectPendingSkeleton(image.parentNode, "uploaded");
  image.dispatchEvent(new Event("load"));
  expectReadyNeutral(image.parentNode, "uploaded");
});

it("morph gallery coverSlot owns pending underlay (frame excluded); empty-gallery bare slot too", () => {
  const galleryVenue = {
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Зал",
    cover: { uploadedUrl: uploaded, credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
    profile: {
      courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
      gallery: {
        coverage: "ordered" as const,
        items: [
          { id: "a0000000-0000-4000-8000-000000000011", url: uploaded, credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
        ],
      },
    },
  };
  venue = { id: galleryVenue.id, name: galleryVenue.name, cover: { uploadedUrl: uploaded } };
  function Morph() {
    resource = useSelectedVenueCover(city, venue);
    return <VenueGallery
      venue={galleryVenue}
      size="sheet"
      coverSlot={<SelectedVenueCover slotRef={resource.compact} className="gb-venue-sheet-cover" />}
      coverFallback={resource.fallback}
    />;
  }
  const morph = mount(() => <Morph />);
  const image = imageAt();
  expectPendingSkeleton(image.parentNode, "uploaded");
  const frame = morph.nodes().find(node => node.className === "gb-venue-gallery__frame");
  expect(frame?.props["data-pending"]).toBeUndefined();
  expect(frame?.style?.backgroundImage).toBeUndefined();
  expect(image.srcWrites).toEqual([uploaded]);
  image.dispatchEvent(new Event("load"));
  expectReadyNeutral(image.parentNode, "uploaded");

  morph.unmount();
  created.length = 0;
  const emptyVenue = {
    id: galleryVenue.id,
    name: "Зал",
    cover: { uploadedUrl: uploaded },
    profile: {
      courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
      gallery: { coverage: "ordered" as const, items: [] },
    },
  };
  function EmptyMorph() {
    resource = useSelectedVenueCover(city, venue);
    return <VenueGallery
      venue={emptyVenue}
      size="sheet"
      coverSlot={<SelectedVenueCover slotRef={resource.compact} className="gb-venue-sheet-cover" />}
      coverFallback={resource.fallback}
    />;
  }
  mount(() => <EmptyMorph />);
  const emptyImage = imageAt();
  expectPendingSkeleton(emptyImage.parentNode, "uploaded");
  expect(emptyImage.srcWrites).toEqual([uploaded]);
  expect(created.filter(node => node.tag === "img")).toEqual([emptyImage]);
});

it("F1: compact main error then expanded remount keeps morph failed state; non-main and new venue isolated", () => {
  const galleryVenue = {
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Зал",
    cover: { uploadedUrl: uploaded, credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
    profile: {
      courtCount: null, amenities: { parking: null, showers: null }, description: null, updatedAt: null,
      gallery: {
        coverage: "ordered" as const,
        items: [
          { id: "a0000000-0000-4000-8000-000000000011", url: uploaded, credit: { kind: "photo" as const, text: "Фото: Клуб", url: "https://club.example" } },
          { id: "a0000000-0000-4000-8000-000000000012", url: uploadedB, credit: { kind: "logo" as const, text: "Логотип: Клуб", url: "https://club.example/logo" } },
        ],
      },
    },
  };
  venue = { id: galleryVenue.id, name: galleryVenue.name, cover: { uploadedUrl: uploaded } };
  let expanded = false;
  let galleryIndex = 0;
  function MapSurfaces() {
    resource = useSelectedVenueCover(city, venue);
    const slot = expanded
      ? <SelectedVenueCover slotRef={resource.info} className="gb-venue-sheet-cover" />
      : <SelectedVenueCover slotRef={resource.compact} className="gb-venue-preview-cover" />;
    return <VenueGallery
      venue={galleryVenue}
      size={expanded ? "sheet" : "compact"}
      showCredit={expanded}
      coverSlot={slot}
      coverFallback={resource.fallback}
      onCoverRetry={resource.retry}
      index={galleryIndex}
    />;
  }
  const renderer = mount(() => <MapSurfaces />);
  const image = imageAt();
  expect(image.srcWrites).toEqual([uploaded]);
  expect(resource.fallback).toBe(false);
  // Capture-before-target: React frame capture fires before the shared resource error listener.
  const frame = renderer.nodes().find(node => node.className === "gb-venue-gallery__frame");
  if (!frame) throw new Error("Missing gallery frame");
  const onErrorCapture = frame.props.onErrorCapture as ((event: { target: Node }) => void) | undefined;
  if (!onErrorCapture) throw new Error("Missing onErrorCapture");
  onErrorCapture({ target: image });
  image.dispatchEvent(new Event("error"));
  renderer.render();
  expect(resource.fallback).toBe(true);
  expect(image.srcWrites).toEqual([uploaded]);
  expectFailedOrEmpty(image.parentNode, "error");
  // Expanded remount: new gallery instance reads shared failed; same morph node, honest error copy.
  expanded = true;
  renderer.render();
  expect(created.filter(node => node.tag === "img")).toEqual([image]);
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  expectFailedOrEmpty(image.parentNode, "error");
  expect(text(renderer.tree[0]!)).toContain("Не удалось загрузить фотографию");
  expect(text(renderer.tree[0]!)).toContain("Фотография временно недоступна");
  expect(text(renderer.tree[0]!)).not.toContain("Фото: Клуб");
  // Healthy non-main keeps its own credit even when main loan failed (after that photo loads).
  galleryIndex = 1;
  renderer.render();
  const nonMain = renderer.nodes().find((node) => node.tag === "img" && node.props.src === uploadedB);
  if (!nonMain) throw new Error("Missing non-main gallery img");
  (nonMain.props.onLoad as () => void)();
  renderer.render();
  expect(text(renderer.tree[0]!)).toContain("Логотип: Клуб");
  expect(text(renderer.tree[0]!)).not.toContain("Не удалось загрузить фотографию");
  // New venue resource does not inherit prior fallback.
  venue = { id: "a0000000-0000-4000-8000-000000000099", name: "Другой", cover: { uploadedUrl: uploaded } };
  galleryVenue.id = venue.id;
  galleryIndex = 0;
  renderer.render();
  expect(resource.fallback).toBe(false);
  // Morph owns pending paint; gallery must not invent ready photo credit for the new venue.
  expect(text(renderer.tree[0]!)).not.toContain("Фото: Клуб");
  expect(text(renderer.tree[0]!)).not.toContain("Не удалось загрузить фотографию");
});
