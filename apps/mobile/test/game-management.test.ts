import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { CoverLockNoSendError, GameManagementCoordinator, creationInput, emptyCreationForm, parseCreatorProfile, parsePreferences } from '../src/game-management.ts';
import type { ManagementPort, ManagementPacket, Venue } from '../src/game-management.ts';
import { ParticipationError, type ManagedGame } from '../src/participation.ts';
import { ProfileCoordinator } from '../src/profile.ts';
import type { OwnProfile } from '../src/profile.ts';
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
  // Production create screen always binds a view lease before publishPreview (fail-closed without it).
  owner.bindCreationView();
  return { owner, sent, trainerReads: () => trainerReads };
}
async function preview(owner: GameManagementCoordinator) { await owner.loadContext('city-1'); owner.update(form); owner.preview(); assert.ok(owner.getSnapshot().preview); }
test('refreshOwnTrainerContext re-reads creator trainer eligibility without inventing it', async () => {
  const active = setup({
    profile: async () => ({ ...profile, trainer: true }),
  });
  await active.owner.loadContext('city-1');
  assert.equal(active.trainerReads(), 1);
  assert.equal(active.owner.getSnapshot().trainer?.status, 'active');
  await active.owner.refreshOwnTrainerContext();
  assert.equal(active.trainerReads(), 2);
  const source = readFileSync(new URL('../src/game-management.ts', import.meta.url), 'utf8');
  assert.match(source, /refreshOwnTrainerContext/);
});

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


test('existing created draft refresh to genuine empty profile blocks new publish and retains recovery reference', async () => {
  for (const incomplete of [{displayName:'',cityId:null,trainer:false}, {...profile,displayName:'   '}]) {
    let dto: ReturnType<typeof parseCreatorProfile> = profile, createCalls = 0;
    const api = createNativeApi(async () => new Response(JSON.stringify(dto),{status:200}));
    const s = setup({profile:() => api.creatorProfile('private-access'), send:async p => {
      if (p.kind === 'create' && ++createCalls === 1) throw new ParticipationError('network');
      return p.kind === 'create' ? g : {...g,status:'published',version:8};
    }});
    await preview(s.owner); await s.owner.publishPreview(); await s.owner.reconcile();
    assert.equal(s.owner.getSnapshot().created?.status,'draft');
    const reference = {...s.owner.getSnapshot().creationReference!}, before = s.sent.length;
    dto = incomplete; await s.owner.loadContext('city-1');
    assert.equal(s.owner.getSnapshot().context,'setup');
    await s.owner.publishDraft(g.id);
    assert.equal(s.sent.length,before); assert.equal(s.owner.getSnapshot().created?.id,g.id);
    assert.deepEqual(s.owner.getSnapshot().creationReference,reference);
    assert.match(s.owner.getSnapshot().notice!,/заполните имя и город/);
    dto = profile; await s.owner.loadContext('city-1'); await s.owner.publishDraft(g.id);
    assert.equal(s.sent.length,before+1); assert.equal(s.sent.at(-1)?.kind,'publish');
    assert.deepEqual(s.sent.at(-1)?.body,{expectedVersion:7}); assert.equal(createCalls,2);
  }
});

test('setup guidance precedes created publish CTA while UNKNOWN reconciliation and draft recovery stay available', () => {
  const ui = readFileSync(new URL('../src/components/create-game.tsx',import.meta.url),'utf8');
  const setupStart = ui.indexOf("state.context === 'setup' ?"), createdStart = ui.indexOf('state.created ?');
  assert.ok(setupStart > ui.indexOf('blocked && state.command ?') && setupStart < createdStart);
  const guidance = ui.slice(setupStart,createdStart);
  assert.match(guidance,/заполнить имя и город в профиле/);
  assert.match(guidance,/pathname: '\/profile', params: \{ returnTo \}/);
  assert.match(ui, /const returnTo = venueId \? venueCreatePath\(venueId\) \?\? '\/games\/create' : '\/games\/create'/);
  assert.match(guidance,/Обновить проверку профиля/);
  assert.match(guidance,/state.creationReference.*Открыть сводку созданной игры/);
  assert.doesNotMatch(guidance,/owner.publishDraft/);
});

test('direct owned or delegated draft entry validates profile without create context or catalog prerequisites', async () => {
  for (const role of ['owner','manager'] as const) {
    for (const dto of [profile,{displayName:'',cityId:null,trainer:false},{...profile,displayName:' '}]) {
      let reads = 0;
      const s = setup({profile:async () => { reads++; return dto; },
        managed:async () => ({items:[{...g,management:{role,createdByMe:role === 'owner'}}],nextCursor:null}),
        preferences:async () => { assert.fail('direct publish must not load create preferences'); },
        venues:async () => { assert.fail('direct publish must not load create venues'); }});
      await s.owner.loadDetail(g.id); assert.equal(s.owner.getSnapshot().context,'idle');
      await s.owner.publishDraft(g.id); assert.equal(reads,1);
      assert.equal(s.sent.length,dto === profile ? 1 : 0);
      if (dto === profile) { assert.equal(s.sent[0]?.kind,'publish'); assert.deepEqual(s.sent[0]?.body,{expectedVersion:7}); }
      else { assert.equal(s.owner.getSnapshot().context,'setup'); assert.match(s.owner.getSnapshot().notice!,/Черновик сохранён/); }
    }
  }
});

test('late publish profile reads cannot write after logout, account change, new generation, refresh or detail reload', async () => {
  for (const change of ['logout','account','generation','context','detail'] as const) {
    const gate = deferred<typeof profile>();
    const s = setup({profile:() => gate.promise}); await s.owner.loadDetail(g.id);
    const work = s.owner.publishDraft(g.id);
    if (change === 'logout') s.owner.forgetCreation();
    if (change === 'account') s.owner.setActor({...actor,actorId:'B',generation:2});
    if (change === 'generation') { s.owner.setActor(null); s.owner.setActor({...actor,sessionId:'returned',generation:2}); }
    const refresh = change === 'context' ? s.owner.loadContext('city-1') : Promise.resolve();
    if (change === 'detail') await s.owner.loadDetail(g.id);
    gate.resolve(profile); await Promise.all([work,refresh]);
    assert.equal(s.sent.length,0); assert.equal(s.owner.getSnapshot().command,undefined);
  }
});

