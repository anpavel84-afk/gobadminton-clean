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
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv,type AppEnv } from "../../src/config/env";
import { GamesService } from "../../src/games/games.service";
import { GameChatService } from "../../src/game-chat/game-chat.service";
import { InvitationsService } from "../../src/invitations/invitations.service";
import { ParticipationsService } from "../../src/participations/participations.service";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { ProfilesService } from "../../src/profiles/profiles.service";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { MessagingService } from "../../src/messaging/messaging.service";
import { RadarModule } from "../../src/radar/radar.module";
import { RadarService } from "../../src/radar/radar.service";
import { selectEligibleNearbyCandidates } from "../../src/radar/radar-matching";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:18960",pepper="a2b-private-synthetic-admin-pepper-32chars";
type Actor={id:string;userId:string;sessionId:string;credentialId:string;token:string;csrf:string};
run("Admin A2b synthetic restriction ledger / required capability boundaries",()=>{
  let app:NestFastifyApplication,pool:Pool,env:AppEnv,games:GamesService,participations:ParticipationsService,invitations:InvitationsService,chat:GameChatService,sessions:SessionService,profiles:ProfilesService,dm:MessagingService,radar:RadarService;
  let moderator:Actor,superadmin:Actor,support:Actor,content:Actor,venueId:string,cityId:string;
  beforeAll(async()=>{
    Object.assign(process.env,{NODE_ENV:"test",APP_ENV:"local",AUTH_PEPPER:"a2b-private-consumer-pepper-32chars",PUBLIC_API_ORIGIN:"http://127.0.0.1:18961",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:18962",ALLOWED_WEB_ORIGINS:"http://127.0.0.1:18962"});
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
    env=loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",USER_RESTRICTIONS_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper,SOCIAL_DIRECTORY_ENABLED:"1",SOCIAL_DM_ENABLED:"1",SOCIAL_RADAR_ENABLED:"1",SOCIAL_INVITATIONS_ENABLED:"1",SOCIAL_GAME_CHAT_ENABLED:"1"});
    pool=new Pool({connectionString:env.DATABASE_URL,max:20});
    const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule,ProfilesModule,MessagingModule,RadarModule]}).compile();
    app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}),{logger:false});await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
    games=mod.get(GamesService);participations=mod.get(ParticipationsService);invitations=mod.get(InvitationsService);chat=mod.get(GameChatService);sessions=mod.get(SessionService);profiles=mod.get(ProfilesService);dm=mod.get(MessagingService);radar=mod.get(RadarService);
    moderator=await actor("moderator");superadmin=await actor("superadmin");support=await actor("support");content=await actor("content_manager");
    cityId=(await pool.query("SELECT id FROM cities LIMIT 1")).rows[0].id;
    venueId=(await pool.query(`INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      VALUES($1,'A2b synthetic venue','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$2,'unverified','a2b venue','a2b address') RETURNING id`,[cityId,moderator.userId])).rows[0].id;
  },120000);
  beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");});
  afterAll(async()=>{await app?.close();await pool?.end();});
  async function user(){return (await pool.query("INSERT INTO users(display_name) VALUES('A2b synthetic') RETURNING id")).rows[0].id as string;}
  async function actor(role:AdminRole):Promise<Actor>{
    const userId=await user(),id=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0].id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);
    const credentialId=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credentialId,id,Buffer.from('synthetic-command-fixture')]);
    const sessionId=(await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",[id,credentialId,hashSecret(pepper,token),sealSecret(pepper,csrf)])).rows[0].id;
    return {userId,id,credentialId,token,csrf,sessionId};
  }
  async function social(){const userId=await user(),session=await sessions.createConsumerSession(userId);
    await pool.query("INSERT INTO player_social_profiles(user_id,display_name,city_id,directory_visible,contact_policy,social_eligible,radar_consented,radar_consent_policy_version,consent_policy_version,opted_in_at,radar_consented_at) VALUES($1,'A2b fixture',$2,true,'requests',true,true,'radar-mvp-v1','directory-mvp-v1',now(),now()) ON CONFLICT(user_id) DO UPDATE SET city_id=$2,directory_visible=true,social_eligible=true,radar_consented=true,radar_consent_policy_version='radar-mvp-v1',consent_policy_version='directory-mvp-v1',opted_in_at=now(),radar_consented_at=now()",[userId,cityId]);
    return {userId,session,publicId:(await pool.query("SELECT public_player_id FROM player_social_profiles WHERE user_id=$1",[userId])).rows[0].public_player_id};
  }
  function detail(id:string,a=moderator,query=''){return app.inject({method:'GET',url:'/v1/admin/users/'+id+'/restrictions'+query,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin}});}
  function command(id:string,body:object,a=moderator,key:string=randomUUID()){return app.inject({method:'POST',url:`/v1/admin/users/${id}/restrictions/commands`,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin,'x-csrf-token':a.csrf,'idempotency-key':key},payload:body});}
  function restriction(capability:string,expectedVersion=1,expiresAt=new Date(Date.now()+3600000).toISOString()){return {action:'restrict',capability,expectedVersion,expiresAt,reasonCode:'synthetic_review'};}
  async function restrict(id:string,capability:string,expectedVersion=1){const r=await command(id,restriction(capability,expectedVersion));expect(r.statusCode,r.body).toBe(200);return r.json();}
  async function reverse(id:string,restrictionId:string,expectedVersion:number){const r=await command(id,{action:'revoke_restriction',restrictionId,expectedVersion,reasonCode:'synthetic_reverse'});expect(r.statusCode,r.body).toBe(200);return r.json();}
  async function draft(owner:Awaited<ReturnType<typeof social>>,key:string=randomUUID()) {return games.createDraft(owner.userId,owner.session.session.id,key,{title:'A2b game',hostDisplayName:'Synthetic owner',hostPublicContact:'Synthetic only',venueId,startsAt:new Date(Date.now()+2*86400000).toISOString(),endsAt:new Date(Date.now()+2*86400000+3600000).toISOString(),timezone:'Europe/Moscow',applicationDeadlineAt:new Date(Date.now()+86400000).toISOString(),capacity:20,externalReservedCount:0,visibility:'public',formatKey:'doubles',activityKind:'regular',levelRule:{scaleId:'test',scaleVersion:1,allowedLevelIds:['test']},settlement:{mode:'external',purpose:'no_trainer_fee',priceMinor:null,currency:null,terms:'Synthetic only'}});}
  const blocked={response:{code:'CAPABILITY_RESTRICTED'}};
  it('exact target reads and mutations enforce current fixed roles, Origin, CSRF, stepup, no consumer escalation',async()=>{
    const u=await social();
    for(const a of [support,content]){expect((await detail(u.userId,a)).statusCode).toBe(403);expect((await command(u.userId,restriction('game.create'),a)).statusCode).toBe(403);expect((await command(u.userId,{action:'revoke_consumer_sessions',expectedVersion:1,reasonCode:'synthetic_review'},a)).statusCode).toBe(403);}
    const read=await detail(u.userId,superadmin);expect(read.statusCode).toBe(200);expect(read.json()).toMatchObject({version:1,restrictions:[],history:[]});expect(read.headers['cache-control']).toBe('no-store');expect(JSON.stringify(read.json())).not.toMatch(/email|provider|token|display_name/);
    for(const headers of [{origin},{origin,authorization:'Bearer '+moderator.token},{origin:'http://127.0.0.1:18962'}])expect((await app.inject({method:'GET',url:`/v1/admin/users/${u.userId}/restrictions`,headers})).statusCode).toBe(headers.origin===origin?401:403);
    const payload=restriction('game.create');expect((await app.inject({method:'POST',url:`/v1/admin/users/${u.userId}/restrictions/commands`,cookies:{[ADMIN_COOKIE]:moderator.token},headers:{origin,'idempotency-key':randomUUID()},payload})).statusCode).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1",[moderator.sessionId]);expect((await command(u.userId,payload)).statusCode).toBe(403);await pool.query('UPDATE admin_sessions SET step_up_at=now() WHERE id=$1',[moderator.sessionId]);
  });
  it('validates reason/version/capability/expiry/idempotency and foreign restriction without writing',async()=>{
    const u=await social();for(const extra of [{reasonCode:''},{expectedVersion:0},{capability:'ban'},{unexpected:true},{expiresAt:'bad'},{expiresAt:new Date(Date.now()-1000).toISOString()},{expiresAt:new Date(Date.now()+31*86400000).toISOString()}])expect([400,422]).toContain((await command(u.userId,{...restriction('game.create'),...extra})).statusCode);
    expect((await command(u.userId,restriction('game.create'),moderator,'short')).statusCode).toBe(400);expect((await detail('bad')).statusCode).toBe(400);expect((await detail(u.userId,moderator,'?beforeVersion=nope')).statusCode).toBe(400);expect((await detail(randomUUID())).statusCode).toBe(404);
    const other=await social(),r=await restrict(other.userId,'game.create');expect((await command(u.userId,{action:'revoke_restriction',restrictionId:r.restrictions[0].id,expectedVersion:1,reasonCode:'synthetic_reverse'})).statusCode).toBe(404);expect((await detail(u.userId)).json().version).toBe(1);
  });
  it('duplicate/concurrent same-key has one ledger/audit/action and mismatched fingerprint fails',async()=>{
    const u=await social(),key=randomUUID(),body=restriction('game.create');const rows=await Promise.all([command(u.userId,body,moderator,key),command(u.userId,body,moderator,key)]);expect(rows.map(r=>r.statusCode)).toEqual([200,200]);expect(rows[0].json()).toEqual(rows[1].json());
    expect((await command(u.userId,{...body,capability:'social.dm_send'},moderator,key)).statusCode).toBe(409);
    expect((await pool.query('SELECT count(*)::int n FROM user_restriction_actions WHERE user_id=$1',[u.userId])).rows[0].n).toBe(1);expect((await pool.query("SELECT count(*)::int n FROM privileged_audit_events WHERE target_id=$1 AND action_key='admin.user.restrict'",[u.userId])).rows[0].n).toBe(1);
  });
  it('concurrent version commands serialize; overlapping capability denies until every restriction reversed',async()=>{
    const u=await social(),results=await Promise.all([command(u.userId,restriction('game.create')),command(u.userId,restriction('game.create'))]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);const first=(await detail(u.userId)).json();const second=await restrict(u.userId,'game.create',2);await reverse(u.userId,first.restrictions[0].id,3);await expect(draft(u)).rejects.toMatchObject(blocked);await reverse(u.userId,second.restrictions.find((r:{id:string})=>r.id!==first.restrictions[0].id).id,4);expect((await draft(u)).statusCode).toBe(201);
  });
  it('account access overlay preserves sessions and roles; separate revoke remains deliberate and cannot grant Admin',async()=>{
    const u=await social(),second=await sessions.createConsumerSession(u.userId),r=await restrict(u.userId,'account.access');expect(await sessions.lookupActiveSession(u.session.sessionToken)).toBeNull();await expect(sessions.createConsumerSession(u.userId)).rejects.toMatchObject(blocked);
    expect((await pool.query('SELECT revoked_at FROM app_sessions WHERE user_id=$1',[u.userId])).rows.every(x=>x.revoked_at===null)).toBe(true);
    const reversed=await reverse(u.userId,r.restrictions[0].id,2);expect((await pool.query('SELECT reversal_of FROM privileged_audit_events WHERE id=$1',[reversed.auditId])).rows[0].reversal_of).toBe(r.auditId);expect(await sessions.lookupActiveSession(u.session.sessionToken)).not.toBeNull();const c=await command(u.userId,{action:'revoke_consumer_sessions',expectedVersion:3,reasonCode:'synthetic_sessions'});expect(c.statusCode).toBe(200);expect(c.json().revokedCount).toBe(2);expect(await sessions.lookupActiveSession(second.sessionToken)).toBeNull();expect((await sessions.createConsumerSession(u.userId)).session.id).toBeTruthy();expect((await pool.query('SELECT * FROM admin_principals WHERE user_id=$1',[u.userId])).rowCount).toBe(0);
    const roles=await pool.query('SELECT role,active FROM admin_role_grants WHERE principal_id=$1',[superadmin.id]);const staffConsumer=await sessions.createConsumerSession(superadmin.userId);const staff=await command(superadmin.userId,{action:'revoke_consumer_sessions',expectedVersion:1,reasonCode:'synthetic_sessions'});expect(staff.json().revokedCount).toBe(1);expect(await sessions.lookupActiveSession(staffConsumer.sessionToken)).toBeNull();expect((await detail(u.userId,superadmin)).statusCode).toBe(200);expect((await pool.query('SELECT role,active FROM admin_role_grants WHERE principal_id=$1',[superadmin.id])).rows).toEqual(roles.rows);
  });
  it('DB-time expiry applies without worker or role/setting mutation',async()=>{
    const u=await social(),expires=new Date(Date.now()+1600).toISOString();const r=await command(u.userId,restriction('game.create',1,expires));expect(r.statusCode).toBe(200);await expect(draft(u)).rejects.toMatchObject(blocked);
    await pool.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)',[expires]);expect((await detail(u.userId)).json().restrictions[0].status).toBe('expired');expect((await draft(u)).statusCode).toBe(201);expect((await detail(u.userId)).json().version).toBe(2);
  });
  it('game create restriction denies new draft and cached replay; existing publish/cancel/history allowed',async()=>{
    const u=await social(),key=randomUUID(),g=await draft(u,key);await restrict(u.userId,'game.create');await expect(draft(u)).rejects.toMatchObject(blocked);await expect(draft(u,key)).rejects.toMatchObject(blocked);
    const published=await games.publish(u.userId,u.session.session.id,g.body.id,randomUUID(),1);const cancelled=await games.cancel(u.userId,u.session.session.id,g.body.id,randomUUID(),published.body.version,'synthetic_cancel');expect(cancelled.body.status).toBe('cancelled');expect((await games.getGame(g.body.id,u.userId)).status).toBe('cancelled');
  });
  it('participation restriction denies request/replay/invitation acceptance while withdraw/history remain',async()=>{
    const o=await social(),u=await social(),g=(await draft(o)).body,published=(await games.publish(o.userId,o.session.session.id,g.id,randomUUID(),1)).body;
    const key=randomUUID(),requested=await participations.request(u.userId,u.session.session.id,g.id,key,published.version);await restrict(u.userId,'participation.request');await expect(participations.request(u.userId,u.session.session.id,g.id,randomUUID(),published.version)).rejects.toMatchObject(blocked);await expect(participations.request(u.userId,u.session.session.id,g.id,key,published.version)).rejects.toMatchObject(blocked);expect((await participations.withdraw(u.userId,u.session.session.id,requested.body.id,randomUUID(),requested.body.version)).body.status).toBe('withdrawn');
    const v=await social();await restrict(v.userId,'participation.request');const invite=await invitations.create(o.userId,o.session.session.id,g.id,randomUUID(),{inviteePublicPlayerId:v.publicId,expectedGameVersion:(await games.getGame(g.id,o.userId)).version});await expect(invitations.accept(v.userId,v.session.session.id,invite.body.id,randomUUID(),{expectedVersion:invite.body.version,expectedGameVersion:(await games.getGame(g.id,o.userId)).version})).rejects.toMatchObject(blocked);expect((await invitations.decline(v.userId,v.session.session.id,invite.body.id,randomUUID(),invite.body.version)).body.status).toBe('declined');
  });
  it('profile/directory restrictions hide public listing/detail/contact; own privacy-off and settings preserved',async()=>{
    for(const capability of ['profile.public','social.directory']){const u=await social(),viewer=await social();const before=(await pool.query('SELECT directory_visible,radar_consented,contact_policy,social_eligible FROM player_social_profiles WHERE user_id=$1',[u.userId])).rows[0];await restrict(u.userId,capability);
      expect((await profiles.listDirectory(null,{limit:100})).items.some(x=>x.publicPlayerId===u.publicId)).toBe(false);await expect(profiles.getDirectoryPlayer(null,u.publicId)).rejects.toMatchObject({response:{code:'RESOURCE_UNAVAILABLE'}});expect((await profiles.getOwn(u.userId)).displayName).toBe('A2b fixture');
      await expect(dm.createRequest(viewer.userId,viewer.session.session.id,randomUUID(),{targetPublicPlayerId:u.publicId,text:'Synthetic',clientMessageId:randomUUID()})).rejects.toMatchObject({response:{code:'RESOURCE_UNAVAILABLE'}});
      expect((await pool.query('SELECT directory_visible,radar_consented,contact_policy,social_eligible FROM player_social_profiles WHERE user_id=$1',[u.userId])).rows[0]).toEqual(before);
      const own=await profiles.getOwn(u.userId);await expect(profiles.setVisibility(u.userId,u.session.session.id,randomUUID(),{expectedVersion:own.version,directoryVisible:true,consentPolicyVersion:'directory-mvp-v1'})).rejects.toMatchObject(blocked);
      expect((await profiles.setVisibility(u.userId,u.session.session.id,randomUUID(),{expectedVersion:own.version,directoryVisible:false})).body.directoryVisible).toBe(false);
    }
  });
  it('DM send restriction blocks create/send/replay and duplicate clientMessageId; permitted history preserved',async()=>{
    const u=await social(),v=await social(),key=randomUUID(),input={targetPublicPlayerId:v.publicId,text:'A2b retained',clientMessageId:randomUUID()},created=await dm.createRequest(u.userId,u.session.session.id,key,input);await restrict(u.userId,'social.dm_send');
    await expect(dm.createRequest(u.userId,u.session.session.id,key,input)).rejects.toMatchObject(blocked);await expect(dm.sendMessage(u.userId,u.session.session.id,randomUUID(),created.body.conversation.id,{text:'denied',clientMessageId:input.clientMessageId})).rejects.toMatchObject(blocked);expect((await dm.listMessages(u.userId,created.body.conversation.id,{})).items[0]?.text).toBe('A2b retained');
    await restrict(v.userId,'social.dm_send');await expect(dm.accept(v.userId,v.session.session.id,created.body.conversation.id,randomUUID(),created.body.conversation.version)).rejects.toMatchObject(blocked);
  });
  it('Game chat send restriction preserves authorized messages and Game cancellation management',async()=>{
    const u=await social(),g=(await draft(u)).body;await games.publish(u.userId,u.session.session.id,g.id,randomUUID(),1);const key=randomUUID(),input={text:'A2b chat history',clientMessageId:randomUUID()};await chat.sendMessage(u.userId,u.session.session.id,key,g.id,input);await restrict(u.userId,'social.game_chat_send');await expect(chat.sendMessage(u.userId,u.session.session.id,randomUUID(),g.id,{text:'blocked',clientMessageId:randomUUID()})).rejects.toMatchObject(blocked);await expect(chat.sendMessage(u.userId,u.session.session.id,key,g.id,input)).rejects.toMatchObject(blocked);expect((await chat.listMessages(u.userId,g.id,{})).items[0]?.text).toBe('A2b chat history');
  });
  it('Radar restriction removes presence, denies activation/nearby, preserves consent, and expiry does not reactivate',async()=>{
    const u=await social(),viewer=await social();const input={location:{latitude:55.75,longitude:37.62,accuracyMeters:100,capturedAt:new Date().toISOString()},radiusBucketKm:5,ttlMinutes:15,consentPolicyVersion:'radar-mvp-v1'};
    const started=await radar.start(u.userId,u.session.session.id,randomUUID(),input);await radar.start(viewer.userId,viewer.session.session.id,randomUUID(),input);
    const copied=(await pool.query('SELECT row_to_json(r) AS row FROM radar_presences r WHERE user_id=$1',[u.userId])).rows[0].row;
    const client=await pool.connect();
    try {
      expect((await selectEligibleNearbyCandidates(client,viewer.userId,new Date(),true)).some(x=>x.user_id===u.userId)).toBe(true);
      const r=await restrict(u.userId,'social.radar');expect((await pool.query('SELECT * FROM radar_presences WHERE user_id=$1',[u.userId])).rowCount).toBe(0);
      await expect(radar.start(u.userId,u.session.session.id,randomUUID(),input)).rejects.toMatchObject(blocked);await expect(radar.nearby(u.userId,u.session.session.id,started.body.activationId,{})).rejects.toMatchObject(blocked);
      // Simulate stale materialization: read/proof policy must still exclude it.
      await pool.query('INSERT INTO radar_presences SELECT * FROM json_populate_record(NULL::radar_presences,$1)',[JSON.stringify(copied)]);
      expect((await selectEligibleNearbyCandidates(client,viewer.userId,new Date(),true)).some(x=>x.user_id===u.userId)).toBe(false);
      await pool.query('DELETE FROM radar_presences WHERE user_id=$1',[u.userId]);await reverse(u.userId,r.restrictions[0].id,2);
      expect((await pool.query('SELECT * FROM radar_presences WHERE user_id=$1',[u.userId])).rowCount).toBe(0);expect((await pool.query('SELECT radar_consented FROM player_social_profiles WHERE user_id=$1',[u.userId])).rows[0].radar_consented).toBe(true);
    } finally {client.release();}

  });
  it('audit insertion failure rolls back ledger/version/presence/session/receipt atomically',async()=>{
    const u=await social(),key=randomUUID();await pool.query("CREATE FUNCTION a2b_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key LIKE 'admin.user.%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER a2b_fail_audit BEFORE INSERT ON privileged_audit_events FOR EACH ROW EXECUTE FUNCTION a2b_fail_audit()");
    try{expect((await command(u.userId,restriction('account.access'),moderator,key)).statusCode).toBe(500);expect((await command(u.userId,{action:'revoke_consumer_sessions',expectedVersion:1,reasonCode:'synthetic_revoke'})).statusCode).toBe(500);expect((await detail(u.userId)).json().version).toBe(1);expect(await sessions.lookupActiveSession(u.session.sessionToken)).not.toBeNull();}finally{await pool.query('DROP TRIGGER a2b_fail_audit ON privileged_audit_events; DROP FUNCTION a2b_fail_audit()');}
    expect((await command(u.userId,restriction('account.access'),moderator,key)).statusCode).toBe(200);
  });
  it('restriction/reversal/use and session issue/revoke serialize on target user fence',async()=>{
    const u=await social(),c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.userId]);const sanction=command(u.userId,restriction('game.create'));await c.query('COMMIT');const r=await sanction;expect(r.statusCode).toBe(200);await expect(draft(u)).rejects.toMatchObject(blocked);await reverse(u.userId,r.json().restrictions[0].id,2);expect((await draft(u)).statusCode).toBe(201);}finally{c.release();}
    const v=await social();const outcomes=await Promise.all([command(v.userId,{action:'revoke_consumer_sessions',expectedVersion:1,reasonCode:'synthetic_race'}),sessions.createConsumerSession(v.userId)]);expect(outcomes[0].statusCode).toBe(200);const active=await sessions.lookupActiveSession(outcomes[1].sessionToken);const count=outcomes[0].json().revokedCount;expect(active===null?count===2:count===1).toBe(true);
  });
  it('waiting consumer fence re-reads session after deliberate revocation commits',async()=>{
    const u=await social(),owner=await pool.connect(),waiting=await pool.connect();
    try {
      await owner.query('BEGIN');await owner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.userId]);
      await waiting.query('BEGIN');
      const pid=(await waiting.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending=app.get(ActorFenceService).assertActiveConsumerInTransaction(waiting,{actorId:u.userId,sessionId:u.session.session.id});
      let observed=false;
      for(let i=0;i<100;i++) { const row=(await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];if(row?.wait_event_type==='Lock'){observed=true;break;}await new Promise(r=>setTimeout(r,10)); }
      expect(observed).toBe(true);
      await owner.query('UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[u.userId]);
      await owner.query('COMMIT');
      await expect(pending).rejects.toMatchObject({response:{code:'UNAUTHENTICATED'}});
    } finally {await owner.query('ROLLBACK');await waiting.query('ROLLBACK');owner.release();waiting.release();}
  });
  it('concurrent restrict/reverse/use has one version winner and enforces resulting capability',async()=>{
    const u=await social(),r=await restrict(u.userId,'game.create');
    const [add,remove,use]=await Promise.allSettled([command(u.userId,restriction('game.create',2)),command(u.userId,{action:'revoke_restriction',restrictionId:r.restrictions[0].id,expectedVersion:2,reasonCode:'synthetic_reverse'}),draft(u)]);
    expect(add.status).toBe('fulfilled');expect(remove.status).toBe('fulfilled');
    if(add.status==='fulfilled'&&remove.status==='fulfilled')expect([add.value.statusCode,remove.value.statusCode].sort()).toEqual([200,409]);
    const state=(await detail(u.userId)).json();expect(state.version).toBe(3);
    if(state.restrictions.some((x:{status:string})=>x.status==='active'))await expect(draft(u)).rejects.toMatchObject(blocked);else expect((await draft(u)).statusCode).toBe(201);
    if(use.status==='rejected')expect(use.reason).toMatchObject(blocked);
  });
  it('current revoked role/principal/session denies even stored command replay; restriction history cannot mutate',async()=>{
    const u=await social(),key=randomUUID(),body=restriction('game.create');expect((await command(u.userId,body,moderator,key)).statusCode).toBe(200);
    const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_admin_authority'))");await c.query('UPDATE admin_role_grants SET active=false WHERE principal_id=$1',[moderator.id]);const waiting=command(u.userId,body,moderator,key);await c.query('COMMIT');expect((await waiting).statusCode).toBe(403);}finally{c.release();await pool.query('UPDATE admin_role_grants SET active=true WHERE principal_id=$1',[moderator.id]);}
    for(const [table,where] of [['admin_principals','id'],['admin_sessions','id']]){const id=table==='admin_principals'?moderator.id:moderator.sessionId;await pool.query(table==='admin_principals'?`UPDATE ${table} SET status='suspended' WHERE ${where}=$1`:`UPDATE ${table} SET revoked_at=now() WHERE ${where}=$1`,[id]);expect((await command(u.userId,body,moderator,key)).statusCode).toBe(401);await pool.query(table==='admin_principals'?`UPDATE ${table} SET status='active' WHERE ${where}=$1`:`UPDATE ${table} SET revoked_at=NULL WHERE ${where}=$1`,[id]);}
    for(const sql of ['DELETE FROM user_restrictions','UPDATE user_restrictions SET reason_code=reason_code','UPDATE user_restriction_actions SET reason_code=reason_code','DELETE FROM user_restriction_actions','TRUNCATE user_restriction_actions CASCADE'])await expect(pool.query(sql)).rejects.toThrow(/append-only|explicit reversal/);
  });
  it('history paginates by immutable version; feature defaults fail closed and no generic user listing',async()=>{
    const u=await social();for(let version=1;version<=102;version++)expect((await command(u.userId,{action:'revoke_consumer_sessions',expectedVersion:version,reasonCode:'synthetic_history'})).statusCode).toBe(200);
    const first=(await detail(u.userId)).json(),second=(await detail(u.userId,moderator,'?beforeVersion='+first.nextHistoryBeforeVersion)).json();expect(first.history).toHaveLength(100);expect(second.history).toHaveLength(2);expect(new Set([...first.history,...second.history].map((x:{id:string})=>x.id)).size).toBe(102);expect(second.version).toBe(103);
    expect((await app.inject({method:'GET',url:'/v1/admin/users',cookies:{[ADMIN_COOKIE]:moderator.token},headers:{origin}})).statusCode).toBe(404);
    env.USER_RESTRICTIONS_INTERNAL_ENABLED=false;try{expect((await detail(u.userId)).statusCode).toBe(404);expect((await command(u.userId,restriction('game.create'))).statusCode).toBe(404);}finally{env.USER_RESTRICTIONS_INTERNAL_ENABLED=true;}
    expect(()=>loadEnv({...process.env,USER_RESTRICTIONS_INTERNAL_ENABLED:'1',ADMIN_INTERNAL_ENABLED:'0'})).toThrow('public rollout disabled');
  });
});
