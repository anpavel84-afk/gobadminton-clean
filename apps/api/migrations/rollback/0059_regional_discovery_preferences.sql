-- Rollback 0059: restore the two-city CHECK only when no regional preferences exist.
-- Do not delete or reset real regional preference rows.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_discovery_preferences
    WHERE city_id IS NOT NULL
      AND city_id NOT IN (
        'a0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000002'
      )
  ) THEN
    RAISE EXCEPTION
      'rollback 0059 blocked: regional discovery preferences exist'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE user_discovery_preferences
  DROP CONSTRAINT user_discovery_preferences_city_id_check;

ALTER TABLE user_discovery_preferences
  ADD CONSTRAINT user_discovery_preferences_city_id_check CHECK (
    city_id IN (
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002'
    )
  );
