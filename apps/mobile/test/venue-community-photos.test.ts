import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { isCommunityPhotoPage } from '../src/venue-community.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const venueId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const photoId2 = '44444444-4444-4444-8444-444444444444';

function photo(id: string, overrides: Record<string, unknown> = {}) {
  const resourceVersion = 1;
  return {
    id,
    width: 800,
    height: 600,
    url: `/v1/comments/${commentId}/revisions/${resourceVersion}/photos/${id}`,
    source: {
      commentId,
      parentCommentId: null,
      resourceVersion,
      path: `/v1/comments/${commentId}`,
    },
    ...overrides,
  };
}

function page(items: unknown[], nextCursor: string | null = null) {
  return { venueId, items, nextCursor };
}

test('#598 isCommunityPhotoPage accepts a valid page', () => {
  assert.equal(isCommunityPhotoPage(page([photo(photoId)])), true);
  assert.equal(isCommunityPhotoPage(page(
    Array.from({ length: 24 }, (_, i) => photo(`${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`)),
    'opaque-cursor',
  )), true);
});

test('#598 isCommunityPhotoPage rejects invalid pages (negative)', () => {
  assert.equal(isCommunityPhotoPage(page(
    Array.from({ length: 25 }, (_, i) => photo(`${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`)),
  )), false);
  assert.equal(isCommunityPhotoPage(page([photo(photoId)], 'cursor-with-short-page')), false);
  assert.equal(isCommunityPhotoPage(page([{
    ...photo(photoId),
    url: `/v1/comments/${commentId}/revisions/1/photos/${photoId2}`,
  }])), false);
  assert.equal(isCommunityPhotoPage(page([{ ...photo(photoId), width: 0 }])), false);
  assert.equal(isCommunityPhotoPage(page([{ ...photo(photoId), width: 1601 }])), false);
  assert.equal(isCommunityPhotoPage(page([photo(photoId), photo(photoId)])), false);
});

test('#598 community photos section always renders header and empty copy', () => {
  const photos = read('../src/components/venue-photos.tsx');
  assert.match(photos, /Фотографии сообщества/);
  assert.match(photos, /Фотографии из публикаций об этой площадке/);
  assert.match(photos, /Пока нет фотографий сообщества\./);
  assert.match(photos, /Не удалось загрузить фотографии\./);
  assert.match(photos, /Ещё фотографии/);
  assert.doesNotMatch(photos, /if \(!photos\.length\) return null/);
  assert.match(photos, /communityPhotos/);
});

test('#598 venue-sheet has no mobile-only empty games block (negative regression)', () => {
  const sheet = read('../src/components/venue-sheet.tsx');
  assert.doesNotMatch(sheet, /На этой площадке пока нет игр/);
  assert.doesNotMatch(sheet, /Будьте первым, кто создаст игру и соберет компанию!/);
});
