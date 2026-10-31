"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { RefCallback } from "react";
import { VENUE_ILLUSTRATION_ALT, venueIllustrationUrl } from "../../../lib/venue-illustration";
import { venueCoverUrl } from "./VenueCover";

const court = "/discovery/badminton-courts.jpg";
type Position = "compact" | "info";

/** A selected venue owns one image; slots only lend it a DOM parent. */
function createCover(url: string | null, initialName: string, venueId?: string) {
  const slots: Record<Position, HTMLSpanElement | null> = { compact: null, info: null };
  let image: HTMLImageElement | null = null;
  let name = initialName;
  let fallback = !url;
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
  const describe = () => {
    for (const slot of Object.values(slots)) {
      if (!slot) continue;
      slot.dataset.cover = fallback ? "default" : "uploaded";
      if (fallback) slot.dataset.fallback = useIllustration ? "illustration" : "court";
      else delete slot.dataset.fallback;
    }
    if (image) {
      image.alt = fallback
        ? (useIllustration ? VENUE_ILLUSTRATION_ALT : "Бадминтонный корт")
        : `Обложка: ${name}`;
    }
  };
  const listen = () => {
    if (!image) return;
    detach?.();
    const current = image;
    const version = ++generation;
    const error = () => {
      if (image !== current || version !== generation || fallback || (!slots.compact && !slots.info)) return;
      fallback = true;
      describe();
      source();
      emit();
    };
    current.addEventListener("error", error);
    detach = () => current.removeEventListener("error", error);
  };
  const source = () => {
    listen();
    if (image) image.src = fallback ? fallbackSrc : url ?? fallbackSrc;
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
      describe();
      source();
    }
    if (image && !detach) listen();
    describe();
    if (image && image.parentNode !== target) target.appendChild(image);
  };
  const compact: RefCallback<HTMLSpanElement> = node => attach("compact", node);
  const info: RefCallback<HTMLSpanElement> = node => attach("info", node);
  return { compact, info, release, retain, subscribe, getSnapshot, rename(value: string) { name = value; describe(); } };
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
