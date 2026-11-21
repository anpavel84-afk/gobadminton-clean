import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  COMMENT_PHOTO_MAX_BYTES,
  MAX_COMMENT_PHOTOS,
  PHOTO_RIGHTS,
  commentSendReady,
  isPhotoReceipt,
  photoComposerReducer,
  readyPhotoIds,
  type PhotoComposerItem,
  type VenueCommentPhotoReceipt,
} from '../src/venue-comment-photos.ts';
import { freezePacket } from '../src/venue-community.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const venueId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const photoId2 = '33333333-3333-4333-8333-333333333333';
const actor = { actorId: 'actor', sessionId: 'session', generation: 1 };
const scope = { venueId, canonicalVenueId: venueId };
const key = '44444444-4444-4444-8444-444444444444';

function readyReceipt(id = photoId, overrides: Partial<VenueCommentPhotoReceipt> = {}): VenueCommentPhotoReceipt {
  return {
    id,
    venueId,
    status: 'ready',
    version: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    width: 400,
    height: 300,
    previewPath: `/v1/me/venue-photo-submissions/${id}/content`,
    ...overrides,
  };
}

function withdrawnReceipt(id = photoId): VenueCommentPhotoReceipt {
  return {
    id,
    venueId,
    status: 'withdrawn',
    version: 2,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    width: 400,
    height: 300,
    previewPath: null,
  };
}

test('#598B isPhotoReceipt accepts valid ready and withdrawn receipts', () => {
  assert.equal(isPhotoReceipt(readyReceipt(), venueId, 'ready'), true);
  assert.equal(isPhotoReceipt(withdrawnReceipt(), venueId, 'withdrawn', photoId), true);
});

test('#598B isPhotoReceipt accepts canonical venue id when alias ≠ canonical; rejects foreign venue (negative)', () => {
  const alias = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const canonical = venueId;
  assert.notEqual(alias, canonical);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { venueId: canonical }), canonical, 'ready'), true);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { venueId: canonical }), alias, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { venueId: photoId2 }), canonical, 'ready'), false);
  assert.equal(isPhotoReceipt(withdrawnReceipt(photoId), canonical, 'withdrawn', photoId), true);
  assert.equal(isPhotoReceipt(withdrawnReceipt(photoId), alias, 'withdrawn', photoId), false);
});

test('#598B isPhotoReceipt rejects invalid receipts (negative)', () => {
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { venueId: photoId2 }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { version: 2 }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, {
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { width: 0 }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, { width: 1601 }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(readyReceipt(photoId, {
    previewPath: `/v1/me/venue-photo-submissions/${photoId2}/content`,
  }), venueId, 'ready'), false);
  assert.equal(isPhotoReceipt(withdrawnReceipt(photoId), venueId, 'withdrawn')
    && withdrawnReceipt().previewPath === null, true);
  assert.equal(isPhotoReceipt({
    ...withdrawnReceipt(),
    previewPath: `/v1/me/venue-photo-submissions/${photoId}/content`,
  }, venueId, 'withdrawn'), false);
});

test('#598B reducer max 4, retry keeps key, readyPhotoIds excludes non-ready', () => {
  let items: PhotoComposerItem[] = [];
  const keys = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  ];
  for (const k of keys.slice(0, 4)) {
    items = photoComposerReducer(items, { type: 'add', key: k, mime: 'image/jpeg', size: 100 });
  }
  assert.equal(items.length, 4);
  const blocked = photoComposerReducer(items, {
    type: 'add', key: keys[4]!, mime: 'image/jpeg', size: 100,
  });
  assert.equal(blocked.length, 4);
  assert.equal(blocked.some(i => i.key === keys[4]), false);

  const retryKey = keys[0]!;
  items = photoComposerReducer(items, {
    type: 'patch', key: retryKey, state: 'retryable', message: 'later',
  });
  items = photoComposerReducer(items, {
    type: 'patch', key: retryKey, state: 'checking',
  });
  assert.equal(items.find(i => i.key === retryKey)?.key, retryKey);

  items = photoComposerReducer(items, {
    type: 'patch',
    key: retryKey,
    state: 'ready',
    receipt: readyReceipt(photoId),
  });
  items = photoComposerReducer(items, {
    type: 'patch',
    key: keys[1]!,
    state: 'rejected',
    message: 'no',
  });
  items = photoComposerReducer(items, {
    type: 'patch',
    key: keys[2]!,
    state: 'retryable',
  });
  items = photoComposerReducer(items, {
    type: 'patch',
    key: keys[3]!,
    state: 'checking',
  });
  assert.deepEqual(readyPhotoIds(items), [photoId]);
  assert.equal(commentSendReady('', items), false);
  items = photoComposerReducer(items, { type: 'patch', key: keys[3]!, state: 'retryable' });
  assert.equal(commentSendReady('', items), true);
  assert.equal(commentSendReady('текст', items.filter(i => i.state !== 'ready')), true);
});

