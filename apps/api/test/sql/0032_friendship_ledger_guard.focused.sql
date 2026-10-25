-- SOURCE ONLY: execute only on newly provisioned disposable isolated PostGIS
-- with migrations through 0032 applied. No real data; all fixtures roll back.
-- Each expected error has its own PL/pgSQL exception subtransaction.
BEGIN;
SET LOCAL application_name='gb_friends_s1_ledger_guard_focused';
DO $verify$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  pair uuid := gen_random_uuid(); other_pair uuid := gen_random_uuid();
  relation uuid := gen_random_uuid(); missing_relation uuid := gen_random_uuid();
  first_request uuid := gen_random_uuid(); second_request uuid := gen_random_uuid();
  at timestamptz := clock_timestamp();
  variant integer; denied boolean;
BEGIN
  INSERT INTO users(id,display_name) VALUES(a,'Guard A'),(b,'Guard B'),
    (c,'Guard C'),(d,'Guard D');
  INSERT INTO social_pairs(id,user_low,user_high) VALUES
    (pair,LEAST(a,b),GREATEST(a,b)),(other_pair,LEAST(c,d),GREATEST(c,d));
  INSERT INTO friendships(id,pair_id,requester_user_id,recipient_user_id,
    request_id,generation,version,state,requester_epoch,recipient_epoch,requested_at,expires_at)
    VALUES(relation,pair,a,b,first_request,1,1,'pending',1,1,at,at+interval '7 days');
  INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,
    requester_user_id,recipient_user_id,requested_at,expires_at)
    VALUES(first_request,relation,1,a,b,at,at+interval '7 days');
  IF NOT EXISTS(SELECT 1 FROM friendship_request_attempts WHERE request_id=first_request) THEN
    RAISE EXCEPTION 'valid same-transaction initial attempt missing';
  END IF;

  UPDATE friendships SET request_id=second_request,generation=2,version=2 WHERE id=relation;
  -- No generation-2 ledger row yet: these cannot pass by hitting ledger UNIQUE.
  -- 1 future generation; 2 identity; 3/4 endpoints; 5/6 timestamps; 7 missing parent.
  FOR variant IN 1..7 LOOP
    denied := false;
    BEGIN
      INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,
        requester_user_id,recipient_user_id,requested_at,expires_at)
        VALUES(CASE WHEN variant=2 THEN gen_random_uuid() ELSE second_request END,
          CASE WHEN variant=7 THEN missing_relation ELSE relation END,
          CASE WHEN variant=1 THEN 3 ELSE 2 END,
          CASE WHEN variant=3 THEN c ELSE a END,
          CASE WHEN variant=4 THEN c ELSE b END,
          CASE WHEN variant=5 THEN at+interval '1 hour' ELSE at END,
          CASE WHEN variant=6 THEN at+interval '8 days' ELSE at+interval '7 days' END);
    EXCEPTION WHEN SQLSTATE '23514' THEN denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'forged attempt variant % allowed',variant; END IF;
  END LOOP;
  INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,
    requester_user_id,recipient_user_id,requested_at,expires_at)
    VALUES(second_request,relation,2,a,b,at,at+interval '7 days');
  IF NOT EXISTS(SELECT 1 FROM friendship_request_attempts
    WHERE request_id=second_request AND generation=2) THEN
    RAISE EXCEPTION 'valid same-transaction advanced attempt missing';
  END IF;

  denied := false;
  BEGIN
    UPDATE friendships SET request_id=first_request,generation=3,version=3 WHERE id=relation;
  EXCEPTION WHEN SQLSTATE '23505' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'historical identity replay on UPDATE allowed'; END IF;
  denied := false;
  BEGIN
    INSERT INTO friendships(pair_id,requester_user_id,recipient_user_id,
      request_id,state,requester_epoch,recipient_epoch,requested_at,expires_at)
      VALUES(other_pair,c,d,first_request,'pending',1,1,at,at+interval '7 days');
  EXCEPTION WHEN SQLSTATE '23505' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'historical identity replay on INSERT allowed'; END IF;

  UPDATE friendships SET state='accepted',expires_at=NULL,accepted_at=at,
    version=version+1 WHERE id=relation AND request_id=second_request AND version=2;
  IF NOT FOUND THEN RAISE EXCEPTION 'valid unchanged-identity state CAS failed'; END IF;
  denied := false;
  BEGIN
    INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,
      requester_user_id,recipient_user_id,requested_at,expires_at)
      VALUES(second_request,relation,2,a,b,at,at+interval '7 days');
  EXCEPTION WHEN SQLSTATE '23514' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'non-pending attempt allowed'; END IF;

  denied := false;
  BEGIN
    TRUNCATE friendship_request_attempts;
  EXCEPTION WHEN SQLSTATE '23514' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'ledger TRUNCATE allowed'; END IF;
  denied := false;
  BEGIN
    UPDATE friendship_request_attempts SET expires_at=expires_at+interval '1 hour'
      WHERE request_id=first_request;
  EXCEPTION WHEN SQLSTATE '23514' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'historical ledger UPDATE allowed'; END IF;
  denied := false;
  BEGIN
    DELETE FROM friendship_request_attempts WHERE request_id=first_request;
  EXCEPTION WHEN SQLSTATE '23514' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'historical ledger DELETE allowed'; END IF;
  IF (SELECT count(*) FROM friendship_request_attempts
      WHERE friendship_id=relation) <> 2 THEN
    RAISE EXCEPTION 'ledger history changed';
  END IF;
  RAISE NOTICE 'GB_FRIENDS_0032_LEDGER_GUARD_FOCUSED_ASSERTIONS_PASS';
END
$verify$;
ROLLBACK;
