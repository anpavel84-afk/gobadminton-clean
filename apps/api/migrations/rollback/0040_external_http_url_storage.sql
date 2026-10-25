-- Roll back the 0040 storage checks. Nulling of contact_website, cover-credit triples and avatar_url
-- is irreversible: the cleared strings are not restored.
-- Drops the checks and function 0040 added. Where 0036 and 0037 had length-and-scheme checks, those
-- predicates are put back so the columns are not left unconstrained. Avatar had no earlier check.
-- Names are unqualified so the current search_path schema is used. A column 0040 skipped is left alone.

DO $url_storage_rollback$
DECLARE
  venues_oid oid := to_regclass('venues');
  identities_oid oid := to_regclass('external_identities');
BEGIN
  IF venues_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = venues_oid AND attname = 'contact_website' AND NOT attisdropped
  ) THEN
    EXECUTE 'ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_contact_website_check';
    EXECUTE 'ALTER TABLE venues ADD CONSTRAINT venues_contact_website_check CHECK (char_length(contact_website) <= 300 AND contact_website ~ ''^https?://'')';
  END IF;
  IF venues_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = venues_oid AND attname = 'cover_credit_url' AND NOT attisdropped
  ) THEN
    EXECUTE 'ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_cover_credit_url_check';
    EXECUTE 'ALTER TABLE venues ADD CONSTRAINT venues_cover_credit_url_check CHECK (char_length(cover_credit_url) <= 300 AND cover_credit_url ~ ''^https://'')';
  END IF;
  IF identities_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = identities_oid AND attname = 'avatar_url' AND NOT attisdropped
  ) THEN
    EXECUTE 'ALTER TABLE external_identities DROP CONSTRAINT IF EXISTS external_identities_avatar_url_check';
  END IF;
END
$url_storage_rollback$;

DROP FUNCTION IF EXISTS external_http_url_storage_ok(text, boolean, integer, boolean);
DROP FUNCTION IF EXISTS external_http_url_storage_ok(text, boolean, integer);
DELETE FROM schema_migrations WHERE id = '0040_external_http_url_storage';
