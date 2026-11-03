-- Rollback 0055: refuse when any delivery claim, intent, or live subscription history exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM web_push_delivery_claims)
     OR EXISTS (SELECT 1 FROM web_push_delivery_intents)
     OR EXISTS (SELECT 1 FROM web_push_subscriptions)
     OR EXISTS (SELECT 1 FROM web_push_preferences WHERE enabled = true)
  THEN
    RAISE EXCEPTION
      'rollback 0055 blocked: web push history or enabled preference exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TABLE IF EXISTS web_push_delivery_claims;
DROP TABLE IF EXISTS web_push_delivery_intents;
DROP TABLE IF EXISTS web_push_subscriptions;
DROP TABLE IF EXISTS web_push_preferences;
