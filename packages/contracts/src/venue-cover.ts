/** Existing AdminSessionCookie, venue.manage AND venue.createdBy=current active user.
 * Every write/replay reauthorizes; upload also requires fresh step-up, CSRF, Origin and CAS.
 * No consumer role, venueId or UI flag is an authorization grant.
 */
export type VenueCoverCredit = { kind: "photo" | "logo" | "illustration"; text: string; url: string | null };
export type VenueCover = { uploadedUrl: string | null; credit?: VenueCoverCredit | null };
/** Authorized retained-cover presence, independent of public moderation visibility. */
export type VenueCoverReceipt = { version: number; hasCover: boolean; cover: VenueCover };
export type VenueCoverAccess = VenueCoverReceipt & { csrfToken: string };
export type DeleteVenueCoverCommand = { expectedVersion: number };

export type VenueGalleryAdminItem = {
  id: string;
  position: number;
  isMain: boolean;
  kind: "photo" | "logo" | "illustration";
  uploadedUrl: string | null;
  credit: VenueCoverCredit;
  sourceUrl: string | null;
  sourceAuthor: string | null;
  permissionBasis: string;
  sourceFingerprint: string | null;
};
export type VenueGalleryReceipt = { version: number; items: VenueGalleryAdminItem[] };
export type VenueGalleryReorderCommand = { expectedVersion: number; orderedIds: string[] };
export type VenueGalleryItemCommand = { expectedVersion: number };