test('#598B withdraw drop removes ready item from composer state', () => {
  let items: PhotoComposerItem[] = photoComposerReducer([], {
    type: 'add', key, mime: 'image/png', size: 50,
  });
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'ready', receipt: readyReceipt(),
  });
  assert.deepEqual(readyPhotoIds(items), [photoId]);
  items = photoComposerReducer(items, { type: 'drop', key });
  assert.deepEqual(readyPhotoIds(items), []);
  assert.equal(items.length, 0);
});

test('#598B withdrawKey path excludes photoIds and preserves same key across withdraw_failed (negative)', () => {
  const withdrawKey = '55555555-5555-4555-8555-555555555555';
  let items: PhotoComposerItem[] = photoComposerReducer([], {
    type: 'add', key, mime: 'image/png', size: 50,
  });
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'ready', receipt: readyReceipt(),
  });
  assert.deepEqual(readyPhotoIds(items), [photoId]);
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'withdrawing', withdrawKey, receipt: readyReceipt(),
  });
  assert.deepEqual(readyPhotoIds(items), []);
  assert.equal(items.find(i => i.key === key)?.withdrawKey, withdrawKey);
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'withdraw_failed', withdrawKey, receipt: readyReceipt(),
    message: 'Снятие не подтверждено. Проверьте доступ и повторите ту же операцию.',
  });
  assert.deepEqual(readyPhotoIds(items), []);
  assert.equal(items.find(i => i.key === key)?.withdrawKey, withdrawKey);
  assert.equal(items.find(i => i.key === key)?.state, 'withdraw_failed');
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'withdrawing', withdrawKey,
  });
  assert.equal(items.find(i => i.key === key)?.withdrawKey, withdrawKey);
});

test('#598B create packet includes photoIds only when non-empty; >4 rejected', () => {
  const withPhotos = freezePacket(actor, scope, {
    kind: 'create',
    text: '',
    parentCommentId: null,
    parentEntityId: venueId,
    photoIds: [photoId, photoId2],
  }, key);
  assert.deepEqual(withPhotos.body.photoIds, [photoId, photoId2]);
  assert.equal(withPhotos.body.text, '');

  const textOnly = freezePacket(actor, scope, {
    kind: 'create',
    text: 'Только текст',
    parentCommentId: null,
    parentEntityId: venueId,
  }, key);
  assert.equal('photoIds' in textOnly.body, false);
  assert.equal(textOnly.body.text, 'Только текст');

  assert.throws(() => freezePacket(actor, scope, {
    kind: 'create',
    text: '',
    parentCommentId: null,
    parentEntityId: venueId,
  }, key));

  assert.throws(() => freezePacket(actor, scope, {
    kind: 'create',
    text: 'x',
    parentCommentId: null,
    parentEntityId: venueId,
    photoIds: [photoId, photoId2, key, venueId, photoId],
  }, key));

  assert.throws(() => freezePacket(actor, scope, {
    kind: 'create',
    text: 'x',
    parentCommentId: null,
    parentEntityId: venueId,
    photoIds: [],
  }, key));
});

test('#598B native-api upload is raw binary with rights/idempotency/bearer; no FormData/CSRF (negative)', () => {
  const api = read('../src/native-api.ts');
  const uploadStart = api.indexOf('uploadCommentPhoto:');
  const uploadEnd = api.indexOf('commentPhotoStatus:');
  assert.ok(uploadStart > 0 && uploadEnd > uploadStart);
  const upload = api.slice(uploadStart, uploadEnd);
  assert.match(upload, /X-Photo-Rights/);
  assert.match(upload, /PHOTO_RIGHTS/);
  assert.match(upload, /Idempotency-Key/);
  assert.match(upload, /Authorization: `Bearer \$\{access\}`/);
  assert.match(upload, /credentials: 'omit'/);
  assert.match(upload, /redirect: 'error'/);
  assert.match(upload, /'Content-Type': input\.mime/);
  assert.match(upload, /\bbody,/);
  assert.doesNotMatch(upload, /new FormData/);
  assert.doesNotMatch(upload, /multipart/);
  assert.doesNotMatch(upload, /btoa|atob|base64/);
  assert.doesNotMatch(upload, /X-CSRF-Token/);
  assert.doesNotMatch(upload, /credentials:\s*'include'/);
  const withdrawStart = api.indexOf('withdrawCommentPhoto:');
  const withdraw = api.slice(withdrawStart, withdrawStart + 1200);
  assert.match(withdraw, /'X-Photo-Version': '1'/);
  assert.match(withdraw, /expectedVersion: 1/);
  assert.match(api, /commentPhotoStatus/);
});

