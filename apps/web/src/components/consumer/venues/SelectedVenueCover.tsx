"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CSSProperties, RefCallback } from "react";
import {
  VENUE_ILLUSTRATION_ALT,
  venueEquipmentPlaceholderStyle,
  venueIllustrationUrl,
} from "../../../lib/venue-illustration";
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

/** A selected venue owns one image; slots only lend it a DOM parent. */
function createCover(url: string | null, initialName: string, venueId?: string) {
  const slots: Record<Position, HTMLSpanElement | null> = { compact: null, info: null };
  let image: HTMLImageElement | null = null;
  let name = initialName;
  let fallback = !url;
  /** Current raster src successfully decoded (uploaded or fallback). */
  let loaded = false;
  /** Fallback raster failed — keep SVG underlay; never claim loaded; hide broken img. */
  let fallbackError = false;
  let generation = 0;
  let detach: (() => void) | undefined;
  let releaseVersion = 0;
  const listeners = new Set<() => void>();
  const useIllustration = Boolean(venueId);
  const fallbackSrc = useIllustration && venueId ? venueIllustrationUrl(venueId) : court;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const getSnapshot = () => fallback;
  const emit = () => { for (const listener of listeners) listener(); };
  const paint = () => {
    const uploadedPending = Boolean(url && !fallback && !loaded);
    const fallbackPending = Boolean(fallback && !loaded && !fallbackError);
    const uploadedReady = Boolean(url && !fallback && loaded);
    const fallbackReady = Boolean(fallback && loaded && !fallbackError);
    const showEquipmentUnderlay = uploadedPending || fallbackPending || fallbackError;
    const underlay = showEquipmentUnderlay ? venueEquipmentPlaceholderStyle() : undefined;
    for (const slot of Object.values(slots)) {
      if (!slot) continue;
      slot.dataset.cover = uploadedReady ? "uploaded" : "default";
      if (uploadedReady) delete slot.dataset.fallback;
      else slot.dataset.fallback = useIllustration ? "illustration" : "court";
      if (uploadedPending) slot.dataset.pending = "uploaded";
      else if (fallbackPending) slot.dataset.pending = "fallback";
      else delete slot.dataset.pending;
      if (underlay) Object.assign(slot.style, underlay);
      else if (uploadedReady || fallbackReady) Object.assign(slot.style, NEUTRAL_READY_STYLE);
    }
    if (image) {
      image.alt = fallback
        ? (useIllustration ? VENUE_ILLUSTRATION_ALT : "Бадминтонный корт")
        : `Обложка: ${name}`;
      image.style.opacity = showEquipmentUnderlay ? "0" : "";
    }
  };
  const applyLoad = (current: HTMLImageElement, version: number) => {
    if (image !== current || version !== generation || (!slots.compact && !slots.info)) return;
    if (fallbackError) return;
    loaded = true;
    paint();
  };
  const applyError = (current: HTMLImageElement, version: number) => {
    if (image !== current || version !== generation || (!slots.compact && !slots.info)) return;
    if (fallback) {
      // Secondary fallback failure: keep SVG + hidden broken raster; never error-loop.
      if (fallbackError) return;
      fallbackError = true;
      loaded = false;
      paint();
      return;
    }
    // Original photo failure → per-venue fallback (pending until that asset decodes).
    fallback = true;
    loaded = false;
    fallbackError = false;
    paint();
    source();
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
    // Attach listeners for this generation before writing src — do not probe the previous src.
    listen(false);
    if (!image) return;
    image.src = fallback ? fallbackSrc : url ?? fallbackSrc;
    paint();
    if (!image.complete) return;
    if (image.naturalWidth > 0) applyLoad(image, generation);
    else if (image.getAttribute("src")) applyError(image, generation);
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
      source();
    }
    if (image && !detach) listen(true);
    paint();
    if (image && image.parentNode !== target) target.appendChild(image);
  };
  const compact: RefCallback<HTMLSpanElement> = node => attach("compact", node);
  const info: RefCallback<HTMLSpanElement> = node => attach("info", node);
  return { compact, info, release, retain, subscribe, getSnapshot, rename(value: string) { name = value; paint(); } };
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
