import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeStory, emptyPreferences, entryRoute, filterCities, parsePreferences, selectedCity } from '../src/entry.ts';
import { cities } from './fixtures.ts';

test('first entry, immediate story skip/guest completion and returning entry', () => {
  assert.equal(entryRoute(emptyPreferences), '/story');
  const skipped = completeStory(emptyPreferences);
  assert.equal(entryRoute(skipped), '/city');
  assert.equal(entryRoute(parsePreferences(JSON.stringify(skipped))), '/city');
  assert.equal(entryRoute(parsePreferences('{"storyCompleted":true,"cityId":"city-2"}')), '/games');
  assert.equal(entryRoute({ storyCompleted: false, cityId: 'city-2' }), '/games');
});
test('manual unsupported/missing city never silently selects a default', () => {
  assert.deepEqual(filterCities(cities, '  каз '), [cities[0]]);
  assert.deepEqual(filterCities(cities, 'Kazan'), [cities[0]]);
  assert.deepEqual(filterCities(cities, 'Несуществующий город'), []);
  assert.deepEqual(filterCities(cities, ''), cities);
  assert.equal(selectedCity(cities, 'removed-city'), null);
  assert.equal(selectedCity(cities, null), null);
  assert.equal(selectedCity(cities, 'city-2'), cities[1]);
});
test('persistence accepts only story completion and a nonsensitive city ID', () => {
  assert.deepEqual(parsePreferences('{"storyCompleted":true,"cityId":"city-1","token":"discard","gameId":"discard"}'),
    { storyCompleted: true, cityId: 'city-1' });
  for (const raw of [null, 'bad', 'null', '{}', '{"cityId":12,"storyCompleted":"yes"}']) {
    assert.deepEqual(parsePreferences(raw), emptyPreferences);
  }
});

test('icon entry waits both hydration owners, skips intro for restored auth, and preserves pending/deep return', async () => {
  const { hydratedEntryRoute } = await import('../src/entry.ts');
  const auth = { status: 'authenticated', returnPath: null };
  assert.equal(hydratedEntryRoute(emptyPreferences, false, auth), null);
  assert.equal(hydratedEntryRoute(emptyPreferences, true, { ...auth, status: 'hydrating' }), null);
  assert.equal(hydratedEntryRoute(emptyPreferences, true, auth), '/games');
  assert.equal(hydratedEntryRoute(emptyPreferences, true, { ...auth, returnPath: '/games/selected-game' }), '/games/selected-game');
  assert.equal(hydratedEntryRoute(emptyPreferences, true, { status: 'signing-in', returnPath: '/games/selected-game' }), '/profile');
  for (const path of ['/games/selected-game', '/auth/native/callback', '/players/public-a']) assert.equal(hydratedEntryRoute(emptyPreferences, true, auth, path), null);
  assert.equal(hydratedEntryRoute(emptyPreferences, true, { status: 'guest', returnPath: null }), '/story');
});

test('interrupted icon entry recovers only exact bare browse after hydration, retaining existing ordering',async()=>{
  const {hydratedEntryRoute}=await import('../src/entry.ts');
  const auth={status:'authenticated',returnPath:'/players/browse'};
  assert.equal(hydratedEntryRoute(emptyPreferences,false,auth),null);
  assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'hydrating'}),null);
  assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'signing-in'}),'/profile');
  assert.equal(hydratedEntryRoute(emptyPreferences,true,auth),'/players/browse');
  assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'guest'}),'/players/browse');
  for(const path of ['/players','/players/browse/','/players/browse?cityId=x','/players/browse#x','/players/%62rowse','/players/browse\n','//evil/players/browse','https://dev.gobadminton.ru/players/browse']){
    assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,returnPath:path}),'/games');
  }
});

test('R3 exact My Games hub/results Entry recovery retains hydration, signing-in and route precedence',async()=>{
  const {hydratedEntryRoute}=await import('../src/entry.ts');
  for(const path of ['/my-games','/my-games/game_A-1/results']) {
    const auth={status:'authenticated',returnPath:path};
    assert.equal(hydratedEntryRoute(emptyPreferences,false,auth),null);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'hydrating'}),null);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'signing-in'}),'/profile');
    assert.equal(hydratedEntryRoute(emptyPreferences,true,{...auth,status:'guest'}),path);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,auth),path);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,auth,'/city'),null);
  }
  for(const path of ['/my-games/','/my-games?x=1','/my-games#history','/my-games\n','/my-games/a/results\n','/my-games/a/results?section=attendance','/my-games/a/results#x','/my-games/%61/results','/my-games/a%2Fb/results','/my-games/a/results/acknowledgements','/my-games//results','https://dev.gobadminton.ru/my-games','//evil/my-games','/messages']) {
    assert.equal(hydratedEntryRoute(emptyPreferences,true,{status:'authenticated',returnPath:path}),'/games',path);
  }
});
