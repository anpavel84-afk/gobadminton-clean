-- Additive Venue A1a repair after 0018.
-- 1) Align venue_normalize_v1 with application v1 (Unicode lower; keep letters/digits).
-- 2) Extract hall/building/unit for legacy rows with identity_discriminator=''.
-- 3) Rekey without silent merge and without rewriting Game FKs.

CREATE OR REPLACE FUNCTION venue_normalize_v1(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both FROM regexp_replace(
    replace(
      lower(normalize(coalesce(input, ''), NFKC) COLLATE "C.utf8"),
      'ё',
      'е'
    ),
    '[^0-9a-zа-я]+',
    ' ',
    'g'
  ));
$$;

UPDATE venues
SET
  normalized_name = venue_normalize_v1(name),
  normalized_address = venue_normalize_v1(address)
WHERE normalized_name IS DISTINCT FROM venue_normalize_v1(name)
   OR normalized_address IS DISTINCT FROM venue_normalize_v1(address);

CREATE OR REPLACE FUNCTION venue_extract_identity_discriminator_v1(
  p_name text,
  p_address text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  hay text := coalesce(p_name, '') || ' ' || coalesce(p_address, '');
  found text[] := ARRAY[]::text[];
  rec record;
  val text;
  uniq text[];
BEGIN
  FOR rec IN
    SELECT regexp_matches(
      hay,
      '(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:корпус|корп\.?|строение|стр\.?|building|bldg\.?)\s*([0-9A-Za-zА-Яа-яЁё]+)',
      'gi'
    ) AS m
  LOOP
    val := venue_normalize_v1(rec.m[1]);
    IF val <> '' THEN
      found := array_append(found, 'building:' || val);
    END IF;
  END LOOP;

  FOR rec IN
    SELECT regexp_matches(
      hay,
      '(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:зал|hall|корт|court)\s*([0-9A-Za-zА-Яа-яЁё]+)',
      'gi'
    ) AS m
  LOOP
    val := venue_normalize_v1(rec.m[1]);
    IF val <> '' THEN
      found := array_append(found, 'hall:' || val);
    END IF;
  END LOOP;

  FOR rec IN
    SELECT regexp_matches(
      hay,
      '(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:unit|помещение|пом\.?)\s*([0-9A-Za-zА-Яа-яЁё]+)',
      'gi'
    ) AS m
  LOOP
    val := venue_normalize_v1(rec.m[1]);
    IF val <> '' THEN
      found := array_append(found, 'unit:' || val);
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[])
  INTO uniq
  FROM (SELECT DISTINCT unnest(found) AS x) s;

  RETURN array_to_string(uniq, '|');
END;
$$;

CREATE INDEX IF NOT EXISTS venues_catalog_city_name_id_idx
  ON venues (city_id, normalized_name, id)
  WHERE lifecycle_state IN ('unverified', 'verified');

-- Recompute identity keys from current normalized fields + extracted discriminator.
-- First claimant by created_at,id wins. Later collisions stay as separate Venue rows.
CREATE OR REPLACE FUNCTION venue_rekey_extracted_legacy_discriminators()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  extracted text;
  disc text;
  new_key text;
  claimed uuid;
  left_id uuid;
  right_id uuid;
  promoted int;
BEGIN
  FOR rec IN
    SELECT
      id,
      city_id,
      name,
      address,
      normalized_name,
      normalized_address,
      identity_discriminator,
      normalization_version,
      created_at
    FROM venues
    ORDER BY created_at ASC, id ASC
  LOOP
    extracted := venue_extract_identity_discriminator_v1(rec.name, rec.address);
    disc := CASE
      WHEN rec.identity_discriminator <> '' THEN rec.identity_discriminator
      ELSE extracted
    END;

    new_key := encode(
      digest(
        rec.normalization_version::text || '|' || rec.city_id::text || '|' ||
        rec.normalized_name || '|' || rec.normalized_address || '|' || disc,
        'sha256'
      ),
      'hex'
    );

    SELECT venue_id INTO claimed
    FROM venue_identity_keys
    WHERE dedupe_key = new_key;

    IF claimed IS NULL THEN
      UPDATE venue_identity_keys
      SET dedupe_key = new_key
      WHERE venue_id = rec.id
        AND NOT EXISTS (
          SELECT 1 FROM venue_identity_keys other WHERE other.dedupe_key = new_key
        );
      GET DIAGNOSTICS promoted = ROW_COUNT;
      IF promoted = 0 THEN
        INSERT INTO venue_identity_keys (dedupe_key, venue_id, normalization_version)
        VALUES (new_key, rec.id, rec.normalization_version)
        ON CONFLICT (dedupe_key) DO NOTHING;
        GET DIAGNOSTICS promoted = ROW_COUNT;
      END IF;
      IF promoted > 0 THEN
        IF rec.identity_discriminator = '' AND extracted <> '' THEN
          UPDATE venues
          SET identity_discriminator = extracted, updated_at = now()
          WHERE id = rec.id
            AND identity_discriminator = '';
        END IF;
      ELSE
        SELECT venue_id INTO claimed
        FROM venue_identity_keys
        WHERE dedupe_key = new_key;
        IF claimed IS NOT NULL AND claimed <> rec.id THEN
          IF rec.id < claimed THEN
            left_id := rec.id;
            right_id := claimed;
          ELSE
            left_id := claimed;
            right_id := rec.id;
          END IF;
          INSERT INTO venue_duplicate_candidates (
            left_venue_id, right_venue_id, source, status
          ) VALUES (
            left_id, right_id, 'legacy_exact_collision', 'open'
          )
          ON CONFLICT (left_venue_id, right_venue_id, source) DO NOTHING;
        END IF;
      END IF;
    ELSIF claimed <> rec.id THEN
      IF rec.id < claimed THEN
        left_id := rec.id;
        right_id := claimed;
      ELSE
        left_id := claimed;
        right_id := rec.id;
      END IF;
      INSERT INTO venue_duplicate_candidates (
        left_venue_id, right_venue_id, source, status
      ) VALUES (
        left_id, right_id, 'legacy_exact_collision', 'open'
      )
      ON CONFLICT (left_venue_id, right_venue_id, source) DO NOTHING;
    ELSE
      IF rec.identity_discriminator = '' AND extracted <> '' THEN
        UPDATE venues
        SET identity_discriminator = extracted, updated_at = now()
        WHERE id = rec.id
          AND identity_discriminator = '';
      END IF;
    END IF;
  END LOOP;
END;
$$;

SELECT venue_rekey_extracted_legacy_discriminators();
