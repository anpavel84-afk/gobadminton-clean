/** Additive owned-media slot; shared OwnSocialProfile version, same cookie mutation protocol. */
export type PlayerCover = { uploadedUrl: string | null };
export type CoverReceipt = { version: number; cover: PlayerCover };

export type DeleteCoverCommand = { expectedVersion: number };
