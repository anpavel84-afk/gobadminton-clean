"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CSSProperties, RefCallback } from "react";
import { venueMediaSkeletonStyle } from "../../../lib/venue-illustration";
import { venueCoverUrl } from "./VenueCover";

const court = "/discovery/badminton-courts.jpg";
type Position = "compact" | "info";

const NEUTRAL_READY_STYLE: CSSProperties = {
  backgroundImage: "none",
  backgroundColor: "var(--c23-surface)",
  backgroundSize: "",
  backgroundPosition: "",
  backgroundRepeat: "",
};

const EMPTY_STYLE: CSSProperties = {
  backgroundImage: "none",
  backgroundColor: "var(--gb-paper, #f5f6f2)",
  backgroundSize: "",
  backgroundPosition: "",
  backgroundRepeat: "",
};

/** A selected venue owns one image; slots only lend it a DOM parent. */
function createCover(url: string | null, initialName: string, venueId?: string) {
  const slots: Record<Position, HTMLSpanElement | null> = { compact: null, info: null };
  let image: HTMLImageElement | null = null;
  let name = initialName;
  /** True when the uploaded URL failed or there is no published media URL. */
  let failed = !url;
  /** Current raster src successfully decoded. */
  let loaded = false;
  /** Terminal decode failure for the current intended src. */
  let decodeError = false;
  let generation = 0;
  let detach: (() => void) | undefined;
  let releaseVersion = 0;
  const listeners = new Set<() => void>();
  const useCourtFallback = !venueId;
  const intendedSrc = () => (url ? url : (useCourtFallback ? court : null));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const getSnapshot = () => failed;
  const emit = () => { for (const listener of listeners) listener(); };
  const paint = () => {
    const src = intendedSrc();
    const uploadedPending = Boolean(url && !failed && !loaded);
    const courtPending = Boolean(!url && useCourtFallback && !failed && !loaded && !decodeError);
    const uploadedReady = Boolean(url && !failed && loaded);
    const courtReady = Boolean(!url && useCourtFallback && loaded && !decodeError);
    const noMedia = Boolean(!url && venueId);
    const showSkeleton = uploadedPending || courtPending;
    const underlay = showSkeleton ? venueMediaSkeletonStyle() : undefined;
    for (const slot of Object.values(slots)) {
      if (!slot) continue;
      slot.dataset.cover = uploadedReady ? "uploaded" : "default";
      if (uploadedReady) delete slot.dataset.fallback;
      else if (courtReady || courtPending) slot.dataset.fallback = "court";
      else delete slot.dataset.fallback;
      if (uploadedPending) slot.dataset.pending = "uploaded";
      else if (courtPending) slot.dataset.pending = "fallback";
      else delete slot.dataset.pending;
      if (failed && url) slot.dataset.state = "error";
      else if (noMedia) slot.dataset.state = "empty";
      else delete slot.dataset.state;
      if (underlay) Object.assign(slot.style, underlay);
      else if (uploadedReady || courtReady) Object.assign(slot.style, NEUTRAL_READY_STYLE);
      else Object.assign(slot.style, EMPTY_STYLE);
    }
    if (image) {
      if (!src || (failed && url) || noMedia) {
        image.style.opacity = "0";
        image.removeAttribute("alt");
      } else {
        image.alt = url ? `Обложка: ${name}` : "Бадминтонный корт";
        image.style.opacity = showSkeleton ? "0" : "";
      }
    }
  };
  const applyLoad = (current: HTMLImageElement, version: number) => {
    if (image !== current || version !== generation || (!slots.compact && !slots.info)) return;
    if (decodeError || (failed && url)) return;
    loaded = true;
    failed = false;
    paint();
  };
  const applyError = (current: HTMLImageElement, version: number) => {
    if (image !== current || version !== generation || (!slots.compact && !slots.info)) return;
    if (!url && useCourtFallback) {
      if (decodeError) return;
      decodeError = true;
      loaded = false;
      failed = true;
      paint();
      return;
    }
    // Uploaded photo failure — terminal failed/retry, never equipment or silent illustration fill.
    failed = true;
    loaded = false;
    decodeError = true;
    paint();
    emit();
  };
  const listen = (probeCache: boolean) => {
    if (!image) return;
    detach?.();
    const current = image;
    const version = ++generation;
    const onError = () => applyError(current, version);
    const onLoad = () => applyLoad(current, version);
    current.addEventListener("error", onError);
    current.addEventListener("load", onLoad);
    detach = () => {
      current.removeEventListener("error", onError);
      current.removeEventListener("load", onLoad);
    };
    // Reattach only: src already matches the intended resource.
    if (probeCache && current.complete && current.getAttribute("src")) {
      if (current.naturalWidth > 0) applyLoad(current, version);
      else applyError(current, version);
    }
  };
  const source = () => {
    const src = intendedSrc();
    if (!src) {
      detach?.();
      detach = undefined;
      if (image) {
        image.removeAttribute("src");
        image.style.opacity = "0";
      }
      paint();
      return;
    }
    // Attach listeners for this generation before writing src — do not probe the previous src.
    listen(false);
    if (!image) return;
    image.src = src;
    paint();
    if (!image.complete) return;
    if (image.naturalWidth > 0) applyLoad(image, generation);
    else if (image.getAttribute("src")) applyError(image, generation);
  };
  const retry = () => {
    if (!url) return;
    failed = false;
    loaded = false;
    decodeError = false;
    source();
    emit();
  };
  const dispose = () => {
    ++generation;
    detach?.(); detach = undefined;
    image?.remove();
    image?.removeAttribute("src");
    image = null;
  };
  // React 19 replays refs and passive effects synchronously. A microtask
  // distinguishes that replay from a final detach without a timer or reload.
  const release = () => {
    const version = ++releaseVersion;
    if (slots.compact || slots.info) return;
    ++generation;
    detach?.(); detach = undefined;
    image?.remove();
    queueMicrotask(() => {
      if (version === releaseVersion && !slots.compact && !slots.info) dispose();
    });
  };
  const retain = () => { ++releaseVersion; };
  const attach = (position: Position, node: HTMLSpanElement | null) => {
    slots[position] = node;
    const target = slots.info ?? slots.compact;
    if (!target) { release(); return; }
    retain();
    // Desktop opens the info slot without a compact preview; either slot may start loading.
    if (!image && (slots.compact || slots.info)) {
      image = document.createElement("img");
      image.loading = "eager";
      image.decoding = "async";
      paint();
      // Sticky uploaded failure waits for explicit retry(); no-media has no src.
      if (!(failed && url) && intendedSrc()) source();
      else paint();
    }
    if (image && !detach && intendedSrc() && !(failed && url)) listen(true);
    paint();
    if (image && image.parentNode !== target) target.appendChild(image);
  };
  const compact: RefCallback<HTMLSpanElement> = node => attach("compact", node);
  const info: RefCallback<HTMLSpanElement> = node => attach("info", node);
  return {
    compact,
    info,
    release,
    retain,
    retry,
    subscribe,
    getSnapshot,
    rename(value: string) { name = value; paint(); },
  };
}

export function useSelectedVenueCover(cityId: string, venue?: { id: string; name: string; cover?: { uploadedUrl: string | null } }) {
  const url = venueCoverUrl(venue?.cover?.uploadedUrl);
  const id = venue?.id;
  const resource = useMemo(() => createCover(url, venue?.name ?? "", id), [cityId, id, url]);
  useEffect(() => { resource.rename(venue?.name ?? ""); }, [resource, venue?.name]);
  useEffect(() => { resource.retain(); return () => resource.release(); }, [resource]);
  const fallback = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  return { ...resource, fallback };
}

/** Empty React-owned slot: the resource moves its image only during commit. */
export function SelectedVenueCover({ slotRef, className }: { slotRef: RefCallback<HTMLSpanElement>; className: string }) {
  return <span className={`gb-venue-cover ${className}`} ref={slotRef} />;
}
