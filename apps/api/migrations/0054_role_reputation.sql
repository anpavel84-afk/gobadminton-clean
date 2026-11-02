-- #394/#372 public organizer/trainer role reputation (pre-join). Additive only.
-- Pending intake is durable in domain; support_cases.created_by stays admin_principal.
-- Never publish legacy private game_reviews rows. No CHECK(TRUE). No 0053 rewrites.

-- Opaque public subject handle per (user, role). Knowing the handle alone is not auth.
CREATE TABLE role_reputation_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  subject_user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  public_handle text NOT NULL
    CHECK (char_length(public_handle) = 32),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_reputation_subjects_user_role_uidx UNIQUE (subject_user_id, role),
  CONSTRAINT role_reputation_subjects_handle_uidx UNIQUE (public_handle)
);

CREATE INDEX role_reputation_subjects_role_idx
  ON role_reputation_subjects (role, updated_at DESC);

-- Append-only event-role proof history. Planned at publish; performed at held.
CREATE TABLE game_role_proof_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  phase text NOT NULL
    CHECK (phase IN ('planned', 'performed', 'disputed', 'cleared', 'corrected')),
  binding_kind text NOT NULL
    CHECK (binding_kind IN (
      'publish_freeze',
      'held_confirm',
      'case_correction',
      'manager_change',
      'substitution',
      'dispute_open',
      'dispute_clear'
    )),
  provenance_source text NOT NULL
    CHECK (provenance_source IN (
      'publish_manager',
      'manager_explicit',
      'case_reviewer',
      'system_derived'
    )),
  accepted_for_count boolean NOT NULL DEFAULT false,
  actor_user_id uuid NULL REFERENCES users (id),
  actor_principal_id uuid NULL REFERENCES admin_principals (id),
  game_version integer NULL
    CHECK (game_version IS NULL OR game_version BETWEEN 1 AND 2147483647),
  outcome_version integer NULL
    CHECK (outcome_version IS NULL OR outcome_version BETWEEN 1 AND 2147483647),
  rationale text NULL
    CHECK (rationale IS NULL OR char_length(rationale) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_role_proof_revisions_version_uidx
    UNIQUE (game_id, role, resource_version),
  CONSTRAINT game_role_proof_revisions_tuple_uidx
    UNIQUE (id, game_id, role, resource_version)
);

CREATE INDEX game_role_proof_revisions_subject_idx
  ON game_role_proof_revisions (subject_user_id, role, recorded_at DESC);

CREATE TRIGGER game_role_proof_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON game_role_proof_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

-- Mutable tip of accepted role proof per game+role.
CREATE TABLE game_role_proofs (
  game_id uuid NOT NULL REFERENCES games (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  phase text NOT NULL
    CHECK (phase IN ('planned', 'performed', 'disputed', 'cleared')),
  accepted_for_count boolean NOT NULL DEFAULT false,
  open_dispute boolean NOT NULL DEFAULT false,
  latest_revision_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_id, role),
  CONSTRAINT game_role_proofs_revision_tuple_fkey
    FOREIGN KEY (latest_revision_id, game_id, role, version)
    REFERENCES game_role_proof_revisions (id, game_id, role, resource_version)
);

CREATE INDEX game_role_proofs_subject_count_idx
  ON game_role_proofs (subject_user_id, role)
  WHERE accepted_for_count = true AND open_dispute = false AND phase = 'performed';

ALTER TABLE game_role_proofs
  ADD CONSTRAINT game_role_proofs_version_tuple_uidx
    UNIQUE (game_id, role, version);

-- Public review slot: unique (author, subject, role); durable after withdraw.
CREATE TABLE role_review_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users (id),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  public_handle text NOT NULL
    CHECK (char_length(public_handle) = 32),
  status text NOT NULL
    CHECK (status IN (
      'submitted',
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
  basis_under_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_review_slots_author_subject_role_uidx
    UNIQUE (author_user_id, subject_user_id, role),
  CONSTRAINT role_review_slots_handle_uidx UNIQUE (public_handle),
  CONSTRAINT role_review_slots_no_self_check
    CHECK (author_user_id <> subject_user_id)
);

CREATE INDEX role_review_slots_subject_status_idx
  ON role_review_slots (subject_user_id, role, status, updated_at DESC);

-- Event fence retains uniqueness after withdrawal.
CREATE TABLE role_review_event_fences (
  author_user_id uuid NOT NULL REFERENCES users (id),
  game_id uuid NOT NULL REFERENCES games (id),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (author_user_id, game_id, subject_user_id, role)
);

CREATE TRIGGER role_review_event_fences_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_review_event_fences
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE role_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  game_id uuid NOT NULL REFERENCES games (id),
  body_text text NOT NULL
    CHECK (char_length(body_text) BETWEEN 1 AND 500),
  topics text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (
      cardinality(topics) <= 2
      AND (
        topics <@ ARRAY[
          'agreements',
          'flow',
          'communication',
          'explanations',
          'attention',
          'session_organization'
        ]::text[]
      )
    ),
  projection_hash text NOT NULL
    CHECK (char_length(projection_hash) = 64),
  consent_at timestamptz NOT NULL,
  lifecycle text NOT NULL
    CHECK (lifecycle IN (
      'submitted',
      'needs_correction',
      'held_basis',
      'published',
      'superseded',
      'withdrawn',
      'removed'
    )),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  proof_game_id uuid NOT NULL,
  proof_role text NOT NULL
    CHECK (proof_role IN ('organization', 'training')),
  proof_version integer NOT NULL
    CHECK (proof_version BETWEEN 1 AND 2147483647),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_review_revisions_version_uidx
    UNIQUE (slot_id, resource_version),
  CONSTRAINT role_review_revisions_id_slot_uidx
    UNIQUE (id, slot_id),
  CONSTRAINT role_review_revisions_tuple_uidx
    UNIQUE (id, slot_id, resource_version),
  CONSTRAINT role_review_revisions_proof_fkey
    FOREIGN KEY (proof_game_id, proof_role, proof_version)
    REFERENCES game_role_proof_revisions (game_id, role, resource_version),
  CHECK (game_id = proof_game_id)
);

