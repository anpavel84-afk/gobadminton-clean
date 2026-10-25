-- WHATWG parsing belongs to application writes/reads. SQL enforces canonical storage.
CREATE FUNCTION public_venue_contact_url_valid(value text, messenger text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE authority text; host text; tail text; label text; i integer;
BEGIN
 IF value IS NULL OR length(value) > 300 OR value !~ '^https?://' THEN RETURN false; END IF;
 FOR i IN 1..length(value) LOOP
  IF ascii(substr(value,i,1)) < 33 OR ascii(substr(value,i,1)) > 126 THEN RETURN false; END IF;
 END LOOP;
 IF position(chr(92) in value)>0 THEN RETURN false; END IF;
 authority := substring(value from '^https?://([^/?#]+)');
 IF authority IS NULL OR position('@' in authority)>0 OR authority <> lower(authority) THEN RETURN false; END IF;
 IF left(authority,1)='[' THEN
  IF authority !~ '^\[[0-9a-f:]+\]$' THEN RETURN false; END IF;
  BEGIN
   IF family(substring(authority from 2 for length(authority)-2)::inet) <> 6 THEN RETURN false; END IF;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 ELSE
  IF authority ~ '^[0-9.]+$' THEN
   BEGIN
    IF family(authority::inet) <> 4 OR host(authority::inet) <> authority THEN RETURN false; END IF;
   EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  ELSE
   IF length(authority)>253 THEN RETURN false; END IF;
   FOREACH label IN ARRAY string_to_array(authority,'.') LOOP
    IF label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN RETURN false; END IF;
   END LOOP;
  END IF;
 END IF;
 tail := substr(value,length(substring(value from '^https?://'))+length(authority)+1);
 IF left(tail,1) <> '/' OR split_part(split_part(tail,'?',1),'#',1) ~* '(^|/)(\.|%2e)(\.|%2e)?(/|$)' THEN RETURN false; END IF;
 IF messenger IS NOT NULL THEN
  host := CASE messenger WHEN 'telegram' THEN 't.me' WHEN 'whatsapp' THEN 'wa.me' WHEN 'vk' THEN 'vk.com' END;
  IF host IS NULL OR value !~ '^https://' OR authority <> host OR split_part(split_part(tail,'?',1),'#',1)='/' THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public_venue_contacts_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE phone text; item jsonb; kinds text[] := ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(value) <> 'object' OR NOT value ?& ARRAY['phone','website','messengers']
    OR value - ARRAY['phone','website','messengers'] <> '{}'::jsonb THEN RETURN false; END IF;
 IF jsonb_typeof(value->'phone') NOT IN ('string','null') OR jsonb_typeof(value->'website') NOT IN ('string','null')
    OR jsonb_typeof(value->'messengers') <> 'array' THEN RETURN false; END IF;
 IF value->'phone' <> 'null'::jsonb THEN
  phone := value->>'phone';
  IF length(phone)>40 OR phone <> btrim(phone) OR phone !~ '^\+?[0-9 ()-]+$'
    OR length(regexp_replace(phone,'[^0-9]','','g')) NOT BETWEEN 7 AND 15 THEN RETURN false; END IF;
 END IF;
 IF value->'website' <> 'null'::jsonb AND NOT public_venue_contact_url_valid(value->>'website') THEN RETURN false; END IF;
 IF jsonb_array_length(value->'messengers')>3 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'messengers') LOOP
  IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['kind','url'] OR item - ARRAY['kind','url'] <> '{}'::jsonb
   OR jsonb_typeof(item->'kind')<>'string' OR jsonb_typeof(item->'url')<>'string'
   OR item->>'kind' NOT IN ('telegram','whatsapp','vk') OR item->>'kind'=ANY(kinds)
   OR NOT public_venue_contact_url_valid(item->>'url',item->>'kind') THEN RETURN false; END IF;
  kinds := array_append(kinds,item->>'kind');
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE venues ADD COLUMN public_contacts jsonb,
 ADD CONSTRAINT venues_public_contacts_check CHECK ((public_contacts IS NULL OR public_venue_contacts_valid(public_contacts)) IS TRUE);
