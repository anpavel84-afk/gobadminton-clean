import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { ProfileCoordinator, ProfileError, parseCoverReceipt } from '../src/profile.ts';
import type { OwnProfile } from '../src/profile.ts';
import {
  ProfileCoverCoordinator,
  freezeCoverPacket,
  type CoverPacket,
  type CoverPort,
} from '../src/profile-cover.ts';
import { cloneDerivativeBytes, type AvatarDerivative } from '../src/profile-avatar.ts';
import { coverCrop } from '../src/profile-avatar-runtime.ts';

const emptyProfile: OwnProfile = {
  publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null, bio: null,
  directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true,
  trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
};
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const hex64 = 'ab'.repeat(32);
const validCover = `/v1/media/covers/${hex64}.png`;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function jpegDerivative(): AvatarDerivative {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  return Object.freeze({ mime: 'image/jpeg' as const, bytes: cloneDerivativeBytes(bytes) });
}

test('cover port wire shape: PUT binary, DELETE JSON CAS, headers, error mapping', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = createNativeApi(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith('/me/cover') && init?.method === 'GET') {
      return new Response(JSON.stringify({ version: 2, cover: { uploadedUrl: validCover } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (init?.method === 'DELETE') {
      return new Response(JSON.stringify({ version: 3, cover: { uploadedUrl: null } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ version: 1, cover: { uploadedUrl: validCover } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  const replace = freezeCoverPacket({
    actor, key: 'cover-key-replace-01', action: 'replace', profileVersion: 0, derivative: jpegDerivative(),
  });
  const put = await api.mutateOwnCover('access-token', replace);
  assert.equal(put.cover.uploadedUrl, validCover);
  assert.equal(calls[0]!.url, 'https://dev.gobadminton.ru/v1/me/cover');
  assert.equal(calls[0]!.init.method, 'PUT');
  assert.equal(calls[0]!.init.credentials, 'omit');
  assert.equal(calls[0]!.init.redirect, 'error');
  const putHeaders = calls[0]!.init.headers as Record<string, string>;
  assert.equal(putHeaders.Authorization, 'Bearer access-token');
  assert.equal(putHeaders['Idempotency-Key'], 'cover-key-replace-01');
  assert.equal(putHeaders['X-Profile-Version'], '0');
  assert.equal(putHeaders['Content-Type'], 'image/jpeg');
  assert.ok(calls[0]!.init.body instanceof Uint8Array);
  const remove = freezeCoverPacket({
    actor, key: 'cover-key-delete-01', action: 'remove', profileVersion: 1, derivative: null,
  });
  await api.mutateOwnCover('access-token', remove);
  assert.equal(calls[1]!.init.method, 'DELETE');
  const delHeaders = calls[1]!.init.headers as Record<string, string>;
  assert.equal(delHeaders['Content-Type'], 'application/json');
  assert.equal(calls[1]!.init.body, JSON.stringify({ expectedVersion: 1 }));
  const own = await api.ownCover('access-token');
  assert.equal(own.version, 2);
  assert.equal(own.cover.uploadedUrl, validCover);
  const failing = createNativeApi(async () => new Response(JSON.stringify({ code: 'RATE_LIMITED' }), { status: 429 }));
  await assert.rejects(
    () => failing.mutateOwnCover('t', replace),
    (e: unknown) => e instanceof ProfileError && e.kind === 'business' && e.status === 429,
  );
});

test('cover receipt parse: valid path kept, invalid path nulled', () => {
  assert.deepEqual(parseCoverReceipt({ version: 1, cover: { uploadedUrl: validCover } }), {
    version: 1, cover: { uploadedUrl: validCover },
  });
  assert.deepEqual(parseCoverReceipt({ version: 1, cover: { uploadedUrl: '/v1/media/avatars/' + hex64 + '.png' } }), {
    version: 1, cover: { uploadedUrl: null },
  });
  assert.throws(() => parseCoverReceipt({ version: -1, cover: { uploadedUrl: null } }), ProfileError);
  assert.throws(() => parseCoverReceipt(null), ProfileError);
});

test('coordinator happy path; stale receipt ignored; uncertain → reconcile only; applyCoverReceipt keeps draft', async () => {
  let version = 3;
  const profile: OwnProfile = {
    ...emptyProfile, version, displayName: 'Игрок', cityId: 'c',
    avatar: { uploadedUrl: null, providerUrl: null }, cover: { uploadedUrl: null },
  };
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'text-key',
  );
  text.setActor(actor);
  await text.load();
  text.update({ displayName: 'Черновик', bio: 'не затирать' });
  const sent: CoverPacket[] = [];
  let reconcileCalls = 0;
  const port: CoverPort = {
    mutate: async (packet) => {
      sent.push(packet);
      version += 1;
      return { version, cover: { uploadedUrl: validCover } };
    },
    reconcile: async () => {
      reconcileCalls += 1;
      return { version, cover: { uploadedUrl: validCover } };
    },
  };
  const owner = new ProfileCoverCoordinator(port, () => `cover-key-${sent.length + 1}`, {
    isTextBusy: () => !!text.getSnapshot().command,
    currentProfile: () => text.getSnapshot().profile,
    applyReceipt: r => text.applyCoverReceipt(r),
    accessToken: () => 'tok',
  });
  owner.setActor(actor);
  await owner.change(async () => jpegDerivative());
  assert.equal(sent.length, 1);
  assert.equal(text.getSnapshot().draft.displayName, 'Черновик');
  assert.equal(text.getSnapshot().draft.bio, 'не затирать');
  assert.equal(text.getSnapshot().profile?.version, version);
  assert.equal(text.getSnapshot().profile?.cover?.uploadedUrl, validCover);
  assert.equal(owner.getSnapshot().notice, 'Обложка сохранена.');
  // Stale receipt ignored.
  text.applyCoverReceipt({ version: 1, cover: { uploadedUrl: null } });
  assert.equal(text.getSnapshot().profile?.version, version);
  assert.equal(text.getSnapshot().profile?.cover?.uploadedUrl, validCover);
  // Uncertain → reconcile only (no new mutate).
  const failing: CoverPort = {
    mutate: async () => { throw new ProfileError('network', 0); },
    reconcile: async () => {
      reconcileCalls += 1;
      version += 1;
      return { version, cover: { uploadedUrl: null } };
    },
  };
  const uncertain = new ProfileCoverCoordinator(failing, () => 'uncertain-key', {
    isTextBusy: () => false,
    currentProfile: () => text.getSnapshot().profile,
    applyReceipt: r => text.applyCoverReceipt(r),
    accessToken: () => 'tok',
  });
  uncertain.setActor(actor);
  const before = sent.length;
  await uncertain.remove();
  assert.equal(sent.length, before);
  assert.ok(reconcileCalls >= 1);
  assert.equal(text.getSnapshot().draft.displayName, 'Черновик');
});

test('coverCrop math: centre and edges for exact 3:1', () => {
  assert.deepEqual(coverCrop(1200, 400, 0.5, 0.5), { originX: 0, originY: 0, width: 1200, height: 400 });
  assert.deepEqual(coverCrop(900, 900, 0.5, 0.5), { originX: 0, originY: 300, width: 900, height: 300 });
  assert.deepEqual(coverCrop(900, 900, 0, 0), { originX: 0, originY: 0, width: 900, height: 300 });
  assert.deepEqual(coverCrop(900, 900, 1, 1), { originX: 0, originY: 600, width: 900, height: 300 });
  assert.deepEqual(coverCrop(1800, 400, 0, 0.5), { originX: 0, originY: 0, width: 1200, height: 400 });
  assert.deepEqual(coverCrop(1800, 400, 1, 0.5), { originX: 600, originY: 0, width: 1200, height: 400 });
});

test('coverImageSource: null for foreign/unauthenticated; token never in uri', () => {
  const text = new ProfileCoordinator(
    { read: async () => emptyProfile, cities: async () => [], send: async () => emptyProfile },
    () => 'k',
  );
  const owner = new ProfileCoverCoordinator(
    { mutate: async () => ({ version: 1, cover: { uploadedUrl: null } }), reconcile: async () => ({ version: 0, cover: { uploadedUrl: null } }) },
    () => 'k',
    {
      isTextBusy: () => false,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: () => undefined,
      accessToken: () => 'secret-token',
    },
  );
  assert.equal(owner.coverImageSource(validCover), null);
  owner.setActor(actor);
  text.setActor(actor);
  const src = owner.coverImageSource(validCover);
  assert.ok(src);
  assert.equal(src.uri, `https://dev.gobadminton.ru${validCover}`);
  assert.equal(src.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(src.uri, /secret-token|Bearer/);
  assert.equal(owner.coverImageSource('/v1/media/avatars/' + hex64 + '.png'), null);
  assert.equal(owner.coverImageSource('https://evil.example/x.png'), null);
  owner.setActor(null);
  assert.equal(owner.coverImageSource(validCover), null);
});

test('cover-editor.tsx contains all web copy strings', () => {
  const source = read('../src/components/cover-editor.tsx');
  for (const phrase of [
    'Изменить обложку',
    'Обложка профиля',
    'JPEG, PNG или WebP · до 10 МБ и 50 Мп, без анимации. На сервер отправляется только выбранный фрагмент. Обложка следует видимости профиля.',
    'Выбрать изображение',
    'По горизонтали',
    'По вертикали',
    'Готовим фрагмент…',
    'Фрагмент в шапке профиля при текущем размере экрана',
    'Сохраняем обложку…',
    'Проверяем обложку…',
    'Слишком много попыток. Попробуйте позже.',
    'Обложка не прошла проверку. Выберите другое фото.',
    'Сохранение не подтверждено. Обновите данные перед повтором.',
    'Обновить данные',
    'Сохранить фрагмент',
    'Удалить обложку',
    'Отмена',
    'Обложка сохранена.',
    'Обложка удалена. Используется стандартное оформление.',
  ]) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
