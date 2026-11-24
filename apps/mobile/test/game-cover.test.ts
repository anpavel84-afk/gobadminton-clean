import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { ProfileError } from '../src/profile.ts';
import {
  GameCoverCoordinator,
  GAME_COVER_UPLOAD_MAX_BYTES,
  admitGameCoverUpload,
  freezeGameCoverPacket,
  gameCoverMediaPath,
  gameCoverMutationSucceeded,
  parseGameCoverReceipt,
  type GameCoverPacket,
  type GameCoverPort,
} from '../src/game-cover.ts';
import { cloneDerivativeBytes, type AvatarDerivative } from '../src/profile-avatar.ts';
import {
  GAME_COVER_DERIVATIVE_MAX_BYTES,
  COVER_DERIVATIVE_MAX_BYTES,
} from '../src/profile-avatar-runtime.ts';

const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const hex64 = 'ab'.repeat(32);
const gameUrl = `/v1/media/game-covers/${hex64}.png`;
const venueUrl = `/v1/media/venue-covers/${hex64}.png`;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function jpegDerivative(bytes = new Uint8Array([255, 216, 255, 217])): AvatarDerivative {
  return Object.freeze({ mime: 'image/jpeg' as const, bytes: cloneDerivativeBytes(bytes) });
}

test('game cover port wire: PUT binary, DELETE JSON CAS, X-Game-Version, bearer-only; oversize zero fetch', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = createNativeApi(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/cover') && init?.method === 'GET') {
      return new Response(JSON.stringify({ version: 2, hasCover: true, cover: { uploadedUrl: gameUrl } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (init?.method === 'DELETE') {
      return new Response(JSON.stringify({ version: 3, hasCover: false, cover: { uploadedUrl: venueUrl } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ version: 2, hasCover: true, cover: { uploadedUrl: gameUrl } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  const replace = freezeGameCoverPacket({
    actor, key: 'game-cover-put-01', gameId: '11111111-1111-1111-1111-111111111111',
    action: 'replace', gameVersion: 1, derivative: jpegDerivative(),
  });
  const put = await api.mutateGameCover('access-token', replace);
  assert.equal(put.hasCover, true);
  assert.equal(calls[0]!.url, 'https://dev.gobadminton.ru/v1/games/11111111-1111-1111-1111-111111111111/cover');
  assert.equal(calls[0]!.init.method, 'PUT');
  assert.equal(calls[0]!.init.credentials, 'omit');
  const putHeaders = calls[0]!.init.headers as Record<string, string>;
  assert.equal(putHeaders.Authorization, 'Bearer access-token');
  assert.equal(putHeaders['Idempotency-Key'], 'game-cover-put-01');
  assert.equal(putHeaders['X-Game-Version'], '1');
  assert.equal(putHeaders['Content-Type'], 'image/jpeg');
  assert.ok(calls[0]!.init.body instanceof Uint8Array);
  const remove = freezeGameCoverPacket({
    actor, key: 'game-cover-del-01', gameId: '11111111-1111-1111-1111-111111111111',
    action: 'remove', gameVersion: 2, derivative: null,
  });
  const deleted = await api.mutateGameCover('access-token', remove);
  assert.equal(deleted.hasCover, false);
  assert.equal(deleted.cover.uploadedUrl, venueUrl);
  assert.equal(calls[1]!.init.method, 'DELETE');
  assert.equal(calls[1]!.init.body, JSON.stringify({ expectedVersion: 2 }));
  const own = await api.gameCover('access-token', '11111111-1111-1111-1111-111111111111');
  assert.equal(own.version, 2);
  assert.equal(own.hasCover, true);
  const failing = createNativeApi(async () => new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }));
  await assert.rejects(
    () => failing.mutateGameCover('t', replace),
    (e: unknown) => e instanceof ProfileError && e.kind === 'business' && e.status === 429,
  );

  const before = calls.length;
  const oversize = freezeGameCoverPacket({
    actor, key: 'oversize', gameId: '11111111-1111-1111-1111-111111111111',
    action: 'replace', gameVersion: 1,
    derivative: jpegDerivative(new Uint8Array(GAME_COVER_UPLOAD_MAX_BYTES + 1)),
  });
  await assert.rejects(() => api.mutateGameCover('access-token', oversize), ProfileError);
  assert.equal(calls.length, before);
  assert.throws(() => admitGameCoverUpload(jpegDerivative(new Uint8Array(0))), ProfileError);
  assert.throws(() => admitGameCoverUpload(null), ProfileError);
});

test('receipt parse keeps hasCover independent of venue fallback URL; rejects foreign hosts', () => {
  assert.deepEqual(parseGameCoverReceipt({
    version: 2, hasCover: false, cover: { uploadedUrl: venueUrl },
  }), { version: 2, hasCover: false, cover: { uploadedUrl: venueUrl } });
  assert.deepEqual(parseGameCoverReceipt({
    version: 3, hasCover: true, cover: { uploadedUrl: gameUrl },
  }), { version: 3, hasCover: true, cover: { uploadedUrl: gameUrl } });
  assert.equal(parseGameCoverReceipt({
    version: 1, hasCover: true, cover: { uploadedUrl: 'https://evil.example/x.png' },
  }).cover.uploadedUrl, null);
  assert.throws(() => parseGameCoverReceipt({ version: 0, hasCover: false, cover: { uploadedUrl: null } }), ProfileError);
  assert.equal(gameCoverMediaPath(gameUrl), gameUrl);
  assert.equal(gameCoverMediaPath(venueUrl), null);
});

test('coordinator: save/remove/hasCover fence; uncertain blocks writes; no auto-publish', async () => {
  let version = 4;
  let hasCover = false;
  const sent: GameCoverPacket[] = [];
  const receipts: Array<{ gameId: string; version: number }> = [];
  const port: GameCoverPort = {
    read: async () => ({ version, hasCover, cover: { uploadedUrl: hasCover ? gameUrl : venueUrl } }),
    mutate: async (packet) => {
      sent.push(packet);
      version += 1;
      hasCover = packet.action === 'replace';
      return { version, hasCover, cover: { uploadedUrl: hasCover ? gameUrl : venueUrl } };
    },
  };
  const owner = new GameCoverCoordinator(port, () => `key-${sent.length + 1}`, {
    onReceipt: (gameId, receipt) => { receipts.push({ gameId, version: receipt.version }); },
    accessToken: () => 'tok',
  });
  owner.setActor(actor);
  await owner.load('game-1');
  assert.equal(owner.getSnapshot().status, 'ready');
  assert.equal(owner.getSnapshot().access?.hasCover, false);
  await owner.remove();
  assert.equal(sent.length, 0);
  await owner.change(async () => jpegDerivative());
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.action, 'replace');
  assert.equal(owner.getSnapshot().access?.hasCover, true);
  assert.equal(receipts.at(-1)?.version, 5);
  await owner.remove();
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.gameVersion, 4);
  assert.equal(owner.getSnapshot().access?.hasCover, false);

  // Unknown retains packet; successful GET must not clear; reconcile is explicit.
  let failRead = false;
  let reads = 0;
  const flaky: GameCoverPort = {
    read: async () => {
      reads += 1;
      if (failRead) throw new ProfileError('network', 503);
      return { version: 10, hasCover: false, cover: { uploadedUrl: null } };
    },
    mutate: async () => { throw new ProfileError('network', 503); },
  };
  const uncertain = new GameCoverCoordinator(flaky, () => 'u-key', {
    accessToken: () => 'tok',
  });
  uncertain.setActor(actor);
  await uncertain.load('game-2');
  const readsAfterLoad = reads;
  failRead = false; // even if GET would succeed, dispatch must not auto-clear via background read
  await uncertain.change(async () => jpegDerivative());
  assert.equal(uncertain.getSnapshot().status, 'unknown');
  assert.equal(uncertain.getSnapshot().command?.packet.key, 'u-key');
  assert.equal(uncertain.getSnapshot().uncertain, true);
  assert.equal(reads, readsAfterLoad); // no automatic GET after failed mutate
  assert.equal(uncertain.blocksManagedWrites('game-2'), true);
  assert.equal(uncertain.blocksManagedWrites('other'), false);
  await uncertain.change(async () => jpegDerivative());
  assert.equal(uncertain.getSnapshot().command?.packet.key, 'u-key');
  await uncertain.reconcile();
  assert.equal(uncertain.getSnapshot().uncertain, false);
  assert.equal(uncertain.getSnapshot().status, 'ready');
  assert.equal(uncertain.getSnapshot().notice, 'Данные обновлены. Можно повторить сохранение.');
  // CURRENT replay: hasCover false with safe null/venue URL is accepted without inventing retained own photo.
  assert.equal(uncertain.getSnapshot().access?.hasCover, false);
});

test('F1 journal: focus/load other game parks unresolved A; return restores packet; retry needs sameActor', async () => {
  const sent: GameCoverPacket[] = [];
  const port: GameCoverPort = {
    read: async (gameId) => ({ version: gameId === 'game-A' ? 2 : 5, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: async (packet) => {
      sent.push(packet);
      throw new ProfileError('network', 503);
    },
  };
  const owner = new GameCoverCoordinator(port, () => 'journal-key', { accessToken: () => 'tok' });
  owner.setActor(actor);
  await owner.load('game-A');
  await owner.change(async () => jpegDerivative());
  assert.equal(owner.getSnapshot().status, 'unknown');
  const parked = owner.getSnapshot().command!.packet;
  assert.equal(parked.key, 'journal-key');
  assert.ok(parked.derivative);

  owner.focus('game-B');
  await Promise.resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(owner.blocksManagedWrites('game-A'), true);
  assert.notEqual(owner.getSnapshot().command?.packet.key, 'journal-key');
  assert.equal(owner.getSnapshot().heldGameId, 'game-A');

  owner.focus('game-A');
  assert.equal(owner.getSnapshot().status, 'unknown');
  assert.equal(owner.getSnapshot().command?.packet.key, 'journal-key');
  assert.equal(owner.getSnapshot().command?.packet.gameVersion, parked.gameVersion);
  assert.deepEqual(
    [...owner.getSnapshot().command!.packet.derivative!.bytes],
    [...parked.derivative!.bytes],
  );

  // New session same actorId must not dispatch the old-session packet.
  owner.setActor({ actorId: 'A', sessionId: 'session-A2', generation: 1 });
  assert.equal(owner.getSnapshot().status, 'unknown');
  const before = sent.length;
  await owner.retry();
  assert.equal(sent.length, before);
  // Explicit reconcile (read-only) still works.
  await owner.reconcile();
  assert.equal(owner.getSnapshot().uncertain, false);
});

test('F2/F5 late preparation zero send; already-started result no paint; permit fence', async () => {
  let resolvePrepare!: (v: AvatarDerivative) => void;
  let resolveStarted!: () => void;
  const started = new Promise<void>(r => { resolveStarted = r; });
  let resolveMutate!: (v: ReturnType<typeof parseGameCoverReceipt>) => void;
  const sent: GameCoverPacket[] = [];
  const delayed: GameCoverPort = {
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: (packet) => {
      sent.push(packet);
      resolveStarted();
      return new Promise(resolve => { resolveMutate = resolve; });
    },
  };
  const late = new GameCoverCoordinator(delayed, () => 'late-key', { accessToken: () => 'tok' });
  late.setActor(actor);
  await late.load('game-3');

  // Late preparation: actor changes before prepare resolves → zero send.
  const prepPending = late.change(async (retired) => {
    const d = await new Promise<AvatarDerivative>(r => { resolvePrepare = r; });
    if (retired()) return 'cancelled';
    return d;
  });
  late.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  resolvePrepare!(jpegDerivative());
  await prepPending;
  assert.equal(sent.length, 0);

  // Already-started mutate: result must not paint under the new actor.
  late.setActor(actor);
  await late.load('game-3');
  const mutatePending = late.change(async () => jpegDerivative());
  await started;
  assert.equal(sent.length, 1);
  late.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  resolveMutate!({ version: 99, hasCover: true, cover: { uploadedUrl: gameUrl } });
  await mutatePending;
  assert.notEqual(late.getSnapshot().access?.version, 99);

  // Permit helpers are production exports (no lazy authority gap).
  late.setActor(actor);
  await late.load('game-4');
  const release = late.openView('game-4');
  const permit = late.renderedPermit();
  assert.ok(permit);
  assert.equal(late.permitLive(permit!), true);
  late.setForeground(false);
  assert.equal(late.permitLive(permit!), false);
  release();
});

test('bearer image source only for game-covers path; venue fallback stays credential-omit', () => {
  const owner = new GameCoverCoordinator({
    read: async () => ({ version: 1, hasCover: true, cover: { uploadedUrl: gameUrl } }),
    mutate: async () => ({ version: 1, hasCover: true, cover: { uploadedUrl: gameUrl } }),
  }, () => 'k', { accessToken: () => 'secret-token' });
  owner.setActor(actor);
  const game = owner.coverImageSource(gameUrl);
  assert.equal(game?.uri, `https://dev.gobadminton.ru${gameUrl}`);
  assert.equal(game?.headers?.Authorization, 'Bearer secret-token');
  const venue = owner.coverImageSource(venueUrl);
  assert.equal(venue?.uri, `https://dev.gobadminton.ru${venueUrl}`);
  assert.equal(venue?.headers, undefined);
  assert.equal(owner.coverImageSource('https://evil.example/x.png'), null);
});

test('#522 APK51 managed game photo budget pin (no source-regex mirror)', () => {
  assert.equal(GAME_COVER_DERIVATIVE_MAX_BYTES, 512 * 1024);
  assert.equal(GAME_COVER_UPLOAD_MAX_BYTES, GAME_COVER_DERIVATIVE_MAX_BYTES);
  assert.ok(COVER_DERIVATIVE_MAX_BYTES > GAME_COVER_DERIVATIVE_MAX_BYTES);
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 52);
});

test('#522 FIX2: openView release retires load/prep; sending→UNKNOWN; reopen not stuck busy', async () => {
  let resolveRead!: (v: { version: number; hasCover: boolean; cover: { uploadedUrl: string | null } }) => void;
  let resolveMutate!: (v: { version: number; hasCover: boolean; cover: { uploadedUrl: string | null } }) => void;
  let reads = 0;
  const port: GameCoverPort = {
    read: () => {
      reads += 1;
      return new Promise(r => { resolveRead = r; });
    },
    mutate: () => new Promise(r => { resolveMutate = r; }),
  };
  const owner = new GameCoverCoordinator(port, () => 'fix2-key', { accessToken: () => 'tok' });
  owner.setActor(actor);

  // Close during load → reloadable; late read ignored; reopen loads again.
  const releaseLoad = owner.openView('game-load');
  assert.equal(owner.getSnapshot().status, 'loading');
  const readsAtClose = reads;
  releaseLoad();
  assert.equal(owner.getSnapshot().focus, null);
  assert.ok(['idle', 'ready'].includes(owner.getSnapshot().status));
  resolveRead!({ version: 1, hasCover: false, cover: { uploadedUrl: null } });
  await Promise.resolve();
  assert.notEqual(owner.getSnapshot().status, 'loading');
  const releaseReload = owner.openView('game-load');
  assert.equal(owner.getSnapshot().status, 'loading');
  assert.ok(reads > readsAtClose);
  resolveRead!({ version: 2, hasCover: false, cover: { uploadedUrl: null } });
  await new Promise(r => setImmediate(r));
  assert.equal(owner.getSnapshot().status, 'ready');
  releaseReload();

  // Close during already-started send → UNKNOWN retained; reopen stays reconcilable not spinning.
  const readyPort: GameCoverPort = {
    read: async () => ({ version: 5, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: () => new Promise(r => { resolveMutate = r; }),
  };
  const sending = new GameCoverCoordinator(readyPort, () => 'send-key', { accessToken: () => 'tok' });
  sending.setActor(actor);
  const releaseSend = sending.openView('game-send');
  await new Promise(r => setImmediate(r));
  assert.equal(sending.getSnapshot().status, 'ready');
  const sendWork = sending.change(async () => jpegDerivative());
  await new Promise(r => setImmediate(r));
  assert.equal(sending.getSnapshot().status, 'sending');
  const packetKey = sending.getSnapshot().command!.packet.key;
  releaseSend();
  assert.equal(sending.getSnapshot().status, 'unknown');
  assert.equal(sending.getSnapshot().command?.packet.key, packetKey);
  assert.equal(sending.getSnapshot().uncertain, true);
  resolveMutate!({ version: 99, hasCover: true, cover: { uploadedUrl: gameUrl } });
  await sendWork;
  assert.notEqual(sending.getSnapshot().access?.version, 99);
  assert.equal(sending.getSnapshot().command?.packet.key, packetKey);

  const releaseReopen = sending.openView('game-send');
  assert.equal(sending.getSnapshot().status, 'unknown');
  assert.equal(sending.busy(), false);
  assert.equal(sending.getSnapshot().command?.packet.key, packetKey);
  releaseReopen();
});

test('#522 FIX2: expected picker handoff survives AppState; close/account/game ABA discard', () => {
  const owner = new GameCoverCoordinator({
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
  }, () => 'k', { accessToken: () => 'tok' });
  owner.setActor(actor);
  const release = owner.openView('game-pick');
  const permit = owner.renderedPermit();
  assert.ok(permit);
  assert.equal(owner.permitLive(permit!), true);

  const end = owner.beginExpectedPickerHandoff(permit!);
  assert.equal(owner.expectingPickerHandoff(), true);
  owner.setForeground(false);
  assert.equal(owner.permitLive(permit!), false);
  assert.equal(owner.pickerHandoffPending(permit!), true);
  assert.equal(owner.pickerHandoffLive(permit!), false);
  owner.setForeground(true);
  assert.equal(owner.pickerHandoffLive(permit!), true);
  // Mutation fence still requires original foregroundGen — handoff must not revive it.
  assert.equal(owner.permitLive(permit!), false);
  end();
  assert.equal(owner.expectingPickerHandoff(), false);

  // Fresh permit after return: normal roundtrip end.
  const permit2 = owner.renderedPermit();
  assert.ok(permit2);
  const end2 = owner.beginExpectedPickerHandoff(permit2!);
  owner.setForeground(false);
  owner.setForeground(true);
  assert.equal(owner.pickerHandoffLive(permit2!), true);
  end2();

  // Account change discards handoff.
  const permit3 = owner.renderedPermit();
  assert.ok(permit3);
  owner.beginExpectedPickerHandoff(permit3!);
  owner.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  assert.equal(owner.expectingPickerHandoff(), false);

  owner.setActor(actor);
  const releaseB = owner.openView('game-B');
  const permitB = owner.renderedPermit();
  assert.ok(permitB);
  owner.beginExpectedPickerHandoff(permitB!);
  releaseB();
  assert.equal(owner.expectingPickerHandoff(), false);
  release();
});

test('#522 FIX4: expected picker handoff ends on real openView release; reopen fresh', () => {
  const owner = new GameCoverCoordinator({
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
  }, () => 'k', { accessToken: () => 'tok' });
  owner.setActor(actor);
  const release = owner.openView('game-route');
  const permit = owner.renderedPermit();
  assert.ok(permit);
  owner.beginExpectedPickerHandoff(permit!);
  assert.equal(owner.expectingPickerHandoff(), true);
  // Real production release (route cleanup) ends handoff — not a mirrored focus-effect.
  release();
  assert.equal(owner.getSnapshot().focus, null);
  assert.equal(owner.expectingPickerHandoff(), false);
  assert.equal(owner.pickerHandoffPending(permit!), false);
  assert.equal(owner.permitLive(permit!), false);
  const release2 = owner.openView('game-route');
  const fresh = owner.renderedPermit();
  assert.ok(fresh);
  assert.notEqual(fresh!.viewGen, permit!.viewGen);
  release2();
});

test('#522 FIX2: CURRENT replay hasCover=false is honest; success helper excludes UNKNOWN notice', async () => {
  const port: GameCoverPort = {
    read: async () => ({ version: 3, hasCover: false, cover: { uploadedUrl: venueUrl } }),
    mutate: async () => ({ version: 4, hasCover: false, cover: { uploadedUrl: venueUrl } }),
  };
  const owner = new GameCoverCoordinator(port, () => 'current-key', { accessToken: () => 'tok' });
  owner.setActor(actor);
  await owner.load('game-current');
  await owner.change(async () => jpegDerivative());
  const snap = owner.getSnapshot();
  assert.equal(snap.access?.hasCover, false);
  assert.match(snap.notice ?? '', /не установлено|обновлены|Данные/i);
  assert.equal(snap.notice, 'Сейчас своё фото не установлено. Можно выбрать изображение снова.');
  assert.equal(gameCoverMutationSucceeded(snap), false);

  // Definite save still closes-worthy.
  const ok: GameCoverPort = {
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: async () => ({ version: 2, hasCover: true, cover: { uploadedUrl: gameUrl } }),
  };
  const saved = new GameCoverCoordinator(ok, () => 'ok-key', { accessToken: () => 'tok' });
  saved.setActor(actor);
  await saved.load('game-ok');
  await saved.change(async () => jpegDerivative());
  assert.equal(gameCoverMutationSucceeded(saved.getSnapshot()), true);

  // UNKNOWN notice must not count as success.
  const flaky: GameCoverPort = {
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: async () => { throw new ProfileError('network', 503); },
  };
  const unknown = new GameCoverCoordinator(flaky, () => 'u', { accessToken: () => 'tok' });
  unknown.setActor(actor);
  await unknown.load('game-u');
  await unknown.change(async () => jpegDerivative());
  assert.equal(gameCoverMutationSucceeded(unknown.getSnapshot()), false);
  assert.ok(unknown.getSnapshot().notice);
});

test('#522 FIX6: CURRENT remove replay with remaining own cover is honest; no removal success/close', async () => {
  const port: GameCoverPort = {
    read: async () => ({ version: 5, hasCover: true, cover: { uploadedUrl: gameUrl } }),
    // Idempotent CURRENT: another manager re-uploaded — own slot still present.
    mutate: async () => ({ version: 6, hasCover: true, cover: { uploadedUrl: gameUrl } }),
  };
  const owner = new GameCoverCoordinator(port, () => 'rm-current', { accessToken: () => 'tok' });
  owner.setActor(actor);
  await owner.load('game-rm-current');
  assert.equal(owner.getSnapshot().access?.hasCover, true);
  await owner.remove();
  const snap = owner.getSnapshot();
  assert.equal(snap.access?.hasCover, true);
  assert.equal(snap.notice, 'Сейчас своё фото установлено. Можно оставить его или выбрать другое.');
  assert.match(snap.notice ?? '', /установлено/i);
  assert.doesNotMatch(snap.notice ?? '', /удалено|площадки|стандартная/i);
  assert.equal(gameCoverMutationSucceeded(snap), false);

  // Definite remove (hasCover=false) still succeeds and closes-worthy.
  const cleared: GameCoverPort = {
    read: async () => ({ version: 2, hasCover: true, cover: { uploadedUrl: gameUrl } }),
    mutate: async () => ({ version: 3, hasCover: false, cover: { uploadedUrl: venueUrl } }),
  };
  const gone = new GameCoverCoordinator(cleared, () => 'rm-ok', { accessToken: () => 'tok' });
  gone.setActor(actor);
  await gone.load('game-rm-ok');
  await gone.remove();
  assert.equal(gone.getSnapshot().access?.hasCover, false);
  assert.equal(gone.getSnapshot().notice, 'Своё фото удалено. Используется текущая обложка площадки или стандартная.');
  assert.equal(gameCoverMutationSucceeded(gone.getSnapshot()), true);
});
