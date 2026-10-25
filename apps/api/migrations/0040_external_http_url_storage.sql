-- Forward-only tightening of stored external URLs. Applied migrations 0002, 0036 and 0037 stay unchanged.
-- Rejects an '@' in the authority (the part after http(s):// and any extra slashes, before the first / ? or #),
-- any backslash, and C0/C1 controls. PostgreSQL text cannot store NUL, so U+0000 never reaches the CHECK.
-- WHATWG percent-decoding, DNS labels, non-default ports and the avatar host allowlist stay in the application
-- helper. That helper remains the stricter check.
--
-- Rows that already fail are set NULL before the new CHECK, rather than left behind a NOT VALID constraint.
-- NOT VALID would still return the userinfo, backslash or control string to any reader. These columns are nullable.
-- A bad cover credit clears kind, text and url together so venue_cover_credit_shape stays true; a valid credit
-- (including '@' in the path or query) is not touched. A bad contact_website or avatar_url is cleared alone.
-- contact_updated_at is left as it was: this is not a user edit. Avatar rows that are ordinary https URLs on a
-- non-allowlisted host stay stored; safeProviderAvatar still drops them on read.

CREATE FUNCTION public.external_http_url_storage_ok(value text, https_only boolean, max_length integer)
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
    AND position('@' IN split_part(split_part(split_part(
      regexp_replace(value, '^https?://+', ''),
      '/', 1), '?', 1), '#', 1)) = 0
  );
$$;

UPDATE venues
SET contact_website = NULL
WHERE contact_website IS NOT NULL
  AND NOT public.external_http_url_storage_ok(contact_website, false, 300);

UPDATE venues
SET cover_credit_kind = NULL,
    cover_credit_text = NULL,
    cover_credit_url = NULL
WHERE cover_credit_url IS NOT NULL
  AND NOT public.external_http_url_storage_ok(cover_credit_url, true, 300);

UPDATE external_identities
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND NOT public.external_http_url_storage_ok(avatar_url, true, 2048);

-- players_query_revision_change is DEFERRABLE INITIALLY DEFERRED on external_identities.
-- The cleanup above queues it; ALTER TABLE is refused while that event is still pending.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE venues DROP CONSTRAINT venues_contact_website_check;
ALTER TABLE venues DROP CONSTRAINT venues_cover_credit_url_check;

ALTER TABLE venues ADD CONSTRAINT venues_contact_website_check
  CHECK (contact_website IS NULL OR public.external_http_url_storage_ok(contact_website, false, 300));
ALTER TABLE venues ADD CONSTRAINT venues_cover_credit_url_check
  CHECK (cover_credit_url IS NULL OR public.external_http_url_storage_ok(cover_credit_url, true, 300));
ALTER TABLE external_identities ADD CONSTRAINT external_identities_avatar_url_check
  CHECK (avatar_url IS NULL OR public.external_http_url_storage_ok(avatar_url, true, 2048));
