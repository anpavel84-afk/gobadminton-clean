import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameManagementCoordinator, creationInput, emptyCreationForm, parseCreatorProfile, parsePreferences } from '../src/game-management.ts';
import type { ManagementPort, ManagementPacket, Venue } from '../src/game-management.ts';
import { ParticipationError } from '../src/participation.ts';
import { gameLocalToIso, gameSchedule } from '../src/game-form.ts';
import { createNativeApi } from '../src/native-api.ts';
import { canonicalReturnPath } from '../src/native-auth-protocol.ts';
import { game as fixture } from './fixtures.ts';
import type { Game, Participation } from '@gobadminton/contracts/game-types';
const now = Date.parse('2026-11-14T00:00:00Z');
const actor = { actorId: 'owner', sessionId: 'native-session', generation: 1 };
const venue: Venue = { id: 'venue-1', cityId: 'city-1', name: 'Реальная площадка', address: 'Адрес', timezone: 'Europe/Berlin' };
const profile = { cityId: 'profile-city', trainer: false, displayName: 'Хозяин' };
const preferences = { version: 0, defaultPublicGameContact: null };
const form = { ...emptyCreationForm(), venueId: venue.id, date: '2026-11-20', time: '18:30', contact: '@owner', saveContact: true };
const g: Game = { ...fixture, id: 'canonical-server-id', status: 'draft', version: 7, venue, startsAt: '2026-11-20T17:30:00Z' };
const part: Participation = { id: 'part', gameId: g.id, userId: 'player', status: 'pending', version: 3, attemptNumber: 1, requestedAt: new Date(now).toISOString() };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function setup(override: Partial<ManagementPort> = {}) {
  const sent: ManagementPacket[] = []; let serial = 0, trainerReads = 0;
  const port: ManagementPort = { profile: async () => profile, preferences: async () => preferences,
    trainer: async () => { trainerReads++; return { id: 'own-trainer', displayName: 'Тренер', status: 'active' }; },
    venues: async () => ({ items: [venue], nextCursor: null }), managed: async () => ({ items: [{ ...g, management: { role: 'manager', createdByMe: false } }], nextCursor: null }),
    game: async () => g, participants: async () => ({ items: [part], nextCursor: null }),
    send: async p => p.kind === 'create' ? g : p.kind === 'publish' ? { ...g, status: 'published', version: 8 } : { ...part, version: 4, status: p.kind === 'confirm' ? 'confirmed' : p.kind === 'reject' ? 'rejected' : 'removed' }, ...override };
  const owner = new GameManagementCoordinator({ ...port, send: async p => { sent.push(p); return port.send(p); } }, () => `key-${++serial}`, () => now);
  owner.setActor(actor);
  return { owner, sent, trainerReads: () => trainerReads };
}
async function preview(owner: GameManagementCoordinator) { await owner.loadContext('city-1'); owner.update(form); owner.preview(); assert.ok(owner.getSnapshot().preview); }
test('actual creator context, zero preference version, manual city and venue timezone govern strict calendar/DST/future fields', async () => {
  assert.deepEqual(parsePreferences(preferences), preferences);
  assert.throws(() => parseCreatorProfile({ id: 'thin-me', roles: ['trainer'] }));
  const s = setup(); await preview(s.owner); assert.equal(s.trainerReads(),0);
  const input = s.owner.getSnapshot().preview!;
  assert.equal(input.timezone,'Europe/Berlin'); assert.equal(input.startsAt,'2026-11-20T17:30:00.000Z');
  assert.equal(input.applicationDeadlineAt,input.startsAt); assert.equal(input.externalReservedCount,0);
  assert.deepEqual(input.savePublicContactDefault,{ expectedVersion: 0 }); assert.equal(input.hostDisplayName,profile.displayName);
  assert.deepEqual(input.levelRule.allowedLevelIds,['3.0','3.5']);
  assert.equal(gameLocalToIso('2027-03-28T02:30','Europe/Berlin'),'');
  assert.equal(gameLocalToIso('2027-02-30T18:30','Europe/Berlin'),'');
  assert.equal(gameSchedule('2026-11-20T18:30','120junk','Europe/Berlin'),null);
  for (const patch of [{ date:'2026-11-01' }, { capacity:'4.5' }, { lower:4,upper:3 }, { activity:'trainer_led' as const }, { venueId:'other' }]) {
    assert.throws(() => creationInput({ ...form,...patch },profile,preferences,null,[venue],'city-1',now));
  }
});
test('missing profile city is controlled setup; trainer reads conditional and legitimate 404 preserves ordinary creation', async () => {
  const missing = setup({ profile: async () => ({ ...profile,cityId:null }) }); await missing.owner.loadContext('city-1'); assert.equal(missing.owner.getSnapshot().context,'setup'); assert.equal(missing.trainerReads(),0);
  const absent = setup({ profile: async () => ({ ...profile,trainer:true }), trainer: async () => { throw new ParticipationError('business',404); } });
  await preview(absent.owner); assert.equal(absent.owner.getSnapshot().trainer,null);
  const active = setup({ profile: async () => ({ ...profile,trainer:true }) }); await preview(active.owner); assert.equal(active.trainerReads(),1);
  active.owner.update({activity:'trainer_led'}); active.owner.preview(); assert.equal(active.owner.getSnapshot().preview?.settlement.purpose,'trainer_fee');
  assert.equal(active.owner.getSnapshot().preview?.settlement.priceMinor,null);
});
test('HTTP 200 empty own profile and blank required name enter setup before downstream reads or writes', async () => {
  for (const dto of [
    { displayName:'',cityId:null,trainer:false },
    { displayName:'',cityId:null,trainer:true },
    { ...profile,cityId:null },
    { ...profile,displayName:'',trainer:true },
    { ...profile,displayName:'   ',trainer:true },
  ]) {
    const reads: string[] = [];
    const api = createNativeApi(async (url,init) => {
      assert.equal(init?.method,'GET'); assert.ok(String(url).endsWith('/me/social-profile'));
      reads.push('profile'); return new Response(JSON.stringify(dto),{status:200});
    });
    const s = setup({ profile: () => api.creatorProfile('private-access'),
      preferences: async () => { reads.push('preferences'); return preferences; },
      trainer: async () => { reads.push('trainer'); return {id:'trainer',displayName:'Тренер',status:'active'}; },
      venues: async () => { reads.push('venues'); return {items:[venue],nextCursor:null}; } });
    await s.owner.loadContext('city-1');
    assert.equal(s.owner.getSnapshot().context,'setup'); assert.deepEqual(s.owner.getSnapshot().profile,dto);
    assert.deepEqual(reads,['profile']); assert.equal(s.owner.getSnapshot().preferences,null);
    assert.equal(s.owner.getSnapshot().trainer,null); assert.deepEqual(s.owner.getSnapshot().venues,[]);
    assert.throws(() => creationInput(form,parseCreatorProfile(dto),preferences,null,[venue],'city-1',now),ParticipationError);
    s.owner.update(form); s.owner.preview(); await s.owner.publishPreview(); await s.owner.publishDraft(g.id);
    assert.equal(s.owner.getSnapshot().preview,null); assert.equal(s.sent.length,0);
  }
});
test('creator transport and creation validation still reject malformed objects, missing fields and wrong types', async () => {
  for (const dto of [null,[],{},
    {cityId:null,trainer:false}, {displayName:'',trainer:false}, {displayName:'',cityId:null},
    {...profile,displayName:null}, {...profile,displayName:4}, {...profile,trainer:'false'},
    {...profile,cityId:4}, {...profile,cityId:''},
  ]) {
    assert.throws(() => parseCreatorProfile(dto),ParticipationError);
    assert.throws(() => creationInput(form,dto as typeof profile,preferences,null,[venue],'city-1',now),ParticipationError);
  }
  const api = createNativeApi(async () => new Response(JSON.stringify({...profile,displayName:null}),{status:200}));
  const s = setup({profile:() => api.creatorProfile('private-access')});
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'error');
  s.owner.update(form); s.owner.preview(); await s.owner.publishPreview(); assert.equal(s.sent.length,0);
});
test('populated HTTP profile permits preview; incomplete or malformed refresh cannot publish the old preview', async () => {
  let dto: unknown = profile;
  const api = createNativeApi(async () => new Response(JSON.stringify(dto),{status:200}));
  const s = setup({profile:() => api.creatorProfile('private-access')});
  await preview(s.owner); assert.equal(s.owner.getSnapshot().context,'ready');
  assert.equal(s.owner.getSnapshot().preview?.hostDisplayName,profile.displayName);
  dto = {...profile,displayName:null};
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'error');
  await s.owner.publishPreview(); assert.equal(s.sent.length,0);
  dto = profile; await preview(s.owner);
  dto = {...profile,displayName:''};
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'setup');
  assert.equal(s.owner.getSnapshot().preview,null); await s.owner.publishPreview(); assert.equal(s.sent.length,0);
});
test('explicit preview Publish owns create→publish with canonical ID/version; sync double tap never creates twice', async () => {
  const gate = deferred<Game>(), s = setup({ send: async p => p.kind === 'create' ? gate.promise : { ...g,status:'published',version:8 } });
  await preview(s.owner); assert.equal(s.sent.length,0);
  const first = s.owner.publishPreview(), second = s.owner.publishPreview(); assert.equal(s.sent.length,1);
  gate.resolve(g); await Promise.all([first,second]); assert.equal(s.sent.length,2);
  assert.equal(s.sent[1]?.kind,'publish'); assert.equal(s.sent[1]?.kind === 'publish' && s.sent[1].gameId,g.id);
  assert.deepEqual(s.sent[1]?.body,{expectedVersion:7}); assert.ok(Object.isFrozen(s.sent[0]?.body));
  await s.owner.publishPreview(); assert.equal(s.sent.length,2);
});
test('UNKNOWN create survives route/context refresh; explicit same-packet reconciliation never auto-publishes or starts another draft', async () => {
  let count = 0; const s = setup({ send: async p => { if (++count === 1) throw new ParticipationError('network'); return p.kind === 'create' ? g : { ...g,status:'published',version:8 }; } });
  await preview(s.owner); await s.owner.publishPreview(); const packet = s.sent[0]; assert.equal(s.owner.getSnapshot().command?.status,'unknown');
  await s.owner.loadContext('city-1'); s.owner.update({ title:'do not replace packet' }); s.owner.preview(); await s.owner.publishPreview(); assert.equal(s.sent.length,1);
  await s.owner.reconcile(); assert.equal(s.sent.length,2); assert.equal(s.sent[1],packet); assert.equal(s.owner.getSnapshot().created?.id,g.id);
  assert.equal(s.owner.getSnapshot().created?.status,'draft'); await s.owner.publishPreview(); assert.equal(s.sent.length,2);
  await s.owner.publishDraft(g.id); assert.equal(s.sent[2]?.kind,'publish');
});
test('UNKNOWN publish and COMMAND_IN_PROGRESS keep same version/body/key; no read or auth return dispatch', async () => {
  let publish = 0; const s = setup({ send: async p => { if (p.kind === 'create') return g; if (++publish < 3) throw new ParticipationError('business',409,'COMMAND_IN_PROGRESS'); return { ...g,status:'published',version:8 }; } });
  await preview(s.owner); await s.owner.publishPreview(); assert.equal(s.sent.length,2); const packet = s.sent[1];
  await s.owner.loadDetail(g.id); assert.equal(s.sent.length,2); await s.owner.publishDraft(g.id); assert.equal(s.sent.length,2);
  await s.owner.reconcile(); assert.equal(s.sent[2],packet); assert.equal(s.owner.getSnapshot().command?.status,'unknown');
  await s.owner.reconcile(); assert.equal(s.sent[3],packet); assert.equal(s.owner.getSnapshot().created?.status,'draft'); // fresh detail, not stale receipt, is authoritative
  for (const p of ['/games/create','/games/manage/canonical-server-id']) assert.equal(canonicalReturnPath(p),p);
  for (const p of ['/games/manage/x/publish','/games/manage/x?publish=1','/games/manage/%78']) assert.equal(canonicalReturnPath(p),null);
});
test('delegated noncreator manager uses current roster version and rights, conflict reloads and revoked manager cannot decide', async () => {
  let denied = false;
  const s = setup({ managed: async () => ({ items: denied ? [] : [{ ...g,status:'published',management:{role:'manager',createdByMe:false} }],nextCursor:null }),
    game: async () => ({...g,status:'published'}), send: async () => { denied = true; throw new ParticipationError('business',409,'VERSION_CONFLICT'); } });
  await s.owner.loadDetail(g.id); await s.owner.decide(g.id,part.id,'reject','Уточните условия');
  assert.equal(s.sent.length,1); assert.deepEqual(s.sent[0]?.body,{expectedVersion:3,reason:'Уточните условия'});
  assert.equal(s.owner.getSnapshot().details[g.id]?.status,'denied');
  await s.owner.decide(g.id,part.id,'confirm',''); assert.equal(s.sent.length,1);
});
test('actor A→B→A generation fences late create, context and paginated private roster; logout clears contact/DTO/packet', async () => {
  const gate = deferred<Game>(), s = setup({ send: async () => gate.promise }); await preview(s.owner); const work = s.owner.publishPreview();
  s.owner.setActor(null); s.owner.setActor({...actor,actorId:'b',generation:2}); s.owner.setActor({...actor,generation:3});
  gate.resolve(g); await work; assert.equal(s.owner.getSnapshot().created,null); assert.equal(s.owner.getSnapshot().form.contact,''); assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.sent.length,1);
  const read = deferred<ReturnType<ManagementPort['profile']> extends Promise<infer T> ? T : never>(); const late = setup({ profile: () => read.promise });
  const loading = late.owner.loadContext('city-1'); late.owner.setActor(null); read.resolve(profile); await loading; assert.equal(late.owner.getSnapshot().context,'idle');
});
test('closed native transport sends exact bodies with bearer only, parses zero prefs and safe recoverable conflicts', async () => {
  const calls: {path:string;init:RequestInit}[] = [];
  const api = createNativeApi(async (url,init) => { calls.push({path:String(url),init:init!}); return new Response(JSON.stringify(String(url).endsWith('game-preferences') ? preferences : g)); });
  assert.deepEqual(await api.gamePreferences('private-access'),preferences);
  const body = creationInput(form,profile,preferences,null,[venue],'city-1',now);
  await api.managementMutation('private-access',{ actor,kind:'create',key:'same-key',body });
  const call = calls[1]!; assert.ok(call.path.endsWith('/v1/games')); assert.deepEqual(JSON.parse(call.init.body as string),body);
  assert.equal(call.init.credentials,'omit'); assert.equal((call.init.headers as Record<string,string>).Authorization,'Bearer private-access');
  assert.equal((call.init.headers as Record<string,string>).Origin,undefined); assert.equal((call.init.headers as Record<string,string>).Cookie,undefined);
});
test('known draft reference survives same-owner auth return without private form/DTO or automatic publication; explicit logout forgets it', async () => {
  const s = setup({ send: async p => { if (p.kind === 'create') return g; throw new ParticipationError('network'); } });
  await preview(s.owner); await s.owner.publishPreview(); assert.equal(s.owner.getSnapshot().created?.id,g.id);
  s.owner.setActor(null); assert.equal(s.owner.getSnapshot().created,null); assert.equal(s.owner.getSnapshot().form.contact,''); assert.equal(s.owner.getSnapshot().creationReference,null);
  s.owner.setActor({...actor,sessionId:'returned-session',generation:2});
  assert.deepEqual(s.owner.getSnapshot().creationReference,{id:g.id,version:7});
  await s.owner.loadContext('city-1'); s.owner.update(form); s.owner.preview(); await s.owner.publishPreview();
  assert.equal(s.sent.length,2); assert.equal(s.owner.getSnapshot().preview,null);
  await s.owner.loadDetail(g.id); assert.equal(s.owner.getSnapshot().created?.id,g.id); assert.equal(s.sent.length,2);
  s.owner.forgetCreation(); s.owner.setActor(null); s.owner.setActor({...actor,generation:3}); assert.equal(s.owner.getSnapshot().creationReference,null);
});
test('manager roster loading/error blocks decisions and late pagination cannot restore revoked/logout data', async () => {
  const gate = deferred<{items:Participation[];nextCursor:string|null}>();
  const s = setup({game:async()=>({...g,status:'published'}), participants:async (_id,cursor)=>cursor ? gate.promise : {items:[part],nextCursor:'page-2'}});
  await s.owner.loadDetail(g.id); const work=s.owner.moreParticipants(g.id);
  await s.owner.decide(g.id,part.id,'confirm',''); assert.equal(s.sent.length,0);
  s.owner.setActor(null); gate.resolve({items:[{...part,id:'next'}],nextCursor:null}); await work;
  assert.deepEqual(s.owner.getSnapshot().details,{});
});

