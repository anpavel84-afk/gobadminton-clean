/** Game-scoped management only; no venue/global admin grant is required or conferred.
 * uploadedUrl is the effective server projection, never a client-selected arbitrary URL.
 * null selects the canonical standard default. Venue fallback is live, never stored on Game.
 */
export type GameCoverReceipt = { version: number; hasCover: boolean; cover: { uploadedUrl: string | null } };
export type DeleteGameCoverCommand = { expectedVersion: number };
