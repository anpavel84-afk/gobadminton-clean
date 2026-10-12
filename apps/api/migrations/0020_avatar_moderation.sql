-- M1 only. Legacy avatar approvals remain NULL; no retroactive moderation claims.
CREATE TABLE content_moderation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('text','image')),
  surface_key text NOT NULL CHECK (surface_key IN ('avatar_image','profile_display_name','profile_bio','trainer_display_name','game_title','game_host_display_name','game_training_description','game_settlement_terms')),
  fingerprint_version integer NOT NULL CHECK (fingerprint_version = 1),
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL,
  local_policy_version text NOT NULL,
  provider_key text NOT NULL CHECK (provider_key IN ('openai','fake')),
  provider_model text NOT NULL,
  provider_response_id text,
  category_flags jsonb NOT NULL CHECK (jsonb_typeof(category_flags) = 'object'),
  decision text NOT NULL CHECK (decision IN ('allow','reject','review')),
  checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(surface_key, fingerprint_version, content_fingerprint, policy_version, local_policy_version, provider_key, provider_model)
);
ALTER TABLE player_social_profiles ADD COLUMN avatar_moderation_approval_id uuid
  REFERENCES content_moderation_approvals(id);
ALTER TABLE player_social_profiles ADD CONSTRAINT avatar_approval_requires_key
  CHECK (avatar_moderation_approval_id IS NULL OR avatar_key IS NOT NULL);

CREATE TABLE content_moderation_rate_budgets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN ('text','image')),
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  day_started_at timestamptz NOT NULL,
  day_count integer NOT NULL CHECK (day_count >= 0),
  next_allowed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,bucket)
);
-- Existing identity retirement remains provider independent and clears the binding too.
CREATE OR REPLACE FUNCTION retire_inactive_account_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE player_social_profiles SET avatar_key = NULL, avatar_moderation_approval_id = NULL,
      version = version + 1, updated_at = now() WHERE user_id = NEW.id AND avatar_key IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
