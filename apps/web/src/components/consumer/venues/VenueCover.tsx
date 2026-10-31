"use client";
import { useState } from "react";
import { VENUE_ILLUSTRATION_ALT, venueIllustrationUrl } from "../../../lib/venue-illustration";
/** Only the current server-authorized derivative. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}
export function VenueCover({ cover, className = "", name = "площадки", fallback = "court", venueId }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string; fallback?: "court" | "trainer"; venueId?: string;
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  const [failed, setFailed] = useState<string | null>(null);
  const showUploaded = Boolean(url && failed !== url);
  const useIllustration = !showUploaded && Boolean(venueId);
  const fallbackSrc = useIllustration
    ? venueIllustrationUrl(venueId!)
    : (fallback === "trainer" ? "/discovery/badminton-gear.jpg" : "/discovery/badminton-courts.jpg");
  const fallbackAlt = useIllustration
    ? VENUE_ILLUSTRATION_ALT
    : (fallback === "trainer" ? "Ракетка и воланы на корте" : "Бадминтонный корт");
  const fallbackKind = useIllustration ? "illustration" : fallback;
  return <span className={`gb-venue-cover ${className}`} data-cover={showUploaded ? "uploaded" : "default"} data-fallback={showUploaded ? undefined : fallbackKind}>
    {showUploaded ? <img src={url!} alt={`Обложка: ${name}`} loading="lazy" decoding="async" onError={() => setFailed(url)} />
      : <img src={fallbackSrc} alt={fallbackAlt} loading="lazy" decoding="async" />}
  </span>;
}
