"use client";
import { useState, type CSSProperties, type ReactNode } from "react";
import { venueMediaSkeletonStyle } from "../../../lib/venue-illustration";

type CoverPhase = {
  key: string;
  /** Last successfully decoded raster src (uploaded or discovery fallback). */
  loaded: string | null;
  /** Sticky: uploaded cover URL that failed; cleared only on url+venue key change. */
  failed: string | null;
  /** Discovery court/trainer raster failed — keep skeleton-free empty; hide broken img. */
  fallbackError: boolean;
};

/** Only the current server-authorized derivative. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}

export function VenueCover({ cover, className = "", name = "площадки", fallback = "court", venueId, allowRetry = true, onRetry }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string; fallback?: "court" | "trainer"; venueId?: string;
  /** When false, failed state stays non-interactive (picker select-button parent). */
  allowRetry?: boolean;
  onRetry?: () => void;
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  // Derive load eligibility from the current url+venueId so URL/id changes never flash a stale photo.
  const [phase, setPhase] = useState<CoverPhase>(() => ({
    key: `${venueId ?? ""}|${url ?? ""}`,
    loaded: null,
    failed: null,
    fallbackError: false,
  }));
  const [retryToken, setRetryToken] = useState(0);
  const key = `${venueId ?? ""}|${url ?? ""}`;
  if (phase.key !== key) {
    setPhase({ key, loaded: null, failed: null, fallbackError: false });
  }
  const failed = phase.key === key ? phase.failed : null;
  const loaded = phase.key === key ? phase.loaded : null;
  const fallbackError = phase.key === key ? phase.fallbackError : false;
  // Pending gate only when a venue-scoped cover must not flash before decode.
  // Without venueId keep the previous immediate uploaded/discovery paint (hero paths).
  const gatePending = Boolean(venueId);
  const uploadedReady = Boolean(url && failed !== url && (!gatePending || loaded === url));
  const uploadedPending = Boolean(url && failed !== url && gatePending && loaded !== url);
  const uploadedFailed = Boolean(url && failed === url);
  // Genuine no published media for a venue-scoped cover — neutral cell, not equipment filler.
  const noMedia = Boolean(gatePending && !url);
  // Discovery/hero without venueId still uses court/trainer ready assets (not venue media).
  const useDiscoveryFallback = !uploadedReady && !uploadedFailed && !noMedia && !gatePending;
  const fallbackSrc = useDiscoveryFallback
    ? (fallback === "trainer" ? "/discovery/badminton-gear.jpg" : "/discovery/badminton-courts.jpg")
    : null;
  const fallbackAlt = fallback === "trainer" ? "Ракетка и воланы на корте" : "Бадминтонный корт";
  const fallbackKind = fallback;
  const fallbackPending = Boolean(
    useDiscoveryFallback
    && fallbackSrc
    && gatePending
    && loaded !== fallbackSrc
    && !fallbackError,
  );
  // Immediate static skeleton (no asset request, no equipment SVG).
  const showSkeleton = uploadedPending || fallbackPending;
  const style: CSSProperties | undefined = showSkeleton
    ? venueMediaSkeletonStyle()
    : uploadedReady && gatePending
      ? { backgroundImage: "none", backgroundColor: "var(--c23-surface)" }
      : noMedia || uploadedFailed || fallbackError
        ? { backgroundImage: "none", backgroundColor: "var(--gb-paper, #f5f6f2)" }
        : undefined;

  function retry() {
    if (!url) return;
    setPhase({ key, loaded: null, failed: null, fallbackError: false });
    setRetryToken((value) => value + 1);
    onRetry?.();
  }

  let body: ReactNode = null;
  if (url && failed !== url) {
    body = <img
      key={`${url}:${retryToken}`}
      src={url}
      alt={`Обложка: ${name}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onDragStart={(event) => { event.preventDefault(); }}
      style={uploadedPending ? { opacity: 0 } : undefined}
      ref={(node) => {
        if (!node || !url || !gatePending || failed === url || loaded === url) return;
        // Cache hit: complete before React attaches onLoad.
        if (!node.complete) return;
        if (node.naturalWidth > 0) setPhase({ key, loaded: url, failed: null, fallbackError: false });
        else setPhase({ key, loaded: null, failed: url, fallbackError: false });
      }}
      onLoad={() => {
        if (gatePending) setPhase({ key, loaded: url, failed: null, fallbackError: false });
      }}
      onError={() => setPhase({ key, loaded: null, failed: url, fallbackError: false })}
    />;
  } else if (uploadedFailed) {
    body = <span className="gb-venue-cover__status" data-state="error">
      <span>Фото не загрузилось</span>
      {allowRetry ? <button type="button" className="gb-venue-cover__retry" onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        retry();
      }}>Повторить</button> : null}
    </span>;
  } else if (noMedia) {
    body = <span className="gb-venue-cover__status" data-state="empty">Фотографии площадки пока нет</span>;
  } else if (fallbackSrc) {
    body = <img
      src={fallbackSrc}
      alt={fallbackAlt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onDragStart={(event) => { event.preventDefault(); }}
      style={fallbackPending || fallbackError ? { opacity: 0 } : undefined}
      ref={(node) => {
        if (!node || !gatePending || loaded === fallbackSrc || fallbackError) return;
        if (!node.complete) return;
        if (node.naturalWidth > 0) {
          setPhase({ key, loaded: fallbackSrc, failed, fallbackError: false });
        } else {
          setPhase({ key, loaded: null, failed, fallbackError: true });
        }
      }}
      onLoad={() => {
        if (gatePending) setPhase({ key, loaded: fallbackSrc, failed, fallbackError: false });
      }}
      onError={() => {
        if (gatePending) setPhase({ key, loaded: null, failed, fallbackError: true });
      }}
    />;
  }

  return <span
    className={`gb-venue-cover ${className}`}
    data-cover={uploadedReady ? "uploaded" : "default"}
    data-fallback={uploadedReady || noMedia || uploadedFailed ? undefined : (useDiscoveryFallback ? fallbackKind : undefined)}
    data-pending={uploadedPending ? "uploaded" : fallbackPending ? "fallback" : undefined}
    data-state={uploadedFailed ? "error" : noMedia ? "empty" : undefined}
    style={style}
  >
    {body}
  </span>;
}
