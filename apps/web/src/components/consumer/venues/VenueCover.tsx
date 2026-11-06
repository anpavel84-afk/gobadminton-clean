"use client";
import { useState, type CSSProperties } from "react";
import { VENUE_ILLUSTRATION_ALT, venueIllustrationUrl } from "../../../lib/venue-illustration";
/** Only the current server-authorized derivative. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}
export function VenueCover({ cover, className = "", name = "площадки", fallback = "court", venueId }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string; fallback?: "court" | "trainer"; venueId?: string;
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  // Derive load eligibility from the current url+venueId so URL/id changes never flash a stale photo.
  const [phase, setPhase] = useState<{ key: string; loaded: string | null; failed: string | null }>(() => ({
    key: `${venueId ?? ""}|${url ?? ""}`,
    loaded: null,
    failed: null,
  }));
  const key = `${venueId ?? ""}|${url ?? ""}`;
  if (phase.key !== key) {
    setPhase({ key, loaded: null, failed: null });
  }
  const failed = phase.key === key ? phase.failed : null;
  const loaded = phase.key === key ? phase.loaded : null;
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
  // Per-venue illustration as CSS background while the uploaded photo is still pending —
  // avoids an empty grey cell without a second DOM img. Clear once ready so transparent logos sit on neutral surface.
  const pendingIllustration = uploadedPending ? venueIllustrationUrl(venueId!) : null;
  const style: CSSProperties | undefined = pendingIllustration
    ? { backgroundImage: `url("${pendingIllustration}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : uploadedReady && gatePending
      ? { backgroundImage: "none", backgroundColor: "var(--c23-surface)" }
      : undefined;
  return <span
    className={`gb-venue-cover ${className}`}
    data-cover={uploadedReady ? "uploaded" : "default"}
    data-fallback={uploadedReady ? undefined : (pendingIllustration ? "illustration" : fallbackKind)}
    data-pending={uploadedPending ? "uploaded" : undefined}
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
            if (node.complete && node.naturalWidth > 0) setPhase({ key, loaded: url, failed: null });
          }}
          onLoad={() => {
            if (gatePending) setPhase({ key, loaded: url, failed: null });
          }}
          onError={() => setPhase({ key, loaded: null, failed: url })}
        />
      : <img src={fallbackSrc} alt={fallbackAlt} loading="lazy" decoding="async" />}
  </span>;
}
