-- #394 public venue experience reviews after confirmed held participation.
-- Additive only. Legacy entity_comments VENUE rows stay closed/unverified.
-- No CHECK(TRUE). No rewrite of 0051/0053/0054. No venue public-reply role.

-- One current author/canonical-venue slot; immutable game-linked private revisions.
CREATE TABLE venue_review_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users (id),
  canonical_venue_id uuid NOT NULL REFERENCES venues (id),
  public_handle text NOT NULL
    CHECK (char_length(public_handle) = 32),
  status text NOT NULL
    CHECK (status IN (
      'self_draft',
      'submitted_waiting',
      'needs_correction',
      'held_basis',
      'published',
      'revision_waiting',
      'withdrawn',
      'removed'
    )),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  approved_revision_id uuid NULL,
  pending_revision_id uuid NULL,
  first_eligible_at timestamptz NULL,
  basis_under_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_review_slots_author_venue_uidx
    UNIQUE (author_user_id, canonical_venue_id),
  CONSTRAINT venue_review_slots_handle_uidx UNIQUE (public_handle)
);

CREATE INDEX venue_review_slots_venue_status_idx
  ON venue_review_slots (canonical_venue_id, status, updated_at DESC);

-- Event fence retains uniqueness after withdrawal (one author/venue/game).
CREATE TABLE venue_review_event_fences (
  author_user_id uuid NOT NULL REFERENCES users (id),
  game_id uuid NOT NULL REFERENCES games (id),
  canonical_venue_id uuid NOT NULL REFERENCES venues (id),
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  first_eligible_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (author_user_id, game_id, canonical_venue_id)
);

CREATE TRIGGER venue_review_event_fences_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_review_event_fences
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE venue_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  game_id uuid NOT NULL REFERENCES games (id),
  audience text NOT NULL
    CHECK (audience IN ('self_draft', 'public_venue')),
  body_text text NOT NULL
    CHECK (char_length(body_text) BETWEEN 1 AND 500),
  topics text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (
      cardinality(topics) <= 3
      AND (topics <@ ARRAY['surface', 'lighting', 'amenities']::text[])
    ),
  projection_hash text NULL
    CHECK (projection_hash IS NULL OR char_length(projection_hash) = 64),
  consent_at timestamptz NULL,
  last_material_edit_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_at timestamptz NULL,
  not_before timestamptz NULL,
  lifecycle text NOT NULL
    CHECK (lifecycle IN (
      'self_draft',
      'submitted',
      'needs_correction',
      'held_basis',
      'published',
      'superseded',
      'withdrawn',
      'removed'
    )),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  attendance_version integer NOT NULL
    CHECK (attendance_version BETWEEN 0 AND 2147483647),
  outcome_version integer NOT NULL
    CHECK (outcome_version BETWEEN 0 AND 2147483647),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_review_revisions_version_uidx
    UNIQUE (slot_id, resource_version),
  CONSTRAINT venue_review_revisions_id_slot_uidx
    UNIQUE (id, slot_id),
  CONSTRAINT venue_review_revisions_tuple_uidx
    UNIQUE (id, slot_id, resource_version),
  CONSTRAINT venue_review_revisions_public_consent_check
    CHECK (
      (audience = 'self_draft' AND projection_hash IS NULL AND consent_at IS NULL)
      OR (audience = 'public_venue' AND projection_hash IS NOT NULL AND consent_at IS NOT NULL)
    )
);

ALTER TABLE venue_review_slots
  ADD CONSTRAINT venue_review_slots_approved_revision_fkey
    FOREIGN KEY (approved_revision_id, id)
    REFERENCES venue_review_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT venue_review_slots_pending_revision_fkey
    FOREIGN KEY (pending_revision_id, id)
    REFERENCES venue_review_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX venue_review_revisions_slot_recorded_idx
  ON venue_review_revisions (slot_id, recorded_at DESC, resource_version DESC);

CREATE INDEX venue_review_revisions_public_ready_idx
  ON venue_review_revisions (slot_id, not_before)
  WHERE audience = 'public_venue' AND lifecycle = 'published' AND not_before IS NOT NULL;

CREATE TRIGGER venue_review_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_review_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

-- Durable pending intake/receipt — applicant creates; staff creates real Case.
CREATE TABLE venue_review_pending_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL
    CHECK (kind IN (
      'review_submit',
      'report',
      'appeal',
      'basis_dispute'
    )),
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  revision_id uuid NULL,
  receipt_token text NOT NULL
    CHECK (char_length(receipt_token) = 32),
  status text NOT NULL
    CHECK (status IN ('waiting_intake', 'linked', 'cancelled')),
  case_id uuid NULL REFERENCES support_cases (id),
  submitted_by_user_id uuid NOT NULL REFERENCES users (id),
  canonical_venue_id uuid NOT NULL REFERENCES venues (id),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  prior_decision_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_review_pending_intakes_receipt_uidx UNIQUE (receipt_token)
);

CREATE INDEX venue_review_pending_intakes_waiting_idx
  ON venue_review_pending_intakes (status, created_at ASC, id ASC)
  WHERE status = 'waiting_intake';

CREATE TABLE venue_review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  reported_revision_id uuid NOT NULL,
  reported_resource_version integer NOT NULL
    CHECK (reported_resource_version BETWEEN 1 AND 2147483647),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  reason_code text NOT NULL
    CHECK (reason_code IN (
      'harassment',
      'spam',
      'inappropriate',
      'pii',
      'threat',
      'fabrication',
      'other'
    )),
  explanation text NULL
    CHECK (explanation IS NULL OR char_length(explanation) BETWEEN 1 AND 500),
  pending_intake_id uuid NOT NULL REFERENCES venue_review_pending_intakes (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_review_reports_actor_target_uidx
    UNIQUE (reporter_user_id, slot_id, reported_resource_version)
);

CREATE TRIGGER venue_review_reports_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_review_reports
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE venue_review_case_links (
  case_id uuid PRIMARY KEY REFERENCES support_cases (id),
  pending_intake_id uuid NOT NULL UNIQUE
    REFERENCES venue_review_pending_intakes (id),
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  created_by_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER venue_review_case_links_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_review_case_links
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE venue_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  case_id uuid NOT NULL REFERENCES support_cases (id),
  slot_id uuid NOT NULL REFERENCES venue_review_slots (id),
  decision text NOT NULL
    CHECK (decision IN (
      'approve',
      'retain',
      'request_correction',
      'remove',
      'restore',
      'resolve_held'
    )),
  exact_revision_id uuid NULL,
  expected_case_version integer NOT NULL,
  expected_resource_version integer NOT NULL,
  rationale text NOT NULL
    CHECK (char_length(rationale) BETWEEN 1 AND 500),
  actor_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER venue_review_decisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_review_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

ALTER TABLE venue_review_pending_intakes
  ADD CONSTRAINT venue_review_pending_intakes_prior_decision_fkey
    FOREIGN KEY (prior_decision_id)
    REFERENCES venue_review_decisions (id);

COMMENT ON TABLE venue_review_slots IS
  '#394 one author/canonical-venue experience slot; public projection gated by approval+48h.';
COMMENT ON TABLE venue_review_pending_intakes IS
  '#394 durable pending intake/receipt without fabricating admin_principal Case creators.';
COMMENT ON COLUMN venue_review_slots.first_eligible_at IS
  '#394 first server-derived eligible timestamp; ordinary toggles do not reset the 14-day window.';
COMMENT ON COLUMN venue_review_revisions.not_before IS
  '#394 max(approved_at, last_material_edit_at+48h); visibility derived on ordinary reads.';
