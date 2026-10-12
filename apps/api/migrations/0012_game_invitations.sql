-- LS-04: GameInvitation as a Sessions resource (not Participation, not a DM).
-- Additive only. Preserves 0001–0011. Pending invitations reserve zero capacity.

CREATE TABLE game_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  inviter_user_id uuid NOT NULL REFERENCES users (id),
  invitee_user_id uuid NOT NULL REFERENCES users (id),
  pair_id uuid NOT NULL REFERENCES social_pairs (id),
  status text NOT NULL
    CHECK (
      status IN (
        'pending',
        'accepted',
        'declined',
        'expired',
        'revoked',
        'cancelled_by_game'
      )
    ),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  expires_at timestamptz NULL,
  decided_at timestamptz NULL,
  participation_id uuid NULL REFERENCES participations (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_invitations_distinct_users_chk CHECK (
    inviter_user_id <> invitee_user_id
  ),
  CONSTRAINT game_invitations_pending_expiry_chk CHECK (
    status <> 'pending' OR expires_at IS NOT NULL
  ),
  CONSTRAINT game_invitations_accepted_participation_chk CHECK (
    status <> 'accepted' OR participation_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX game_invitations_pending_invitee_uidx
  ON game_invitations (game_id, invitee_user_id)
  WHERE status = 'pending';

CREATE INDEX game_invitations_pending_expiry_idx
  ON game_invitations (expires_at)
  WHERE status = 'pending';

CREATE INDEX game_invitations_invitee_created_idx
  ON game_invitations (invitee_user_id, created_at DESC, id);

CREATE INDEX game_invitations_game_created_idx
  ON game_invitations (game_id, created_at DESC, id);

CREATE INDEX game_invitations_inviter_created_idx
  ON game_invitations (inviter_user_id, created_at DESC, id);
