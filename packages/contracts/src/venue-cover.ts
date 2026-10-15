/** Existing AdminSessionCookie, venue.manage AND venue.createdBy=current active user.
 * Every write/replay reauthorizes; upload also requires fresh step-up, CSRF, Origin and CAS.
 * No consumer role, venueId or UI flag is an authorization grant.
 */
export type VenueCover = { uploadedUrl: string | null };
export type VenueCoverReceipt = { version: number; cover: VenueCover };
export type VenueCoverAccess = VenueCoverReceipt & { csrfToken: string };
export type DeleteVenueCoverCommand = { expectedVersion: number };
