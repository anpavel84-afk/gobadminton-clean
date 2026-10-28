import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  integer,
  index,
  uniqueIndex,
  jsonb,
  pgTable,
  bigint,
  doublePrecision,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Typed mirror of the migration-managed schema_migrations table. */
export const schemaMigrations = pgTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").notNull().default("active"),
  locale: text("locale").notNull().default("ru"),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
});

export const externalIdentities = pgTable("external_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  providerKey: text("provider_key").notNull(),
  issuerNamespace: text("issuer_namespace").notNull(),
  subject: text("subject").notNull(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authTransactions = pgTable("auth_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  stateHash: text("state_hash").notNull(),
  providerKey: text("provider_key").notNull(),
  clientAudience: text("client_audience").notNull().default("browser"),
  redirectUri: text("redirect_uri").notNull(),
  returnPath: text("return_path").notNull(),
  bindingHash: text("binding_hash").notNull(),
  pkceVerifierCiphertext: text("pkce_verifier_ciphertext").notNull(),
  pkceChallenge: text("pkce_challenge").notNull(),
  purpose: text("purpose").notNull().default("login"),
  boundUserId: uuid("bound_user_id"),
  boundSessionId: uuid("bound_session_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSessions = pgTable("app_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  audience: text("audience").notNull().default("consumer_browser"),
  authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull().defaultNow(),
  sessionHash: text("session_hash").notNull(),
  csrfCiphertext: text("csrf_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizers = pgTable("organizers", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull().default("personal"),
  displayName: text("display_name").notNull(),
  publicContact: text("public_contact").notNull(),
  onboardingStatus: text("onboarding_status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizerMemberships = pgTable("organizer_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizerId: uuid("organizer_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const cities = pgTable("cities", {
  id: uuid("id").primaryKey(),
  countryCode: text("country_code").notNull(),
  nameRu: text("name_ru").notNull(),
  nameEn: text("name_en").notNull(),
  defaultTimezone: text("default_timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const venues = pgTable("venues", {
  publicContacts: jsonb("public_contacts"),
  courtCount: integer("court_count"),
  amenityParking: boolean("amenity_parking"),
  amenityShowers: boolean("amenity_showers"),
  publicProfileUpdatedAt: timestamp("public_profile_updated_at", { withTimezone: true }),
  contactPhone: text("contact_phone"),
  contactWebsite: text("contact_website"),
  bookingNote: text("booking_note"),
  contactUpdatedAt: timestamp("contact_updated_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  id: uuid("id").defaultRandom().primaryKey(),
  cityId: uuid("city_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  timezone: text("timezone").notNull(),
  dataStatus: text("data_status").notNull().default("verified"),
  provenance: text("provenance").notNull().default("organizer_submitted"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  lifecycleState: text("lifecycle_state").notNull().default("unverified"),
  normalizedName: text("normalized_name").notNull().default(""),
  normalizedAddress: text("normalized_address").notNull().default(""),
  normalizationVersion: integer("normalization_version").notNull().default(1),
  canonicalVenueId: uuid("canonical_venue_id"),
  identityDiscriminator: text("identity_discriminator").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("venues_court_count_check", sql`${table.courtCount} >= 0`)]);

export const trainerProfiles = pgTable("trainer_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  declarationSource: text("declaration_source").notNull().default("self_declared"),
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizerId: uuid("organizer_id"),
  hostDisplayName: text("host_display_name").notNull(),
  hostPublicContact: text("host_public_contact").notNull(),
  venueId: uuid("venue_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  visibility: text("visibility").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  applicationDeadlineAt: timestamp("application_deadline_at", {
    withTimezone: true,
  }).notNull(),
  capacity: integer("capacity").notNull(),
  externalReservedCount: integer("external_reserved_count").notNull().default(0),
  formatKey: text("format_key").notNull(),
  levelScaleId: text("level_scale_id").notNull(),
  levelScaleVersion: integer("level_scale_version").notNull(),
  allowedLevelIds: jsonb("allowed_level_ids").notNull(),
  activityKind: text("activity_kind"),
  trainerProfileId: uuid("trainer_profile_id"),
  trainerDisplayNameSnapshot: text("trainer_display_name_snapshot"),
  trainingDescription: text("training_description"),
  settlementMode: text("settlement_mode").notNull(),
  settlementPurpose: text("settlement_purpose"),
  priceStatus: text("price_status"),
  priceUnit: text("price_unit"),
  priceMinor: text("price_minor"),
  currency: text("currency"),
  settlementTerms: text("settlement_terms").notNull(),
  version: integer("version").notNull().default(1),
  cancelReason: text("cancel_reason"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const gameManagers = pgTable("game_managers", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  aggregateVersion: integer("aggregate_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyRecords = pgTable("idempotency_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").notNull(),
  operation: text("operation").notNull(),
  keyHash: text("key_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  reservationState: text("reservation_state").notNull().default("completed"),
  statusCode: integer("status_code"),
  responseBody: jsonb("response_body"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participations = pgTable("participations", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  version: integer("version").notNull().default(1),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participationTransitions = pgTable("participation_transitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  participationId: uuid("participation_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorId: uuid("actor_id"),
  reasonCode: text("reason_code"),
  reasonText: text("reason_text"),
  aggregateVersion: integer("aggregate_version").notNull(),
  gameVersion: integer("game_version").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const playerSocialProfiles = pgTable("player_social_profiles", {
  socialActionEpoch: bigint("social_action_epoch", { mode: "bigint" }).notNull().default(1n),
  avatarKey: text("avatar_key"),
  avatarModerationApprovalId: uuid("avatar_moderation_approval_id"),
  userId: uuid("user_id").primaryKey(),
  publicPlayerId: uuid("public_player_id").notNull().defaultRandom(),
  displayName: text("display_name").notNull().default(""),
  cityId: uuid("city_id"),
  areaKey: text("area_key"),
  levelScaleId: text("level_scale_id"),
  levelScaleVersion: integer("level_scale_version"),
  levelId: text("level_id"),
  bio: text("bio"),
  directoryVisible: boolean("directory_visible").notNull().default(false),
  contactPolicy: text("contact_policy").notNull().default("closed"),
  consentPolicyVersion: text("consent_policy_version"),
  optedInAt: timestamp("opted_in_at", { withTimezone: true }),
  radarConsented: boolean("radar_consented").notNull().default(false),
  radarConsentPolicyVersion: text("radar_consent_policy_version"),
  radarConsentedAt: timestamp("radar_consented_at", { withTimezone: true }),
  socialEligible: boolean("social_eligible").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  radarConsentEvidenceId: uuid("radar_consent_evidence_id"),
});

export const playerLookingIntents = pgTable("player_looking_intents", {
  userId: uuid("user_id").primaryKey(),
  active: boolean("active").notNull().default(false),
  cityId: uuid("city_id"),
  areaKey: text("area_key"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  formatKeys: jsonb("format_keys").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const socialPairs = pgTable("social_pairs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userLow: uuid("user_low").notNull(),
  userHigh: uuid("user_high").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userBlocks = pgTable("user_blocks", {
  blockerUserId: uuid("blocker_user_id").notNull(),
  blockedUserId: uuid("blocked_user_id").notNull(),
  pairId: uuid("pair_id").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const abuseReports = pgTable("abuse_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterUserId: uuid("reporter_user_id").notNull(),
  targetKind: text("target_kind").notNull(),
  targetUserId: uuid("target_user_id").notNull(),
  targetPublicPlayerId: uuid("target_public_player_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  detail: text("detail"),
  evidenceRefs: jsonb("evidence_refs").notNull(),
  state: text("state").notNull().default("submitted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const radarPresences = pgTable("radar_presences", {
  userId: uuid("user_id").primaryKey(),
  activationId: uuid("activation_id").notNull(),
  consentEvidenceId: uuid("consent_evidence_id"),
  locationModel: text("location_model"),
  gridSizeMeters: integer("grid_size_meters"),
  sourceAccuracyMeters: doublePrecision("source_accuracy_meters"),
  sourceCapturedAt: timestamp("source_captured_at", {withTimezone:true}),
  ownerSessionId: uuid("owner_session_id").notNull(),
  version: integer("version").notNull().default(1),
  policyVersion: text("policy_version").notNull(),
  regionId: text("region_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  hardExpiresAt: timestamp("hard_expires_at", { withTimezone: true }).notNull(),
  foregroundUntil: timestamp("foreground_until", { withTimezone: true }).notNull(),
  locationValidUntil: timestamp("location_valid_until", { withTimezone: true }).notNull(),
  nextLocationUpdateAt: timestamp("next_location_update_at", { withTimezone: true }).notNull(),
  nextRadiusChangeAt: timestamp("next_radius_change_at", { withTimezone: true }).notNull(),
  radiusChangesWindowStartedAt: timestamp("radius_changes_window_started_at", {
    withTimezone: true,
  }).notNull(),
  radiusChangesInWindow: integer("radius_changes_in_window").notNull().default(0),
  cellI: integer("cell_i").notNull(),
  cellJ: integer("cell_j").notNull(),
  radiusBucketKm: integer("radius_bucket_km").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const radarRateBudgets = pgTable("radar_rate_budgets", {
  userId: uuid("user_id").notNull(),
  bucket: text("bucket").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  contextHash: text("context_hash"),
});

export const gameInvitations = pgTable("game_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull(),
  inviterUserId: uuid("inviter_user_id").notNull(),
  inviteeUserId: uuid("invitee_user_id").notNull(),
  pairId: uuid("pair_id").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  participationId: uuid("participation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


// M1 moderation metadata only; content/score payloads are never persisted here.
export const contentModerationApprovals = pgTable("content_moderation_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentType: text("content_type").notNull(),
  surfaceKey: text("surface_key").notNull(),
  fingerprintVersion: integer("fingerprint_version").notNull(),
  contentFingerprint: text("content_fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  localPolicyVersion: text("local_policy_version").notNull(),
  providerKey: text("provider_key").notNull(),
  providerModel: text("provider_model").notNull(),
  providerResponseId: text("provider_response_id"),
  categoryFlags: jsonb("category_flags").notNull(),
  decision: text("decision").notNull(),
  checkedAt: timestamp("checked_at", {withTimezone: true}).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
});
export const contentModerationRateBudgets = pgTable("content_moderation_rate_budgets", {
  userId: uuid("user_id").notNull(), bucket: text("bucket").notNull(),
  windowStartedAt: timestamp("window_started_at", {withTimezone: true}).notNull(), count: integer("count").notNull(),
  dayStartedAt: timestamp("day_started_at", {withTimezone: true}).notNull(), dayCount: integer("day_count").notNull(),
  nextAllowedAt: timestamp("next_allowed_at", {withTimezone: true}),
  updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
}, (table) => [primaryKey({columns: [table.userId, table.bucket]})]);

// Non-geographic immutable disclosure/evidence projections; SQL migration owns FKs/indexes.
export const radarDisclosures = pgTable("radar_disclosures", {
  policyVersion:text("policy_version").notNull(), disclosureId:text("disclosure_id").primaryKey(),
  disclosureSha256:text("disclosure_sha256").notNull(),locale:text("locale").notNull(),disclosureText:text("disclosure_text").notNull(),
});
export const radarConsentEvents = pgTable("radar_consent_events", {
  id:uuid("id").primaryKey().defaultRandom(),userId:uuid("user_id").notNull(),eventType:text("event_type").notNull(),
  policyVersion:text("policy_version").notNull(),disclosureId:text("disclosure_id").notNull(),disclosureSha256:text("disclosure_sha256").notNull(),locale:text("locale").notNull(),
  occurredAt:timestamp("occurred_at",{withTimezone:true}).notNull().defaultNow(),source:text("source").notNull(),reversesEventId:uuid("reverses_event_id"),
});

export const playersQueryRevision = pgTable("players_query_revision", { singleton: boolean("singleton").primaryKey(), revision: bigint("revision", {mode:"bigint"}).notNull().default(1n) });

/** Private account template; never a public social-profile projection. */
export const userGamePreferences = pgTable("user_game_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  defaultPublicGameContact: text("default_public_game_contact"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Private discovery choice; null after account-deletion cleanup. */
export const userDiscoveryPreferences = pgTable("user_discovery_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  cityId: uuid("city_id").references(() => cities.id),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/** E1 migration constraints/partial unique indexes remain SQL authority. */
export const emailAuthMethods = pgTable("email_auth_methods", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull(),
  emailCanonical: text("email_canonical").notNull(), emailDisplay: text("email_display").notNull(),
  normalizationVersion: integer("normalization_version").notNull().default(1), status: text("status").notNull().default("active"),
  verifiedAt: timestamp("verified_at", {withTimezone: true}).notNull().defaultNow(),
  version: integer("version").notNull().default(1), createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(), revokedAt: timestamp("revoked_at", {withTimezone: true}),
});
export const emailAuthChallenges = pgTable("email_auth_challenges", {
  id: uuid("id").defaultRandom().primaryKey(), purpose: text("purpose").notNull(),
  emailCanonical: text("email_canonical").notNull(), emailDisplay: text("email_display").notNull(), origin: text("origin").notNull(),
  originalMethodId: uuid("original_method_id"), changeProofId: uuid("change_proof_id"),
  browserBindingHash: text("browser_binding_hash"), boundUserId: uuid("bound_user_id"), boundSessionId: uuid("bound_session_id"),
  returnPath: text("return_path").notNull(), generation: integer("generation").notNull().default(1), codeHash: text("code_hash").notNull(),
  codeCiphertext: text("code_ciphertext"), state: text("state").notNull().default("queued"), verifyAttempts: integer("verify_attempts").notNull().default(0),
  sendCount: integer("send_count").notNull().default(1), expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
  resendAfter: timestamp("resend_after", {withTimezone: true}).notNull(), consumedAt: timestamp("consumed_at", {withTimezone: true}),
  supersededAt: timestamp("superseded_at", {withTimezone: true}), createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
});
export const emailAuthDeliveryAttempts = pgTable("email_auth_delivery_attempts", {
  challengeId: uuid("challenge_id").notNull(), generation: integer("generation").notNull(), attemptNo: integer("attempt_no").notNull(),
  state: text("state").notNull(), providerMessageId: text("provider_message_id"), errorClass: text("error_class"),
  createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
}, table => [primaryKey({columns: [table.challengeId, table.generation, table.attemptNo]})]);
export const emailAuthRateBuckets = pgTable("email_auth_rate_buckets", {
  keyHash: text("key_hash").notNull(), bucketKind: text("bucket_kind").notNull(),
  windowStart: timestamp("window_start", {withTimezone: true}).notNull(), count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
}, table => [primaryKey({columns: [table.keyHash, table.bucketKind, table.windowStart]})]);

// A0a typed projections. SQL migrations own constraints, triggers and indexes.
const adminBytes = customType<{data:Buffer}>({dataType:()=>"bytea"});
export const adminPrincipals = pgTable("admin_principals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull(),
});
export const adminRoleGrants = pgTable("admin_role_grants", {
  principalId: uuid("principal_id").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull(),
  actorId: uuid("actor_id"),
  reasonCode: text("reason_code").notNull(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull(),
}, t=>[primaryKey({columns:[t.principalId,t.role]})]);
export const adminWebauthnCredentials = pgTable("admin_webauthn_credentials", {
  credentialId: text("credential_id").primaryKey(),
  principalId: uuid("principal_id").notNull(),
  publicKey: adminBytes("public_key").notNull(),
  signCount: bigint("sign_count", {mode:"number"}).notNull(),
  transports: jsonb("transports").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
});
export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  principalId: uuid("principal_id").notNull(),
  credentialId: text("credential_id").notNull(),
  audience: text("audience").notNull(),
  tokenHash: text("token_hash").notNull(),
  csrfCiphertext: text("csrf_ciphertext").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
  lastSeenAt: timestamp("last_seen_at", {withTimezone:true}).notNull(),
  stepUpAt: timestamp("step_up_at", {withTimezone:true}).notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  revokedAt: timestamp("revoked_at", {withTimezone:true}),
});
export const adminAuthTransactions = pgTable("admin_auth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  providerKey: text("provider_key").notNull(),
  bindingHash: text("binding_hash").notNull(),
  verifierCiphertext: text("verifier_ciphertext").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  consumedAt: timestamp("consumed_at", {withTimezone:true}),
});
export const adminMfaTickets = pgTable("admin_mfa_tickets", {
  tokenHash: text("token_hash").primaryKey(),
  principalId: uuid("principal_id").notNull(),
  csrfCiphertext: text("csrf_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  consumedAt: timestamp("consumed_at", {withTimezone:true}),
});
export const adminActivationTokens = pgTable("admin_activation_tokens", {
  principalId: uuid("principal_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  consumedAt: timestamp("consumed_at", {withTimezone:true}),
});
export const adminWebauthnChallenges = pgTable("admin_webauthn_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  principalId: uuid("principal_id").notNull(),
  ticketHash: text("ticket_hash"),
  sessionId: uuid("session_id"),
  purpose: text("purpose").notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  consumedAt: timestamp("consumed_at", {withTimezone:true}),
});
export const adminBootstrapState = pgTable("admin_bootstrap_state", {
  singleton: boolean("singleton").primaryKey(),
  operationId: uuid("operation_id").notNull(),
  principalId: uuid("principal_id").notNull(),
  activationHash: text("activation_hash").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
});
export const privilegedAuditEvents = pgTable("privileged_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id"),
  systemActor: text("system_actor"),
  sessionId: uuid("session_id"),
  rolesSnapshot: jsonb("roles_snapshot").notNull(),
  permissionKey: text("permission_key").notNull(),
  actionKey: text("action_key").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  internalNote: text("internal_note"),
  caseId: uuid("case_id"),
  beforeDiff: jsonb("before_diff").notNull(),
  afterDiff: jsonb("after_diff").notNull(),
  requestId: uuid("request_id").notNull(),
  idempotencyHash: text("idempotency_hash"),
  reversalOf: uuid("reversal_of"),
  retentionClass: text("retention_class").notNull(),
  legalHold: boolean("legal_hold").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
});
export const adminCommandReceipts = pgTable("admin_command_receipts", {
  actorId: uuid("actor_id").notNull(),
  keyHash: text("key_hash").notNull(),
  fingerprint: text("fingerprint").notNull(),
  responseCiphertext: text("response_ciphertext").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull(),
}, t=>[primaryKey({columns:[t.actorId,t.keyHash]})]);
export const adminRateWindows = pgTable("admin_rate_windows", {
  keyHash: text("key_hash").notNull(),
  windowStart: timestamp("window_start", {withTimezone:true}).notNull(),
  attempts: integer("attempts").notNull(),
}, t=>[primaryKey({columns:[t.keyHash,t.windowStart]})]);

/** Internal-only game moderation. SQL migration owns checks and immutable-history triggers. */
export const gameModerationState = pgTable("game_moderation_state", {
  gameId: uuid("game_id").primaryKey().references(() => games.id),
  state: text("state").notNull().default("clear"),
  requestsLocked: boolean("requests_locked").notNull().default(false),
  version: integer("version").notNull().default(1),
  lastActionId: uuid("last_action_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const gameModerationActions = pgTable("game_moderation_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id),
  auditId: uuid("audit_id").notNull().unique().references(() => privilegedAuditEvents.id),
  action: text("action").notNull(),
  reasonCode: text("reason_code").notNull(),
  beforeState: jsonb("before_state").notNull(),
  afterState: jsonb("after_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Internal capability overlay; SQL owns finite expiry and immutable ledger/history guards. */
export const userRestrictionState = pgTable("user_restriction_state", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
});
export const userRestrictions = pgTable("user_restrictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  capability: text("capability").notNull(),
  reasonCode: text("reason_code").notNull(),
  startsAt: timestamp("starts_at", {withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", {withTimezone:true}).notNull(),
  createdBy: uuid("created_by").notNull().references(() => adminPrincipals.id),
  revokedAt: timestamp("revoked_at", {withTimezone:true}),
  revokedBy: uuid("revoked_by").references(() => adminPrincipals.id),
  revokeReasonCode: text("revoke_reason_code"),
  version: integer("version").notNull().default(1),
});
export const userRestrictionActions = pgTable("user_restriction_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  restrictionId: uuid("restriction_id").references(() => userRestrictions.id),
  userVersion: integer("user_version").notNull(),
  auditId: uuid("audit_id").notNull().unique().references(() => privilegedAuditEvents.id),
  action: text("action").notNull(),
  reasonCode: text("reason_code").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});

// Additive A3 projections; append-only SQL constraints/triggers own integrity.
export const supportCases = pgTable("support_cases", {
  id: uuid("id").defaultRandom().primaryKey(), status: text("status").notNull().default("open"),
  version: integer("version").notNull().default(1), assignedTo: uuid("assigned_to"), createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
});
export const supportCaseLinks = pgTable("support_case_links", {
  id:uuid("id").defaultRandom().primaryKey(), caseId:uuid("case_id").notNull(), sourceKind:text("source_kind").notNull(), reportId:uuid("report_id"),gameId:uuid("game_id"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const supportCaseActions = pgTable("support_case_actions", {
  id:uuid("id").defaultRandom().primaryKey(),caseId:uuid("case_id").notNull(),caseVersion:integer("case_version").notNull(),auditId:uuid("audit_id").notNull(),action:text("action").notNull(),noteCode:text("note_code"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const caseEvidenceItems = pgTable("case_evidence_items", {
  id:uuid("id").defaultRandom().primaryKey(),caseId:uuid("case_id").notNull(),linkId:uuid("link_id").notNull(),kind:text("kind").notNull(),payload:jsonb("payload").notNull(),contentHash:text("content_hash").notNull(),classification:text("classification").notNull(),policyId:text("policy_id").notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),legalHold:boolean("legal_hold").notNull().default(false),auditId:uuid("audit_id").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

export const venueAdminActions = pgTable("venue_admin_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  venueId: uuid("venue_id").notNull(),
  venueVersion: integer("venue_version").notNull(),
  action: text("action").notNull(),
  actorId: uuid("actor_id").notNull(),
  auditId: uuid("audit_id").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});

/** Existing migration0032 relationship; no new graph or ownership. */
export const friendships = pgTable("friendships", {
  id:uuid("id").defaultRandom().primaryKey(),pairId:uuid("pair_id").notNull().unique().references(()=>socialPairs.id),
  requesterUserId:uuid("requester_user_id").notNull().references(()=>users.id),
  recipientUserId:uuid("recipient_user_id").notNull().references(()=>users.id),
  requestId:uuid("request_id").notNull().unique(),generation:bigint("generation",{mode:"bigint"}).notNull().default(1n),
  version:bigint("version",{mode:"bigint"}).notNull().default(1n),state:text("state").notNull(),
  requesterEpoch:bigint("requester_epoch",{mode:"bigint"}).notNull(),recipientEpoch:bigint("recipient_epoch",{mode:"bigint"}).notNull(),
  requestedAt:timestamp("requested_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt:timestamp("expires_at",{withTimezone:true}),acceptedAt:timestamp("accepted_at",{withTimezone:true}),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});

/** FR-3A typed projections. Migration0041 owns relationship membership,
 * unique direction, state/version guards, inbox indexes and immutable audit. */
export const gameRecommendations = pgTable("game_recommendations", {
  id:uuid("id").defaultRandom().primaryKey(), friendshipId:uuid("friendship_id").notNull().references(()=>friendships.id),
  friendshipGeneration:bigint("friendship_generation",{mode:"bigint"}).notNull(),
  gameId:uuid("game_id").notNull().references(()=>games.id),
  senderUserId:uuid("sender_user_id").notNull().references(()=>users.id),
  recipientUserId:uuid("recipient_user_id").notNull().references(()=>users.id),
  senderEpoch:bigint("sender_epoch",{mode:"bigint"}).notNull(),
  recipientEpoch:bigint("recipient_epoch",{mode:"bigint"}).notNull(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
  state:text("state").notNull().default("active"),recipientHidden:boolean("recipient_hidden").notNull().default(false),
  version:integer("version").notNull().default(1),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex("game_recommendations_direction_idx").on(t.friendshipId,t.gameId,t.senderUserId),
  index("game_recommendations_received_idx").on(t.recipientUserId,t.id).where(sql`${t.state}='active' AND NOT ${t.recipientHidden}`),
  index("game_recommendations_sent_idx").on(t.senderUserId,t.id),
  check("game_recommendations_version_check",sql`${t.version} BETWEEN 1 AND 2147483647`),
  check("game_recommendations_state_check",sql`${t.state} IN ('active','withdrawn')`),
  check("game_recommendations_not_self",sql`${t.senderUserId} <> ${t.recipientUserId}`),
  check("game_recommendations_generation_check",sql`${t.friendshipGeneration} >= 1`),
  check("game_recommendations_sender_epoch_check",sql`${t.senderEpoch} >= 1`),
  check("game_recommendations_recipient_epoch_check",sql`${t.recipientEpoch} >= 1`),
  check("game_recommendations_expiry_check",sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '30 days'`),
]);
export const gameRecommendationActions = pgTable("game_recommendation_actions", {
  recommendationId:uuid("recommendation_id").notNull().references(()=>gameRecommendations.id),
  version:integer("version").notNull(),action:text("action").notNull(),
  actorUserId:uuid("actor_user_id").notNull().references(()=>users.id),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.recommendationId,t.version]})]);
