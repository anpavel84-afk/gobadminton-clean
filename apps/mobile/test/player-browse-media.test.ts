import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  NATIVE_BROWSE_MEDIA_AHEAD,
  NATIVE_BROWSE_MEDIA_CAP,
  browseMediaNeighborhood,
  browsePeerMediaKey,
  browsePeerMediaUrls,
  createBrowseMediaWarmup,
  type BrowseMediaScope,
} from '../src/player-browse-media.ts';
import type { PublicPlayer } from '../src/players.ts';
import { API_ORIGIN } from '../src/public-api.ts';

const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const coverPath = (n: number) => `/v1/media/covers/${hash(n)}.png`;
const avatarPath = (n: number) => `/v1/media/avatars/${hash(n)}.png`;

function player(id: string, media?: { cover?: number; avatar?: number; provider?: string }): PublicPlayer {
  const row: PublicPlayer = {
    publicPlayerId: id,
    displayName: id,
    cityId: 'city',
    areaKey: null,
    level: null,
    bio: null,
    trainer: false,
    lookingForGame: true,
  };
  if (media?.avatar !== undefined || media?.provider) {
    row.avatar = {
      uploadedUrl: media.avatar !== undefined ? avatarPath(media.avatar) : null,
      providerUrl: media.provider ?? null,
    };
  }
  if (media?.cover !== undefined) row.cover = { uploadedUrl: coverPath(media.cover) };
  return row;
}

const liveScope = (over: Partial<BrowseMediaScope> = {}): BrowseMediaScope => ({
  episode: 1,
  actorId: 'actor',
  sessionId: 'session',
  generation: 1,
  filterKey: '["city","","",false,false,""]',
  focused: true,
  foreground: true,
  ...over,
});

