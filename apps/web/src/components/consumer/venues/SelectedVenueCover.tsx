"use client";
import { useEffect, useMemo, type RefCallback } from "react";
import { venueCoverUrl } from "./VenueCover";

const court = "/discovery/badminton-courts.jpg";
type Position = "compact" | "info";

/** One committed browser resource; moving between slots never assigns src. */
function createResource(url: string | null) {
  const slots: Partial<Record<Position, HTMLSpanElement>> = {};
  let image: HTMLImageElement | null = null;
  let name = "";
  let uploaded = !!url;
  let generation = 0;
  let detach = () => {};
  const present = () => {
    for (const slot of Object.values(slots)) {
      slot.dataset.cover = uploaded ? "uploaded" : "default";
      if (uploaded) delete slot.dataset.fallback;
      else slot.dataset.fallback = "court";
    }
    if (image) {
      image.alt = uploaded ? `Обложка: ${name}` : "Бадминтонный корт";
      const target = slots.info ?? slots.compact;
      if (target && image.parentNode !== target) target.appendChild(image);
    }
  };
  const source = () => {
    if (!image) return;
    detach();
    const current = image;
    const token = ++generation;
    const error = () => {
      if (image !== current || token !== generation || !uploaded) return;
      uploaded = false;
      source();
      present();
    };
    current.addEventListener("error", error);
    detach = () => current.removeEventListener("error", error);
    current.src = uploaded && url ? url : court;
  };
  const register = (position: Position, node: HTMLSpanElement | null) => {
    if (node) slots[position] = node;
    else delete slots[position];
    if (!slots.compact && !slots.info) {
      ++generation;
      detach();
      detach = () => {};
      image?.remove();
      image?.removeAttribute("src");
      image = null;
      return;
    }
    if (!image && slots.compact) {
      uploaded = !!url;
      image = document.createElement("img");
      image.loading = "eager";
      image.decoding = "async";
      source();
    }
    present();
  };
  return {
    compact: ((node) => register("compact", node)) as RefCallback<HTMLSpanElement>,
    info: ((node) => register("info", node)) as RefCallback<HTMLSpanElement>,
    rename(value: string) { name = value; present(); },
  };
}
export function useSelectedVenueCover(cityId: string, venue?: { id: string; name: string; cover?: { uploadedUrl: string | null } }) {
  const url = venueCoverUrl(venue?.cover?.uploadedUrl);
  const resource = useMemo(() => createResource(url), [cityId, venue?.id, url]);
  useEffect(() => { resource.rename(venue?.name ?? ""); }, [resource, venue?.name]);
  return resource;
}
export function SelectedVenueCover({ slotRef, position }: { slotRef: RefCallback<HTMLSpanElement>; position: Position }) {
  return <span ref={slotRef} className={`gb-venue-cover ${position === "compact" ? "gb-venue-preview-cover" : "gb-venue-sheet-cover"}`} />;
}
