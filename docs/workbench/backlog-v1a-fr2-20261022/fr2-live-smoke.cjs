'use strict';
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {loadEnv}=require('./dist/config/env.js');
const {SessionService}=require('./dist/auth/session.service.js');
const {SESSION_COOKIE}=require('./dist/auth/constants.js');
const {DEMO_USER_IDS,DEMO_ISSUER_NAMESPACE}=require('./dist/database/demo-ids.js');
const origin='https://dev.gobadminton.ru';
const report={schema:'GB_FR2_LIVE_SYNTHETIC_SMOKE_V1',started_at:new Date().toISOString(),result:'NOT_RUN',checks:[],sessions_revoked:0,real_users_touched:false,flags_changed:false,source_changed:false};
function need(ok,code){if(!ok)throw Object.assign(new Error(code),{safeCode:code});}
let pool,svc,aa,bb,created;
const issued=[];
async function req(actor,path,body,key){
 need(path.startsWith('/v1/')&&!path.includes('://'),'invalid_local_path');
 const headers={Accept:'application/json'};
 if(actor)headers.Cookie=SESSION_COOKIE+'='+actor.sessionToken;
 if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=origin;headers['x-csrf-token']=actor.csrfToken;headers['Idempotency-Key']=key||randomUUID();}
 const res=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(12000)});
 const raw=await res.text();need(raw.length<1000000,'response_too_large');let value;try{value=JSON.parse(raw);}catch{throw Object.assign(new Error('invalid_json'),{safeCode:'invalid_json'});}
 need(res.ok,'HTTP_'+res.status+'_'+String(value?.code||'request_failed').replace(/[^A-Za-z0-9_]/g,'').slice(0,60));
 return {status:res.status,value};
}
async function check(name,fn){await fn();report.checks.push({name,result:'PASS'});}
async function finishRelation(){
 if(!created||!aa)return;
 const r=(await req(aa,'/v1/friendships/'+created.friendshipId)).value;
 if(r.relationship==='friends')await req(aa,'/v1/friendships/'+created.friendshipId+'/remove',{expectedVersion:r.version});
 else if(r.relationship==='outgoing_pending'&&r.request?.id===created.requestId)await req(aa,'/v1/friend-requests/'+created.requestId+'/cancel',{expectedVersion:r.version});
 else need(r.relationship==='unavailable','unexpected_cleanup_relationship');
 report.relationship_cleanup='API_TERMINAL_STATE';
}
(async()=>{
 try{
  const env=loadEnv(process.env);
  need(env.APP_ENV!=='prod'&&env.PUBLIC_API_ORIGIN===origin&&env.PUBLIC_WEB_ORIGIN===origin&&env.FRIENDS_INTERNAL_ENABLED&&env.SOCIAL_DIRECTORY_ENABLED,'not_authorized_DEV');
  report.before_sha=(await req(null,'/v1/meta')).value.gitSha;
  need(/^[a-f0-9]{40}$/.test(report.before_sha||''),'unknown_live_revision');
  pool=new Pool({connectionString:env.DATABASE_URL,max:2,statement_timeout:10000});
  // Only read published synthetic identity metadata. Never inspect existing sessions or real users.
  const people=(await pool.query(`SELECT u.id,p.public_player_id FROM users u JOIN player_social_profiles p ON p.user_id=u.id
   WHERE u.id=ANY($1::uuid[]) AND u.status='active' AND p.directory_visible AND p.social_eligible AND p.contact_policy='requests'
   AND EXISTS(SELECT 1 FROM external_identities e WHERE e.user_id=u.id AND e.issuer_namespace=$2)
   AND NOT EXISTS(SELECT 1 FROM external_identities e WHERE e.user_id=u.id AND e.issuer_namespace IS DISTINCT FROM $2)
   ORDER BY u.id`,[DEMO_USER_IDS,DEMO_ISSUER_NAMESPACE])).rows;
  need(people.length>=2,'no_two_proven_eligible_synthetic_accounts');
  let pair;
  for(let i=0;i<people.length&&!pair;i++)for(let k=i+1;k<people.length;k++){
   const [a,b]=[people[i],people[k]];
   const found=(await pool.query(`SELECT 1 FROM social_pairs sp WHERE sp.user_low=LEAST($1::uuid,$2::uuid) AND sp.user_high=GREATEST($1::uuid,$2::uuid)
    AND (EXISTS(SELECT 1 FROM friendships f WHERE f.pair_id=sp.id) OR EXISTS(SELECT 1 FROM user_blocks ub WHERE ub.pair_id=sp.id))`,[a.id,b.id])).rowCount;
   if(!found){pair=[a,b];break;}
  }
  need(pair,'no_unused_synthetic_pair');report.synthetic_users=pair.map(x=>x.id);
  // Only two NEW synthetic sessions, with shorter local lifetime. Runtime config unchanged.
  svc=new SessionService(pool,{...env,SESSION_TTL_SECONDS:180});
  aa=await svc.createConsumerSession(pair[0].id);issued.push(aa.session.id);
  bb=await svc.createConsumerSession(pair[1].id);issued.push(bb.session.id);
  await check('actual_capabilities_both',async()=>{for(const a of [aa,bb])need((await req(a,'/v1/me/social-capabilities')).value.friends===true,'friends_capability_off');});
  const key=randomUUID(),send={targetPublicPlayerId:pair[1].public_player_id};
  await check('send_actual_request',async()=>{created=(await req(aa,'/v1/friend-requests',send,key)).value;need(created.outcome==='pending'&&created.friendshipId&&created.requestId,'invalid_pending_receipt');});
  await check('same_key_replay_no_duplicate',async()=>{const r=(await req(aa,'/v1/friend-requests',send,key)).value;need(r.friendshipId===created.friendshipId&&r.requestId===created.requestId&&r.version===created.version,'replay_identity_changed');});
  await check('recipient_sees_incoming',async()=>{const x=(await req(bb,'/v1/me/friendships?view=incoming')).value;need(Array.isArray(x.items)&&x.items.some(v=>v.friendshipId===created.friendshipId&&v.relationship==='incoming_pending'),'incoming_missing');});
  await check('recipient_accepts',async()=>{const r=(await req(bb,'/v1/friend-requests/'+created.requestId+'/accept',{expectedVersion:created.version})).value;need(r.outcome==='accepted'&&r.friendshipId===created.friendshipId,'invalid_accept_receipt');});
  await check('both_accepted_lists',async()=>{for(const a of [aa,bb]){const x=(await req(a,'/v1/me/friendships?view=accepted')).value;need(x.items.some(v=>v.friendshipId===created.friendshipId&&v.relationship==='friends'),'accepted_missing');}});
  await check('API_remove_cleanup',finishRelation);
  await check('both_lists_after_remove',async()=>{for(const a of [aa,bb])need(!(await req(a,'/v1/me/friendships?view=accepted')).value.items.some(v=>v.friendshipId===created.friendshipId),'cleanup_still_accepted');});
  report.after_sha=(await req(null,'/v1/meta')).value.gitSha;need(report.after_sha===report.before_sha,'live_revision_changed');
  report.result='PASS';report.friendship_id=created.friendshipId;
 }catch(e){report.result='FAIL';report.reason=e.safeCode||e.name||'unknown_error';}
 finally{
  if(created&&report.relationship_cleanup!=='API_TERMINAL_STATE')try{await finishRelation();}catch(e){report.cleanup_reason=e.safeCode||e.name;}
  for(const id of issued)try{await svc.revokeSession(id);report.sessions_revoked++;}catch(e){report.revoke_reason=e.safeCode||e.name;}
  if(pool)await pool.end();report.finished_at=new Date().toISOString();
  if(issued.length!==report.sessions_revoked)report.result='FAIL';
  console.log(JSON.stringify(report,null,2));process.exitCode=report.result==='PASS'?0:1;
 }
})();