test('new publish profile failures and concurrent taps send no unsafe or duplicate command', async () => {
  for (const failure of [new ParticipationError('business',404),new ParticipationError('network')]) {
    const s = setup({profile:async () => { throw failure; }}); await s.owner.loadDetail(g.id);
    await s.owner.publishDraft(g.id); assert.equal(s.sent.length,0); assert.match(s.owner.getSnapshot().notice!,/Черновик сохранён/);
  }
  const gate = deferred<typeof profile>(), s = setup({profile:() => gate.promise});
  await s.owner.loadDetail(g.id);
  const first = s.owner.publishDraft(g.id), second = s.owner.publishDraft(g.id);
  gate.resolve(profile); await Promise.all([first,second]); assert.equal(s.sent.length,1);
});

test('UNKNOWN publish still reconciles original packet after invalid profile refresh and same-owner reauth', async () => {
  let dto: ReturnType<typeof parseCreatorProfile> = profile; let recover = false, reads = 0;
  const s = setup({profile:async () => { reads++; return dto; },send:async p => {
    if (p.kind === 'create') return g;
    if (!recover) throw new ParticipationError('network');
    return {...g,status:'published',version:8};
  }});
  await preview(s.owner); await s.owner.publishPreview(); const original = s.sent[1]!;
  dto = {displayName:'',cityId:null,trainer:false};
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'setup');
  s.owner.setActor(null); s.owner.setActor({...actor,sessionId:'returned',generation:2});
  await s.owner.loadContext('city-1'); const beforeReads = reads;
  await s.owner.publishDraft(g.id); assert.equal(s.sent.length,2);
  recover = true; await s.owner.reconcile();
  const replay = s.sent[2]!;
  assert.equal(reads,beforeReads); assert.equal(replay.kind,'publish'); assert.equal(replay.key,original.key);
  assert.strictEqual(replay.body,original.body); assert.equal(replay.gameId,g.id);
  assert.deepEqual(replay.body,{expectedVersion:7}); assert.equal(s.sent.length,3);
});

test('explicit native profile save then read-only return refresh unblocks creation without create/publish or search-city replacement', async () => {
  let dto: OwnProfile = { publicPlayerId:null,version:0,displayName:'',cityId:null,areaKey:null,level:null,bio:null,
    directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,optedInAt:null,radarConsented:false,
    radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:false,trainer:false,lookingForGame:null,
    avatar:{uploadedUrl:null,providerUrl:null} };
  let saves = 0;
  const s = setup({profile:async () => parseCreatorProfile(dto)});
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'setup');
  const editor = new ProfileCoordinator({read:async () => dto,cities:async () => [{id:'profile-city',nameRu:'Казань',nameEn:'Kazan',countryCode:'RU',defaultTimezone:'Europe/Moscow'}],
    send:async p => { saves++; dto = {...dto,...p.body,version:1}; return dto; }},() => 'profile-key');
  editor.setActor(actor); await editor.load(); editor.update({displayName:'Хозяин',cityId:'profile-city'}); await editor.save();
  assert.equal(saves,1); assert.equal(s.sent.length,0); assert.equal(s.owner.getSnapshot().context,'setup');
  // Same operation as explicit local return: authoritative read only. Search city remains city-1.
  await s.owner.loadContext('city-1'); assert.equal(s.owner.getSnapshot().context,'ready');
  assert.equal(s.owner.getSnapshot().cityId,'city-1'); assert.equal(s.owner.getSnapshot().profile?.cityId,'profile-city'); assert.equal(s.sent.length,0);
  s.owner.update(form); s.owner.preview(); assert.ok(s.owner.getSnapshot().preview); assert.equal(s.sent.length,0);
  const route = readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
  assert.match(route,/intent === '\/games\/create'.*loadContext\(preferences.cityId\)/);
  assert.doesNotMatch(route,/publishDraft|publishPreview|requestParticipation|setPreferences/);
});

test('explicit catalog-backed venue selection changes only local form venue, preserves all other fields and requires fresh preview', async () => {
  const next = {...venue,id:'another-venue',cityId:'another-city',timezone:'Pacific/Auckland'};
  const s = setup({venues:async city => ({items:city === next.cityId ? [next] : [venue],nextCursor:null})});
  await preview(s.owner); const old = s.owner.getSnapshot();
  assert.equal(await s.owner.selectVenue(next),true);
  const selected = s.owner.getSnapshot();
  assert.equal(selected.cityId,next.cityId); assert.deepEqual(selected.form,{...old.form,venueId:next.id});
  assert.equal(selected.profile?.cityId,profile.cityId); assert.equal(selected.preview,null); assert.equal(s.sent.length,0);
  s.owner.preview(); assert.equal(s.owner.getSnapshot().preview?.timezone,next.timezone); assert.equal(s.sent.length,0);
  const wrong = setup(); await preview(wrong.owner); const before = wrong.owner.getSnapshot();
  assert.equal(await wrong.owner.selectVenue({...venue,timezone:'Pacific/Auckland'}),false);
  assert.deepEqual(wrong.owner.getSnapshot().form,before.form); assert.equal(wrong.owner.getSnapshot().preview,before.preview);
  assert.equal(wrong.owner.getSnapshot().context,'ready'); assert.equal(wrong.sent.length,0);
  await wrong.owner.publishPreview(); assert.equal(wrong.sent.length,2);
  assert.equal(wrong.sent[0]?.kind,'create');
  if (wrong.sent[0]?.kind === 'create') assert.equal(wrong.sent[0].body.venueId,venue.id);
});