test('#598B composer gates «Добавить фото» on rights; no upload path without rights (negative)', () => {
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /Фотографии · до 4/);
  assert.match(composer, /Это мои фото или у меня есть права на публикацию/);
  assert.match(composer, /Добавить фото/);
  assert.match(composer, /disabled=\{!model\.rights \|\| locked/);
  assert.match(composer, /if \(!rights \|\| live\.current\.locked/);
  assert.match(composer, /nativeAuth\.uploadCommentPhoto/);
  assert.match(composer, /Повторить/);
  assert.match(composer, /Убрать фото/);
  assert.doesNotMatch(composer, /new FormData/);
  assert.doesNotMatch(composer, /X-CSRF-Token/);
  assert.equal(PHOTO_RIGHTS, 'community-photo-rights-v1');
  assert.equal(MAX_COMMENT_PHOTOS, 4);
  assert.equal(COMMENT_PHOTO_MAX_BYTES, 5 * 1024 * 1024);
});

test('#598B r2 withdraw retry uses DELETE with same withdrawKey and never re-uploads (negative)', () => {
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /withdrawKey/);
  assert.match(composer, /withdrawing/);
  assert.match(composer, /withdraw_failed/);
  assert.match(composer, /nativeAuth\.withdrawCommentPhoto\(\{ id: receiptId, key: withdrawKey \}/);
  assert.match(composer, /PHOTO_SUBMISSION_UNAVAILABLE/);
  const retryStart = composer.indexOf('const retry = useCallback');
  const retryEnd = composer.indexOf('const remove = useCallback');
  assert.ok(retryStart > 0 && retryEnd > retryStart);
  const retry = composer.slice(retryStart, retryEnd);
  assert.match(retry, /if \(item\.withdrawKey && item\.receipt\) \{\s*void withdrawOne\(item\.key, item\.receipt\.id, item\.withdrawKey\);\s*return;/);
  const withdrawBranch = retry.slice(
    retry.indexOf('item.withdrawKey && item.receipt'),
    retry.indexOf('if (!rights)'),
  );
  assert.doesNotMatch(withdrawBranch, /uploadOne/);
  assert.match(withdrawBranch, /withdrawOne/);
  const removeStart = composer.indexOf('const remove = useCallback');
  const removeEnd = composer.indexOf('const clear = useCallback');
  const remove = composer.slice(removeStart, removeEnd);
  assert.match(remove, /item\.withdrawKey \?\? Crypto\.randomUUID\(\)/);
  assert.doesNotMatch(remove, /uploadOne/);
});

test('#598B r2 unmount cleanup invalidates generation and guards async continuations (negative)', () => {
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /const alive = useRef\(true\)/);
  assert.match(composer, /alive\.current = true/);
  assert.match(composer, /alive\.current = false/);
  assert.match(composer, /return \(\) => \{\s*alive\.current = false;\s*generation\.current \+= 1;/);
  assert.match(composer, /!alive\.current \|\| epoch !== generation\.current/);
  const effectStart = composer.indexOf('useEffect(() => {');
  const effectBody = composer.slice(effectStart, effectStart + 500);
  assert.match(effectBody, /return \(\) => \{/);
});

test('#598B auth coordinator exposes photo ports through participationRead', () => {
  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /uploadCommentPhoto =/);
  assert.match(auth, /commentPhotoStatus =/);
  assert.match(auth, /withdrawCommentPhoto =/);
  assert.match(auth, /participationRead\(access => this\.deps\.api\.uploadCommentPhoto/);
  assert.match(auth, /participationRead\(access => this\.deps\.api\.withdrawCommentPhoto/);
});

test('#598B root composer wired under venue community comment field', () => {
  const ui = read('../src/components/venue-community.tsx');
  assert.match(ui, /VenueCommentPhotoComposer/);
  assert.match(ui, /useVenueCommentPhotoComposer/);
  assert.match(ui, /RootCommentComposer/);
  assert.match(ui, /photoIds: photos\.readyIds/);
});

test('#598B r2 composer survives roots loading; uses canonical venue id (negative)', () => {
  const ui = read('../src/components/venue-community.tsx');
  assert.match(ui, /useVenueCommentPhotoComposer\(s\.scope\?\.canonicalVenueId \?\? null, s\.actor, locked\)/);
  assert.match(ui, /Photo drafts live on CommunityPanel/);
  assert.match(ui, /canCreate \? <RootCommentComposer locked=\{locked\} photos=\{photos\} \/>/);
  assert.doesNotMatch(ui, /s\.roots\.phase === 'ready' && s\.roots\.pages\[0\]\?\.page\.canCreate \?/);
  assert.doesNotMatch(ui, /useVenueCommentPhotoComposer\(s\.venueId/);
  assert.match(ui, /function RootCommentComposer\(\{[\s\S]*photos: VenueCommentPhotoComposerModel/);
});
