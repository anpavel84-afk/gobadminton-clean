-- #386 / OD-018 combined venue arrangement: organizer-declared court-booking status.
-- Additive singleton per game. Absence of a row projects as unspecified/version 0/updatedAt null.
-- Never auto-migrates existing games to confirmed. No booking provider / payments.

CREATE TABLE game_court_booking (
  game_id uuid PRIMARY KEY REFERENCES games (id),
  status text NOT NULL
    CHECK (status IN ('unspecified', 'arranging', 'organizer_confirmed', 'not_arranged')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  declaration_source text NOT NULL
    CHECK (declaration_source = 'organizer_declared'),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX game_court_booking_updated_idx
  ON game_court_booking (updated_at, game_id);