test('venue entry/selection cannot replace UNKNOWN or created reference and late view/session/catalog reads cannot select', async () => {
  const unknown = setup({send:async () => {throw new Error('lost');}}); await preview(unknown.owner); await unknown.owner.publishPreview();
  const old = unknown.owner.getSnapshot(); assert.equal(await unknown.owner.selectVenue({...venue,id:'another'}),false);
  assert.equal(unknown.owner.getSnapshot().command?.packet,old.command?.packet); assert.deepEqual(unknown.owner.getSnapshot().form,old.form); assert.equal(unknown.sent.length,1);
  const created = setup(); await preview(created.owner); await created.owner.publishPreview(); const reference = created.owner.getSnapshot().creationReference;
  assert.equal(await created.owner.selectVenue({...venue,id:'another'}),false); assert.equal(created.owner.getSnapshot().creationReference,reference);
  for (const interruption of ['view','session','new-read']) {
    const pending = deferred<{items:Venue[];nextCursor:null}>(); let delay = false, visible = true;
    const s = setup({venues:async () => delay ? pending.promise : {items:[venue],nextCursor:null}}); await preview(s.owner); const before = s.owner.getSnapshot().form;
    delay = true; const selected = s.owner.selectVenue(venue,() => visible);
    if (interruption === 'view') visible = false;
    if (interruption === 'session') s.owner.setActor({...actor,generation:2});
    if (interruption === 'new-read') { delay = false; await s.owner.loadContext('city-1'); }
    pending.resolve({items:[venue],nextCursor:null}); assert.equal(await selected,false); assert.equal(s.sent.length,0);
    if (interruption === 'view') assert.deepEqual(s.owner.getSnapshot().form,before);
  }
});


// Execute the component's real pre-JSX hooks/handlers with retained hook slots and focus cleanup.
// No React Native renderer is needed for this controlled lifecycle; UI rendering remains native QA.
function mountedCreateGame(owner: GameManagementCoordinator, target?: Venue, options: { cityId?: string; push?: (path: string) => void } = {}) {
  const source = readFileSync(new URL('../src/components/create-game.tsx',import.meta.url),'utf8');
  // Intermediate «Продолжить прежнюю форму» UI is removed (#590); auto-select keeps the selectVenue fence and never publishes.
  assert.doesNotMatch(source, /Выбрать эту площадку для формы/);
  assert.doesNotMatch(source, /Продолжить прежнюю форму/);
  const selectVenueFn = source.slice(source.indexOf('const selectVenue = async'), source.indexOf('const continueOrdinaryForm'));
  assert.match(selectVenueFn, /owner\.selectVenue\(venue, current\)/);
  assert.doesNotMatch(selectVenueFn, /publish/);
  let cityId = options.cityId ?? 'city-1';
  const body = source.slice(source.indexOf('export function CreateGame('),source.indexOf('  const f = state.form;'))
    .replace('export function','function') + `  return { selectVenue, selecting, selected, continuePress: continueOrdinaryForm };\n}`;
  type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
  const slots: Slot[] = []; let index = 0, focused = true;
  let focusCallback: (() => () => void) | undefined, focusCleanup: (() => void) | undefined;
  let effects: (() => void)[] = [];
  const slot = () => slots[index++] ?? (slots[index - 1] = {});
  const same = (a: unknown[] | undefined,b: unknown[]) => !!a && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const component = runInNewContext(`(${stripTypeScriptTypes(body)})`, {
    useAuth: () => ({gameManagement:owner,status:'authenticated',me:{id:actor.actorId}}),
    useRouter: () => ({push:options.push ?? (() => {})}), usePreferences: () => ({preferences:{cityId},hydrated:true}),
    useSyncExternalStore: (_subscribe: unknown,getSnapshot: () => unknown) => getSnapshot(),
    useRef: (value: unknown) => { const s = slot(); return s.value ?? (s.value = {current:value}); },
    useState: (value: unknown) => { const s = slot(); if (!Object.hasOwn(s,'value')) s.value = value;
      return [s.value,(next: unknown) => { s.value = next; }]; },
    useCallback: (callback: unknown,deps: unknown[]) => { const s = slot();
      if (!same(s.deps,deps)) { s.value = callback; s.deps = deps; } return s.value; },
    useEffect: (callback: () => void | (() => void),deps: unknown[]) => { const s = slot();
      if (!same(s.deps,deps)) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = callback() || undefined; }); } },
    useFocusEffect: (callback: () => () => void) => {
      if (focusCallback !== callback) { focusCallback = callback;
        effects.push(() => { focusCleanup?.(); if (focused) focusCleanup = callback(); }); }
    },
    useResource: () => ({state:{status:'ready',data:target},retry:() => {}}),
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    publicApi: {}, venueCreatePath: (id: string) => `/games/create/venue/${id}`,
  }) as (props: {venueId?: string}) => {selectVenue: () => Promise<void>; selecting: boolean; selected: boolean; continuePress: () => void};
  return {
    setCity: (value: string) => { cityId = value; },
    render: () => { index = 0; const result = component({venueId:target?.id});
      const pending = effects; effects = []; pending.forEach(effect => effect()); return result; },
    blur: () => { focused = false; focusCleanup?.(); focusCleanup = undefined; },
    focus: () => { focused = true; focusCleanup = focusCallback?.(); },
  };
}

test('mounted ordinary ready form survives venue press, blur before catalog settles and return without a focus reload', async () => {
  const next = {...venue,id:'another-venue',cityId:'another-city'};
  const pending = deferred<{items:Venue[];nextCursor:null}>(), reached = deferred<boolean>();
  let loads = 0; const loadsDone: Promise<void>[] = [];
  const s = setup({venues:async city => {
    if (city === next.cityId) { reached.resolve(true); return pending.promise; }
    return {items:[venue],nextCursor:null};
  }});
  const load = s.owner.loadContext;
  s.owner.loadContext = (...args) => { loads++; const work = load(...args); loadsDone.push(work); return work; };
  const ordinary = mountedCreateGame(s.owner); ordinary.render(); await Promise.all(loadsDone);
  s.owner.update(form); s.owner.preview(); const before = s.owner.getSnapshot();
  assert.equal(before.context,'ready'); assert.ok(before.preview); ordinary.blur();
  const contextual = mountedCreateGame(s.owner,next); const intent = contextual.render();
  const work = intent.selectVenue(); await reached.promise;
  // No shared loading/clearing even while the catalog read is genuinely pending.
  assert.strictEqual(s.owner.getSnapshot(),before);
  contextual.blur(); ordinary.focus(); ordinary.render();
  assert.equal(loads,1); assert.strictEqual(s.owner.getSnapshot(),before);
  pending.resolve({items:[next],nextCursor:null}); await work; ordinary.render();
  assert.strictEqual(s.owner.getSnapshot(),before);
  assert.equal(s.owner.getSnapshot().context,'ready'); assert.strictEqual(s.owner.getSnapshot().profile,before.profile);
  assert.strictEqual(s.owner.getSnapshot().venues,before.venues); assert.strictEqual(s.owner.getSnapshot().form,before.form);
  assert.strictEqual(s.owner.getSnapshot().preview,before.preview); assert.equal(s.owner.getSnapshot().creationReference,null);
  assert.equal(loads,1); assert.equal(s.sent.length,0);
  contextual.focus(); assert.equal(contextual.render().selected,false); assert.equal(s.sent.length,0);
});

