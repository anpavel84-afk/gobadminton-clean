-- Synthetic-only transaction on disposable PostGIS; fully rolls back.
BEGIN;
SET LOCAL application_name='gb_friends_s1_disposable_sql_test';
DO $verify$
DECLARE
 a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
 c uuid := gen_random_uuid(); pair uuid := gen_random_uuid();
 relation uuid := gen_random_uuid(); request uuid := gen_random_uuid();
 at timestamptz := clock_timestamp();
 epoch bigint; denied boolean;
BEGIN
 INSERT INTO users(id,display_name) VALUES(a,'A'),(b,'B'),(c,'C');
 INSERT INTO player_social_profiles(user_id,display_name,contact_policy)
   VALUES(a,'A','requests'),(b,'B','requests'),(c,'C','requests');
 INSERT INTO social_pairs(id,user_low,user_high)
   VALUES(pair,LEAST(a,b),GREATEST(a,b));
 INSERT INTO friendships(id,pair_id,requester_user_id,recipient_user_id,
   request_id,generation,version,state,requester_epoch,recipient_epoch,
   requested_at,expires_at)
   VALUES(relation,pair,a,b,request,1,1,'pending',1,1,at,at+interval '7 days');
 INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,
   requester_user_id,recipient_user_id,requested_at,expires_at)
   VALUES(request,relation,1,a,b,at,at+interval '7 days');

 denied:=false;
 BEGIN
  INSERT INTO friendships(pair_id,requester_user_id,recipient_user_id,
    request_id,state,requester_epoch,recipient_epoch,expires_at)
    VALUES(pair,a,c,gen_random_uuid(),'pending',1,1,clock_timestamp()+interval '1 day');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'invalid pair allowed'; END IF;

 denied:=false;
 BEGIN
  UPDATE friendship_request_attempts SET expires_at=expires_at+interval '1 hour' WHERE request_id=request;
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'attempt history rewrite allowed'; END IF;

 denied:=false;
 BEGIN
  UPDATE friendships SET generation=4,version=3 WHERE id=relation;
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'version/generation invalid transition allowed'; END IF;

 UPDATE friendships SET state='accepted',expires_at=NULL,
   accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
   WHERE id=relation;
 IF NOT EXISTS(SELECT 1 FROM friendships WHERE id=relation AND version=2 AND state='accepted')
   THEN RAISE EXCEPTION 'valid accepted transition failed'; END IF;

 UPDATE player_social_profiles SET contact_policy='closed' WHERE user_id=a;
 SELECT social_action_epoch INTO epoch FROM player_social_profiles WHERE user_id=a;
 IF epoch<>2 THEN RAISE EXCEPTION 'profile epoch error';END IF;
 UPDATE users SET status='disabled' WHERE id=a;
 SELECT social_action_epoch INTO epoch FROM player_social_profiles WHERE user_id=a;
 IF epoch<>3 THEN RAISE EXCEPTION 'account epoch error';END IF;

 denied:=false;
 BEGIN
  INSERT INTO social_action_rate_buckets(user_id,bucket,window_start,count,expires_at)
  VALUES(a,'friend.send',clock_timestamp(),-1,clock_timestamp()+interval '1 hour');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'negative quota allowed'; END IF;
 RAISE NOTICE 'GB_FRIENDS_0032_NEGATIVE_ASSERTIONS_PASS';
END
$verify$;
ROLLBACK;
