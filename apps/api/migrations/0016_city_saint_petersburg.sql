-- Catalog city: Санкт-Петербург (stable UUID for demo/synthetic + GET /cities).
-- DERIVED_FOR_INTERNAL_MVP: timezone Europe/Moscow matches IANA for SPB.

INSERT INTO cities (id, country_code, name_ru, name_en, default_timezone)
VALUES (
  'a0000000-0000-4000-8000-000000000002',
  'RU',
  'Санкт-Петербург',
  'Saint Petersburg',
  'Europe/Moscow'
)
ON CONFLICT (id) DO NOTHING;