test('cancelled contextual reads and failures at profile, preferences and catalog preserve the ready snapshot', async () => {
  for (const stage of ['profile','preferences','venues'] as const) {
    for (const fails of [false,true]) {
      const pending = deferred<boolean>(), reached = deferred<boolean>(); let delay = false, visible = true;
      const wait = async () => { if (delay) { reached.resolve(true); await pending.promise;
        if (fails) throw new ParticipationError('network'); } };
      const s = setup({profile:async () => { if (stage === 'profile') await wait(); return profile; },
        preferences:async () => { if (stage === 'preferences') await wait(); return preferences; },
        venues:async () => { if (stage === 'venues') await wait(); return {items:[venue],nextCursor:null}; }});
      await preview(s.owner); const before = s.owner.getSnapshot(); delay = true;
      const work = s.owner.selectVenue(venue,() => visible); await reached.promise;
      visible = false; pending.resolve(true); assert.equal(await work,false);
      assert.strictEqual(s.owner.getSnapshot(),before); assert.equal(s.sent.length,0);
    }
  }
});

test('pending venue selection cannot overwrite later edits, newer selection or another actor/session', async () => {
  const next = {...venue,id:'next-venue',cityId:'next-city'}, newer = {...venue,id:'newer-venue',cityId:'newer-city'};
  for (const change of ['edit','selection','logout','account','session','created'] as const) {
    const pending = deferred<{items:Venue[];nextCursor:null}>(), reached = deferred<boolean>();
    const s = setup({venues:async city => {
      if (city === next.cityId) { reached.resolve(true); return pending.promise; }
      return {items:city === newer.cityId ? [newer] : [venue],nextCursor:null};
    }});
    await preview(s.owner); const work = s.owner.selectVenue(next); await reached.promise;
    if (change === 'edit') { s.owner.update({title:'Later title',contact:'@later',terms:'Later terms'}); s.owner.preview(); }
    if (change === 'selection') assert.equal(await s.owner.selectVenue(newer),true);
    if (change === 'logout') s.owner.forgetCreation();
    if (change === 'account') s.owner.setActor({...actor,actorId:'other',generation:2});
    if (change === 'session') s.owner.setActor({...actor,sessionId:'new-session',generation:2});
    if (change === 'created') await s.owner.publishPreview();
    const after = s.owner.getSnapshot(); pending.resolve({items:[next],nextCursor:null});
    assert.equal(await work,false); assert.strictEqual(s.owner.getSnapshot(),after); assert.equal(s.sent.length,change === 'created' ? 2 : 0);
    // The existing authoritative detail fixture returns draft v7 after the publish receipt.
    if (change === 'created') { assert.equal(after.created?.status,'draft'); assert.deepEqual(after.creationReference,{id:g.id,version:7}); }
    if (change === 'edit') { assert.equal(after.form.title,'Later title'); assert.equal(after.preview?.hostPublicContact,'@later'); }
    if (change === 'selection') { assert.equal(after.cityId,newer.cityId); assert.equal(after.form.venueId,newer.id); }
  }
});

test('UNKNOWN arising during local selection retains the strict same packet, key and body without resend', async () => {
  const next = {...venue,id:'next-venue',cityId:'next-city'};
  const pending = deferred<{items:Venue[];nextCursor:null}>(), reached = deferred<boolean>();
  const s = setup({send:async () => { throw new ParticipationError('network'); },venues:async city => {
    if (city === next.cityId) { reached.resolve(true); return pending.promise; }
    return {items:[venue],nextCursor:null};
  }});
  await preview(s.owner); const work = s.owner.selectVenue(next); await reached.promise;
  await s.owner.publishPreview(); const unknown = s.owner.getSnapshot(), packet = unknown.command!.packet;
  assert.equal(unknown.command?.status,'unknown'); assert.strictEqual(packet,s.sent[0]);
  pending.resolve({items:[next],nextCursor:null}); assert.equal(await work,false);
  assert.strictEqual(s.owner.getSnapshot(),unknown); assert.strictEqual(s.owner.getSnapshot().command?.packet,packet);
  assert.strictEqual(s.owner.getSnapshot().command?.packet.body,packet.body);
  assert.equal(s.owner.getSnapshot().command?.packet.key,packet.key); assert.equal(s.sent.length,1);
  assert.equal(await s.owner.selectVenue(next),false); assert.equal(s.sent.length,1);
});