test('root repro: UNKNOWN create is private to the verified owner across reauth and only explicit reconciliation repeats the original key/body', async () => {
  const s = setup({ send: async () => { if (s.sent.length === 1) throw new ParticipationError('network'); return g; } });
  await preview(s.owner); await s.owner.publishPreview();
  const original = s.sent[0]!, body = JSON.stringify(original.body);
  assert.equal(s.owner.getSnapshot().command?.status,'unknown');
  s.owner.setActor(null);
  const guest = s.owner.getSnapshot();
  assert.equal(guest.command,undefined); assert.equal(guest.preview,null); assert.equal(guest.created,null);
  assert.equal(guest.profile,null); assert.equal(guest.preferences,null); assert.deepEqual(guest.details,{});
  assert.equal(guest.form.contact,''); assert.equal(guest.creationReference,null);
  await s.owner.reconcile(); await s.owner.publishPreview(); assert.equal(s.sent.length,1);
  const returned = {...actor,sessionId:'new-session',generation:2};
  s.owner.setActor(returned); assert.equal(s.owner.getSnapshot().command?.status,'unknown');
  assert.equal(s.sent.length,1); // Auth return itself cannot dispatch.
  await s.owner.loadContext('city-1'); s.owner.update({...form,title:'must not replace UNKNOWN'}); s.owner.preview(); await s.owner.publishPreview();
  assert.equal(s.sent.length,1); assert.equal(s.owner.getSnapshot().form.contact,'');
  await s.owner.reconcile();
  assert.deepEqual(s.sent.map(p => [p.kind,p.key,JSON.stringify(p.body)]),[['create',original.key,body],['create',original.key,body]]);
  assert.deepEqual(s.sent[1]!.actor,returned); assert.deepEqual(original.actor,actor);
  assert.strictEqual(s.sent[1]!.body,original.body); assert.ok(Object.isFrozen(s.sent[1]));
  assert.equal(s.owner.getSnapshot().created?.status,'draft'); assert.equal(s.sent.length,2);
  await s.owner.publishPreview(); assert.equal(s.sent.length,2);
  await s.owner.publishDraft(g.id); assert.equal(s.sent[2]?.kind,'publish');
});

