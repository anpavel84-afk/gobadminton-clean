-- #394/#372 private peer received-review typed report + immutable revision binding.
-- Additive: extend abuse_reports target_kind; never edit applied 0008/0048.

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'abuse_reports'::regclass
      AND con.contype = 'c'
      AND att.attname = 'target_kind'
  LOOP
    EXECUTE format('ALTER TABLE abuse_reports DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player', 'game_review'));

ALTER TABLE abuse_reports
  ALTER COLUMN target_public_player_id DROP NOT NULL;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_player_public_id_chk
  CHECK (
    (target_kind = 'player' AND target_public_player_id IS NOT NULL)
    OR (target_kind = 'game_review')
  );

-- Self-report constraint retained: reporter_user_id <> target_user_id.

-- Additive composite UNIQUE so bindings can FK the exact revision tuple
-- (id, review_id, game_id, resource_version). Existing 0048 rows unchanged.
ALTER TABLE game_review_revisions
  ADD CONSTRAINT game_review_revisions_report_binding_tuple_uidx
  UNIQUE (id, review_id, game_id, resource_version);

CREATE TABLE game_review_report_bindings (
  report_id uuid PRIMARY KEY REFERENCES abuse_reports (id),
  review_id uuid NOT NULL REFERENCES game_reviews (id),
  game_id uuid NOT NULL REFERENCES games (id),
  revision_id uuid NOT NULL REFERENCES game_review_revisions (id),
  reported_version integer NOT NULL
    CHECK (reported_version BETWEEN 1 AND 2147483647),
  share_consent boolean NOT NULL
    CHECK (share_consent IS TRUE),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_review_report_bindings_actor_version_uidx
    UNIQUE (reporter_user_id, review_id, reported_version),
  CONSTRAINT game_review_report_bindings_revision_tuple_fkey
    FOREIGN KEY (revision_id, review_id, game_id, reported_version)
    REFERENCES game_review_revisions (id, review_id, game_id, resource_version)
);

CREATE INDEX game_review_report_bindings_review_idx
  ON game_review_report_bindings (review_id, reported_version);

CREATE INDEX game_review_report_bindings_game_idx
  ON game_review_report_bindings (game_id, created_at DESC);

-- Reuse existing support_immutable; reference rows must not mutate.
CREATE TRIGGER game_review_report_bindings_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON game_review_report_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

COMMENT ON TABLE game_review_report_bindings IS
  'Immutable reference from typed abuse_reports(game_review) to exact game_review_revisions row; private text stays in revision history only.';