test('actual Continue CTA resumes new ordinary mounts and backstack without reads even when local city differs; explicit city and actor changes still reload', async () => {
  const local = {...venue,id:'local',cityId:'local-city'}, target = {...venue,id:'target',cityId:'target-city'};
  let reads = 0; const loads: Promise<void>[] = [];
  const s = setup({venues:async city => { reads++; return {items:city === local.cityId ? [local] : [{...venue,cityId:city}],nextCursor:null}; }});
  const load = s.owner.loadContext;
  s.owner.loadContext = (...args) => { const work = load(...args); loads.push(work); return work; };
  const original = mountedCreateGame(s.owner); original.render(); await Promise.all(loads);
  s.owner.update(form); assert.equal(await s.owner.selectVenue(local),true); s.owner.preview();
  const before = s.owner.getSnapshot(); assert.ok(before.preview); original.blur();
  const routes: string[] = [], contextual = mountedCreateGame(s.owner,target,{push:path => routes.push(path)});
  contextual.render().continuePress(); assert.deepEqual(routes,['/games/create']); contextual.blur();
  const start = reads, remounted = mountedCreateGame(s.owner); remounted.render(); await Promise.all(loads);
  assert.strictEqual(s.owner.getSnapshot(),before); assert.equal(reads,start); assert.equal(before.cityId,local.cityId);
  original.focus(); original.render(); assert.strictEqual(s.owner.getSnapshot(),before);
  // A second new mount also retains the same current domain continuation.
  mountedCreateGame(s.owner).render(); await Promise.all(loads); assert.strictEqual(s.owner.getSnapshot(),before);
  remounted.setCity('changed-search-city'); remounted.render(); await Promise.all(loads);
  assert.equal(s.owner.getSnapshot().cityId,'changed-search-city'); assert.equal(s.owner.getSnapshot().form.venueId,'');
  assert.equal(s.owner.getSnapshot().preview,null); assert.ok(reads > start); assert.equal(s.sent.length,0);
  s.owner.continueOrdinaryForm('changed-search-city'); s.owner.setActor({...actor,sessionId:'new',generation:2});
  mountedCreateGame(s.owner,undefined,{cityId:'changed-search-city'}).render(); await Promise.all(loads);
  assert.equal(s.owner.getSnapshot().context,'ready'); assert.equal(s.owner.getSnapshot().form.contact,''); assert.equal(s.sent.length,0);
});

test('failed live selection keeps usable prior context through actual Continue and ordinary mount; setup/invalid authority still blocks', async () => {
  for (const failure of ['mismatch','network','setup','invalid'] as const) {
    let fail = false, loads = 0;
    const target = {...venue,id:'target',cityId:'target-city'};
    const s = setup({profile:async () => {
      if (fail && failure === 'setup') return {...profile,cityId:null};
      if (fail && failure === 'invalid') throw new ParticipationError('invalid');
      return profile;
    },venues:async city => {
      loads++;
      if (fail && failure === 'network') throw new ParticipationError('network');
      return {items:city === target.cityId ? [] : [venue],nextCursor:null};
    }});
    await preview(s.owner); const before = s.owner.getSnapshot(); fail = true;
    const contextual = mountedCreateGame(s.owner,target); await contextual.render().selectVenue();
    const failed = s.owner.getSnapshot();
    assert.strictEqual(failed.form,before.form); assert.strictEqual(failed.preview,before.preview); assert.equal(s.sent.length,0);
    if (failure === 'setup' || failure === 'invalid') {
      assert.equal(failed.context,failure === 'setup' ? 'setup' : 'error');
      await s.owner.publishPreview(); assert.equal(s.sent.length,0); continue;
    }
    assert.equal(failed.context,'ready'); assert.strictEqual(failed.venues,before.venues); assert.strictEqual(failed.profile,before.profile);
    assert.match(failed.notice ?? '',/Выбор не изменён/);
    const count = loads; contextual.render().continuePress(); contextual.blur();
    mountedCreateGame(s.owner).render(); await new Promise(done => setImmediate(done));
    assert.strictEqual(s.owner.getSnapshot(),failed); assert.equal(loads,count); assert.equal(s.sent.length,0);
    s.owner.edit(); s.owner.update({title:'Still editable'}); assert.equal(s.owner.getSnapshot().form.title,'Still editable');
  }
});

test('late failed selection cannot replace later edits, newer valid selection or session state', async () => {
  for (const interruption of ['edit','selection','session'] as const) {
    const gate = deferred<boolean>(), reached = deferred<boolean>();
    const target = {...venue,id:'target',cityId:'target-city'}, newer = {...venue,id:'newer',cityId:'newer-city'};
    const s = setup({venues:async city => {
      if (city === target.cityId) { reached.resolve(true); await gate.promise; throw new ParticipationError('network'); }
      return {items:city === newer.cityId ? [newer] : [venue],nextCursor:null};
    }});
    await preview(s.owner); const work = s.owner.selectVenue(target); await reached.promise;
    if (interruption === 'edit') { s.owner.update({title:'Later'}); s.owner.preview(); }
    if (interruption === 'selection') assert.equal(await s.owner.selectVenue(newer),true);
    if (interruption === 'session') s.owner.setActor({...actor,sessionId:'changed',generation:2});
    const current = s.owner.getSnapshot(); gate.resolve(true); assert.equal(await work,false);
    assert.strictEqual(s.owner.getSnapshot(),current); assert.equal(s.sent.length,0);
  }
});

test('#522 FIX6: ready loadDetail soft-refresh keeps game shell (no loading unmount flash)', async () => {
  const draft = { ...g, id: 'game-cover-soft', status: 'draft' as const, version: 2 };
  let version = 2;
  const managedGate = deferred<{ items: ManagedGame[]; nextCursor: null }>();
  let managedCalls = 0;
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => {
      managedCalls += 1;
      if (managedCalls === 1) {
        return { items: [{ ...draft, version, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
      }
      return managedGate.promise;
    },
    game: async () => ({ ...draft, version }),
    participants: async () => ({ items: [], nextCursor: null }),
    send: async () => draft,
  }, () => 'soft-key', () => now);
  owner.setActor(actor);
  await owner.loadDetail('game-cover-soft');
  const ready = owner.getSnapshot().details['game-cover-soft'];
  assert.equal(ready?.status, 'ready');
  assert.ok(ready?.game);
  const gameRef = ready!.game;

  version = 3;
  const refresh = owner.loadDetail('game-cover-soft');
  await new Promise(r => setImmediate(r));
  const mid = owner.getSnapshot().details['game-cover-soft'];
  assert.equal(mid?.status, 'ready', 'receipt refresh must not flash loading');
  assert.strictEqual(mid?.game, gameRef);
  managedGate.resolve({
    items: [{ ...draft, version: 3, management: { role: 'owner', createdByMe: true } }],
    nextCursor: null,
  });
  await refresh;
  assert.equal(owner.getSnapshot().details['game-cover-soft']?.status, 'ready');
  assert.equal(owner.getSnapshot().details['game-cover-soft']?.game?.version, 3);

  // Cold load (no ready shell) still uses loading.
  const cold = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async () => draft,
  }, () => 'cold-key', () => now);
  cold.setActor(actor);
  const coldWork = cold.loadDetail('game-cover-soft');
  assert.equal(cold.getSnapshot().details['game-cover-soft']?.status, 'loading');
  await coldWork;
  assert.equal(cold.getSnapshot().details['game-cover-soft']?.status, 'ready');
});

