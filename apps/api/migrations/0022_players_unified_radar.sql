-- Source-only, additive. No old consent or position upgraded/backfilled.
ALTER TABLE radar_presences ADD COLUMN location_model text NULL;
ALTER TABLE radar_presences ADD COLUMN grid_size_meters integer NULL;
ALTER TABLE radar_presences ADD COLUMN source_accuracy_meters double precision NULL;
ALTER TABLE radar_presences ADD COLUMN source_captured_at timestamptz NULL;
ALTER TABLE radar_presences ADD CONSTRAINT radar_unified_metadata CHECK (
 (policy_version <> 'radar-geographic-sharing-v2' AND location_model IS NULL AND grid_size_meters IS NULL AND source_accuracy_meters IS NULL AND source_captured_at IS NULL)
 OR (policy_version = 'radar-geographic-sharing-v2' AND location_model IS NOT NULL AND grid_size_meters IS NOT NULL
 AND source_accuracy_meters IS NOT NULL AND source_captured_at IS NOT NULL AND consent_evidence_id IS NOT NULL
 AND ((location_model='regional_grid_100m_v1' AND grid_size_meters=100 AND source_accuracy_meters BETWEEN 0 AND 100)
 OR (location_model='regional_grid_1000m_v1' AND grid_size_meters=1000 AND source_accuracy_meters>100 AND source_accuracy_meters<=1000)))
);
INSERT INTO radar_disclosures(policy_version,disclosure_id,disclosure_sha256,locale,disclosure_text)
VALUES ('radar-geographic-sharing-v2','radar-geographic-sharing-v2.ru.v1',
 encode(sha256(convert_to('Включая Radar, вы временно показываете авторизованным пользователям GoBadminton своё примерное местоположение и расстояние до вас. При точной геолокации используется ячейка около 100 м, при неточной — около 1 км; точность зависит от устройства. Расстояние приблизительное, по прямой. Вы можете выключить Radar в любой момент. В фоне передача прекращается, сеанс ограничен по времени.','UTF8')),'hex'),
 'ru','Включая Radar, вы временно показываете авторизованным пользователям GoBadminton своё примерное местоположение и расстояние до вас. При точной геолокации используется ячейка около 100 м, при неточной — около 1 км; точность зависит от устройства. Расстояние приблизительное, по прямой. Вы можете выключить Radar в любой момент. В фоне передача прекращается, сеанс ограничен по времени.');
-- Conservative global epoch: unrelated changes may invalidate a context too.
-- No location or query snapshots. Writers advance in their own transaction.
CREATE TABLE players_query_revision (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 1 CHECK(revision>0));
INSERT INTO players_query_revision DEFAULT VALUES;
CREATE FUNCTION bump_players_query_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Row constraint triggers fire after the domain transaction's work, at COMMIT.
 -- Coalesce all affected rows/tables to one bump per transaction.
 IF current_setting('gobadminton.players_revision_bumped',true) = 'yes' THEN RETURN NULL; END IF;
 UPDATE players_query_revision SET revision=revision+1 WHERE singleton;
 PERFORM set_config('gobadminton.players_revision_bumped','yes',true);
 RETURN NULL;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','player_social_profiles','player_looking_intents','trainer_profiles','user_blocks','radar_presences','radar_consent_events','external_identities','conversations'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER players_query_revision_change AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bump_players_query_revision()',t);
 EXECUTE format('CREATE TRIGGER players_query_revision_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_players_query_revision()',t);
 END LOOP;
END; $$;

-- last_seen_at telemetry must not invalidate paging or acquire the revision fence.
CREATE CONSTRAINT TRIGGER players_query_session_insert_delete AFTER INSERT OR DELETE ON app_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bump_players_query_revision();
CREATE TRIGGER players_query_session_truncate AFTER TRUNCATE ON app_sessions FOR EACH STATEMENT EXECUTE FUNCTION bump_players_query_revision();
CREATE CONSTRAINT TRIGGER players_query_session_authority AFTER UPDATE ON app_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at OR OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.audience IS DISTINCT FROM NEW.audience)
EXECUTE FUNCTION bump_players_query_revision();
