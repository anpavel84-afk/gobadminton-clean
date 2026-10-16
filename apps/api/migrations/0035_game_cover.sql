-- Game slot only: venue fallback is resolved live against games.venue_id.
ALTER TABLE games ADD COLUMN cover_key text UNIQUE CHECK (cover_key IS NULL OR cover_key ~ '^[a-f0-9]{64}\.png$');
ALTER TABLE games ADD COLUMN cover_moderation_approval_id uuid REFERENCES content_moderation_approvals(id);
ALTER TABLE games ADD COLUMN cover_actor_id uuid REFERENCES users(id);
ALTER TABLE games ADD CONSTRAINT game_cover_binding CHECK
 ((cover_key IS NULL AND cover_moderation_approval_id IS NULL AND cover_actor_id IS NULL)
 OR (cover_key IS NOT NULL AND cover_moderation_approval_id IS NOT NULL AND cover_actor_id IS NOT NULL));
CREATE FUNCTION game_own_cover_url(game_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT '/v1/media/game-covers/' || g.cover_key FROM games g
 JOIN content_moderation_approvals a ON a.id=g.cover_moderation_approval_id
 JOIN users u ON u.id=g.cover_actor_id
 WHERE g.id=game_id AND u.status='active' AND a.decision='allow' AND a.surface_key='cover_image'
 AND NOT EXISTS (SELECT 1 FROM game_moderation_state ms WHERE ms.game_id=g.id AND ms.state<>'clear')
$$;
CREATE FUNCTION game_effective_cover_url(game_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT COALESCE(game_own_cover_url(g.id),venue_cover_url(g.venue_id)) FROM games g WHERE g.id=game_id
$$;
CREATE TRIGGER game_cover_cleanup AFTER UPDATE OF cover_key OR DELETE ON games
 FOR EACH ROW EXECUTE FUNCTION queue_owned_cover_cleanup();
CREATE FUNCTION retire_inactive_game_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE games SET cover_key=NULL,cover_moderation_approval_id=NULL,cover_actor_id=NULL,
   version=version+1,updated_at=now() WHERE cover_actor_id=NEW.id AND cover_key IS NOT NULL;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER inactive_game_cover AFTER UPDATE OF status ON users
 FOR EACH ROW EXECUTE FUNCTION retire_inactive_game_cover();