test('#522 APK51 management dispatch gate blocks publish while cover unresolved for same game', async () => {
  let coverBlocked = true;
  const sent: ManagementPacket[] = [];
  let serial = 0;
  const draft = { ...g, id: 'game-cover-lock', status: 'draft' as const, version: 2 };
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      return { ...draft, status: 'published', version: draft.version + 1 };
    },
  }, () => `key-${++serial}`, () => now, {
    coverBlocksWrites: gameId => coverBlocked && gameId === 'game-cover-lock',
  });
  owner.setActor(actor);
  await owner.loadDetail('game-cover-lock');
  assert.equal(owner.getSnapshot().details['game-cover-lock']?.status, 'ready');
  await owner.publishDraft('game-cover-lock');
  assert.equal(sent.length, 0);
  assert.match(owner.getSnapshot().notice ?? '', /фото/);
  coverBlocked = false;
  await owner.publishDraft('game-cover-lock');
  assert.equal(sent.length, 1);
  const packet = sent[0];
  assert.ok(packet);
  assert.equal(packet.kind, 'publish');
  assert.equal(packet.kind === 'publish' ? packet.gameId : '', 'game-cover-lock');
});

test('#522 FIX3: CoverLockNoSendError on UNKNOWN retry preserves packet/key; unrelated stale → UNKNOWN', async () => {
  let coverBlocked = false;
  let portStale: 'cover' | 'other' | null = null;
  const sent: ManagementPacket[] = [];
  let serial = 0;
  let rejectSend!: (e: unknown) => void;
  let pendingSend: Promise<Game> | null = null;
  const draft = { ...g, id: 'game-cover-unknown', status: 'draft' as const, version: 2 };
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      if (pendingSend) {
        await pendingSend;
      }
      if (portStale === 'cover') {
        // Simulate AuthCoordinator cover gate after delayed token — arm lock then dedicated no-send.
        coverBlocked = true;
        throw new CoverLockNoSendError();
      }
      if (portStale === 'other') throw new ParticipationError('stale');
      sent.push(p);
      return { ...draft, status: 'published', version: draft.version + 1 };
    },
  }, () => `key-${++serial}`, () => now, {
    coverBlocksWrites: gameId => coverBlocked && gameId === 'game-cover-unknown',
  });
  owner.setActor(actor);
  await owner.loadDetail('game-cover-unknown');

  // Force UNKNOWN publish via delayed network loss.
  pendingSend = new Promise<Game>((_, reject) => { rejectSend = reject; });
  const publishWork = owner.publishDraft('game-cover-unknown');
  await new Promise(r => setImmediate(r));
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  const original = owner.getSnapshot().command!.packet;
  rejectSend(new ParticipationError('network'));
  await publishWork;
  pendingSend = null;
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, original.key);

  // Delayed CoverLockNoSendError on retry: early gate off, port arms lock + throws → keep UNKNOWN.
  portStale = 'cover';
  coverBlocked = false;
  const before = sent.length;
  await owner.reconcile();
  assert.equal(sent.length, before);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, original.key);
  assert.strictEqual(owner.getSnapshot().command?.packet, original);
  assert.match(owner.getSnapshot().notice ?? '', /фото/);
  // Later unlocking cover must not erase the preserved UNKNOWN packet.
  coverBlocked = false;
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.strictEqual(owner.getSnapshot().command?.packet, original);

  // Unrelated stale follows accepted50 UNKNOWN — never lose packet.
  portStale = 'other';
  coverBlocked = false;
  await owner.reconcile();
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, original.key);
  assert.strictEqual(owner.getSnapshot().command?.packet, original);
  assert.match(owner.getSnapshot().notice ?? '', /неизвестен|Проверка повторит/);
});

test('#522 APK52 omit photo keeps create→publish; no cover stage', async () => {
  let latest: Game = g;
  const s = setup({
    game: async () => latest,
    send: async p => {
      if (p.kind === 'create') {
        latest = { ...g, status: 'draft', version: 7 };
        return latest;
      }
      if (p.kind === 'publish') {
        latest = { ...g, status: 'published', version: 8 };
        return latest;
      }
      return { ...part, version: 4, status: p.kind === 'confirm' ? 'confirmed' : p.kind === 'reject' ? 'rejected' : 'removed' };
    },
  });
  await preview(s.owner);
  assert.equal(s.owner.hasCreationPhoto(), false);
  await s.owner.publishPreview();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[0]?.kind, 'create');
  assert.equal(s.sent[1]?.kind, 'publish');
  assert.equal(s.owner.getSnapshot().created?.status, 'published');
});