test('#522 browse neighborhood matches accepted WEB window (current + 4 ahead + previous, cap 6)', () => {
  assert.equal(NATIVE_BROWSE_MEDIA_AHEAD, 4);
  assert.equal(NATIVE_BROWSE_MEDIA_CAP, 6);
  assert.deepEqual(browseMediaNeighborhood(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(browseMediaNeighborhood(2, 5), [2, 3, 4, 1]);
  assert.deepEqual(browseMediaNeighborhood(4, 5), [4, 3]);
  assert.deepEqual(browseMediaNeighborhood(1, 10), [1, 2, 3, 4, 5, 0]);
  assert.ok(browseMediaNeighborhood(1, 10).length <= NATIVE_BROWSE_MEDIA_CAP);
  assert.deepEqual(browseMediaNeighborhood(0, 0), []);
  assert.deepEqual(browseMediaNeighborhood(-1, 3), []);
});

test('#522 media key and URL identity use playerMediaUrl; reject unsafe hosts', () => {
  const base = player('p1');
  const withAvatar = player('p1', { avatar: 1 });
  const withCover = player('p1', { avatar: 1, cover: 2 });
  const replaced = player('p1', { avatar: 1, cover: 3 });
  assert.notEqual(browsePeerMediaKey(base), browsePeerMediaKey(withAvatar));
  assert.notEqual(browsePeerMediaKey(withCover), browsePeerMediaKey(replaced));
  assert.equal(browsePeerMediaKey(withCover), browsePeerMediaKey({ ...withCover, displayName: 'Other' }));
  const urls = browsePeerMediaUrls(withCover);
  assert.equal(urls.peerId, 'p1');
  assert.equal(urls.cover, `${API_ORIGIN}${coverPath(2)}`);
  assert.deepEqual(urls.avatars, [`${API_ORIGIN}${avatarPath(1)}`]);
  assert.equal(browsePeerMediaUrls(player('x', { provider: 'https://evil.example/a' })).avatars.length, 0);
  assert.equal(browsePeerMediaUrls(player('x', { provider: 'https://avatars.yandex.net/photo' })).avatars[0],
    'https://avatars.yandex.net/photo');
});

test('#522 warmup prefetches bounded neighborhood; current priority; cap/dedupe', async () => {
  const calls: string[] = [];
  const warmup = createBrowseMediaWarmup(async url => {
    calls.push(url);
    return true;
  });
  const deck = [0, 1, 2, 3, 4, 5, 6, 7].map(i => player(`p${i}`, { cover: i, avatar: i }));
  warmup.sync(deck, 1, liveScope());
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const expectedPeers = browseMediaNeighborhood(1, deck.length).map(i => deck[i]!);
  assert.equal(expectedPeers.length, 6);
  assert.equal(warmup.occupancy().retained.length, 6);
  assert.ok(warmup.occupancy().retained.includes('p1'));
  assert.ok(!warmup.occupancy().retained.includes('p7'));
  // current peer URLs appear before far-ahead (neighborhood order drives start order)
  const firstCover = `${API_ORIGIN}${coverPath(1)}`;
  assert.ok(calls.indexOf(firstCover) >= 0);
  assert.ok(calls.indexOf(firstCover) <= calls.indexOf(`${API_ORIGIN}${coverPath(5)}`));
});

test('#522 rapid select / scope change retires stale resolves; errors never throw', async () => {
  let release!: (ok: boolean) => void;
  const gate = new Promise<boolean>(r => { release = r; });
  const seen: string[] = [];
  const warmup = createBrowseMediaWarmup(async url => {
    seen.push(url);
    if (url.includes(hash(0))) return gate;
    return true;
  });
  const deck = [0, 1, 2, 3, 4].map(i => player(`p${i}`, { cover: i }));
  warmup.sync(deck, 0, liveScope({ episode: 1 }));
  assert.ok(warmup.occupancy().loading.includes('p0'));
  warmup.sync(deck, 2, liveScope({ episode: 2 }));
  release(true);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  // stale episode-1 resolve must not reinsert p0 after episode-2 neighborhood
  assert.equal(warmup.occupancy().retained.includes('p0'), false);
  assert.ok(warmup.occupancy().retained.includes('p2'));

  const failing = createBrowseMediaWarmup(async () => { throw new Error('network'); });
  failing.sync(deck, 0, liveScope());
  await new Promise(r => setImmediate(r));
  assert.ok(failing.occupancy().retained.includes('p0'));
  assert.equal(failing.occupancy().loading.includes('p0'), false);

  failing.retire();
  assert.deepEqual(failing.occupancy(), { retained: [], loading: [] });
  failing.sync(deck, 0, liveScope({ focused: false }));
  assert.deepEqual(failing.occupancy(), { retained: [], loading: [] });
  failing.sync(deck, 0, liveScope({ foreground: false }));
  assert.deepEqual(failing.occupancy(), { retained: [], loading: [] });
});

test('#522 mediaKey change aborts prior peer warm; same key does not restart', async () => {
  let inflight = 0;
  const warmup = createBrowseMediaWarmup(async () => {
    inflight += 1;
    return true;
  });
  const a = player('p0', { cover: 1, avatar: 1 });
  const b = player('p0', { cover: 2, avatar: 1 });
  warmup.sync([a], 0, liveScope());
  await new Promise(r => setImmediate(r));
  const afterFirst = inflight;
  warmup.sync([a], 0, liveScope());
  await new Promise(r => setImmediate(r));
  assert.equal(inflight, afterFirst, 'identical mediaKey must not restart');
  warmup.sync([b], 0, liveScope());
  await new Promise(r => setImmediate(r));
  assert.ok(inflight > afterFirst, 'new cover identity restarts warm');
  assert.equal(warmup.occupancy().retained.length, 1);
});

test('#522 player-browse hooks warmup without retargeting gestures or match commands', () => {
  const browse = readFileSync(new URL('../src/components/player-browse.tsx', import.meta.url), 'utf8');
  assert.match(browse, /createBrowseMediaWarmup/);
  assert.match(browse, /mediaWarmup\.current\.sync\(/);
  assert.match(browse, /Image\.prefetch/);
  assert.match(browse, /typeof createBrowseMediaWarmup !== 'function'/);
  // Still only one visible keyed card surface — no offscreen Image commit into the animated card.
  assert.match(browse, /<Animated\.View key=\{card\}/);
  assert.equal((browse.match(/<Animated\.View key=\{/g) ?? []).length, 1);
  // Gestures / match path unchanged ownership
  assert.match(browse, /new BrowseGesture\(/);
  assert.match(browse, /owner\.act\(/);
  assert.match(browse, /void owner\.act\(kind==='request'\?'send':'withdraw'/);
  // Warmup must not gate action/exit
  const action = browse.slice(browse.indexOf("const action = (kind:'skip'|'request'|'withdraw'"), browse.indexOf('const callbacks:PanResponderCallbacks'));
  assert.doesNotMatch(action, /mediaWarmup|prefetch|warmup/);
  const exit = browse.slice(browse.indexOf('const exit = (dir:'), browse.indexOf("const action = (kind:'skip'|'request'|'withdraw'"));
  assert.doesNotMatch(exit, /mediaWarmup|prefetch|warmup/);
});
