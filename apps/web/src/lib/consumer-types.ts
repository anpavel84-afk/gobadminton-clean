export type ActivityKind = "regular" | "trainer_led";
export type GameStatus = "draft" | "published" | "cancelled" | "completed";
export type GameVisibility = "public" | "unlisted";
export type ParticipationStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "withdrawn"
  | "removed"
  | "cancelled_by_game"
  | "expired";

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  requestId: string;
  detail?: string;
};

export type Me = {
  id: string;
  displayName: string;
  locale: string;
  linkedProviders: string[];
  csrfToken: string;
};

export type LinkedProviderStatus = "connected" | "available" | "unavailable";

export type LinkedProviderItem = {
  provider: "vk" | "yandex";
  label: string;
  status: LinkedProviderStatus;
  linkedAt?: string;
};

export type LinkedProvidersResponse = {
  items: LinkedProviderItem[];
};

export type SessionItem = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type SessionsResponse = {
  items: SessionItem[];
};

export type RevokeOtherSessionsResponse = SessionsResponse & {
  revokedCount: number;
};

export type City = {
  id: string;
  countryCode: string;
  nameRu: string;
  nameEn: string;
  defaultTimezone: string;
};

export type VenueSummary = {
  cover?: { uploadedUrl: string | null };
  id: string;
  name: string;
  cityId: string;
  address: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
};

export type OrganizerSummary = {
  avatar?: PlayerAvatar;
  id: string | null;
  displayName: string;
  publicContact: string;
};

export type LevelRule = {
  scaleId: string;
  scaleVersion: number;
  allowedLevelIds: string[];
};

export type Settlement =
  | {
      mode: "external";
      purpose: "no_trainer_fee";
      priceMinor: null;
      currency: null;
      terms: string;
    }
  | {
      mode: "external";
      purpose: "trainer_fee";
      priceStatus: "by_agreement";
      priceMinor: null;
      currency: null;
      terms: string;
    }
  | {
      mode: "external";
      purpose: "trainer_fee";
      priceStatus: "fixed";
      priceUnit: "per_player_per_session";
      priceMinor: string;
      currency: string;
      terms: string;
    };

export type GameTrainerSummary = {
  profileId: string;
  displayName: string;
  declarationSource: "self_declared";
};

export type Game = {
  cover?: { uploadedUrl: string | null };
  id: string;
  version: number;
  title: string;
  status: GameStatus;
  visibility: GameVisibility;
  activityKind: ActivityKind;
  trainer: GameTrainerSummary | null;
  trainingDescription: string | null;
  organizer: OrganizerSummary;
  venue: VenueSummary;
  startsAt: string;
  endsAt: string;
  timezone: string;
  applicationDeadlineAt: string;
  capacity: number;
  externalReservedCount: number;
  confirmedCount: number;
  availablePlaces: number;
  formatKey: string;
  levelRule: LevelRule;
  settlement: Settlement;
};

export type GamePage = {
  items: Game[];
  nextCursor: string | null;
};

export type GameManagement = {
  role: "owner" | "manager";
  /** Server-derived from games.created_by_user_id; never client-supplied. */
  createdByMe: boolean;
};

export type ManagedGame = Game & {
  management: GameManagement;
};

export type ManagedGamePage = {
  items: ManagedGame[];
  nextCursor: string | null;
};

export type Participation = {
  isCreatorOrganizer?: boolean;
  id: string;
  gameId: string;
  userId: string;
  status: ParticipationStatus;
  version: number;
  attemptNumber: number;
  requestedAt: string;
  confirmedAt?: string | null;
};

export type ParticipationPage = {
  items: Participation[];
  nextCursor: string | null;
};

export type TrainerProfile = {
  id: string;
  version: number;
  displayName: string;
  bio: string | null;
  declarationSource: "self_declared";
  declaredAt: string;
  status: "active" | "inactive";
};

export type CreateGameInput = {
  savePublicContactDefault?: { expectedVersion: number };
  hostDisplayName: string;
  hostPublicContact: string;
  venueId: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  applicationDeadlineAt: string;
  capacity: number;
  externalReservedCount: number;
  visibility: GameVisibility;
  formatKey: string;
  activityKind: ActivityKind;
  levelRule: LevelRule;
  settlement: Settlement;
  trainingDescription?: string | null;
};