test('#522 APK52 confirmed photo: exactly one create, one cover save, one publish with fresh versions', async () => {
  const coverCalls: { gameId: string; gameVersion: number }[] = [];
  let serial = 0;
  const draft = { ...g, version: 7 };
  const published = { ...g, status: 'published' as const, version: 9 };
  let latest: Game = draft;
  const sent: ManagementPacket[] = [];
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...latest, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => latest,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') {
        latest = draft;
        return draft;
      }
      if (p.kind === 'publish') {
        assert.equal(p.body.expectedVersion, 8);
        latest = published;
        return published;
      }
      throw new Error('unexpected');
    },
  }, () => `key-${++serial}`, () => now, {
    saveCreationCover: async ({ gameId, gameVersion, live }) => {
      coverCalls.push({ gameId, gameVersion });
      assert.equal(live(), true);
      assert.equal(gameId, draft.id);
      assert.equal(gameVersion, 7);
      latest = { ...draft, version: 8 };
      return { version: 8 };
    },
  });
  owner.setActor(actor);
  owner.bindCreationView();
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes });
  assert.equal(owner.hasCreationPhoto(), true);
  const first = owner.publishPreview();
  const second = owner.publishPreview();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.kind, 'create');
  assert.equal(sent[1]?.kind, 'publish');
  assert.equal(coverCalls.length, 1);
  assert.equal(owner.hasCreationPhoto(), false);
  assert.equal(owner.getSnapshot().created?.status, 'published');
  assert.equal(owner.getSnapshot().created?.version, 9);
});

test('#522 APK52 cover reject/UNKNOWN leaves draft and never publishes; reconcile does not chain', async () => {
  for (const outcome of ['reject', 'unknown'] as const) {
    let serial = 0;
    const draft = { ...g, version: 7 };
    const sent: ManagementPacket[] = [];
    const owner = new GameManagementCoordinator({
      profile: async () => profile,
      preferences: async () => preferences,
      trainer: async () => { throw new ParticipationError('business', 404); },
      venues: async () => ({ items: [venue], nextCursor: null }),
      managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
      game: async () => draft,
      participants: async () => ({ items: [], nextCursor: null }),
      send: async p => {
        sent.push(p);
        if (p.kind === 'create') return draft;
        if (p.kind === 'publish') return { ...draft, status: 'published' as const, version: 8 };
        throw new Error('unexpected');
      },
    }, () => `key-${++serial}`, () => now, {
      saveCreationCover: async () => null,
      coverBlocksWrites: () => outcome === 'unknown',
    });
    owner.setActor(actor);
    owner.bindCreationView();
    await owner.loadContext('city-1');
    owner.update(form);
    owner.preview();
    owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([9]) });
    await owner.publishPreview();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.kind, 'create');
    assert.equal(owner.getSnapshot().created?.status, 'draft');
    assert.deepEqual(owner.getSnapshot().creationReference, { id: draft.id, version: 7 });
    assert.match(owner.getSnapshot().notice ?? '', /Фото не сохранено|черновик/i);
    assert.equal(owner.creationCoverBlocksPublish(draft.id), true);
    await owner.reconcile();
    assert.equal(sent.length, 1);
    // Plain Publish on failed-photo create summary must not POST — hold until managed resolve/omit.
    await owner.publishDraft(draft.id);
    assert.equal(sent.length, 1);
    if (outcome === 'unknown') {
      // Uncertain cover still blocks even after acknowledge until coverBlocksWrites clears.
      owner.acknowledgeCreationCoverResolved(draft.id);
      assert.equal(owner.creationCoverBlocksPublish(draft.id), true);
      await owner.publishDraft(draft.id);
      assert.equal(sent.length, 1);
    } else {
      owner.acknowledgeCreationCoverResolved(draft.id);
      assert.equal(owner.creationCoverBlocksPublish(draft.id), false);
      await owner.publishDraft(draft.id);
      assert.equal(sent.length, 2);
      assert.equal(sent[1]?.kind, 'publish');
    }
  }
});

test('#522 FIX3: create-view lease retires cover/publish after create; draft retained', async () => {
  let serial = 0;
  const draft = { ...g, version: 7 };
  const sent: ManagementPacket[] = [];
  const coverCalls: string[] = [];
  const createGate = deferred<Game>();
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') return createGate.promise;
      throw new Error('publish must not run');
    },
  }, () => `key-${++serial}`, () => now, {
    saveCreationCover: async () => {
      coverCalls.push('cover');
      return { version: 8 };
    },
  });
  owner.setActor(actor);
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1]) });
  const release = owner.bindCreationView();
  const work = owner.publishPreview();
  await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1);
  // Real blur/unmount retires continuation before create settles.
  release();
  createGate.resolve(draft);
  await work;
  assert.equal(coverCalls.length, 0);
  assert.equal(sent.some(p => p.kind === 'publish'), false);
  assert.equal(owner.getSnapshot().created?.status, 'draft');
  assert.deepEqual(owner.getSnapshot().creationReference, { id: draft.id, version: 7 });
});

test('#522 FIX3: create foreground retire stops cover/publish; expected draft kept', async () => {
  let serial = 0;
  const draft = { ...g, version: 7 };
  const sent: ManagementPacket[] = [];
  const coverGate = deferred<{ version: number } | null>();
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') return draft;
      throw new Error('publish must not run');
    },
  }, () => `key-${++serial}`, () => now, {
    saveCreationCover: async ({ live }) => {
      assert.equal(live(), true);
      return coverGate.promise;
    },
  });
  owner.setActor(actor);
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1]) });
  owner.bindCreationView();
  const work = owner.publishPreview();
  await new Promise(r => setImmediate(r));
  owner.setCreationForeground(false);
  coverGate.resolve({ version: 8 });
  await work;
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, 'create');
  assert.equal(owner.getSnapshot().created?.status, 'draft');
});

test('#522 APK52 failed create never calls cover save; reconcile settles create only', async () => {
  let coverCalls = 0;
  let serial = 0;
  const sent: ManagementPacket[] = [];
  let failOnce = true;
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...g, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => g,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (failOnce) { failOnce = false; throw new ParticipationError('network'); }
      return g;
    },
  }, () => `key-${++serial}`, () => now, {
    saveCreationCover: async () => {
      coverCalls += 1;
      return { version: 8 };
    },
  });
  owner.setActor(actor);
  owner.bindCreationView();
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1]) });
  await owner.publishPreview();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, 'create');
  assert.equal(coverCalls, 0);
  assert.equal(owner.getSnapshot().created, null);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
  assert.equal(owner.hasCreationPhoto(), true);
  await owner.reconcile();
  assert.equal(coverCalls, 0);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.kind, 'create');
  assert.equal(sent.some(p => p.kind === 'publish'), false);
  assert.equal(owner.getSnapshot().created?.status, 'draft');
  assert.equal(owner.hasCreationPhoto(), false);
});

