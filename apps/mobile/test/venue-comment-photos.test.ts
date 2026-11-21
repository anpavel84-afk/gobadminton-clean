import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  COMMENT_PHOTO_MAX_BYTES,
  MAX_COMMENT_PHOTOS,
  PHOTO_RIGHTS,
  applyPendingReadDelta,
  applyPublishOperationUpdates,
  commentSendReady,
  isPhotoReceipt,
  notePendingPublish,
  photoComposerReducer,
  readyPhotoIds,
  type PhotoComposerItem,
  type VenueCommentPhotoReceipt,
} from '../src/venue-comment-photos.ts';
import { CommunityError, freezePacket } from '../src/venue-community.ts';
import { createNativeApi } from '../src/native-api.ts';
import { ParticipationError } from '../src/participation.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const venueId = '11111111-1111-4111-8111-111111111111';
const foreignVenueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
  assert.match(composer, /nativeAuth\.withdrawCommentPhoto\(\s*\{ id: receiptId, key: withdrawKey, venueId: venue \},\s*current,\s*permit,/);
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
  // r5: permit() checked inside participationRead callback before deps.api dispatch.
  assert.match(auth, /uploadCommentPhoto =[\s\S]*?permit: \(\) => boolean,[\s\S]*?participationRead\(access => \{\s*if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.uploadCommentPhoto\(access, input\);/);
  assert.match(auth, /commentPhotoStatus =[\s\S]*?permit: \(\) => boolean,[\s\S]*?participationRead\(access => \{\s*if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.commentPhotoStatus\(access, input\);/);
  assert.match(auth, /withdrawCommentPhoto =[\s\S]*?permit: \(\) => boolean,[\s\S]*?participationRead\(access => \{\s*if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.withdrawCommentPhoto\(access, input\);/);
});

test('#598B root composer wired under venue community comment field', () => {
  const ui = read('../src/components/venue-community.tsx');
  assert.match(ui, /VenueCommentPhotoComposer/);
  assert.match(ui, /useVenueCommentPhotoComposer/);
  assert.match(ui, /RootCommentComposer/);
  assert.match(ui, /const photoIds = photos\.readyIds/);
  assert.match(ui, /\.\.\.\(photoIds\.length \? \{ photoIds \} : \{\}\)/);
});

test('#598B r2 composer survives roots loading; uses canonical venue id (negative)', () => {
  const ui = read('../src/components/venue-community.tsx');
  assert.match(ui, /useVenueCommentPhotoComposer\(s\.scope\?\.canonicalVenueId \?\? null, s\.actor, locked\)/);
  assert.match(ui, /Photo drafts \+ create→photoIds association live on CommunityPanel/);
  assert.match(ui, /canCreate \? <RootCommentComposer locked=\{locked\} photos=\{photos\} onPublish=\{rememberPublish\} \/>/);
  assert.doesNotMatch(ui, /s\.roots\.phase === 'ready' && s\.roots\.pages\[0\]\?\.page\.canCreate \?/);
  assert.doesNotMatch(ui, /useVenueCommentPhotoComposer\(s\.venueId/);
  assert.match(ui, /function RootCommentComposer\(\{[\s\S]*photos: VenueCommentPhotoComposerModel/);
});

test('#598B r3/r4 retires photo drafts on reconcile-confirmed create via CommunityPanel association (negative)', () => {
  const ui = read('../src/components/venue-community.tsx');
  const panelStart = ui.indexOf('function CommunityPanel');
  const rootStart = ui.indexOf('function RootCommentComposer');
  assert.ok(panelStart > 0 && rootStart > panelStart);
  const panel = ui.slice(panelStart, rootStart);
  const root = ui.slice(rootStart, ui.indexOf('function ThreadNotice'));
  // Association next to drafts on CommunityPanel — not in RootCommentComposer.
  assert.match(panel, /pendingPublish/);
  assert.match(panel, /notePendingPublish|rememberPublish/);
  assert.match(panel, /applyPublishOperationUpdates/);
  assert.match(panel, /photos\.retirePublished/);
  assert.doesNotMatch(root, /publishKey/);
  assert.doesNotMatch(root, /pendingPublish/);
  assert.doesNotMatch(root, /photos\.clear\(\)/);
  assert.doesNotMatch(root, /s\.operations/);
  assert.doesNotMatch(ui, /owner\.commit\(packet\.key\)\.then/);
  // Refused path must NOT retire photo drafts (association cleared only).
  const helpers = read('../src/venue-comment-photos.ts');
  const refusedIdx = helpers.indexOf("operation.status === 'refused'");
  assert.ok(refusedIdx > 0);
  const refusedTail = helpers.slice(refusedIdx, refusedIdx + 160);
  assert.doesNotMatch(refusedTail, /retireIds\.push/);
  assert.match(refusedTail, /next\.delete/);
});

test('#598B r4 remount: association survives RootCommentComposer unmount; reconcile retires drafts', () => {
  // canCreate true → create UNKNOWN → canCreate false (composer unmounted) → canCreate true
  // → reconcile confirms → drafts with those ids retired and not resubmittable.
  let items: PhotoComposerItem[] = photoComposerReducer([], {
    type: 'add', key, mime: 'image/jpeg', size: 100,
  });
  items = photoComposerReducer(items, {
    type: 'patch', key, state: 'ready', receipt: readyReceipt(photoId),
  });
  assert.deepEqual(readyPhotoIds(items), [photoId]);

  let pending = notePendingPublish(new Map(), 'op-unknown', [photoId]);
  // Composer unmount/remount does not touch CommunityPanel's pendingPublish.
  const stillUnknown = applyPublishOperationUpdates(pending, [
    { packet: { key: 'op-unknown' }, status: 'unknown' },
  ]);
  assert.equal(stillUnknown.retireIds.length, 0);
  assert.ok(stillUnknown.pending.has('op-unknown'));
  pending = stillUnknown.pending;

  const confirmed = applyPublishOperationUpdates(pending, [
    { packet: { key: 'op-unknown' }, status: 'confirmed' },
  ]);
  assert.deepEqual(confirmed.retireIds, [photoId]);
  assert.equal(confirmed.pending.size, 0);
  items = photoComposerReducer(items, { type: 'retireIds', ids: confirmed.retireIds });
  assert.deepEqual(readyPhotoIds(items), []);
  assert.equal(commentSendReady('', items), false);

  // Refused keeps drafts resubmittable.
  let refusedItems: PhotoComposerItem[] = photoComposerReducer([], {
    type: 'add', key, mime: 'image/jpeg', size: 100,
  });
  refusedItems = photoComposerReducer(refusedItems, {
    type: 'patch', key, state: 'ready', receipt: readyReceipt(photoId),
  });
  const refused = applyPublishOperationUpdates(
    notePendingPublish(new Map(), 'op-refused', [photoId]),
    [{ packet: { key: 'op-refused' }, status: 'refused' }],
  );
  assert.deepEqual(refused.retireIds, []);
  assert.equal(refused.pending.size, 0);
  assert.deepEqual(readyPhotoIds(refusedItems), [photoId]);

  const ui = read('../src/components/venue-community.tsx');
  assert.match(ui, /pendingPublish/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function RootCommentComposer'), ui.indexOf('function ThreadNotice')), /publishKey/);
});

test('#598B r3 pending file read blocks Send; uploadOne/read recheck locked (negative)', () => {
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /pendingReads/);
  assert.match(composer, /setPendingReads/);
  assert.match(composer, /applyPendingReadDelta/);
  assert.match(composer, /canSend: \(text: string\) => !reading && commentSendReady\(text, items\)/);
  assert.match(composer, /checking: hasCheckingPhoto\(items\) \|\| reading/);
  const uploadStart = composer.indexOf('const uploadOne = useCallback');
  const uploadEnd = composer.indexOf('const withdrawOne = useCallback');
  assert.ok(uploadStart > 0 && uploadEnd > uploadStart);
  const upload = composer.slice(uploadStart, uploadEnd);
  assert.match(upload, /isLocked/);
  assert.match(upload, /state: 'retryable'/);
  assert.doesNotMatch(upload, /nativeAuth\.uploadCommentPhoto[\s\S]*isLocked/);
  const addStart = composer.indexOf('const add = useCallback');
  const addEnd = composer.indexOf('const retry = useCallback');
  const add = composer.slice(addStart, addEnd);
  assert.match(add, /applyPendingReadDelta\(count, 1, alive\.current, epoch, generation\.current\)/);
  assert.match(add, /live\.current\.locked\) return;/);
  assert.match(add, /applyPendingReadDelta\(count, -1, alive\.current, epoch, generation\.current\)/);
  // Unconditional finally decrement must not remain.
  assert.doesNotMatch(add, /setPendingReads\(count => Math\.max\(0, count - 1\)\)/);
});

test('#598B r4 stale read completion cannot zero a newer generation pending count (negative)', () => {
  // start read A (gen 1) → scope reset (gen 2) → start read B → complete A → gen2 still 1; complete B → 0
  let pending = 0;
  const gen1 = 1;
  pending = applyPendingReadDelta(pending, 1, true, gen1, 1);
  assert.equal(pending, 1);
  // Scope reset replaces counter (composer effect sets 0) and bumps generation.
  pending = 0;
  const gen2 = 2;
  pending = applyPendingReadDelta(pending, 1, true, gen2, 2);
  assert.equal(pending, 1);
  // Stale A completes against gen 2 — must not decrement.
  pending = applyPendingReadDelta(pending, -1, true, gen1, 2);
  assert.equal(pending, 1);
  // Dead/unmounted continuation also ignored.
  pending = applyPendingReadDelta(pending, -1, false, gen2, 2);
  assert.equal(pending, 1);
  // Live B completes.
  pending = applyPendingReadDelta(pending, -1, true, gen2, 2);
  assert.equal(pending, 0);
  // Send stays disabled while pending > 0 (gen2 after stale A).
  assert.equal(applyPendingReadDelta(1, -1, true, 1, 2) > 0, true);

  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /applyPendingReadDelta\(count, -1, alive\.current, epoch, generation\.current\)/);
  assert.match(composer, /if \(alive\.current && epoch === generation\.current\) running\.current\.delete\(key\)/);
});

test('#598B r4 self-audit: publish association owned by CommunityPanel; async continuations generation-guarded (negative)', () => {
  const ui = read('../src/components/venue-community.tsx');
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  const helpers = read('../src/venue-comment-photos.ts');
  // (a) state that must outlive RootCommentComposer lives on CommunityPanel next to drafts.
  assert.match(ui, /pendingPublish/);
  assert.match(ui, /retirePublished/);
  assert.match(helpers, /applyPublishOperationUpdates/);
  assert.match(helpers, /notePendingPublish/);
  const root = ui.slice(ui.indexOf('function RootCommentComposer'), ui.indexOf('function ThreadNotice'));
  assert.doesNotMatch(root, /useRef/);
  assert.doesNotMatch(root, /useState/);
  assert.doesNotMatch(root, /useEffect/);
  // (b) every pendingReads / running finally mutation is alive+generation guarded.
  assert.match(helpers, /applyPendingReadDelta/);
  assert.match(composer, /applyPendingReadDelta\(count, 1/);
  assert.match(composer, /applyPendingReadDelta\(count, -1/);
  const uploadFinally = composer.slice(
    composer.indexOf('const uploadOne = useCallback'),
    composer.indexOf('const withdrawOne = useCallback'),
  );
  assert.match(uploadFinally, /if \(alive\.current && epoch === generation\.current\) running\.current\.delete\(key\)/);
  const withdrawFinally = composer.slice(
    composer.indexOf('const withdrawOne = useCallback'),
    composer.indexOf('const add = useCallback'),
  );
  assert.match(withdrawFinally, /if \(alive\.current && epoch === generation\.current\) running\.current\.delete\(key\)/);
});

test('#598B r3 status/withdraw/upload reject foreign venue receipt; accept canonical (negative)', async () => {
  assert.notEqual(venueId, foreignVenueId);
  const matching = readyReceipt(photoId, { venueId });
  const foreign = readyReceipt(photoId, { venueId: foreignVenueId });
  const matchingWithdrawn = withdrawnReceipt(photoId);
  const foreignWithdrawn = { ...withdrawnReceipt(photoId), venueId: foreignVenueId };

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  let uploadBody: unknown = matching;
  const api = createNativeApi(async (url, init) => {
    const path = String(url);
    if (path.includes('/comment-photos') && init?.method === 'POST') {
      return new Response(JSON.stringify(uploadBody), { status: 201 });
    }
    if (path.includes('/venue-photo-submissions/') && init?.method === 'GET') {
      return new Response(JSON.stringify(uploadBody), { status: 200 });
    }
    if (path.includes('/venue-photo-submissions/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify(uploadBody), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  uploadBody = matching;
  assert.deepEqual(
    await api.uploadCommentPhoto('token', { venueId, key, mime: 'image/jpeg', bytes: jpeg }),
    matching,
  );
  uploadBody = foreign;
  await assert.rejects(
    () => api.uploadCommentPhoto('token', { venueId, key, mime: 'image/jpeg', bytes: jpeg }),
    (error: unknown) => error instanceof CommunityError && error.kind === 'invalid',
  );

  uploadBody = matching;
  assert.deepEqual(
    await api.commentPhotoStatus('token', { id: photoId, venueId }),
    matching,
  );
  uploadBody = foreign;
  await assert.rejects(
    () => api.commentPhotoStatus('token', { id: photoId, venueId }),
    (error: unknown) => error instanceof CommunityError && error.kind === 'invalid',
  );

  uploadBody = matchingWithdrawn;
  assert.deepEqual(
    await api.withdrawCommentPhoto('token', { id: photoId, key, venueId }),
    matchingWithdrawn,
  );
  uploadBody = foreignWithdrawn;
  await assert.rejects(
    () => api.withdrawCommentPhoto('token', { id: photoId, key, venueId }),
    (error: unknown) => error instanceof CommunityError && error.kind === 'invalid',
  );

  const apiSrc = read('../src/native-api.ts');
  assert.match(apiSrc, /commentPhotoStatus: async \(\s*access: string,\s*input: Readonly<\{ id: string; venueId: string \}>,/);
  assert.match(apiSrc, /withdrawCommentPhoto: async \(\s*access: string,\s*input: Readonly<\{ id: string; key: string; venueId: string \}>,/);
  assert.match(apiSrc, /isPhotoReceipt\(raw, venueId, 'ready', photoId\)/);
  assert.match(apiSrc, /isPhotoReceipt\(raw, venueId, 'withdrawn', photoId\)/);
  assert.doesNotMatch(
    apiSrc.slice(apiSrc.indexOf('commentPhotoStatus:'), apiSrc.indexOf('withdrawCommentPhoto:')),
    /communityId\(\(raw as VenueCommentPhotoReceipt\)\.venueId\)/,
  );
  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /commentPhotoStatus = \(\s*input: Readonly<\{ id: string; venueId: string \}>,\s*actor: Actor,\s*permit: \(\) => boolean,/);
  assert.match(auth, /withdrawCommentPhoto = \(\s*input: Readonly<\{ id: string; key: string; venueId: string \}>,\s*actor: Actor,\s*permit: \(\) => boolean,/);
});

test('#598B r5 composer passes alive+generation+scope permit; stale ParticipationError silent (negative)', () => {
  const composer = read('../src/components/venue-comment-photo-composer.tsx');
  assert.match(composer, /ParticipationError/);
  const upload = composer.slice(
    composer.indexOf('const uploadOne = useCallback'),
    composer.indexOf('const withdrawOne = useCallback'),
  );
  assert.match(upload, /const permit = \(\) => alive\.current && epoch === generation\.current && live\.current\.venueId === venue/);
  assert.match(upload, /nativeAuth\.uploadCommentPhoto\(\s*\{ venueId: venue, key, mime, bytes \},\s*current,\s*permit,/);
  assert.match(upload, /error instanceof ParticipationError && error\.kind === 'stale'/);
  const withdraw = composer.slice(
    composer.indexOf('const withdrawOne = useCallback'),
    composer.indexOf('const add = useCallback'),
  );
  assert.match(withdraw, /const permit = \(\) => alive\.current && epoch === generation\.current && live\.current\.venueId === venue\s*&& itemsRef\.current\.some\(item => item\.key === key\)/);
  assert.match(withdraw, /nativeAuth\.withdrawCommentPhoto\(\s*\{ id: receiptId, key: withdrawKey, venueId: venue \},\s*current,\s*permit,/);
  assert.match(withdraw, /error instanceof ParticipationError && error\.kind === 'stale'/);
});

test('#598B r5 delayed-token: stale permit never dispatches photo API; live permit calls once', async () => {
  // Faithful minimal harness of participationRead + photo methods (FIX-598B2-R5-EVIDENCE).
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };
  type PhotoApi = {
    uploadCommentPhoto: (access: string, input: unknown) => Promise<unknown>;
    commentPhotoStatus: (access: string, input: unknown) => Promise<unknown>;
    withdrawCommentPhoto: (access: string, input: unknown) => Promise<unknown>;
  };
  const participationRead = async <T>(
    token: () => Promise<string>,
    operation: (access: string) => Promise<T>,
  ): Promise<T> => {
    const access = await token();
    return operation(access);
  };
  const makePorts = (api: PhotoApi, token: () => Promise<string>) => ({
    uploadCommentPhoto: (input: unknown, _actor: unknown, permit: () => boolean) =>
      participationRead(token, access => {
        if (!permit()) throw new ParticipationError('stale');
        return api.uploadCommentPhoto(access, input);
      }),
    commentPhotoStatus: (input: unknown, _actor: unknown, permit: () => boolean) =>
      participationRead(token, access => {
        if (!permit()) throw new ParticipationError('stale');
        return api.commentPhotoStatus(access, input);
      }),
    withdrawCommentPhoto: (input: unknown, _actor: unknown, permit: () => boolean) =>
      participationRead(token, access => {
        if (!permit()) throw new ParticipationError('stale');
        return api.withdrawCommentPhoto(access, input);
      }),
  });

  for (const method of ['uploadCommentPhoto', 'withdrawCommentPhoto', 'commentPhotoStatus'] as const) {
    for (const caseKind of ['stale', 'live'] as const) {
      const gate = deferred<string>();
      const apiCalls: string[] = [];
      const api: PhotoApi = {
        uploadCommentPhoto: async () => { apiCalls.push('uploadCommentPhoto'); return readyReceipt(); },
        commentPhotoStatus: async () => { apiCalls.push('commentPhotoStatus'); return readyReceipt(); },
        withdrawCommentPhoto: async () => { apiCalls.push('withdrawCommentPhoto'); return withdrawnReceipt(); },
      };
      const ports = makePorts(api, () => gate.promise);
      let permitted = true;
      const permit = () => permitted;
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const work = method === 'uploadCommentPhoto'
        ? ports.uploadCommentPhoto({ venueId, key, mime: 'image/jpeg', bytes: jpeg }, actor, permit)
        : method === 'commentPhotoStatus'
          ? ports.commentPhotoStatus({ id: photoId, venueId }, actor, permit)
          : ports.withdrawCommentPhoto({ id: photoId, key, venueId }, actor, permit);

      await new Promise(done => setImmediate(done));
      assert.equal(apiCalls.length, 0, `${method} must await token before dispatch`);

      if (caseKind === 'stale') {
        permitted = false;
        gate.resolve('access-token');
        await assert.rejects(work, (error: unknown) =>
          error instanceof ParticipationError && error.kind === 'stale');
        assert.equal(apiCalls.length, 0, `${method} stale must not dispatch`);
      } else {
        gate.resolve('access-token');
        await work;
        assert.deepEqual(apiCalls, [method], `${method} live must dispatch once`);
      }
    }
  }

  // Source: actual coordinator methods use the same permit-inside-callback shape.
  const auth = read('../src/auth-coordinator.ts');
  assert.match(auth, /if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.uploadCommentPhoto/);
  assert.match(auth, /if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.commentPhotoStatus/);
  assert.match(auth, /if \(!permit\(\)\) throw new ParticipationError\('stale'\);\s*return this\.deps\.api\.withdrawCommentPhoto/);
});
