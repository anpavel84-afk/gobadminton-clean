"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefCallback } from "react";
import type { Venue, VenueProfile } from "../../../lib/consumer-types";
import { httpsCreditUrl } from "../../../lib/original-http-authority";
import { VenueCover, venueCoverUrl } from "./VenueCover";
import { VenueCoverCredit } from "./VenueCoverCredit";
import "../../../styles/venue-gallery.css";

export type GalleryItem = VenueProfile["gallery"]["items"][number];

const AXIS_LOCK = 10;
const SWIPE_THRESHOLD = 48;

function readItems(gallery: Venue["profile"] extends infer P ? P : never, cover?: Venue["cover"]): GalleryItem[] {
  const profile = gallery && typeof gallery === "object" ? gallery as VenueProfile : null;
  const raw = profile?.gallery;
  const items: GalleryItem[] = [];
  if (raw && raw.coverage === "ordered" && Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!item || typeof item !== "object") continue;
      const url = venueCoverUrl(item.url);
      if (!url) continue;
      const credit = item.credit;
      if (!credit || (credit.kind !== "photo" && credit.kind !== "logo" && credit.kind !== "illustration")) continue;
      if (credit.kind === "illustration") {
        if (credit.text !== "Иллюстрация" || credit.url != null) continue;
        items.push({ id: typeof item.id === "string" ? item.id : url, url, credit: { kind: "illustration", text: "Иллюстрация", url: null } });
      } else {
        const href = httpsCreditUrl(credit.url);
        if (!href || typeof credit.text !== "string" || credit.text.length > 120) continue;
        if (credit.kind === "photo" && !credit.text.startsWith("Фото: ")) continue;
        if (credit.kind === "logo" && !credit.text.startsWith("Логотип: ")) continue;
        items.push({ id: typeof item.id === "string" ? item.id : url, url, credit: { kind: credit.kind, text: credit.text, url: href } });
      }
      if (items.length >= 8) break;
    }
  }
  if (items.length === 0) {
    const url = venueCoverUrl(cover?.uploadedUrl);
    if (url) {
      const credit = cover?.credit;
      items.push({
        id: url,
        url,
        credit: credit && (credit.kind === "photo" || credit.kind === "logo" || credit.kind === "illustration")
          ? credit
          : { kind: "illustration", text: "Иллюстрация", url: null },
      });
    }
  }
  return items;
}

type Drag = { id: number; x: number; y: number; axis: "pending" | "x" | "y" };

export function VenueGallery({
  venue,
  className = "",
  size = "sheet",
  coverSlot,
  showCredit = true,
  onIndexChange,
}: {
  venue: Pick<Venue, "id" | "name" | "cover" | "profile"> | (Pick<Venue, "id" | "name" | "cover"> & { profile?: Venue["profile"] });
  className?: string;
  size?: "sheet" | "compact" | "page";
  /** Reuse SelectedVenueCover morph slot for the current main-matching image. */
  coverSlot?: ReactNode;
  showCredit?: boolean;
  onIndexChange?: (index: number, item: GalleryItem | null) => void;
}) {
  const items = readItems(venue.profile ?? null, venue.cover);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const labelId = useId();
  const safeIndex = items.length === 0 ? 0 : ((index % items.length) + items.length) % items.length;
  const current = items[safeIndex] ?? null;
  const mainUrl = venueCoverUrl(venue.cover?.uploadedUrl);
  const useMorphSlot = Boolean(coverSlot && current && mainUrl && current.url === mainUrl && failed !== current.url);

  useEffect(() => { setIndex(0); setFailed(null); }, [venue.id]);
  useEffect(() => {
    if (items.length === 0) { onIndexChange?.(0, null); return; }
    const next = Math.min(safeIndex, items.length - 1);
    if (next !== index) setIndex(next);
    onIndexChange?.(next, items[next] ?? null);
  }, [items, safeIndex, index, onIndexChange]);

  useEffect(() => {
    if (items.length < 2) return;
    const adjacent = [items[safeIndex - 1], items[safeIndex + 1]].filter(Boolean) as GalleryItem[];
    for (const item of adjacent) {
      const image = new Image();
      image.decoding = "async";
      image.src = item.url;
    }
  }, [items, safeIndex]);

  function go(delta: number) {
    if (items.length < 2) return;
    setIndex((value) => (value + delta + items.length) % items.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (items.length < 2) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (items.length < 2 || event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending" };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.id !== event.pointerId) return;
    const dx = event.clientX - currentDrag.x;
    const dy = event.clientY - currentDrag.y;
    if (currentDrag.axis === "pending") {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
        return;
      }
      currentDrag.axis = "x";
    }
    if (currentDrag.axis === "x") event.preventDefault();
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.id !== event.pointerId) return;
    drag.current = null;
    if (currentDrag.axis !== "x") return;
    const dx = event.clientX - currentDrag.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
  }
  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  if (items.length === 0) {
    return <VenueCover cover={undefined} name={venue.name} className={className} />;
  }

  const showControls = items.length > 1 && size !== "compact";

  return <div className={`gb-venue-gallery-wrap ${className}`.trim()}>
    <div
      className="gb-venue-gallery"
      data-size={size === "compact" ? "compact" : size}
      data-count={items.length}
      role="group"
      aria-roledescription="gallery"
      aria-labelledby={labelId}
      tabIndex={showControls ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <span id={labelId} className="gb-sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
        Фото площадки {safeIndex + 1} из {items.length}
      </span>
      <div className="gb-venue-gallery__frame">
        {useMorphSlot ? coverSlot : current && failed !== current.url
          ? <img
              key={current.url}
              src={current.url}
              alt={`Обложка: ${venue.name}`}
              loading="eager"
              decoding="async"
              onError={() => setFailed(current.url)}
            />
          : <VenueCover cover={undefined} name={venue.name} />}
      </div>
      {showControls && <>
        <div className="gb-venue-gallery__nav">
          <button type="button" aria-label="Предыдущее фото" onClick={() => go(-1)}>←</button>
          <button type="button" aria-label="Следующее фото" onClick={() => go(1)}>→</button>
        </div>
        <span className="gb-venue-gallery__count" aria-hidden="true">{safeIndex + 1}/{items.length}</span>
      </>}
    </div>
    {showCredit && current ? <div className="gb-venue-gallery__credit"><VenueCoverCredit credit={current.credit} /></div> : null}
  </div>;
}

/** Slot helper when a parent already owns SelectedVenueCover refs. */
export function VenueGallerySlot({ slotRef, className }: { slotRef: RefCallback<HTMLSpanElement>; className?: string }) {
  return <span className={`gb-venue-cover ${className ?? ""}`} ref={slotRef} />;
}