test('UNKNOWN publish and manager rejection retain original game/version/reason across new authenticated generations', async () => {
  for (const kind of ['publish','reject'] as const) {
    let recover = false;
    const s = setup({ game: async () => ({...g,status:'published'}), send: async p => {
      if (p.kind === 'create') return g;
      if (!recover) throw new ParticipationError('network');
      return p.kind === 'publish' ? {...g,status:'published',version:8} : {...part,status:'rejected',version:4};
    } });
    if (kind === 'publish') { await preview(s.owner); await s.owner.publishPreview(); }
    else { await s.owner.loadDetail(g.id); await s.owner.decide(g.id,part.id,'reject','Original reason'); }
    const original = s.sent.at(-1)!, before = s.sent.length;
    assert.equal(original.kind,kind); assert.equal(s.owner.getSnapshot().command?.status,'unknown');
    s.owner.setActor(null); assert.equal(s.owner.getSnapshot().command,undefined); assert.deepEqual(s.owner.getSnapshot().details,{});
    s.owner.setActor({...actor,sessionId:'returned',generation:2});
    assert.equal(s.sent.length,before); assert.equal(s.owner.getSnapshot().command?.status,'unknown');
    await s.owner.publishDraft(g.id); await s.owner.decide(g.id,part.id,'confirm',''); assert.equal(s.sent.length,before);
    recover = true; await s.owner.reconcile();
    const replay = s.sent.at(-1)!;
    assert.equal(replay.kind,kind); assert.equal(replay.key,original.key); assert.strictEqual(replay.body,original.body);
    assert.equal(replay.gameId,g.id);
    if (replay.kind === 'reject') { assert.equal(replay.participationId,part.id); assert.deepEqual(replay.body,{expectedVersion:3,reason:'Original reason'}); }
    else assert.deepEqual(replay.body,{expectedVersion:7});
    assert.equal(s.sent.length,before+1);
  }
});

