-- G1 additive source-only schema. No policy cutover, receipt backfill or presence upgrade.
CREATE TABLE radar_disclosures (
 policy_version text NOT NULL, disclosure_id text PRIMARY KEY, disclosure_sha256 text NOT NULL CHECK(length(disclosure_sha256)=64),
 locale text NOT NULL, disclosure_text text NOT NULL,
 UNIQUE(policy_version,disclosure_id,disclosure_sha256,locale)
);
INSERT INTO radar_disclosures VALUES ('radar-geographic-sharing-v1','radar-geographic-sharing-v1.ru.v1','27f2dbe7d27e79ed3f2c4a17ced63bae922e4e72e4ffc6da149c24b4ccb977f3','ru','Включая Radar, вы делаете своё примерное местоположение видимым другим авторизованным пользователям GoBadminton, даже если они не включили свой Radar. Местоположение видно, пока Radar активен. Вы можете выключить его в любой момент. Приложение должно оставаться открытым на экране; местоположение автоматически устаревает. Другие экраны обновляются с небольшой задержкой, до 45 секунд.');
CREATE TABLE radar_consent_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 event_type text NOT NULL CHECK(event_type IN ('accepted','withdrawn')),
 policy_version text NOT NULL, disclosure_id text NOT NULL, disclosure_sha256 text NOT NULL, locale text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL CHECK(source IN ('radar_enable','radar_consent_withdraw')),
 reverses_event_id uuid NULL REFERENCES radar_consent_events(id),
 FOREIGN KEY(policy_version,disclosure_id,disclosure_sha256,locale) REFERENCES radar_disclosures(policy_version,disclosure_id,disclosure_sha256,locale),
 CHECK((event_type='accepted' AND source='radar_enable' AND reverses_event_id IS NULL) OR
       (event_type='withdrawn' AND source='radar_consent_withdraw' AND reverses_event_id IS NOT NULL)),
 UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX radar_consent_withdrawal_uidx ON radar_consent_events(reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE INDEX radar_consent_user_policy_idx ON radar_consent_events(user_id,policy_version,occurred_at);
ALTER TABLE player_social_profiles ADD COLUMN radar_consent_evidence_id uuid NULL;
ALTER TABLE player_social_profiles ADD FOREIGN KEY(radar_consent_evidence_id,user_id) REFERENCES radar_consent_events(id,user_id);
ALTER TABLE radar_presences ADD COLUMN consent_evidence_id uuid NULL;
ALTER TABLE radar_presences ADD FOREIGN KEY(consent_evidence_id,user_id) REFERENCES radar_consent_events(id,user_id);
CREATE INDEX radar_presences_region_policy_idx ON radar_presences(region_id,policy_version);
ALTER TABLE radar_rate_budgets ADD COLUMN context_hash text NULL;

-- Account retirement must conflict with geographic visibility even when there
-- is no owned avatar/profile mutation. No target-user SHARE lock is needed by proof.
CREATE FUNCTION invalidate_inactive_account_radar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
  DELETE FROM radar_presences WHERE user_id = NEW.id;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER users_inactive_radar AFTER UPDATE OF status ON users
 FOR EACH ROW EXECUTE FUNCTION invalidate_inactive_account_radar();
