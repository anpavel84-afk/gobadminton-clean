import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendUpcomingPage, futureItems, nextExpiryDelay } from '../src/upcoming.ts';
import { LatestResource } from '../src/resource.ts';
import { game } from './fixtures.ts';
import type { GamePage } from '../src/public-api.ts';

const now = Date.parse('2026-11-13T12:00:00Z');
const item = (id: string, offset: number) => ({ ...game, id, startsAt: new Date(now + offset).toISOString() });

test('strict upcoming boundary removes elapsed cached items and schedules their next expiry without mutating the cache', () => {
  const cache = [item('past', -1), item('boundary', 0), item('soon', 1000), item('later', 2000),
    { ...game, id: 'invalid', startsAt: 'bad-date' }];
  assert.deepEqual(futureItems(cache, now).map(row => row.id), ['soon', 'later']);
  assert.equal(nextExpiryDelay(cache, now), 1000);
  assert.deepEqual(futureItems(cache, now + 1000).map(row => row.id), ['later']);
  assert.equal(nextExpiryDelay(cache, now + 1000), 1000);
  assert.deepEqual(futureItems(cache, now + 2000), []);
  assert.equal(nextExpiryDelay(cache, now + 2000), null);
  assert.equal(cache.length, 5);
  assert.equal(nextExpiryDelay([item('distant', 3_000_000_000)], now), 2_147_483_647);
});

test('delayed pagination expires previous and incoming items, preserves cursor/dedup and cannot overwrite a new city', async () => {
  const previous = { items: [item('expired-cache', 1), item('duplicate', 5000)], nextCursor: 'page2' };
  const page = { items: [item('expired-response', 2), { ...item('duplicate', 5000), availablePlaces: 1 }], nextCursor: 'page3' };
  const merged = appendUpcomingPage(previous, page, now + 2);
  assert.deepEqual(merged, { items: [page.items[1]], nextCursor: 'page3' });
  assert.deepEqual(appendUpcomingPage(previous, page, now + 5000), { items: [], nextCursor: 'page3' });
  const resource = new LatestResource<GamePage>();
  await resource.load('city-a', async () => previous);
  let resolve!: (value: GamePage) => void;
  const pending = new Promise<GamePage>(yes => { resolve = yes; });
  const loading = resource.load('city-a', () => pending, (old, next) => appendUpcomingPage(old, next, now + 2));
  await resource.load('city-b', async () => ({ items: [], nextCursor: null }));
  resolve(page); await loading;
  assert.deepEqual(resource.state, { key: 'city-b', status: 'ready', data: { items: [], nextCursor: null } });
});
