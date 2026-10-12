/**
 * Deterministic synthetic demo identity space.
 * All mutable demo rows use these IDs so seed/cleanup never touch non-demo data.
 */

export const DEMO_ISSUER_NAMESPACE = "demo:synthetic:foundation-v001";
export const DEMO_POPULATION_VERSION = "SYNTHETIC_DEMO_POPULATION_V001";
/** Moscow catalog city (migration 0003). */
export const DEMO_MOSCOW_CITY_ID = "a0000000-0000-4000-8000-000000000001";
/** Санкт-Петербург catalog city (migration 0016). */
export const DEMO_SPB_CITY_ID = "a0000000-0000-4000-8000-000000000002";
/** @deprecated Prefer DEMO_MOSCOW_CITY_ID; kept as Moscow alias for existing imports. */
export const DEMO_CITY_ID = DEMO_MOSCOW_CITY_ID;

/** UUID: d0f0KKKK-0000-4000-8000-IIIIIIIIIIII (hex only). */
function demoUuid(kind: number, index: number): string {
  if (!Number.isInteger(kind) || kind < 0 || kind > 0xffff) {
    throw new Error(`demo kind out of range: ${kind}`);
  }
  if (!Number.isInteger(index) || index < 1 || index > 0xffffffff) {
    throw new Error(`demo index out of range: ${index}`);
  }
  const kindHex = kind.toString(16).padStart(4, "0");
  const indexHex = index.toString(16).padStart(12, "0");
  return `d0f0${kindHex}-0000-4000-8000-${indexHex}`;
}

export const DemoKind = {
  user: 0x0001,
  identity: 0x0002,
  publicPlayer: 0x0003,
  venue: 0x0010,
  trainer: 0x0011,
  game: 0x0020,
  gameManager: 0x0021,
  participation: 0x0030,
  participationTransition: 0x0031,
  /** Undirected social_pairs row keyed by sorted person ordinals. */
  socialPair: 0x0040,
  dmConversation: 0x0041,
  gameConversation: 0x0042,
  message: 0x0043,
  gameInvitation: 0x0044,
  /** Ephemeral demo Radar peer session (runtime cohort, not seed presence). */
  radarSession: 0x0050,
  /** Ephemeral demo Radar peer activation id. */
  radarActivation: 0x0051,
} as const;

export function demoUserId(n: number): string {
  return demoUuid(DemoKind.user, n);
}
export function demoIdentityId(n: number): string {
  return demoUuid(DemoKind.identity, n);
}
export function demoPublicPlayerId(n: number): string {
  return demoUuid(DemoKind.publicPlayer, n);
}
export function demoVenueId(n: number): string {
  return demoUuid(DemoKind.venue, n);
}
export function demoTrainerId(n: number): string {
  return demoUuid(DemoKind.trainer, n);
}
export function demoGameId(n: number): string {
  return demoUuid(DemoKind.game, n);
}
export function demoGameManagerId(n: number): string {
  return demoUuid(DemoKind.gameManager, n);
}
export function demoParticipationId(n: number): string {
  return demoUuid(DemoKind.participation, n);
}
export function demoParticipationTransitionId(n: number): string {
  return demoUuid(DemoKind.participationTransition, n);
}

/**
 * Deterministic social_pairs id for two person ordinals (order-independent).
 * Index encoding: low*100 + high (ordinals 1..20 → unique 101..1920).
 */
export function demoSocialPairId(ordinalA: number, ordinalB: number): string {
  if (ordinalA === ordinalB) {
    throw new Error(`demo social pair requires distinct ordinals: ${ordinalA}`);
  }
  const low = Math.min(ordinalA, ordinalB);
  const high = Math.max(ordinalA, ordinalB);
  return demoUuid(DemoKind.socialPair, low * 100 + high);
}

export function demoDmConversationId(n: number): string {
  return demoUuid(DemoKind.dmConversation, n);
}

/** One game-chat conversation per demo game ordinal. */
export function demoGameConversationId(gameOrdinal: number): string {
  return demoUuid(DemoKind.gameConversation, gameOrdinal);
}

export function demoMessageId(n: number): string {
  return demoUuid(DemoKind.message, n);
}

export function demoGameInvitationId(n: number): string {
  return demoUuid(DemoKind.gameInvitation, n);
}

export function demoRadarSessionId(n: number): string {
  return demoUuid(DemoKind.radarSession, n);
}

export function demoRadarActivationId(n: number): string {
  return demoUuid(DemoKind.radarActivation, n);
}

/** All person ordinals 1..20 from SYNTHETIC_DEMO_POPULATION_V001. */
export const DEMO_PERSON_ORDINALS = Array.from(
  { length: 20 },
  (_, i) => i + 1,
) as readonly number[];

export const DEMO_USER_IDS = DEMO_PERSON_ORDINALS.map(demoUserId);
/** 4 Moscow + 2 SPB synthetic venues. */
export const DEMO_VENUE_IDS = [1, 2, 3, 4, 5, 6].map(demoVenueId);
/** Exactly 20 demo games across Moscow + Санкт-Петербург. */
export const DEMO_GAME_IDS = Array.from({ length: 20 }, (_, i) =>
  demoGameId(i + 1),
);

/** DM conversation ordinals used by social backfill (deterministic). */
export const DEMO_DM_CONVERSATION_ORDINALS = Array.from(
  { length: 10 },
  (_, i) => i + 1,
) as readonly number[];

export const DEMO_DM_CONVERSATION_IDS = DEMO_DM_CONVERSATION_ORDINALS.map(
  demoDmConversationId,
);

/**
 * Game chats for seeded games except draft (13).
 * Includes closed cancelled representatives (12, 20).
 */
export const DEMO_GAME_CHAT_ORDINALS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20,
] as const;

export const DEMO_GAME_CONVERSATION_IDS = DEMO_GAME_CHAT_ORDINALS.map(
  demoGameConversationId,
);

export const DEMO_GAME_INVITATION_ORDINALS = Array.from(
  { length: 8 },
  (_, i) => i + 1,
) as readonly number[];

export const DEMO_GAME_INVITATION_IDS = DEMO_GAME_INVITATION_ORDINALS.map(
  demoGameInvitationId,
);

/** Predicate for SQL filters / safety checks. */
export function isDemoUuid(id: string): boolean {
  return /^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$/i.test(id);
}
