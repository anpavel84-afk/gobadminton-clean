-- #485 Expand private discovery preference city_id CHECK to 13 approved cities.
-- Additive constraint replacement only. No city/catalog seeds. Preserve rows,
-- versions, FK, NULL city_id, and the existing deletion trigger/function.

ALTER TABLE user_discovery_preferences
  DROP CONSTRAINT user_discovery_preferences_city_id_check;

ALTER TABLE user_discovery_preferences
  ADD CONSTRAINT user_discovery_preferences_city_id_check CHECK (
    city_id IN (
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      '1775016f-373e-5a15-958b-1305770b2b16',
      'bec5831e-d6d2-59da-9d17-0c32b1eca331',
      '5c219eb1-87da-5fd3-9194-20e9d1501315',
      '3113cbf1-c8bd-5475-9774-2e9567414f46',
      '1a08b6d0-7bb8-5df5-903d-633ebc064a6e',
      '2f9a0a40-b6cd-53f6-8f0d-06cfb607cd0e',
      '38d822e9-2c2a-5969-871c-ee6da3c702da',
      '17b9f926-c927-59be-9adb-1434a971e2e4',
      'cc3fde74-3c6d-5dc6-8e87-eb463e45ade3',
      'f89658dd-d378-593d-9ec0-b8dae693f0af',
      'dc1f0006-1076-5e28-8608-63ecd96240eb'
    )
  );
