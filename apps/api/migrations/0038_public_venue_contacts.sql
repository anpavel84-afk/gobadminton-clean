-- Additive, opt-in organization contacts. No private-column copy or backfill.
-- Application rollback MUST retain this column and its data.
CREATE FUNCTION venue_public_contact_url_valid(value text, messenger_kind text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  authority text;
  host text;
  scheme text;
  tail text;
  segment text;
  path_segments text[] := ARRAY[]::text[];
BEGIN
  IF value IS NULL
     OR value ~ '[[:cntrl:]]' OR value ~ U&'[\0080-\009F]'
     OR position(chr(92) in value) > 0 THEN RETURN false; END IF;
  value := btrim(value);
  IF char_length(value) > 300 THEN RETURN false; END IF;
  IF value !~* '^https?://[^/?#[:space:]]+' THEN RETURN false; END IF;
  scheme := lower(split_part(value, ':', 1));
  authority := substring(value from '(?i)^https?://([^/?#]+)');
  IF authority ~ '[@[:space:]]' THEN RETURN false; END IF;
  -- Only default ports are accepted, matching WHATWG URL.port normalization.
  host := regexp_replace(authority, CASE WHEN scheme = 'https' THEN ':0*443$' ELSE ':0*80$' END, '');
  IF host !~ '^\[[0-9a-fA-F:]+\]$' AND host ~ ':' THEN RETURN false; END IF;
  IF host !~ '^([a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+\.?$' AND host !~ '^\[[0-9a-fA-F:]+\]$' THEN RETURN false; END IF;
  IF host ~ '^\[' THEN
    BEGIN PERFORM substring(host from 2 for char_length(host)-2)::inet;
    EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  ELSIF host ~ '^[0-9.]+$' THEN
    BEGIN PERFORM host::inet;
    EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  END IF;
  IF messenger_kind IS NOT NULL THEN
    IF scheme <> 'https' OR lower(host) <> CASE messenger_kind
      WHEN 'telegram' THEN 't.me' WHEN 'whatsapp' THEN 'wa.me' WHEN 'vk' THEN 'vk.com' ELSE '' END
      THEN RETURN false; END IF;
    tail := substring(value from '(?i)^https?://[^/?#]+(.*)$');
    tail := split_part(split_part(tail,'?',1),'#',1);
    IF left(tail,1) <> '/' THEN RETURN false; END IF;
    -- WHATWG dot segments must not hide an empty root pathname.
    FOREACH segment IN ARRAY string_to_array(substring(tail from 2),'/') LOOP
      IF segment ~* '^(\.|%2e)$' THEN CONTINUE;
      ELSIF segment ~* '^(\.|%2e)(\.|%2e)$' THEN
        path_segments := path_segments[1:greatest(coalesce(array_length(path_segments,1),0)-1,0)];
      ELSE path_segments := array_append(path_segments,segment);
      END IF;
    END LOOP;
    IF tail ~* '/(\.|%2e)(\.|%2e)?$' THEN path_segments := array_append(path_segments,''); END IF;
    IF coalesce(array_to_string(path_segments,'/'),'') = '' THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION venue_public_contacts_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item jsonb;
  phone text;
  kinds text[] := ARRAY[]::text[];
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  IF NOT (value ?& ARRAY['phone','website','messengers'])
     OR value - ARRAY['phone','website','messengers'] <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(value->'phone') NOT IN ('null','string')
     OR jsonb_typeof(value->'website') NOT IN ('null','string')
     OR jsonb_typeof(value->'messengers') <> 'array' THEN RETURN false; END IF;
  IF value->'phone' <> 'null'::jsonb THEN
    phone := value->>'phone';
    IF phone ~ '[[:cntrl:]]' OR phone ~ U&'[\0080-\009F]' THEN RETURN false; END IF;
    phone := btrim(phone);
    IF char_length(phone) > 40 OR phone !~ '^\+?[0-9 ()-]+$'
       OR char_length(regexp_replace(phone,'[^0-9]','','g')) NOT BETWEEN 7 AND 15 THEN RETURN false; END IF;
  END IF;
  IF value->'website' <> 'null'::jsonb AND NOT venue_public_contact_url_valid(value->>'website') THEN RETURN false; END IF;
  IF jsonb_array_length(value->'messengers') > 3 THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_array_elements(value->'messengers') LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
    IF NOT (item ?& ARRAY['kind','url']) OR item - ARRAY['kind','url'] <> '{}'::jsonb
       OR jsonb_typeof(item->'kind') <> 'string' OR jsonb_typeof(item->'url') <> 'string'
       OR item->>'kind' NOT IN ('telegram','whatsapp','vk') THEN RETURN false; END IF;
    IF item->>'kind' = ANY(kinds) OR NOT venue_public_contact_url_valid(item->>'url',item->>'kind') THEN RETURN false; END IF;
    kinds := array_append(kinds,item->>'kind');
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE venues ADD COLUMN public_contacts jsonb;
ALTER TABLE venues ADD CONSTRAINT venues_public_contacts_check
  CHECK (venue_public_contacts_valid(public_contacts));
