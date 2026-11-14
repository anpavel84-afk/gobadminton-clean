import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_ORIGIN, createPublicApi } from '../src/public-api.ts';
import { gameCoverSources, publicCoverPath } from '../src/media.ts';
import { game } from './fixtures.ts';

test('public cover projections preserve game/venue order and reject arbitrary URLs without inventing media', async () => {
  const gamePath = `/v1/media/game-covers/${'a'.repeat(64)}.png`;
  const venuePath = `/v1/media/venue-covers/${'b'.repeat(64)}.png`;
  const projected = { ...game, cover: { uploadedUrl: gamePath }, venue: { ...game.venue, cover: { uploadedUrl: venuePath } } };
  const api = createPublicApi(async () => new Response(JSON.stringify(projected)));
  assert.deepEqual(gameCoverSources(await api.game(game.id)), [`${API_ORIGIN}${gamePath}`, `${API_ORIGIN}${venuePath}`]);
  assert.deepEqual(gameCoverSources(game), []);
  assert.deepEqual(gameCoverSources({ ...projected, cover: { uploadedUrl: venuePath } }), [`${API_ORIGIN}${venuePath}`]);
  for (const invalid of [null, {}, 'https://external.test/photo.png', `${API_ORIGIN}${gamePath}`, `//external.test${gamePath}`,
    `${gamePath}?token=x`, `${gamePath}#x`, `${gamePath}/../x`, gamePath.replace('.png', '.svg'), gamePath.replace('aaaa', 'AAAA')]) {
    assert.equal(publicCoverPath(invalid, 'game'), null);
  }
  assert.equal(publicCoverPath(gamePath, 'venue'), null);
  assert.deepEqual(gameCoverSources({ ...projected, cover: { uploadedUrl: 'https://external.test/photo.png' } }), [`${API_ORIGIN}${venuePath}`]);
});
