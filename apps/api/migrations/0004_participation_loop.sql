-- F-04 transactional participation loop.
-- Preserves F-01/F-02/F-03 tables. Additive only.

CREATE TABLE participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL
    CHECK (status IN (
      'pending',
      'confirmed',
      'rejected',
      'withdrawn',
      'removed',
      'cancelled_by_game',
      'expired'
    )),
  attempt_number integer NOT NULL DEFAULT 1
    CHECK (attempt_number >= 1),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL,
  decision_reason text NULL
    CHECK (
      decision_reason IS NULL
      OR char_length(decision_reason) BETWEEN 1 AND 1000
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participations_game_user_uidx UNIQUE (game_id, user_id)
);

CREATE INDEX participations_game_status_idx
  ON participations (game_id, status);

CREATE INDEX participations_user_requested_id_idx
  ON participations (user_id, requested_at, id);

CREATE TABLE participation_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  participation_id uuid NOT NULL REFERENCES participations (id),
  from_status text NULL
    CHECK (
      from_status IS NULL
      OR from_status IN (
        'pending',
        'confirmed',
        'rejected',
        'withdrawn',
        'removed',
        'cancelled_by_game',
        'expired'
      )
    ),
  to_status text NOT NULL
    CHECK (to_status IN (
      'pending',
      'confirmed',
      'rejected',
      'withdrawn',
      'removed',
      'cancelled_by_game',
      'expired'
    )),
  actor_id uuid NULL REFERENCES users (id),
  reason_code text NULL
    CHECK (
      reason_code IS NULL
      OR char_length(reason_code) BETWEEN 1 AND 64
    ),
  reason_text text NULL
    CHECK (
      reason_text IS NULL
      OR char_length(reason_text) BETWEEN 1 AND 1000
    ),
  aggregate_version integer NOT NULL
    CHECK (aggregate_version >= 1),
  game_version integer NOT NULL
    CHECK (game_version >= 1),
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX participation_transitions_participation_at_idx
  ON participation_transitions (participation_id, at, id);
