import { apiFetch } from "./api-client";
import { isPhotoId } from "./comments-api";

export const PHOTO_RIGHTS = "community-photo-rights-v1";
export type VenueCommentPhotoReceipt = {
  id: string; venueId: string; status: "ready" | "withdrawn"; version: number;
  expiresAt: string; width: number; height: number; previewPath: string | null;
};
export function isPhotoReceipt(value: unknown, venueId: string, status: "ready" | "withdrawn", id?: string): value is VenueCommentPhotoReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as VenueCommentPhotoReceipt;
  return isPhotoId(row.id) && (!id || row.id === id) && row.venueId === venueId
    && row.status === status && row.version === (status === "ready" ? 1 : 2)
    && Number.isFinite(Date.parse(row.expiresAt))
    && (status !== "ready" || Date.parse(row.expiresAt) > Date.now())
    && Number.isInteger(row.width) && row.width > 0 && row.width <= 1600
    && Number.isInteger(row.height) && row.height > 0 && row.height <= 1600
    && row.previewPath === (status === "ready" ? `/v1/me/venue-photo-submissions/${row.id}/content` : null);
}
export function uploadVenueCommentPhoto(venueId: string, file: Blob, key: string, csrfToken: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/venues/${encodeURIComponent(venueId)}/comment-photos`, {
    method: "POST", body: file, csrfToken, signal,
    headers: { "Content-Type": file.type, "Idempotency-Key": key, "X-Photo-Rights": PHOTO_RIGHTS },
  });
}
export function getOwnedVenueCommentPhoto(id: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/me/venue-photo-submissions/${encodeURIComponent(id)}`, { signal });
}
export function withdrawVenueCommentPhoto(id: string, key: string, csrfToken: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/me/venue-photo-submissions/${encodeURIComponent(id)}`, {
    method: "DELETE", body: JSON.stringify({ expectedVersion: 1 }), csrfToken, signal,
    headers: { "Idempotency-Key": key, "X-Photo-Version": "1" },
  });
}
