"use client";
import { useState, type CSSProperties } from "react";
import {
  VENUE_ILLUSTRATION_ALT,
  venueEquipmentPlaceholderStyle,
  venueIllustrationUrl,
} from "../../../lib/venue-illustration";

type CoverPhase = {
  key: string;
  /** Last successfully decoded raster src (uploaded or fallback). */
  loaded: string | null;
  /** Sticky: uploaded cover URL that failed; cleared only on url+venue key change. */
  failed: string | null;
  /** Fallback raster failed — keep SVG underlay; never claim loaded; hide broken img. */
  fallbackError: boolean;
};

/** Only the current server-authorized derivative. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}
export function VenueCover({ cover, className = "", name = "площадки", fallback = "court", venueId }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string; fallback?: "court" | "trainer"; venueId?: string;
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  // Derive load eligibility from the current url+venueId so URL/id changes never flash a stale photo.
  const [phase, setPhase] = useState<CoverPhase>(() => ({
    key: `${venueId ?? ""}|${url ?? ""}`,
    loaded: null,
    failed: null,
    fallbackError: false,
  }));
  const key = `${venueId ?? ""}|${url ?? ""}`;
  if (phase.key !== key) {
    setPhase({ key, loaded: null, failed: null, fallbackError: false });
  }
  const failed = phase.key === key ? phase.failed : null;
  const loaded = phase.key === key ? phase.loaded : null;
  const fallbackError = phase.key === key ? phase.fallbackError : false;
  // Pending illustration gate only when a per-venue illustration can fill the cell (picker/thumbs).
  // Without venueId keep the previous immediate uploaded paint (discovery/hero paths).
  const gatePending = Boolean(venueId);
  const uploadedReady = Boolean(url && failed !== url && (!gatePending || loaded === url));
  const uploadedPending = Boolean(url && failed !== url && gatePending && loaded !== url);
  const useIllustration = !uploadedReady && Boolean(venueId);
  const fallbackSrc = useIllustration
    ? venueIllustrationUrl(venueId!)
    : (fallback === "trainer" ? "/discovery/badminton-gear.jpg" : "/discovery/badminton-courts.jpg");
  const fallbackAlt = useIllustration
    ? VENUE_ILLUSTRATION_ALT
    : (fallback === "trainer" ? "Ракетка и воланы на корте" : "Бадминтонный корт");
  const fallbackKind = useIllustration ? "illustration" : fallback;
  // Illustration/court/trainer img is itself a network asset — gate until onLoad when venue-scoped.
  // Original failure must not clear sticky `failed`; fallback success never revives the bad cover.
  const fallbackPending = Boolean(
    !uploadedReady
    && !(url && failed !== url)
    && gatePending
    && loaded !== fallbackSrc
    && !fallbackError,
  );
  // Immediate inline SVG underlay (no asset request). Stays on fallback raster failure too.
  const showEquipmentUnderlay = uploadedPending || fallbackPending || fallbackError;
  const style: CSSProperties | undefined = showEquipmentUnderlay
    ? venueEquipmentPlaceholderStyle()
    : uploadedReady && gatePending
      ? { backgroundImage: "none", backgroundColor: "var(--c23-surface)" }
      : undefined;
  return <span
    className={`gb-venue-cover ${className}`}
    data-cover={uploadedReady ? "uploaded" : "default"}
    data-fallback={uploadedReady ? undefined : (showEquipmentUnderlay ? "illustration" : fallbackKind)}
    data-pending={uploadedPending ? "uploaded" : fallbackPending ? "fallback" : undefined}
    style={style}
  >
    {url && failed !== url
      ? <img
          src={url}
          alt={`Обложка: ${name}`}
          loading="lazy"
          decoding="async"
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
        />
      : <img
          src={fallbackSrc}
          alt={fallbackAlt}
          loading="lazy"
          decoding="async"
          style={fallbackPending || fallbackError ? { opacity: 0 } : undefined}
          ref={(node) => {
            if (!node || !gatePending || loaded === fallbackSrc || fallbackError) return;
            if (!node.complete) return;
            if (node.naturalWidth > 0) {
              // Preserve sticky original failure — fallback success must not revive bad cover.
              setPhase({ key, loaded: fallbackSrc, failed, fallbackError: false });
            } else {
              setPhase({ key, loaded: null, failed, fallbackError: true });
            }
          }}
          onLoad={() => {
            if (gatePending) setPhase({ key, loaded: fallbackSrc, failed, fallbackError: false });
          }}
          onError={() => {
            // Keep immediate SVG underlay; hide broken raster; never claim loaded or clear original failure.
            if (gatePending) setPhase({ key, loaded: null, failed, fallbackError: true });
          }}
        />}
  </span>;
}
