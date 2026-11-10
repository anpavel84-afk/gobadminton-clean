import { apiFetch } from "./api-client";
import { isPhotoId } from "./comments-api";
import type { VenueCommunityPhotoPage } from "./comments-types";

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


/** Actual API 0.42: opaque cursor, fixed 24-item page, no total. */
export function getVenueCommunityPhotos(venueId: string, cursor: string | null, signal: AbortSignal) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<unknown>(`/v1/venues/${encodeURIComponent(venueId)}/community-photos${query}`, { signal, cache: "no-store" });
}
export function isCommunityPhotoPage(value: unknown): value is VenueCommunityPhotoPage {
  if (!value || typeof value !== "object") return false;
  const page = value as VenueCommunityPhotoPage;
  if (!isPhotoId(page.venueId) || !Array.isArray(page.items) || page.items.length > 24
    || !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0 && page.nextCursor.length <= 1024))
    || (page.nextCursor !== null && page.items.length !== 24)) return false;
  const ids = new Set<string>();
  return page.items.every((photo) => {
    if (!photo || !isPhotoId(photo.id) || ids.has(photo.id)) return false;
    ids.add(photo.id);
    const s = photo.source;
    return s && isPhotoId(s.commentId) && (s.parentCommentId === null || isPhotoId(s.parentCommentId))
      && s.parentCommentId !== s.commentId && Number.isInteger(s.resourceVersion) && s.resourceVersion > 0
      && s.path === `/v1/comments/${s.commentId}`
      && photo.url === `/v1/comments/${s.commentId}/revisions/${s.resourceVersion}/photos/${photo.id}`
      && Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 1600
      && Number.isInteger(photo.height) && photo.height > 0 && photo.height <= 1600;
  });
}
