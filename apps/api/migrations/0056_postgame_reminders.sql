-- #457 / NEXT-2. Bounded durable internal organizer reminders to record outcome.
-- Max 3 ordinals per (game, organizer). Absence of outcome row = unknown.
-- No auto held/absent/sanctions. No external push/email/SMS. Additive only.

CREATE TABLE game_outcome_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  organizer_user_id uuid NOT NULL REFERENCES users (id),
  ordinal smallint NOT NULL
    CHECK (ordinal BETWEEN 1 AND 3),
  version integer NOT NULL DEFAULT 1
    CHECK (version BETWEEN 1 AND 2147483647),
  state text NOT NULL
    CHECK (state IN ('scheduled', 'visible', 'snoozed', 'stopped')),
  due_at timestamptz NOT NULL,
  visible_at timestamptz NULL,
  snoozed_until timestamptz NULL,
  stop_reason text NULL
    CHECK (
      stop_reason IS NULL
      OR stop_reason IN (
        'outcome_recorded',
        'game_cancelled',
        'role_lost',
        'account_restricted',
        'account_inactive'
      )
    ),
  stopped_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_outcome_reminders_game_org_ordinal_uidx
    UNIQUE (game_id, organizer_user_id, ordinal),
  CHECK (
    (
      state = 'scheduled'
      AND visible_at IS NULL
      AND snoozed_until IS NULL
      AND stop_reason IS NULL
      AND stopped_at IS NULL
    )
    OR (
      state = 'visible'
      AND visible_at IS NOT NULL
      AND snoozed_until IS NULL
      AND stop_reason IS NULL
      AND stopped_at IS NULL
    )
    OR (
      state = 'snoozed'
      AND visible_at IS NOT NULL
      AND snoozed_until IS NOT NULL
      AND stop_reason IS NULL
      AND stopped_at IS NULL
    )
    OR (
      state = 'stopped'
      AND stop_reason IS NOT NULL
      AND stopped_at IS NOT NULL
    )
  )
);

CREATE INDEX game_outcome_reminders_org_state_idx
  ON game_outcome_reminders (organizer_user_id, state, due_at, id);

CREATE INDEX game_outcome_reminders_game_state_idx
  ON game_outcome_reminders (game_id, state, ordinal);

CREATE INDEX game_outcome_reminders_due_scheduled_idx
  ON game_outcome_reminders (due_at ASC, id)
  WHERE state IN ('scheduled', 'snoozed');

CREATE TABLE game_outcome_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  reminder_id uuid NOT NULL REFERENCES game_outcome_reminders (id),
  game_id uuid NOT NULL REFERENCES games (id),
  organizer_user_id uuid NOT NULL REFERENCES users (id),
  ordinal smallint NOT NULL
    CHECK (ordinal BETWEEN 1 AND 3),
  event_kind text NOT NULL
    CHECK (event_kind IN ('created', 'activated', 'snoozed', 'stopped')),
  detail text NULL
    CHECK (detail IS NULL OR char_length(detail) BETWEEN 1 AND 200),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX game_outcome_reminder_events_reminder_idx
  ON game_outcome_reminder_events (reminder_id, recorded_at ASC, id);

CREATE INDEX game_outcome_reminder_events_game_idx
  ON game_outcome_reminder_events (game_id, recorded_at ASC, id);
