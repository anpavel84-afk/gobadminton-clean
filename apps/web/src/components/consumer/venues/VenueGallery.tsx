"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefCallback, type MouseEvent as ReactMouseEvent } from "react";
import type { Venue, VenueProfile } from "../../../lib/consumer-types";
import { httpsCreditUrl } from "../../../lib/original-http-authority";
import { venueMediaSkeletonStyle } from "../../../lib/venue-illustration";
import { VenueCover, venueCoverUrl } from "./VenueCover";
import { VenueCoverCredit } from "./VenueCoverCredit";
import { VenueSourceCredit, safeCatalogSource } from "./VenueSourceCredit";
import "../../../styles/venue-gallery.css";

export type GalleryItem = VenueProfile["gallery"]["items"][number];

const AXIS_LOCK = 10;
const SWIPE_THRESHOLD = 48;

/** Exclude interactive descendants before drag/capture so arrow clicks keep their target. */
function isGalleryInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean(
    (target as Element).closest(
      "button,a,input,select,textarea,summary,label,[role='button'],[role='link'],[role='textbox']",
    ),
  );
}

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
  // Attributed legacy single cover only — never invent illustration credit for unattributed covers.
  // Strict ordered validation above is unchanged; this path only preserves honest legacy DISPLAY.
  // Rejected/unsafe credit URLs stay plain text via VenueCoverCredit (never become links).
  if (items.length === 0) {
    const url = venueCoverUrl(cover?.uploadedUrl);
    const credit = cover?.credit;
    if (url && credit && (credit.kind === "photo" || credit.kind === "logo" || credit.kind === "illustration")) {
      if (credit.kind === "illustration") {
        if (typeof credit.text === "string" && credit.text.length > 0 && credit.text.length <= 120 && credit.url == null) {
          items.push({ id: url, url, credit: { kind: "illustration", text: credit.text, url: null } });
        }
      } else if (typeof credit.text === "string" && credit.text.length <= 120
        && ((credit.kind === "photo" && credit.text.startsWith("Фото: "))
          || (credit.kind === "logo" && credit.text.startsWith("Логотип: ")))) {
        items.push({
          id: url,
          url,
          credit: { kind: credit.kind, text: credit.text, url: httpsCreditUrl(credit.url) },
        });
      }
    }
  }
  return items;
}

function mainIndex(items: GalleryItem[], cover?: Venue["cover"]): number {
  const mainUrl = venueCoverUrl(cover?.uploadedUrl);
  if (!mainUrl || items.length === 0) return 0;
  const index = items.findIndex((item) => item.url === mainUrl);
  return index >= 0 ? index : 0;
}

type Drag = { id: number; x: number; y: number; axis: "pending" | "x" | "y" };

