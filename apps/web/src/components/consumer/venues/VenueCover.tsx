"use client";
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  VENUE_ILLUSTRATION_ALT,
  venueIllustrationUrl,
  venueMediaSkeletonStyle,
} from "../../../lib/venue-illustration";

type CoverPhase = {
  key: string;
  /** Last successfully decoded raster src (uploaded or default illustration / discovery). */
  loaded: string | null;
  /** Sticky: uploaded cover URL that failed; cleared only on url+venue key change. */
  failed: string | null;
  /** Default illustration or discovery raster failed — honest error, not silent fill. */
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
  // Genuine no published media for a venue-scoped cover — deterministic illustration asset.
  const noMedia = Boolean(gatePending && !url);
  const illustrationSrc = noMedia && venueId ? venueIllustrationUrl(venueId) : null;
  const illustrationPending = Boolean(
    illustrationSrc
    && loaded !== illustrationSrc
    && !fallbackError,
  );
  const illustrationReady = Boolean(illustrationSrc && loaded === illustrationSrc && !fallbackError);
  const illustrationFailed = Boolean(illustrationSrc && fallbackError);
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
  const showSkeleton = uploadedPending || fallbackPending || illustrationPending;
  const style: CSSProperties | undefined = showSkeleton
    ? venueMediaSkeletonStyle()
    : uploadedReady && gatePending
      ? { backgroundImage: "none", backgroundColor: "var(--c23-surface)" }
      : illustrationReady
        ? { backgroundImage: "none", backgroundColor: "var(--c23-surface)" }
        : uploadedFailed || fallbackError || illustrationFailed
          ? { backgroundImage: "none", backgroundColor: "var(--gb-paper, #f5f6f2)" }
          : undefined;

  function retry() {
    if (url) {
      setPhase({ key, loaded: null, failed: null, fallbackError: false });
      setRetryToken((value) => value + 1);
      onRetry?.();
      return;
    }
    if (!illustrationSrc) return;
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
  } else if (illustrationSrc) {
    if (illustrationFailed) {
      body = <span className="gb-venue-cover__status" data-state="error">
        <span>Не удалось загрузить иллюстрацию</span>
        {allowRetry ? <button type="button" className="gb-venue-cover__retry" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          retry();
        }}>Повторить</button> : null}
      </span>;
    } else {
      body = <>
        <img
          key={`${illustrationSrc}:${retryToken}`}
          src={illustrationSrc}
          alt={VENUE_ILLUSTRATION_ALT}
          loading="lazy"
          decoding="async"
          draggable={false}
          onDragStart={(event) => { event.preventDefault(); }}
          style={illustrationPending ? { opacity: 0 } : undefined}
          ref={(node) => {
            if (!node || !illustrationSrc || loaded === illustrationSrc || fallbackError) return;
            if (!node.complete) return;
            if (node.naturalWidth > 0) {
              setPhase({ key, loaded: illustrationSrc, failed: null, fallbackError: false });
            } else {
              setPhase({ key, loaded: null, failed: null, fallbackError: true });
            }
          }}
          onLoad={() => {
            setPhase({ key, loaded: illustrationSrc, failed: null, fallbackError: false });
          }}
          onError={() => {
            setPhase({ key, loaded: null, failed: null, fallbackError: true });
          }}
        />
        {illustrationPending
          ? <span className="gb-venue-cover__status" data-state="loading" role="status">Загружаем иллюстрацию…</span>
          : null}
      </>;
    }
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
    data-fallback={
      uploadedReady || uploadedFailed
        ? undefined
        : illustrationReady || illustrationPending || illustrationFailed
          ? "illustration"
          : (useDiscoveryFallback ? fallbackKind : undefined)
    }
    data-pending={
      uploadedPending
        ? "uploaded"
        : illustrationPending
          ? "illustration"
          : fallbackPending
            ? "fallback"
            : undefined
    }
    data-state={uploadedFailed || illustrationFailed ? "error" : undefined}
    style={style}
  >
    {body}
    {illustrationReady
      ? <span className="gb-venue-cover__badge" aria-hidden="true">Иллюстрация</span>
      : null}
  </span>;
}
