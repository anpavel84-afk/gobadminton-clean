-- Game-scoped management authority correction.
-- Additive only: preserves 0001–0004. Legacy organizers remain for compatibility
-- but stop being the authorization root.

ALTER TABLE games
  ADD COLUMN host_display_name text NULL
    CHECK (
      host_display_name IS NULL
      OR char_length(host_display_name) BETWEEN 1 AND 160
    ),
  ADD COLUMN host_public_contact text NULL
    CHECK (
      host_public_contact IS NULL
      OR char_length(host_public_contact) BETWEEN 1 AND 320
    );

CREATE TABLE game_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('owner', 'manager')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT game_managers_game_user_uidx UNIQUE (game_id, user_id)
);

CREATE INDEX game_managers_user_active_idx
  ON game_managers (user_id)
  WHERE status = 'active';

CREATE INDEX game_managers_game_active_idx
  ON game_managers (game_id)
  WHERE status = 'active';

-- Backfill host snapshot from legacy organizer rows.
UPDATE games g
SET
  host_display_name = o.display_name,
  host_public_contact = o.public_contact
FROM organizers o
WHERE g.organizer_id = o.id
  AND (g.host_display_name IS NULL OR g.host_public_contact IS NULL);

-- Every existing Game gets an active owner from immutable creator identity.
INSERT INTO game_managers (game_id, user_id, role, status)
SELECT g.id, g.created_by_user_id, 'owner', 'active'
FROM games g
WHERE NOT EXISTS (
  SELECT 1
  FROM game_managers gm
  WHERE gm.game_id = g.id
    AND gm.user_id = g.created_by_user_id
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM games g
    WHERE g.host_display_name IS NULL OR g.host_public_contact IS NULL
  ) THEN
    RAISE EXCEPTION '0005_game_scoped_authority: host snapshot backfill incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM games g
    WHERE NOT EXISTS (
      SELECT 1 FROM game_managers gm
      WHERE gm.game_id = g.id
        AND gm.role = 'owner'
        AND gm.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION '0005_game_scoped_authority: active owner missing for one or more games';
  END IF;
END $$;

ALTER TABLE games
  ALTER COLUMN host_display_name SET NOT NULL,
  ALTER COLUMN host_public_contact SET NOT NULL;

-- New games may omit legacy organizer_id; host snapshot + game_managers are authoritative.
ALTER TABLE games
  ALTER COLUMN organizer_id DROP NOT NULL;
