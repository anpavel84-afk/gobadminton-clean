"use client";
import { useEffect, useMemo } from "react";
import type { RefCallback } from "react";
import { venueCoverUrl } from "./VenueCover";

const court = "/discovery/badminton-courts.jpg";
type Position = "compact" | "info";

/** A selected venue owns one image; slots only lend it a DOM parent. */
function createCover(url: string | null, initialName: string) {
  const slots: Record<Position, HTMLSpanElement | null> = { compact: null, info: null };
  let image: HTMLImageElement | null = null;
  let name = initialName;
  let fallback = !url;
  let generation = 0;
  let detach: (() => void) | undefined;
  const describe = () => {
    for (const slot of Object.values(slots)) {
      if (!slot) continue;
      slot.dataset.cover = fallback ? "default" : "uploaded";
      if (fallback) slot.dataset.fallback = "court";
      else delete slot.dataset.fallback;
    }
    if (image) image.alt = fallback ? "Бадминтонный корт" : `Обложка: ${name}`;
  };
  const source = () => {
    if (!image) return;
    detach?.();
    const current = image;
    const version = ++generation;
    const error = () => {
      if (image !== current || version !== generation || fallback) return;
      fallback = true;
      describe();
      source();
    };
    current.addEventListener("error", error);
    detach = () => current.removeEventListener("error", error);
    current.src = fallback ? court : url ?? court;
  };
  const dispose = () => {
    ++generation;
    detach?.(); detach = undefined;
    image?.remove();
    image?.removeAttribute("src");
    image = null;
  };
  const attach = (position: Position, node: HTMLSpanElement | null) => {
    slots[position] = node;
    const target = slots.info ?? slots.compact;
    if (!target) { dispose(); return; }
    // Only a committed compact slot starts loading the selected resource.
    if (!image && slots.compact) {
      image = document.createElement("img");
      image.loading = "eager";
      image.decoding = "async";
      describe();
      source();
    }
    describe();
    if (image && image.parentNode !== target) target.appendChild(image);
  };
  const compact: RefCallback<HTMLSpanElement> = node => attach("compact", node);
  const info: RefCallback<HTMLSpanElement> = node => attach("info", node);
  return { compact, info, dispose, rename(value: string) { name = value; describe(); } };
}

export function useSelectedVenueCover(cityId: string, venue?: { id: string; name: string; cover?: { uploadedUrl: string | null } }) {
  const url = venueCoverUrl(venue?.cover?.uploadedUrl);
  const id = venue?.id;
  const resource = useMemo(() => createCover(url, venue?.name ?? ""), [cityId, id, url]);
  useEffect(() => { resource.rename(venue?.name ?? ""); }, [resource, venue?.name]);
  useEffect(() => () => resource.dispose(), [resource]);
  return resource;
}

/** Empty React-owned slot: the resource moves its image only during commit. */
export function SelectedVenueCover({ slotRef, className }: { slotRef: RefCallback<HTMLSpanElement>; className: string }) {
  return <span className={`gb-venue-cover ${className}`} ref={slotRef} />;
}
