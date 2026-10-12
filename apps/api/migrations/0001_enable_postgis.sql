-- F-01 foundation migration: enable PostGIS and record schema bootstrap.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS foundation_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO foundation_markers (label)
SELECT 'f01-foundation'
WHERE NOT EXISTS (
  SELECT 1 FROM foundation_markers WHERE label = 'f01-foundation'
);

-- Verify PostGIS is available for this database.
DO $$
DECLARE
  postgis_ver text;
BEGIN
  SELECT PostGIS_Version() INTO postgis_ver;
  IF postgis_ver IS NULL OR length(postgis_ver) = 0 THEN
    RAISE EXCEPTION 'PostGIS extension did not report a version';
  END IF;
END $$;
