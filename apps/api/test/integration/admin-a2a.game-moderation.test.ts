import { normalizeDiscovery } from "../../src/games/games-discovery.query";
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret,sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv,type AppEnv } from "../../src/config/env";
import { GamesService,type GameDto } from "../../src/games/games.service";
import { GameChatService } from "../../src/game-chat/game-chat.service";
import { InvitationsService } from "../../src/invitations/invitations.service";
import { ParticipationsService } from "../../src/participations/participations.service";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:18940",pepper="a2a-private-synthetic-admin-pepper-32chars";
type Actor={id:string;userId:string;sessionId:string;credentialId:string;token:string;csrf:string};
run("Admin A2a synthetic game moderation / Sessions cancellation",()=>{
  let app:NestFastifyApplication,pool:Pool,env:AppEnv,games:GamesService,participations:ParticipationsService,invitations:InvitationsService,chat:GameChatService,sessions:SessionService;
  let moderator:Actor,superadmin:Actor,support:Actor,content:Actor,venueId:string;
  beforeAll(async()=>{
    process.env.NODE_ENV="test";process.env.APP_ENV="local";process.env.AUTH_PEPPER="a2a-private-consumer-pepper-32chars";
    process.env.PUBLIC_API_ORIGIN="http://127.0.0.1:18941";process.env.PUBLIC_WEB_ORIGIN="http://127.0.0.1:18942";process.env.ALLOWED_WEB_ORIGINS=process.env.PUBLIC_WEB_ORIGIN;
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
    env=loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",GAME_MODERATION_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper,SOCIAL_DIRECTORY_ENABLED:"1",SOCIAL_INVITATIONS_ENABLED:"1",SOCIAL_GAME_CHAT_ENABLED:"1"});
    pool=new Pool({connectionString:env.DATABASE_URL,max:10});
    const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule]}).compile();
    app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
    games=mod.get(GamesService);participations=mod.get(ParticipationsService);invitations=mod.get(InvitationsService);chat=mod.get(GameChatService);sessions=mod.get(SessionService);
    moderator=await actor("moderator");superadmin=await actor("superadmin");support=await actor("support");content=await actor("content_manager");
    venueId=(await pool.query<{id:string}>(`INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      SELECT id,'A2a synthetic venue','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$1,'unverified','a2a venue','a2a address' FROM cities LIMIT 1 RETURNING id`,[moderator.userId])).rows[0]!.id;
  },120000);
  beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");});
  afterAll(async()=>{await app?.close();await pool?.end();});
  async function user(){return (await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('A2a synthetic') RETURNING id")).rows[0]!.id;}
  // Explicit synthetic authority fixtures for command tests. Actual signed enrollment/login is separately exercised in browser harness.
  async function actor(role:AdminRole):Promise<Actor>{
    const userId=await user(),id=(await pool.query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0]!.id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);
    const credentialId=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credentialId,id,Buffer.from('synthetic-command-fixture')]);
    const sessionId=(await pool.query<{id:string}>("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",[id,credentialId,hashSecret(pepper,token),sealSecret(pepper,csrf)])).rows[0]!.id;
    return {userId,id,credentialId,token,csrf,sessionId};
  }
  async function fixture(){const ownerId=await user(),session=await sessions.createConsumerSession(ownerId);const starts=new Date(Date.now()+2*86400000),ends=new Date(+starts+3600000);
    const draft=await games.createDraft(ownerId,session.session.id,randomUUID(),{hostDisplayName:'Synthetic owner',hostPublicContact:'No real contact',venueId,startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:'Europe/Moscow',applicationDeadlineAt:starts.toISOString(),capacity:20,externalReservedCount:0,visibility:'public',formatKey:'doubles',activityKind:'regular',levelRule:{scaleId:'test',scaleVersion:1,allowedLevelIds:['test']},settlement:{mode:'external',purpose:'no_trainer_fee',priceMinor:null,currency:null,terms:'Synthetic only'}});
    return {game:(await games.publish(ownerId,session.session.id,draft.body.id,randomUUID(),1)).body,ownerId,session};
  }
  function command(game:GameDto|{id:string},action:string,version=1,a=moderator,key:string=randomUUID(),extra:object={}){return app.inject({method:'POST',url:`/v1/admin/games/${game.id}/moderation/commands`,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin,'x-csrf-token':a.csrf,'idempotency-key':key},payload:{action,expectedModerationVersion:version,reasonCode:'synthetic_review',...extra}});}
  function detail(id:string,a=moderator,query=''){return app.inject({method:'GET',url:'/v1/admin/games/'+id+query,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin}});}
  async function stats(id:string){return (await pool.query(`SELECT (SELECT row_to_json(g) FROM games g WHERE id=$1) AS game,
    (SELECT json_agg(p ORDER BY id) FROM participations p WHERE game_id=$1) AS participations,
    (SELECT json_agg(t ORDER BY t.id) FROM participation_transitions t JOIN participations p ON p.id=t.participation_id WHERE p.game_id=$1) AS transitions,
    (SELECT json_agg(i ORDER BY id) FROM game_invitations i WHERE game_id=$1) AS invitations,
    (SELECT json_agg(c ORDER BY id) FROM conversations c WHERE game_id=$1) AS conversations,
    (SELECT json_agg(m ORDER BY m.user_id) FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id WHERE c.game_id=$1) AS members,
    (SELECT json_agg(e ORDER BY id) FROM outbox_events e WHERE aggregate_id=$1 OR payload->>'gameId'=$1::text) AS outbox,
    (SELECT json_agg(ms) FROM game_moderation_state ms WHERE game_id=$1) AS moderation,
    (SELECT json_agg(a ORDER BY id) FROM game_moderation_actions a WHERE game_id=$1) AS history,
    (SELECT json_agg(e ORDER BY id) FROM privileged_audit_events e WHERE target_id=$1::text AND action_key LIKE 'admin.game.%') AS audit`,[id])).rows[0];}
  async function socialUser(){const userId=await user(),session=await sessions.createConsumerSession(userId);await pool.query("INSERT INTO player_social_profiles(user_id,display_name,social_eligible) VALUES($1,'A2a synthetic',true) ON CONFLICT DO NOTHING",[userId]);await pool.query("UPDATE player_social_profiles SET social_eligible=true WHERE user_id=$1",[userId]);return {userId,session,publicId:(await pool.query("SELECT public_player_id FROM player_social_profiles WHERE user_id=$1",[userId])).rows[0].public_player_id};}
  it('current role list/detail/commands deny support/content, consumer cookie/bearer, Origin/CSRF',async()=>{
    const {game}=await fixture();
    for(const a of [support,content]){expect((await detail(game.id,a)).statusCode).toBe(403);expect((await command(game,'hide',1,a)).statusCode).toBe(403);}
    for(const headers of [{origin},{origin,authorization:'Bearer '+moderator.token},{origin:'http://127.0.0.1:18942'}])expect((await app.inject({method:'GET',url:'/v1/admin/games',headers})).statusCode).toBe(headers.origin===origin?401:403);
    const wrong=await app.inject({method:'POST',url:`/v1/admin/games/${game.id}/moderation/commands`,cookies:{[ADMIN_COOKIE]:moderator.token},headers:{origin,'idempotency-key':randomUUID()},payload:{action:'hide',expectedModerationVersion:1,reasonCode:'test'}});expect(wrong.statusCode).toBe(403);
    for(const a of [moderator,superadmin]){const res=await detail(game.id,a);expect(res.statusCode).toBe(200);expect(res.headers['cache-control']).toBe('no-store');expect(res.json().moderation).toMatchObject({state:'clear',version:1});expect(JSON.stringify(res.json())).not.toContain('No real contact');}
  });
  it('strict reason/version/body/target/query validation and missing keys fail without side effects',async()=>{
    const {game}=await fixture(),before=await stats(game.id);
    for(const extra of [{reasonCode:''},{expectedModerationVersion:0},{unexpected:true},{expectedGameVersion:2}])expect((await command(game,'hide',1,moderator,randomUUID(),extra)).statusCode).toBe(400);
    expect((await command(game,'force_cancel')).statusCode).toBe(400);expect((await command(game,'hide',1,moderator,'short')).statusCode).toBe(400);expect((await detail('bad')).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/v1/admin/games?limit=101',cookies:{[ADMIN_COOKIE]:moderator.token},headers:{origin}})).statusCode).toBe(400);
    expect(await stats(game.id)).toEqual(before);
  });
  it('hide removes discovery only; takedown denies public detail; restore preserves lifecycle/visibility/history',async()=>{
    const {game,ownerId}=await fixture();expect((await games.listPublished({})).items.some(g=>g.id===game.id)).toBe(true);
    expect((await command(game,'hide')).statusCode).toBe(200);expect((await games.listPublished({limit:100})).items.some(g=>g.id===game.id)).toBe(false);expect((await games.getGame(game.id,null)).status).toBe('published');
    const map=await games.mapPublished(normalizeDiscovery({cityId:(await pool.query('SELECT city_id FROM venues WHERE id=$1',[venueId])).rows[0].city_id,temporalScope:'upcoming',venueId}));expect(map.items.flatMap(v=>v.games).some(g=>g.id===game.id)).toBe(false);
    expect((await command(game,'takedown',2)).statusCode).toBe(200);await expect(games.getGame(game.id,null)).rejects.toMatchObject({response:{code:'GAME_NOT_FOUND'}});expect((await games.getGame(game.id,ownerId)).status).toBe('published');
    expect((await command(game,'hide',3)).statusCode).toBe(409);expect((await command(game,'restore_moderation',3)).statusCode).toBe(200);
    expect((await games.getGame(game.id,null)).version).toBe(game.version);const d=(await detail(game.id)).json();expect(d.history.map((h:{action:string})=>h.action)).toEqual(['restore_moderation','takedown','hide']);expect(d.moderation).toMatchObject({state:'clear',requestsLocked:false,version:4});
  });
  it('request lock blocks actual request/create invitation/accept; preserves replay/withdraw/history then restoration permits new work',async()=>{
    const f=await fixture(),inv=await socialUser();await pool.query("INSERT INTO player_social_profiles(user_id,display_name,social_eligible) VALUES($1,'A2a owner',true) ON CONFLICT DO NOTHING",[f.ownerId]);await pool.query('UPDATE player_social_profiles SET social_eligible=true WHERE user_id=$1',[f.ownerId]);
    const i=await invitations.create(f.ownerId,f.session.session.id,f.game.id,randomUUID(),{inviteePublicPlayerId:inv.publicId,expectedGameVersion:f.game.version});
    const player=await socialUser(),key=randomUUID(),p=await participations.request(player.userId,player.session.session.id,f.game.id,key,f.game.version);
    expect((await command(f.game,'lock_requests')).statusCode).toBe(200);
    const other=await socialUser();await expect(participations.request(other.userId,other.session.session.id,f.game.id,randomUUID(),f.game.version)).rejects.toMatchObject({response:{code:'GAME_REQUESTS_LOCKED'}});
    await expect(invitations.create(f.ownerId,f.session.session.id,f.game.id,randomUUID(),{inviteePublicPlayerId:other.publicId,expectedGameVersion:f.game.version})).rejects.toMatchObject({response:{code:'GAME_REQUESTS_LOCKED'}});
    await expect(invitations.accept(inv.userId,inv.session.session.id,i.body.id,randomUUID(),{expectedVersion:i.body.version,expectedGameVersion:f.game.version})).rejects.toMatchObject({response:{code:'GAME_REQUESTS_LOCKED'}});
    expect((await participations.request(player.userId,player.session.session.id,f.game.id,key,f.game.version)).body.id).toBe(p.body.id);
    expect((await participations.withdraw(player.userId,player.session.session.id,p.body.id,randomUUID(),p.body.version)).body.status).toBe('withdrawn');
    expect((await command(f.game,'restore_moderation',2)).statusCode).toBe(200);expect((await participations.request(other.userId,other.session.session.id,f.game.id,randomUUID(),f.game.version)).body.status).toBe('pending');
  });
  it('fresh step-up required on takedown/force-cancel including sealed replay',async()=>{
    const f=await fixture(),key=randomUUID();await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1",[moderator.sessionId]);
    expect((await command(f.game,'takedown')).json().code).toBe('ADMIN_STEP_UP_REQUIRED');expect((await command(f.game,'force_cancel',1,moderator,key,{expectedGameVersion:f.game.version})).json().code).toBe('ADMIN_STEP_UP_REQUIRED');
    expect((await command(f.game,'hide')).statusCode).toBe(200);await pool.query('UPDATE admin_sessions SET step_up_at=now() WHERE id=$1',[moderator.sessionId]);
    expect((await command(f.game,'force_cancel',2,moderator,key,{expectedGameVersion:f.game.version})).statusCode).toBe(200);await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1",[moderator.sessionId]);
    expect((await command(f.game,'force_cancel',2,moderator,key,{expectedGameVersion:f.game.version})).statusCode).toBe(403);await pool.query('UPDATE admin_sessions SET step_up_at=now() WHERE id=$1',[moderator.sessionId]);
  });
  it('same-key concurrent replay is exactly once; changed target/body conflict; independent version race has one winner',async()=>{
    const f=await fixture(),key=randomUUID(),results=await Promise.all([command(f.game,'hide',1,moderator,key),command(f.game,'hide',1,moderator,key)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);expect(results[0]!.json()).toEqual(results[1]!.json());expect((await detail(f.game.id)).json().history).toHaveLength(1);
    expect((await command(f.game,'lock_requests',2,moderator,key)).statusCode).toBe(409);const g=await fixture();expect((await command(g.game,'hide',1,moderator,key)).statusCode).toBe(409);
    const race=await Promise.all([command(f.game,'lock_requests',2),command(f.game,'restore_moderation',2)]);expect(race.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await detail(f.game.id)).json().history).toHaveLength(2);
  });
  it('force-cancel executes existing participants/invites/chat/outbox consequences; restore never revives; jobs preserved',async()=>{
    const f=await fixture(),p=await socialUser(),inv=await socialUser();await pool.query("INSERT INTO player_social_profiles(user_id,display_name,social_eligible) VALUES($1,'A2a owner',true) ON CONFLICT DO NOTHING",[f.ownerId]);await pool.query('UPDATE player_social_profiles SET social_eligible=true WHERE user_id=$1',[f.ownerId]);
    const pending=await participations.request(p.userId,p.session.session.id,f.game.id,randomUUID(),f.game.version);await participations.confirm(f.ownerId,f.session.session.id,pending.body.id,randomUUID(),pending.body.version);f.game=await games.getGame(f.game.id,f.ownerId);
    await invitations.create(f.ownerId,f.session.session.id,f.game.id,randomUUID(),{inviteePublicPlayerId:inv.publicId,expectedGameVersion:f.game.version});await chat.getOrEnsureChat(f.ownerId,f.game.id);
    const jobsBefore=(await pool.query("SELECT count(*)::int n FROM pgboss.job WHERE data->>'gameId'=$1",[f.game.id])).rows[0].n;
    const res=await command(f.game,'force_cancel',1,moderator,randomUUID(),{expectedGameVersion:f.game.version});expect(res.statusCode).toBe(200);expect(res.json()).toMatchObject({status:'cancelled',gameVersion:f.game.version+1});
    const s=await stats(f.game.id);expect(s.participations[0].status).toBe('cancelled_by_game');expect(s.invitations[0].status).toBe('cancelled_by_game');expect(s.conversations[0].lifecycle_state).toBe('closed');expect(s.members.every((m:{send_allowed:boolean})=>!m.send_allowed)).toBe(true);expect(s.outbox.some((e:{type:string})=>e.type==='game.cancelled')).toBe(true);
    expect((await pool.query("SELECT count(*)::int n FROM pgboss.job WHERE data->>'gameId'=$1",[f.game.id])).rows[0].n).toBe(jobsBefore);
    expect((await command(f.game,'restore_moderation',2)).statusCode).toBe(200);const after=await stats(f.game.id);for(const k of ['game','participations','invitations','conversations','members','outbox'])expect(after[k]).toEqual(s[k]);expect(after.audit).toHaveLength(2);
  });
  it('audit INSERT failure rolls back force-cancel projection, history, receipt and every domain consequence',async()=>{
    const f=await fixture(),p=await socialUser();await participations.request(p.userId,p.session.session.id,f.game.id,randomUUID(),f.game.version);await chat.getOrEnsureChat(f.ownerId,f.game.id);const before=await stats(f.game.id);
    await pool.query("CREATE FUNCTION a2a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='admin.game.force_cancel' THEN RAISE EXCEPTION 'synthetic audit rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER a2a_fail_audit BEFORE INSERT ON privileged_audit_events FOR EACH ROW EXECUTE FUNCTION a2a_fail_audit()");
    const key=randomUUID();try{expect((await command(f.game,'force_cancel',1,moderator,key,{expectedGameVersion:f.game.version})).statusCode).toBe(500);expect(await stats(f.game.id)).toEqual(before);expect((await pool.query('SELECT 1 FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2',[moderator.id,hashSecret(pepper,key)])).rowCount).toBe(0);}finally{await pool.query('DROP TRIGGER a2a_fail_audit ON privileged_audit_events; DROP FUNCTION a2a_fail_audit()');}
    expect((await command(f.game,'force_cancel',1,moderator,key,{expectedGameVersion:f.game.version})).statusCode).toBe(200);
  });
  it('owner cancel racing Admin cancel has one domain winner and no duplicate consequences',async()=>{
    const f=await fixture(),outcomes=await Promise.allSettled([games.cancel(f.ownerId,f.session.session.id,f.game.id,randomUUID(),f.game.version,'synthetic_owner'),command(f.game,'force_cancel',1,moderator,randomUUID(),{expectedGameVersion:f.game.version})]);
    const ownerOk=outcomes[0]!.status==='fulfilled';const admin=outcomes[1]!;expect(admin.status).toBe('fulfilled');if(admin.status==='fulfilled')expect(admin.value.statusCode).toBe(ownerOk?409:200);
    const s=await stats(f.game.id);expect(s.game.status).toBe('cancelled');expect(s.outbox.filter((e:{type:string})=>e.type==='game.cancelled')).toHaveLength(1);
  });
  it('revocation holding A0a authority lock commits before waiting command; current principal/credential/session/role denies replay',async()=>{
    const f=await fixture(),key=randomUUID();expect((await command(f.game,'hide',1,moderator,key)).statusCode).toBe(200);
    for(const [sql,restore] of [
      ["UPDATE admin_principals SET status='suspended' WHERE id=$1","UPDATE admin_principals SET status='active' WHERE id=$1"],
      ["UPDATE admin_role_grants SET active=false WHERE principal_id=$1","UPDATE admin_role_grants SET active=true WHERE principal_id=$1"],
    ]){const c=await pool.connect();await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_admin_authority'))");await c.query(sql!,[moderator.id]);const pending=command(f.game,'hide',1,moderator,key);await c.query('COMMIT');c.release();expect([401,403]).toContain((await pending).statusCode);await pool.query(restore!,[moderator.id]);}
    await pool.query("UPDATE admin_webauthn_credentials SET status='revoked' WHERE credential_id=$1",[moderator.credentialId]);expect((await command(f.game,'hide',1,moderator,key)).statusCode).toBe(401);await pool.query("UPDATE admin_webauthn_credentials SET status='active' WHERE credential_id=$1",[moderator.credentialId]);
    await pool.query('UPDATE admin_sessions SET revoked_at=now() WHERE id=$1',[moderator.sessionId]);expect((await detail(f.game.id)).statusCode).toBe(401);await pool.query('UPDATE admin_sessions SET revoked_at=NULL WHERE id=$1',[moderator.sessionId]);expect((await detail(f.game.id)).json().history).toHaveLength(1);
  });
  it('request racing lock is serialized by Game fence; post-lock requests always denied',async()=>{
    const f=await fixture(),p=await socialUser();const results=await Promise.allSettled([participations.request(p.userId,p.session.session.id,f.game.id,randomUUID(),f.game.version),command(f.game,'lock_requests')]);expect(results[1]!.status).toBe('fulfilled');const q=await socialUser();await expect(participations.request(q.userId,q.session.session.id,f.game.id,randomUUID(),f.game.version)).rejects.toMatchObject({response:{code:'GAME_REQUESTS_LOCKED'}});expect((await detail(f.game.id)).json().moderation.requestsLocked).toBe(true);
  });
  it('append-only actions reject UPDATE/DELETE/TRUNCATE; history paginates beyond100 without losing current truth',async()=>{
    const f=await fixture();for(let i=1;i<=102;i++)expect((await command(f.game,i%2?'hide':'restore_moderation',i)).statusCode).toBe(200);
    const first=(await detail(f.game.id)).json();expect(first.history).toHaveLength(100);expect(first.nextHistoryCursor).toBeTruthy();const second=(await detail(f.game.id,moderator,'?historyCursor='+first.nextHistoryCursor)).json();expect(second.history).toHaveLength(2);expect(second.moderation.version).toBe(103);expect(new Set([...first.history,...second.history].map((h:{id:string})=>h.id)).size).toBe(102);
    for(const sql of ['UPDATE game_moderation_actions SET reason_code=reason_code','DELETE FROM game_moderation_actions','TRUNCATE game_moderation_actions CASCADE'])await expect(pool.query(sql)).rejects.toThrow('append-only');
  });
  it('feature disabled404 and production flag rejected; absent projection remains default without historical rewrite',async()=>{
    const f=await fixture();env.GAME_MODERATION_INTERNAL_ENABLED=false;try{expect((await detail(f.game.id)).statusCode).toBe(404);expect((await command(f.game,'hide')).statusCode).toBe(404);expect((await games.getGame(f.game.id,null)).id).toBe(f.game.id);}finally{env.GAME_MODERATION_INTERNAL_ENABLED=true;}
    expect((await pool.query('SELECT * FROM game_moderation_state WHERE game_id=$1',[f.game.id])).rowCount).toBe(0);
    expect(()=>loadEnv({...process.env,GAME_MODERATION_INTERNAL_ENABLED:'1',ADMIN_INTERNAL_ENABLED:'0'})).toThrow('public rollout disabled');
  });
});
