"use client";
import { useState } from "react";
/** Only the current server-authorized derivative. The neutral local shell is not a venue photograph. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}
export function VenueCover({ cover, className = "", name = "площадки" }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string;
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={`gb-venue-cover ${className}`} data-cover={url && failed !== url ? "uploaded" : "default"}>
    {url && failed !== url ? <img src={url} alt={`Обложка: ${name}`} loading="lazy" decoding="async" onError={() => setFailed(url)} />
      : <span className="gb-venue-cover__default" role="img" aria-label="Обложка площадки недоступна"><span aria-hidden="true">▱</span></span>}
  </span>;
}
