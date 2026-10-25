-- Forward-only tightening of stored external URLs. Applied migrations 0002, 0036 and 0037 stay unchanged.
-- Rejects an '@' in the authority (the part after http(s):// and any extra slashes, before the first / ? or #),
-- any backslash, and C0/C1 controls. PostgreSQL text cannot store NUL, so U+0000 never reaches the CHECK.
-- A credit URL (credit_port) also requires the authority port to be absent or the exact digits 443:
-- an empty port and leading zeros fail. Contact websites and avatars pass credit_port false, so a private
-- contact may still use a non-default port such as :444. Percent-decoding, DNS labels and the avatar
-- host allowlist stay in the application helper. That helper remains the stricter check.
--
-- The function name is unqualified and replaced in place. A replay with search_path set to another schema
-- (side, public) creates or replaces the function in that schema and does not collide with the public schema.
-- Each column is updated and rechecked only when it already exists, so this file can run before 0036
-- (no contact_website yet) and still tighten cover credits and avatars. Chronological 0039 then 0040
-- still sees every column and installs the checks.
--
-- Rows that already fail are set NULL before the new CHECK, rather than left behind a NOT VALID constraint.
-- NOT VALID would still return the userinfo, backslash, control or bad-port string to any reader.
-- These columns are nullable. A bad cover credit clears kind, text and url together so
-- venue_cover_credit_shape stays true; a valid credit (including '@' in the path or query, and :443)
-- is not touched. A bad contact_website or avatar_url is cleared alone.
-- contact_updated_at is left as it was: this is not a user edit. Avatar rows that are ordinary https URLs on a
-- non-allowlisted host stay stored; safeProviderAvatar still drops them on read.

CREATE OR REPLACE FUNCTION external_http_url_storage_ok(value text, https_only boolean, max_length integer, credit_port boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NULL OR (
    char_length(value) <= max_length
    AND (
      (https_only AND value ~ '^https://')
      OR ((NOT https_only) AND value ~ '^https?://')
    )
    AND value !~ '\\'
    AND value !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')
    AND position('@' IN authority) = 0
    AND (
      NOT credit_port
      OR authority ~ '^(\[[0-9A-Fa-f:.]+\]|[^:/?#]+)(:443)?$'
    )
  )
  FROM (
    SELECT split_part(split_part(split_part(
      regexp_replace(value, '^https?://+', ''),
      '/', 1), '?', 1), '#', 1) AS authority
  ) AS extracted;
$$;

DO $url_storage$
DECLARE
  venues_oid oid := to_regclass('venues');
  identities_oid oid := to_regclass('external_identities');
  has_contact boolean := false;
  has_credit boolean := false;
  has_avatar boolean := false;
BEGIN
  IF venues_oid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = venues_oid AND attname = 'contact_website' AND NOT attisdropped
    ) INTO has_contact;
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = venues_oid AND attname = 'cover_credit_url' AND NOT attisdropped
    ) INTO has_credit;
  END IF;
  IF identities_oid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = identities_oid AND attname = 'avatar_url' AND NOT attisdropped
    ) INTO has_avatar;
  END IF;

  IF has_contact THEN
    EXECUTE $sql$UPDATE venues SET contact_website = NULL
      WHERE contact_website IS NOT NULL
        AND NOT external_http_url_storage_ok(contact_website, false, 300, false)$sql$;
  END IF;
  IF has_credit THEN
    EXECUTE $sql$UPDATE venues
      SET cover_credit_kind = NULL, cover_credit_text = NULL, cover_credit_url = NULL
      WHERE cover_credit_url IS NOT NULL
        AND NOT external_http_url_storage_ok(cover_credit_url, true, 300, true)$sql$;
  END IF;
  IF has_avatar THEN
    EXECUTE $sql$UPDATE external_identities SET avatar_url = NULL
      WHERE avatar_url IS NOT NULL
        AND NOT external_http_url_storage_ok(avatar_url, true, 2048, false)$sql$;
  END IF;

  -- players_query_revision_change is DEFERRABLE INITIALLY DEFERRED on external_identities.
  -- The avatar cleanup queues it; ALTER TABLE is refused while that event is still pending.
  SET CONSTRAINTS ALL IMMEDIATE;

  IF has_contact THEN
    EXECUTE 'ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_contact_website_check';
    EXECUTE $sql$ALTER TABLE venues ADD CONSTRAINT venues_contact_website_check
      CHECK (contact_website IS NULL OR external_http_url_storage_ok(contact_website, false, 300, false))$sql$;
  END IF;
  IF has_credit THEN
    EXECUTE 'ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_cover_credit_url_check';
    EXECUTE $sql$ALTER TABLE venues ADD CONSTRAINT venues_cover_credit_url_check
      CHECK (cover_credit_url IS NULL OR external_http_url_storage_ok(cover_credit_url, true, 300, true))$sql$;
  END IF;
  IF has_avatar THEN
    EXECUTE 'ALTER TABLE external_identities DROP CONSTRAINT IF EXISTS external_identities_avatar_url_check';
    EXECUTE $sql$ALTER TABLE external_identities ADD CONSTRAINT external_identities_avatar_url_check
      CHECK (avatar_url IS NULL OR external_http_url_storage_ok(avatar_url, true, 2048, false))$sql$;
  END IF;
END
$url_storage$;
