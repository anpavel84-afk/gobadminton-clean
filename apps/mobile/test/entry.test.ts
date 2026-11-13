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
