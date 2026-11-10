-- Keep bytes journaled for the existing collector; retain paid moderation history.
INSERT INTO avatar_media_gc(storage_key,not_before)
SELECT storage_key,now() FROM venue_photo_submissions
ON CONFLICT(storage_key) DO UPDATE SET not_before=now();
DROP TABLE venue_photo_submissions;
DROP FUNCTION venue_photo_submission_guard();
-- Leave the backward-compatible additive community_photo_image surface allowance
-- and approval rows intact so reapplying 0069 can reuse valid M1 decisions.
-- Attempts, UNKNOWN reservations, budgets and cost history are not reset.

DELETE FROM schema_migrations WHERE id='0069_venue_comment_photo_submissions';