test('explicit logout and authoritative account B permanently wipe quarantined UNKNOWN create and context', async () => {
  for (const clear of ['logout-active','logout-guest','account-B'] as const) {
    const s = setup({ send: async () => { throw new ParticipationError('network'); } });
    await preview(s.owner); await s.owner.publishPreview();
    if (clear !== 'logout-active') s.owner.setActor(null);
    if (clear === 'account-B') s.owner.setActor({...actor,actorId:'B',sessionId:'session-B',generation:2});
    else s.owner.forgetCreation();
    const cleared = s.owner.getSnapshot();
    assert.equal(cleared.command,undefined); assert.equal(cleared.preview,null); assert.equal(cleared.form.contact,'');
    assert.equal(cleared.profile,null); assert.equal(cleared.creationReference,null); assert.deepEqual(cleared.details,{});
    s.owner.setActor(null); s.owner.setActor({...actor,sessionId:'A-returned',generation:3});
    await s.owner.reconcile(); assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.sent.length,1);
  }
});

test('reauth while create is sending quarantines UNKNOWN and fences the old response after explicit new-generation reconciliation', async () => {
  const gate = deferred<Game>();
  const s = setup({ send: async () => s.sent.length === 1 ? gate.promise : g });
  await preview(s.owner); const oldWork = s.owner.publishPreview(), original = s.sent[0]!;
  s.owner.setActor(null); s.owner.setActor({...actor,sessionId:'new-session',generation:2});
  assert.equal(s.owner.getSnapshot().command?.status,'unknown'); assert.equal(s.sent.length,1);
  await s.owner.reconcile(); assert.equal(s.sent[1]?.key,original.key); assert.strictEqual(s.sent[1]?.body,original.body);
  assert.equal(s.owner.getSnapshot().created?.id,g.id);
  gate.resolve({...g,id:'stale-draft',version:99}); await oldWork;
  assert.deepEqual(s.owner.getSnapshot().creationReference,{id:g.id,version:7});
  assert.equal(s.owner.getSnapshot().command?.status,'settled'); assert.equal(s.sent.length,2);
});