export function VenueGallery({
  venue,
  className = "",
  size = "sheet",
  coverSlot,
  coverFallback = false,
  showCredit = true,
  showSourceCredit = true,
  index: controlledIndex,
  onIndexChange,
  onCoverRetry,
}: {
  venue: Pick<Venue, "id" | "name" | "cover" | "profile"> | (Pick<Venue, "id" | "name" | "cover"> & { profile?: Venue["profile"] });
  className?: string;
  size?: "sheet" | "compact" | "page";
  /** Reuse SelectedVenueCover morph slot for the current main-matching image. */
  coverSlot?: ReactNode;
  /** Shared SelectedVenueCover resource already failed the main loan. */
  coverFallback?: boolean;
  showCredit?: boolean;
  /** Catalog source credit; false in compact select-button parents that render it as a sibling footer. */
  showSourceCredit?: boolean;
  /** Parent-owned index keeps compact↔expanded selection aligned for one venue. */
  index?: number;
  onIndexChange?: (index: number, item: GalleryItem | null) => void;
  /** Optional morph-resource retry when the shared main cover failed. */
  onCoverRetry?: () => void;
}) {
  const items = readItems(venue.profile ?? null, venue.cover);
  const [uncontrolledIndex, setUncontrolledIndex] = useState(() => mainIndex(items, venue.cover));
  const index = controlledIndex ?? uncontrolledIndex;
  const notify = useRef(onIndexChange);
  notify.current = onIndexChange;
  const commitIndex = (next: number) => {
    if (controlledIndex !== undefined) {
      if (controlledIndex === next) return;
      notify.current?.(next, items[next] ?? null);
      return;
    }
    setUncontrolledIndex(next);
    notify.current?.(next, items[next] ?? null);
  };
  const [failed, setFailed] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const labelId = useId();
  const statusId = useId();
  const safeIndex = items.length === 0 ? 0 : ((index % items.length) + items.length) % items.length;
  const current = items[safeIndex] ?? null;
  const mainUrl = venueCoverUrl(venue.cover?.uploadedUrl);
  const mainLoanFailed = Boolean(coverSlot && coverFallback && current && mainUrl && current.url === mainUrl);
  // Keep the morph main-loan slot for pending/ready/failed paint of the single shared image.
  const useMorphSlot = Boolean(coverSlot && current && mainUrl && current.url === mainUrl && failed !== current.url);
  const imageFailed = Boolean(current && (failed === current.url || mainLoanFailed));
  // All gallery sizes: static skeleton while the single current photo is empty (not morph path).
  // Morph keeps one physical photo node; frame underlay is CSS-only and does not steal gestures.
  const framePending = Boolean(
    !useMorphSlot
    && current
    && !imageFailed
    && loadedSrc !== current.url,
  );
  const framePendingStyle = framePending ? venueMediaSkeletonStyle() : undefined;
  const imageReady = Boolean(current && !imageFailed && loadedSrc === current.url);

  useEffect(() => {
    setFailed(null);
    setLoadedSrc(null);
    setRetryToken(0);
    // Parent-owned controlled index survives compact→expanded remount on the same venue.
    // Uncontrolled (and new-venue parent resets) still start on the main image.
    if (controlledIndex !== undefined) return;
    const next = mainIndex(readItems(venue.profile ?? null, venue.cover), venue.cover);
    commitIndex(next);
    // Reset only when the selected venue identity changes.
  }, [venue.id]);
  // loadedSrc is compared to current.url — a swipe/index change is pending until that url loads.
  // Do not clear loadedSrc in an effect after ref cache-hit, or complete images stay empty.

  useEffect(() => {
    if (items.length === 0) {
      if (index !== 0) commitIndex(0);
      return;
    }
    const next = Math.min(safeIndex, items.length - 1);
    if (next !== index) commitIndex(next);
  }, [items.length, safeIndex, index]);

  useEffect(() => {
    if (items.length < 2) return;
    const adjacent = [items[safeIndex - 1], items[safeIndex + 1]].filter(Boolean) as GalleryItem[];
    for (const item of adjacent) {
      const image = new Image();
      image.decoding = "async";
      image.src = item.url;
    }
  }, [safeIndex, items.length, current?.id]);

  function go(delta: number) {
    if (items.length < 2) return;
    commitIndex((safeIndex + delta + items.length) % items.length);
  }

  function retryCurrent() {
    if (!current) return;
    if (mainLoanFailed) {
      onCoverRetry?.();
      return;
    }
    setFailed(null);
    setLoadedSrc(null);
    setRetryToken((value) => value + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (items.length < 2) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); go(1); }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (items.length < 2 || event.button !== 0) return;
    // Real mouse clicks on nav (and nested SVG glyphs) must not start gallery capture.
    if (isGalleryInteractiveTarget(event.target)) return;
    // A fresh real press clears stale swipe click-suppression so the first tap is not swallowed.
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending" };
    event.currentTarget.setPointerCapture(event.pointerId);
    // Do not stopPropagation: VenuePopup tracks pending vertical takeover without
    // stealing capture from this gallery target.
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.id !== event.pointerId) return;
    const dx = event.clientX - currentDrag.x;
    const dy = event.clientY - currentDrag.y;
    if (currentDrag.axis === "pending") {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        // Vertical: release so the enclosing VenuePopup can take over at axis lock.
        drag.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
        return;
      }
      currentDrag.axis = "x";
      event.preventDefault();
      event.stopPropagation();
    }
    if (currentDrag.axis === "x") {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.id !== event.pointerId) return;
    drag.current = null;
    if (currentDrag.axis !== "x") return;
    event.stopPropagation();
    const dx = event.clientX - currentDrag.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      go(dx < 0 ? 1 : -1);
      suppressClick.current = true;
    }
  }
  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }
  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const catalogSource = "profile" in venue ? venue.profile?.catalogSource : undefined;
  // Avoid empty credit wrappers in compact picker thumbs when there is nothing to show.
  // Compact interactive parents pass showSourceCredit={false} and render VenueSourceCredit outside the row/select button.
  const sourceCredit = showSourceCredit && safeCatalogSource(catalogSource)
    ? <VenueSourceCredit catalogSource={catalogSource} />
    : null;
  const allowRetry = size !== "compact";

  if (items.length === 0) {
    // Preserve parent morph/fallback slot when gallery has no items; do not invent photo credit.
    // Source attribution still renders for every presented venue (including empty media).
    // Counts stay 0 — default illustration is cover paint, not a synthetic gallery item.
    const emptyCredit = sourceCredit ? <div className="gb-venue-gallery__credit">{sourceCredit}</div> : null;
    const legacyCoverUrl = venueCoverUrl(venue.cover?.uploadedUrl);
    if (coverSlot) {
      // Keep the single shared morph slot. No published URL → morph loads default illustration.
      if (!legacyCoverUrl) {
        const illustrationFailed = Boolean(coverFallback);
        return <div className={`gb-venue-gallery-wrap ${className}`.trim()}>
          <div
            className="gb-venue-gallery"
            data-size={size === "compact" ? "compact" : size}
            data-count={0}
            role="group"
            aria-roledescription="gallery"
          >
            <div
              className="gb-venue-gallery__frame"
              data-state={illustrationFailed ? "error" : undefined}
            >
              {coverSlot}
              {illustrationFailed && size !== "compact" ? (
                <div className="gb-venue-gallery__status" data-state="error" role="alert">
                  <p>Не удалось загрузить иллюстрацию</p>
                  {onCoverRetry ? (
                    <button type="button" className="gb-venue-gallery__retry" onClick={(event) => {
                      event.stopPropagation();
                      onCoverRetry();
                    }}>Повторить загрузку</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {emptyCredit}
        </div>;
      }
      return <>{coverSlot}{emptyCredit}</>;
    }
    // Unattributed legacy cover or genuine no-media → VenueCover (uploaded / default illustration).
    // Sheet/page keep gallery chrome with data-count=0; compact reuses the thumb className.
    if (size === "compact") {
      return <>
        <VenueCover
          cover={venue.cover}
          name={venue.name}
          className={className}
          venueId={venue.id}
          allowRetry={false}
        />
        {emptyCredit}
      </>;
    }
    return <div className={`gb-venue-gallery-wrap ${className}`.trim()}>
      <div
        className="gb-venue-gallery"
        data-size={size}
        data-count={0}
        role="group"
        aria-roledescription="gallery"
      >
        <div className="gb-venue-gallery__frame">
          <VenueCover
            cover={venue.cover}
            name={venue.name}
            venueId={venue.id}
            allowRetry={allowRetry}
          />
        </div>
      </div>
      {emptyCredit}
    </div>;
  }

  const showControls = items.length > 1 && size !== "compact";
  // Compact thumbs stay caption-free (aria-busy + skeleton only); sheet/page keep the loading line.
  const statusText = framePending && size !== "compact"
    ? "Загружаем фотографию…"
    : (imageFailed && size === "compact" ? "Фото не загрузилось" : null);

  return <div className={`gb-venue-gallery-wrap ${className}`.trim()}>
    <div
      className="gb-venue-gallery"
      data-size={size === "compact" ? "compact" : size}
      data-count={items.length}
      role="group"
      aria-roledescription="gallery"
      aria-labelledby={labelId}
      aria-describedby={(statusText || imageFailed) ? statusId : undefined}
      aria-busy={framePending || undefined}
      tabIndex={showControls ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onClickCapture={onClickCapture}
    >
      <span id={labelId} className="gb-sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
        Фото площадки {safeIndex + 1} из {items.length}
      </span>
      <div
        className="gb-venue-gallery__frame"
        data-pending={framePending ? "uploaded" : undefined}
        data-state={imageFailed ? "error" : undefined}
        style={framePendingStyle}
        onErrorCapture={(event) => {
          // Main loan: capture runs before the shared resource target listener — do not setFailed
          // (that would drop morph and mount a second fallback img). Let the resource own it.
          if (useMorphSlot) return;
          const target = event.target;
          if (!(target instanceof HTMLImageElement) || !current || failed === current.url) return;
          // Observe the original current img src only — not a static illustration fallback.
          if (target.getAttribute("src") === current.url) setFailed(current.url);
        }}
      >
        {useMorphSlot ? <>
          {coverSlot}
          {mainLoanFailed && size !== "compact" ? (
            <div className="gb-venue-gallery__status" data-state="error" id={statusId} role="alert">
              <p>Не удалось загрузить фотографию</p>
              <p>Информация о площадке доступна ниже</p>
              {onCoverRetry ? (
                <button type="button" className="gb-venue-gallery__retry" onClick={(event) => {
                  event.stopPropagation();
                  onCoverRetry();
                }}>Повторить загрузку</button>
              ) : null}
            </div>
          ) : null}
        </> : imageFailed && current
          ? <div className="gb-venue-gallery__status" data-state="error" id={statusId} role="alert">
              {size === "compact" ? <p>Фото не загрузилось</p> : <>
                <p>Не удалось загрузить фотографию</p>
                <p>Информация о площадке доступна ниже</p>
                {allowRetry ? (
                  <button type="button" className="gb-venue-gallery__retry" onClick={(event) => {
                    event.stopPropagation();
                    retryCurrent();
                  }}>Повторить загрузку</button>
                ) : null}
              </>}
            </div>
          : current
          ? <img
              key={`${current.url}:${retryToken}`}
              src={current.url}
              alt={`Обложка: ${venue.name}`}
              loading="eager"
              decoding="async"
              draggable={false}
              onDragStart={(event) => { event.preventDefault(); }}
              style={framePending ? { opacity: 0 } : undefined}
              ref={(node) => {
                if (!node || !current || loadedSrc === current.url) return;
                if (node.complete && node.naturalWidth > 0) setLoadedSrc(current.url);
              }}
              onLoad={() => setLoadedSrc(current.url)}
              onError={() => setFailed(current.url)}
            />
          : null}
      </div>
      {showControls && <>
        <div className="gb-venue-gallery__nav">
          <button type="button" aria-label="Предыдущее фото" onClick={(event) => { event.stopPropagation(); go(-1); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M10.5 3.5 6 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
            </svg>
          </button>
          <button type="button" aria-label="Следующее фото" onClick={(event) => { event.stopPropagation(); go(1); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
            </svg>
          </button>
        </div>
        <span className="gb-venue-gallery__count" aria-hidden="true">{safeIndex + 1}/{items.length}</span>
      </>}
    </div>
    {(showCredit && current && imageReady) || sourceCredit || (showCredit && framePending && size !== "compact") || (showCredit && imageFailed && size !== "compact") ? <div className="gb-venue-gallery__credit">
      {showCredit && framePending && size !== "compact" ? <p className="gb-venue-gallery__caption" id={statusId} role="status">Загружаем фотографию…</p> : null}
      {showCredit && imageFailed && size !== "compact" ? <p className="gb-venue-gallery__caption">Фотография временно недоступна</p> : null}
      {showCredit && current && imageReady ? <VenueCoverCredit credit={current.credit} /> : null}
      {sourceCredit}
    </div> : (statusText && size === "compact" && !(imageFailed && !useMorphSlot)
      ? <span id={statusId} className="gb-sr-only" role="status">{statusText}</span>
      : null)}
  </div>;
}

/** Slot helper when a parent already owns SelectedVenueCover refs. */
export function VenueGallerySlot({ slotRef, className }: { slotRef: RefCallback<HTMLSpanElement>; className?: string }) {
  return <span className={`gb-venue-cover ${className ?? ""}`} ref={slotRef} />;
}
