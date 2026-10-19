"use client";
import { useState } from "react";
/** Only the current server-authorized derivative. */
export function venueCoverUrl(url: unknown): string | null {
  return typeof url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(url) ? url : null;
}
export function VenueCover({ cover, className = "", name = "площадки", fallback = "court" }: {
  cover?: { uploadedUrl: string | null }; className?: string; name?: string; fallback?: "court" | "trainer";
}) {
  const url = venueCoverUrl(cover?.uploadedUrl);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={`gb-venue-cover ${className}`} data-cover={url && failed !== url ? "uploaded" : "default"} data-fallback={url && failed !== url ? undefined : fallback}>
    {url && failed !== url ? <img src={url} alt={`Обложка: ${name}`} loading="lazy" decoding="async" onError={() => setFailed(url)} />
      : <img src={fallback === "trainer" ? "/discovery/badminton-gear.jpg" : "/discovery/badminton-courts.jpg"} alt={fallback === "trainer" ? "Ракетка и воланы на корте" : "Бадминтонный корт"} loading="lazy" decoding="async" />}
  </span>;
}