export type CreateVenueInput = {
  cityId: string;
  name: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
};

export type Venue = CreateVenueInput & {
  cover?: { uploadedUrl: string | null };
  id: string;
  dataStatus: string;
  provenance: string;
};


export type SocialLevel = {
  scaleId: string;
  scaleVersion: number;
  levelId: string;
  provenance: "self_declared";
};

export type LookingIntent = {
  version: number;
  state: "active" | "inactive";
  cityId: string | null;
  areaKey: string | null;
  startsAt: string | null;
  endsAt: string | null;
  expiresAt: string | null;
  formatKeys: string[];
};

export type OwnSocialProfile = {
  cover?: { uploadedUrl: string | null };
  avatar?: PlayerAvatar;
  publicPlayerId: string | null;
  version: number;
  displayName: string;
  cityId: string | null;
  areaKey: string | null;
  level: SocialLevel | null;
  bio: string | null;
  directoryVisible: boolean;
  contactPolicy: "requests" | "closed";
  consentPolicyVersion: string | null;
  optedInAt: string | null;
  radarConsented: boolean;
  radarConsentPolicyVersion: string | null;
  radarConsentedAt: string | null;
  socialEligible: boolean;
  trainer: boolean;
  lookingForGame: LookingIntent | null;
};

export type PublicPlayer = {
  cover?: { uploadedUrl: string | null };
  /** Missing on older servers means unavailable. Commands revalidate. */
  canRequestContact?: boolean;
  avatar?: PlayerAvatar;
  publicPlayerId: string;
  displayName: string;
  cityId: string | null;
  areaKey: string | null;
  level: SocialLevel | null;
  bio: string | null;
  trainer: boolean;
  lookingForGame: boolean;
};

export type PublicPlayerPage = {
  items: PublicPlayer[];
  nextCursor: string | null;
};

export type PatchSocialProfileInput = {
  expectedVersion?: number;
  displayName?: string;
  cityId?: string | null;
  areaKey?: string | null;
  level?: SocialLevel | null;
  bio?: string | null;
  contactPolicy?: "requests" | "closed";
  radarConsented?: boolean;
  radarConsentPolicyVersion?: string;
  socialEligible?: boolean;
};

export type SocialProfileVisibilityInput = {
  directoryVisible: boolean;
  consentPolicyVersion?: string;
  expectedVersion: number;
};

export type LookingForGamePutInput = {
  cityId: string;
  areaKey?: string | null;
  ttlMinutes?: number;
  formatKeys?: string[];
  expectedVersion?: number;
};

export type BlockReceipt = {
  publicPlayerId: string;
  blocked: boolean;
};

export type AbuseReportReasonCode =
  | "harassment"
  | "spam"
  | "fake_profile"
  | "inappropriate"
  | "other";

export type CreateAbuseReportInput = {
  targetKind: "player";
  targetPublicPlayerId: string;
  reasonCode: AbuseReportReasonCode;
  detail?: string | null;
  evidenceRefs?: string[];
};

export type AbuseReportReceipt = {
  reportId: string;
  status: string;
  createdAt: string;
};

/** Named blockers for missing authoritative contracts (do not fabricate). */
export const API_BLOCKERS = {
  REQUEST_ATTENTION_COUNT:
    "BLOCKER: no authoritative per-Game pending-request count on ManagedGame; do not invent attention chips.",
  VENUE_CATALOG:
    "BLOCKER: no public venue catalog/list endpoint; create may use POST /venues or venue ids observed in discovery for the selected city.",
  LEVEL_FORMAT_CATALOG:
    "BLOCKER: no authoritative level/format catalog endpoint; UI uses contract string fields with pilot values only.",
  GEOLOCATION:
    "C-GEO: geolocation omitted; manual city path via GET /cities only.",
} as const;

/** Consumer wording for unavailable capabilities; internal evidence remains above. */
export const UNAVAILABLE_COPY = {
  REQUEST_ATTENTION_COUNT: "Количество новых заявок пока недоступно.",
  VENUE_CATALOG: "Каталог площадок пока недоступен. Выберите площадку из найденных игр или добавьте новую.",
  LEVEL_FORMAT_CATALOG: "Укажите формат и подходящие уровни игры.",
} as const;

/** Additive avatar projection; missing on older API candidates. */
export type PlayerAvatar = { uploadedUrl: string | null; providerUrl: string | null };
