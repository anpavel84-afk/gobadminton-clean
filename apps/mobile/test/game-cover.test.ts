import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { ProfileError } from '../src/profile.ts';
import {
  GameCoverCoordinator,
  freezeGameCoverPacket,
  gameCoverMediaPath,
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

function jpegDerivative(): AvatarDerivative {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  return Object.freeze({ mime: 'image/jpeg' as const, bytes: cloneDerivativeBytes(bytes) });
}

test('game cover port wire: PUT binary, DELETE JSON CAS, X-Game-Version, bearer-only', async () => {
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
});

test('receipt parse keeps hasCover independent of venue fallback URL', () => {
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

test('coordinator: save/remove/hasCover fence; uncertain blocks writes; late actor ignore; no auto-publish', async () => {
  let version = 4;
  let hasCover = false;
  const sent: GameCoverPacket[] = [];
  let reads = 0;
  const receipts: Array<{ gameId: string; version: number }> = [];
  const port: GameCoverPort = {
    read: async () => {
      reads += 1;
      return { version, hasCover, cover: { uploadedUrl: hasCover ? gameUrl : venueUrl } };
    },
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
  // Remove disabled when hasCover=false even with venue fallback URL present.
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

  // Unknown → new write blocked until explicit reconcile; no auto-publish.
  let failRead = false;
  const flaky: GameCoverPort = {
    read: async () => {
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
  failRead = true;
  await uncertain.change(async () => jpegDerivative());
  assert.equal(uncertain.getSnapshot().status, 'unknown');
  assert.equal(uncertain.blocksManagedWrites('game-2'), true);
  assert.equal(uncertain.blocksManagedWrites('other'), false);
  await uncertain.change(async () => jpegDerivative());
  assert.equal(uncertain.getSnapshot().command?.packet.key, 'u-key');
  failRead = false;
  await uncertain.reconcile();
  assert.equal(uncertain.getSnapshot().uncertain, false);
  assert.equal(uncertain.getSnapshot().status, 'ready');
  assert.equal(uncertain.getSnapshot().notice, 'Данные обновлены. Можно повторить сохранение.');

  // Late actor change retires in-flight paint.
  let resolveMutate!: (v: ReturnType<typeof parseGameCoverReceipt>) => void;
  const delayed: GameCoverPort = {
    read: async () => ({ version: 1, hasCover: false, cover: { uploadedUrl: null } }),
    mutate: () => new Promise(resolve => { resolveMutate = resolve; }),
  };
  const late = new GameCoverCoordinator(delayed, () => 'late-key', { accessToken: () => 'tok' });
  late.setActor(actor);
  await late.load('game-3');
  const pending = late.change(async () => jpegDerivative());
  late.setActor({ actorId: 'B', sessionId: 'session-B', generation: 1 });
  resolveMutate!({ version: 99, hasCover: true, cover: { uploadedUrl: gameUrl } });
  await pending;
  assert.notEqual(late.getSnapshot().access?.version, 99);
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

test('#522 APK51 managed game photo wiring, 512KiB budget, counter pin', () => {
  assert.equal(GAME_COVER_DERIVATIVE_MAX_BYTES, 512 * 1024);
  assert.ok(COVER_DERIVATIVE_MAX_BYTES > GAME_COVER_DERIVATIVE_MAX_BYTES);
  const runtime = read('../src/profile-avatar-runtime.ts');
  assert.match(runtime, /prepareGameCoverDerivative/);
  assert.match(runtime, /GAME_COVER_DERIVATIVE_MAX_BYTES/);
  const management = read('../src/components/game-management.tsx');
  assert.match(management, /GameCoverEditor/);
  assert.match(management, /blocksManagedWrites/);
  const editor = read('../src/components/game-cover-editor.tsx');
  assert.match(editor, /prepareGameCoverDerivative/);
  assert.match(editor, /Подтвердить выбор фото/);
  assert.match(editor, /hasCover/);
  assert.doesNotMatch(editor, /auto.?publish|publishDraft/i);
  const api = read('../src/native-api.ts');
  assert.match(api, /mutateGameCover/);
  assert.match(api, /X-Game-Version/);
  assert.equal(JSON.parse(read('../app.json')).expo.android.versionCode, 51);
});
