import { apiFetch } from "./api-client";
import { isPhotoId } from "./comments-api";
import { httpsCreditUrl } from "./original-http-authority";

export const VENUE_CANDIDATE_RIGHTS = "venue-candidate-rights-v1";
export type CandidateEvidence = {
  creditKind: "photo"; creditText: string; creditUrl: string; sourceUrl: string;
  permissionBasis: string; sourceAuthor?: string | null; sourceFingerprint?: string | null;
};
export type VenuePhotoCandidate = {
  id: string; venueId: string; status: "awaiting_review" | "accepted" | "rejected" | "withdrawn";
  version: number; width: 1200; height: 400; evidence: CandidateEvidence; previewPath: string | null;
};
const clean = (text: string) => !/[\u0000-\u001f\u007f-\u009f]/u.test(text);
const url = (text: unknown): text is string => typeof text === "string" && text.length <= 300
  && text.startsWith("https://") && httpsCreditUrl(text) !== null;
export function isCandidateEvidence(value: unknown): value is CandidateEvidence {
  if (!value || typeof value !== "object") return false;
  const e = value as CandidateEvidence;
  return e.creditKind === "photo" && typeof e.creditText === "string"
    && e.creditText.startsWith("Фото: ") && e.creditText.trim().length >= 7 && e.creditText.length <= 120 && clean(e.creditText)
    && url(e.creditUrl) && url(e.sourceUrl) && typeof e.permissionBasis === "string"
    && e.permissionBasis.trim().length > 0 && e.permissionBasis.length <= 600 && clean(e.permissionBasis)
    && !/^(approved|licensed|ok|yes|true)$/i.test(e.permissionBasis.trim())
    && (e.sourceAuthor == null || (typeof e.sourceAuthor === "string" && e.sourceAuthor.trim().length > 0 && e.sourceAuthor.length <= 120 && clean(e.sourceAuthor)))
    && (e.sourceFingerprint == null || (typeof e.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(e.sourceFingerprint)));
}
export function isVenuePhotoCandidate(value: unknown, venueId: string, id?: string): value is VenuePhotoCandidate {
  if (!value || typeof value !== "object") return false;
  const row = value as VenuePhotoCandidate;
  return isPhotoId(row.id) && (!id || row.id === id) && row.venueId === venueId && isPhotoId(row.venueId)
    && ["awaiting_review", "accepted", "rejected", "withdrawn"].includes(row.status)
    && row.version === (row.status === "awaiting_review" ? 1 : 2) && row.width === 1200 && row.height === 400
    && isCandidateEvidence(row.evidence)
    && row.previewPath === (row.status === "awaiting_review" ? `/v1/me/venue-photo-candidates/${row.id}/content` : null);
}
export function uploadVenuePhotoCandidate(venueId: string, bytes: Blob, evidence: CandidateEvidence, key: string, csrfToken: string, signal: AbortSignal) {
  // Text headers are ASCII ByteStrings. Encode exactly once, including real Cyrillic credits.
  const optional = (text: string | null | undefined) => text == null ? "null" : encodeURIComponent(text);
  return apiFetch<unknown>(`/v1/venues/${encodeURIComponent(venueId)}/photo-candidates`, {
    method: "POST", body: bytes, csrfToken, signal,
    headers: {
      "Content-Type": bytes.type, "Idempotency-Key": key, "X-Photo-Rights": VENUE_CANDIDATE_RIGHTS,
      "X-Gallery-Credit-Kind": "photo", "X-Gallery-Credit-Text": encodeURIComponent(evidence.creditText),
      "X-Gallery-Credit-Url": encodeURIComponent(evidence.creditUrl), "X-Gallery-Source-Url": encodeURIComponent(evidence.sourceUrl),
      "X-Gallery-Source-Author": optional(evidence.sourceAuthor), "X-Gallery-Permission-Basis": encodeURIComponent(evidence.permissionBasis),
      "X-Gallery-Source-Fingerprint": evidence.sourceFingerprint ?? "null",
    },
  });
}
export function getOwnedVenuePhotoCandidate(id: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/me/venue-photo-candidates/${encodeURIComponent(id)}`, { signal });
}
export function withdrawVenuePhotoCandidate(id: string, key: string, csrfToken: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/me/venue-photo-candidates/${encodeURIComponent(id)}`, {
    method: "DELETE", body: JSON.stringify({ expectedVersion: 1 }), csrfToken, signal,
    headers: { "Idempotency-Key": key, "X-Photo-Version": "1" },
  });
}
export async function candidatePrivatePreview(candidate: VenuePhotoCandidate, signal: AbortSignal): Promise<Blob> {
  if (!isVenuePhotoCandidate(candidate, candidate.venueId, candidate.id) || candidate.status !== "awaiting_review") throw new Error("Candidate unavailable");
  const response = await fetch(candidate.previewPath!, { signal, credentials: "include", cache: "no-store", redirect: "error" });
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "image/png") throw new Error("Preview unavailable");
  const bytes = await response.blob();
  if (!bytes.size || bytes.size > 5 * 1024 * 1024) throw new Error("Preview unavailable");
  return bytes;
}
