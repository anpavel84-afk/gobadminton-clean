"use client";
import { useEffect, useMemo } from "react";
import type { VenueSummary } from "../../../lib/consumer-types";
import { venueCoverUrl } from "./VenueCover";

const court = "/discovery/badminton-courts.jpg";
type Mode = "compact" | "info";

/** Pure resource construction. DOM work belongs exclusively to commit refs. */
function createResource(url: string | null) {
  let name = "площадки";
  const slots: Record<Mode, HTMLSpanElement | null> = { compact: null, info: null };
  let image: HTMLImageElement | null = null;
  let stop: (() => void) | null = null;
  let generation = 0;
  let uploaded = url !== null;
  const decorate = () => {
    for (const slot of Object.values(slots)) {
      if (!slot) continue;
      slot.dataset.cover = uploaded ? "uploaded" : "default";
      if (uploaded) delete slot.dataset.fallback;
      else slot.dataset.fallback = "court";
    }
  };
  const source = (node: HTMLImageElement) => {
    stop?.();
    const token = ++generation;
    const current = () => image === node && token === generation;
    const load = () => { if (!current()) return; };
    const error = () => {
      if (!current() || !uploaded) return;
      uploaded = false;
      source(node);
    };
    node.addEventListener("load", load);
    node.addEventListener("error", error);
    stop = () => {
      node.removeEventListener("load", load);
      node.removeEventListener("error", error);
    };
    node.alt = uploaded ? `Обложка: ${name}` : "Бадминтонный корт";
    decorate();
    node.src = uploaded && url ? url : court;
  };
  const register = (mode: Mode, slot: HTMLSpanElement | null) => {
    slots[mode] = slot;
    const target = slots.info ?? slots.compact;
    if (!target) {
      ++generation;
      stop?.(); stop = null;
      image?.remove();
      image?.removeAttribute("src");
      image = null;
      return;
    }
    if (!image) {
      image = document.createElement("img");
      image.loading = "eager";
      image.decoding = "async";
      source(image);
    }
    decorate();
    if (image.parentNode !== target) target.appendChild(image);
  };
  return {
    setName(value: string) {
      name = value;
      if (image && uploaded) image.alt = `Обложка: ${name}`;
    },
    compact: (slot: HTMLSpanElement | null) => register("compact", slot),
    info: (slot: HTMLSpanElement | null) => register("info", slot),
  };
}
export type SelectedVenueCoverResource = ReturnType<typeof createResource>;

/** Lives in GamesMapView, independently of the conditional sheet and its info view. */
export function useSelectedVenueCover(cityId: string, venue: VenueSummary | undefined) {
  const id = venue?.id;
  const url = venueCoverUrl(venue?.cover?.uploadedUrl);
  const name = venue?.name ?? "площадки";
  // Identity follows the selection and normalized source, never presentation state.
  const resource = useMemo(() => createResource(url), [cityId, id, url]);
  useEffect(() => { resource.setName(name); }, [resource, name]);
  return resource;
}

export function SelectedVenueCover({ resource, mode, className }: {
  resource: SelectedVenueCoverResource; mode: Mode; className: string;
}) {
  return <span className={`gb-venue-cover ${className}`} ref={resource[mode]} />;
}