test('#522 APK52 expired start after create stops before publish; draft kept', async () => {
  let tick = now;
  let serial = 0;
  const draft = { ...g, version: 7, startsAt: '2026-11-20T17:30:00Z' };
  const sent: ManagementPacket[] = [];
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') {
        tick = Date.parse('2026-11-21T00:00:00Z');
        return draft;
      }
      throw new Error('publish must not run');
    },
  }, () => `key-${++serial}`, () => tick, {
    saveCreationCover: async () => ({ version: 8 }),
  });
  owner.setActor(actor);
  owner.bindCreationView();
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1]) });
  await owner.publishPreview();
  assert.equal(sent.length, 1);
  assert.equal(owner.getSnapshot().created?.status, 'draft');
  assert.match(owner.getSnapshot().notice ?? '', /Начало уже прошло/);
});

test('#522 FIX4: absent creation lease fails closed; no create without bind', async () => {
  const unbound = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...g, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => g,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async () => { throw new Error('must not send'); },
  }, () => 'key-x', () => now);
  unbound.setActor(actor);
  await unbound.loadContext('city-1');
  unbound.update(form);
  unbound.preview();
  // No bindCreationView — fail closed (no actor-only bypass).
  await unbound.publishPreview();
  assert.equal(unbound.getSnapshot().created, null);
  assert.equal(unbound.getSnapshot().command, undefined);
});

test('#522 FIX4: lease retire during publishDraft profile await → zero publish; draft kept', async () => {
  let serial = 0;
  const draft = { ...g, version: 7 };
  const sent: ManagementPacket[] = [];
  const profileGate = deferred<typeof profile>();
  let profileCalls = 0;
  const owner = new GameManagementCoordinator({
    profile: async () => {
      profileCalls += 1;
      // First create-context profile reads resolve immediately; publishDraft awaits the gate.
      if (profileCalls <= 1) return profile;
      return profileGate.promise;
    },
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') return draft;
      throw new Error('publish must not run');
    },
  }, () => `key-${++serial}`, () => now);
  owner.setActor(actor);
  const release = owner.bindCreationView();
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  const work = owner.publishPreview();
  await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, 'create');
  // Late boundary: retire after create, during publish profile await.
  release();
  profileGate.resolve(profile);
  await work;
  assert.equal(sent.some(p => p.kind === 'publish'), false);
  assert.equal(owner.getSnapshot().created?.status, 'draft');
  assert.deepEqual(owner.getSnapshot().creationReference, { id: draft.id, version: 7 });
});

test('#522 FIX4: view departure clears parent creation photo; remount has no hidden bytes', async () => {
  const s = setup();
  await preview(s.owner);
  s.owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(s.owner.hasCreationPhoto(), true);
  // Real route departure via bind release.
  const release = s.owner.bindCreationView();
  s.owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([4]) });
  assert.equal(s.owner.hasCreationPhoto(), true);
  release();
  assert.equal(s.owner.hasCreationPhoto(), false);
});

test('#522 FIX8: initial create arms lease before dispatch; retire before send → zero POST; not UNKNOWN', async () => {
  let serial = 0;
  const draft = { ...g, version: 7 };
  const sent: ManagementPacket[] = [];
  const tokenGate = deferred<void>();
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => ({ items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null }),
    game: async () => draft,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      // Simulate AuthCoordinator post-token recheck of isCreationContinuationLive.
      await tokenGate.promise;
      if (!owner.isCreationContinuationLive()) throw new ParticipationError('stale');
      sent.push(p);
      return draft;
    },
  }, () => `key-${++serial}`, () => now);
  owner.setActor(actor);
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  const release = owner.bindCreationView();
  const work = owner.publishPreview();
  await new Promise(r => setImmediate(r));
  assert.equal(owner.isCreationContinuationLive(), true, 'create lease armed before token/API');
  release();
  assert.equal(owner.isCreationContinuationLive(), false);
  tokenGate.resolve();
  await work;
  assert.equal(sent.length, 0);
  assert.equal(owner.getSnapshot().created, null);
  assert.equal(owner.getSnapshot().command, undefined);
});

test('#522 FIX8: cover→publish awaits detail refresh and admits authoritative version (no identity abort)', async () => {
  let serial = 0;
  const draft = { ...g, version: 7 };
  let latest: Game = draft;
  const sent: ManagementPacket[] = [];
  let detailReads = 0;
  const owner = new GameManagementCoordinator({
    profile: async () => profile,
    preferences: async () => preferences,
    trainer: async () => { throw new ParticipationError('business', 404); },
    venues: async () => ({ items: [venue], nextCursor: null }),
    managed: async () => {
      detailReads += 1;
      return { items: [{ ...latest, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    },
    game: async () => latest,
    participants: async () => ({ items: [], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (p.kind === 'create') {
        latest = draft;
        return draft;
      }
      if (p.kind === 'publish') {
        assert.equal(p.body.expectedVersion, 8);
        latest = { ...latest, status: 'published', version: 9 };
        return latest;
      }
      throw new Error('unexpected');
    },
  }, () => `key-${++serial}`, () => now, {
    saveCreationCover: async ({ gameId, gameVersion }) => {
      assert.equal(gameId, draft.id);
      assert.equal(gameVersion, 7);
      latest = { ...draft, version: 8 };
      return { version: 8 };
    },
  });
  owner.setActor(actor);
  owner.bindCreationView();
  await owner.loadContext('city-1');
  owner.update(form);
  owner.preview();
  owner.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([1]) });
  await owner.publishPreview();
  assert.equal(sent[0]?.kind, 'create');
  assert.equal(sent[1]?.kind, 'publish');
  assert.ok(detailReads >= 1, 'cover path must refresh detail before publish capture');
  assert.equal(owner.getSnapshot().created?.status, 'published');
  assert.equal(owner.getSnapshot().created?.version, 9);
  const source = readFileSync(new URL('../src/game-management.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /currentGame !== game/);
  assert.match(source, /currentGame\.id !== game\.id/);
});