-- Tip FK for approved/pending revisions (additive after revisions exist).
ALTER TABLE role_review_slots
  ADD CONSTRAINT role_review_slots_approved_revision_fkey
    FOREIGN KEY (approved_revision_id, id)
    REFERENCES role_review_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT role_review_slots_pending_revision_fkey
    FOREIGN KEY (pending_revision_id, id)
    REFERENCES role_review_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX role_review_revisions_slot_recorded_idx
  ON role_review_revisions (slot_id, recorded_at DESC, resource_version DESC);

CREATE TRIGGER role_review_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_review_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE role_review_replies (
  slot_id uuid PRIMARY KEY REFERENCES role_review_slots (id),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  status text NOT NULL
    CHECK (status IN (
      'submitted',
      'needs_correction',
      'published',
      'revision_waiting',
      'withdrawn',
      'removed'
    )),
  approved_revision_id uuid NULL,
  pending_revision_id uuid NULL,
  bound_review_revision_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE role_review_reply_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slot_id uuid NOT NULL REFERENCES role_review_replies (slot_id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  body_text text NOT NULL
    CHECK (char_length(body_text) BETWEEN 1 AND 500),
  projection_hash text NOT NULL
    CHECK (char_length(projection_hash) = 64),
  consent_at timestamptz NOT NULL,
  lifecycle text NOT NULL
    CHECK (lifecycle IN (
      'submitted',
      'needs_correction',
      'published',
      'superseded',
      'withdrawn',
      'removed'
    )),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  bound_review_revision_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_review_reply_revisions_version_uidx
    UNIQUE (slot_id, resource_version),
  CONSTRAINT role_review_reply_revisions_id_slot_uidx
    UNIQUE (id, slot_id),
  CONSTRAINT role_review_reply_revisions_tuple_uidx
    UNIQUE (id, slot_id, resource_version)
);

ALTER TABLE role_review_replies
  ADD CONSTRAINT role_review_replies_approved_revision_fkey
    FOREIGN KEY (approved_revision_id, slot_id)
    REFERENCES role_review_reply_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT role_review_replies_pending_revision_fkey
    FOREIGN KEY (pending_revision_id, slot_id)
    REFERENCES role_review_reply_revisions (id, slot_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER role_review_reply_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_review_reply_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

-- Domain pending intake + receipt (no fake admin principal / Case auto-create).
CREATE TABLE role_reputation_pending_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL
    CHECK (kind IN (
      'review_submit',
      'reply_submit',
      'report',
      'appeal',
      'basis_dispute'
    )),
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  revision_id uuid NULL,
  reply_revision_id uuid NULL,
  receipt_token text NOT NULL
    CHECK (char_length(receipt_token) = 32),
  status text NOT NULL
    CHECK (status IN ('waiting_intake', 'linked', 'cancelled')),
  case_id uuid NULL REFERENCES support_cases (id),
  submitted_by_user_id uuid NOT NULL REFERENCES users (id),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('organization', 'training')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_reputation_pending_intakes_receipt_uidx UNIQUE (receipt_token)
);

CREATE INDEX role_reputation_pending_intakes_waiting_idx
  ON role_reputation_pending_intakes (status, created_at ASC, id ASC)
  WHERE status = 'waiting_intake';

CREATE TABLE role_reputation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  target_kind text NOT NULL
    CHECK (target_kind IN ('review', 'reply')),
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
  pending_intake_id uuid NOT NULL REFERENCES role_reputation_pending_intakes (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_reputation_reports_actor_target_uidx
    UNIQUE (reporter_user_id, slot_id, target_kind, reported_resource_version)
);

CREATE TRIGGER role_reputation_reports_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_reputation_reports
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE role_reputation_case_links (
  case_id uuid PRIMARY KEY REFERENCES support_cases (id),
  pending_intake_id uuid NOT NULL UNIQUE
    REFERENCES role_reputation_pending_intakes (id),
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  created_by_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER role_reputation_case_links_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_reputation_case_links
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

CREATE TABLE role_reputation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  case_id uuid NOT NULL REFERENCES support_cases (id),
  slot_id uuid NOT NULL REFERENCES role_review_slots (id),
  decision text NOT NULL
    CHECK (decision IN (
      'approve',
      'retain',
      'request_correction',
      'remove',
      'restore',
      'resolve_held',
      'resolve_role'
    )),
  target_kind text NOT NULL
    CHECK (target_kind IN ('review', 'reply', 'role_basis', 'held_basis')),
  exact_revision_id uuid NULL,
  expected_case_version integer NOT NULL,
  expected_resource_version integer NOT NULL,
  rationale text NOT NULL
    CHECK (char_length(rationale) BETWEEN 1 AND 500),
  actor_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER role_reputation_decisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON role_reputation_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

COMMENT ON TABLE role_reputation_subjects IS
  '#394 public opaque role handles; re-check surface visibility on every read.';
COMMENT ON TABLE game_role_proof_revisions IS
  '#394 append-only historical organizer/trainer identity; no current-manager backfill.';
COMMENT ON TABLE role_reputation_pending_intakes IS
  '#394 durable pending intake/receipt without fabricating admin_principal Case creators.';
