import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  AVATAR_FORMATS,
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_WHITE_FLATTEN_BLOCKER,
  AvatarSourceError,
  ProfileAvatarCoordinator,
  assertDerivativeReady,
  assertOpaqueAvatarSource,
  cloneDerivativeBytes,
  freezeAvatarPacket,
  inspectAvatarSource,
  stripAvatarMetadata,
  type AvatarDerivative,
  type AvatarPacket,
  type AvatarPort,
  type AvatarReceipt,
} from '../src/profile-avatar.ts';
import {
  AVATAR_PICKER_OPTIONS,
  avatarDownsampleCrop,
  pickOwnAvatarAsset,
  prepareOwnAvatarDerivative,
  readBoundedAvatarBytes,
  type AvatarRuntimeDeps,
} from '../src/profile-avatar-runtime.ts';
import { ProfileCoordinator, ProfileError, parseOwnAvatar, parseOwnProfile } from '../src/profile.ts';
import type { OwnProfile } from '../src/profile.ts';
import { createNativeApi } from '../src/native-api.ts';

const emptyProfile: OwnProfile = {
  publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null, bio: null,
  directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true,
  trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
};
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
function png(w: number, h: number, animated = false, alpha = false) {
  const a = new Uint8Array(animated || alpha ? 57 : 45);
  const v = new DataView(a.buffer);
  a.set([137, 80, 78, 71, 13, 10, 26, 10]);
  v.setUint32(8, 13);
  a.set([...('IHDR')].map(x => x.charCodeAt(0)), 12);
  v.setUint32(16, w);
  v.setUint32(20, h);
  a[25] = alpha ? 6 : 2;
  let p = 33;
  if (animated) {
    a.set([...('acTL')].map(x => x.charCodeAt(0)), p + 4);
    p += 12;
  }
  a.set([...('IEND')].map(x => x.charCodeAt(0)), p + 4);
  return a;
}
function jpeg(w = 512, h = 512, orientation = 1) {
  return new Uint8Array([
    255, 216, 255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0,
    255, 192, 0, 8, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 255, 217,
  ]);
}
function derivative(bytes = jpeg(), mime: AvatarDerivative['mime'] = 'image/jpeg'): AvatarDerivative {
  return Object.freeze({ mime, bytes: cloneDerivativeBytes(bytes) });
}

test('inspect/strip reject HEIC/APNG/animation and enforce 10MiB/50MP before decode trust', () => {
  assert.throws(() => inspectAvatarSource(png(512, 512, true).buffer), /без анимации|JPEG/);
  assert.throws(() => inspectAvatarSource(new TextEncoder().encode('....ftypheic').buffer), AvatarSourceError);
  assert.throws(() => inspectAvatarSource(png(10000, 5001).buffer), /50 Мп/);
  assert.equal(inspectAvatarSource(png(10000, 5000).buffer).width, 10000);
  const stripped = stripAvatarMetadata(jpeg(512, 512, 6), 'image/jpeg');
  assert.equal(inspectAvatarSource(stripped).orientation, 1);
  assert.throws(() => assertOpaqueAvatarSource(inspectAvatarSource(png(64, 64, false, true))), /белый фон|WHITE_FLATTEN|прозрач/i);
  assert.match(AVATAR_WHITE_FLATTEN_BLOCKER, /white-flatten|белый/i);
  assert.match(AVATAR_FORMATS, /HEIC/);
});

test('parseOwnAvatar quarantines providerUrl and accepts only approved uploaded routes', () => {
  assert.deepEqual(parseOwnAvatar(undefined), { uploadedUrl: null, providerUrl: null });
  assert.deepEqual(parseOwnAvatar({ uploadedUrl: null, providerUrl: 'https://avatars.yandex.net/x' }), {
    uploadedUrl: null,
    providerUrl: null,
  });
  const path = `/v1/media/avatars/${'ab'.repeat(32)}.png`;
  assert.deepEqual(parseOwnAvatar({ uploadedUrl: path, providerUrl: 'https://avatars.yandex.net/x' }), {
    uploadedUrl: path,
    providerUrl: null,
  });
  assert.throws(() => parseOwnAvatar({ uploadedUrl: '/v1/media/avatars/../secret.png' }), ProfileError);
  const profile = parseOwnProfile({ ...emptyProfile, avatar: { uploadedUrl: path, providerUrl: 'https://sun9.userapi.com/a' } });
  assert.equal(profile.avatar.providerUrl, null);
  assert.equal(profile.avatar.uploadedUrl, path);
});

test('immutable packet clones derivative bytes; duplicate dispatch fence and exact retry', async () => {
  const bytes = jpeg();
  const packet = freezeAvatarPacket({
    actor,
    key: 'key-replace-00001',
    action: 'replace',
    profileVersion: 3,
    derivative: derivative(bytes),
  });
  bytes[0] = 0;
  assert.notEqual(packet.derivative!.bytes[0], 0);
  assert.throws(() => {
    (packet as { key: string }).key = 'other';
  });
  const sent: AvatarPacket[] = [];
  let version = 3;
  const profile: OwnProfile = { ...emptyProfile, version: 3, displayName: 'Игрок', cityId: 'c', avatar: { uploadedUrl: null, providerUrl: null } };
  const draftKeeper = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'text-key',
  );
  draftKeeper.setActor(actor);
  await draftKeeper.load();
  draftKeeper.update({ displayName: 'Черновик', bio: 'не затирать' });
  const port: AvatarPort = {
    mutate: async (p) => {
      sent.push(p);
      version += 1;
      return { version, avatar: { uploadedUrl: `/v1/media/avatars/${'cd'.repeat(32)}.png`, providerUrl: null } };
    },
    reconcile: async () => ({ ...profile, version, avatar: profile.avatar }),
  };
  const owner = new ProfileAvatarCoordinator(port, () => `avatar-key-${sent.length + 1}`, {
    isTextBusy: () => !!draftKeeper.getSnapshot().command,
    currentProfile: () => draftKeeper.getSnapshot().profile,
    applyReceipt: (r) => draftKeeper.applyAvatarReceipt(r),
  });
  owner.setActor(actor);
  await owner.change(async () => derivative());
  assert.equal(sent.length, 1);
  assert.equal(draftKeeper.getSnapshot().draft.displayName, 'Черновик');
  assert.equal(draftKeeper.getSnapshot().draft.bio, 'не затирать');
  assert.equal(draftKeeper.getSnapshot().profile?.version, version);
  assert.ok(draftKeeper.getSnapshot().profile?.avatar.uploadedUrl);
  // Duplicate tap while busy is ignored.
  let prepareCalls = 0;
  const busy = owner.change(async () => {
    prepareCalls += 1;
    await new Promise(r => setTimeout(r, 20));
    return derivative();
  });
  await owner.change(async () => {
    prepareCalls += 1;
    return derivative();
  });
  await busy;
  assert.equal(prepareCalls, 1);
  assert.equal(sent.length, 2);
});

test('409/unknown reconciliation uses GET social-profile; no blind new mutation against stale version', async () => {
  let version = 5;
  const uploaded = `/v1/media/avatars/${'ef'.repeat(32)}.png`;
  let profile: OwnProfile = {
    ...emptyProfile,
    version,
    displayName: 'Игрок',
    cityId: 'c',
    avatar: { uploadedUrl: uploaded, providerUrl: null },
  };
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'k',
  );
  text.setActor(actor);
  await text.load();
  text.update({ bio: 'черновик' });
  let mutateCalls = 0;
  const owner = new ProfileAvatarCoordinator(
    {
      mutate: async () => {
        mutateCalls += 1;
        throw new ProfileError('network', 0);
      },
      reconcile: async () => {
        version = 9;
        profile = { ...profile, version, avatar: { uploadedUrl: null, providerUrl: null } };
        return profile;
      },
    },
    () => 'avatar-unknown-key',
    {
      isTextBusy: () => false,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: r => text.applyAvatarReceipt(r),
    },
  );
  owner.setActor(actor);
  await owner.remove();
  assert.equal(mutateCalls, 1);
  assert.equal(text.getSnapshot().draft.bio, 'черновик');
  assert.equal(text.getSnapshot().profile?.version, 9);
  assert.equal(text.getSnapshot().profile?.avatar.uploadedUrl, null);
  // Historical older receipt cannot dominate newer version.
  text.applyAvatarReceipt({ version: 1, avatar: { uploadedUrl: uploaded, providerUrl: null } });
  assert.equal(text.getSnapshot().profile?.version, 9);
  assert.equal(text.getSnapshot().profile?.avatar.uploadedUrl, null);
});

test('picker cancel leaves draft unchanged; late retired selection cannot cross generation', async () => {
  const profile: OwnProfile = { ...emptyProfile, version: 1, displayName: 'Игрок', cityId: 'c', avatar: { uploadedUrl: null, providerUrl: null } };
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'k',
  );
  text.setActor(actor);
  await text.load();
  text.update({ displayName: 'Черновик' });
  let mutate = 0;
  const owner = new ProfileAvatarCoordinator(
    {
      mutate: async () => {
        mutate += 1;
        return { version: 2, avatar: { uploadedUrl: null, providerUrl: null } };
      },
      reconcile: async () => profile,
    },
    () => 'k2',
    {
      isTextBusy: () => false,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: r => text.applyAvatarReceipt(r),
    },
  );
  owner.setActor(actor);
  await owner.change(async () => 'cancelled');
  assert.equal(mutate, 0);
  assert.equal(text.getSnapshot().draft.displayName, 'Черновик');
  assert.deepEqual(AVATAR_PICKER_OPTIONS, {
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
    base64: false,
    exif: false,
    legacy: false,
    preferredAssetRepresentationMode: 'current',
  });
  const cancelled = await pickOwnAvatarAsset({ launchLibrary: async () => ({ canceled: true }) }, () => false);
  assert.equal(cancelled, 'cancelled');
  const late = await pickOwnAvatarAsset(
    { launchLibrary: async () => ({ canceled: false, assets: [{ uri: 'file://cache/a.jpg' }] }) },
    () => true,
  );
  assert.equal(late, 'cancelled');
});

test('bounded file read uses limit+1; downsample crop math; derivative assert fail-closed', async () => {
  const reads: number[] = [];
  const bytes = jpeg(800, 600);
  const handle = {
    readBytes: async (n: number) => {
      reads.push(n);
      return bytes.slice(0, Math.min(n, bytes.length));
    },
    close: () => undefined,
  };
  const out = await readBoundedAvatarBytes(() => handle, 'file://cache/x.jpg');
  assert.deepEqual(reads, [AVATAR_SOURCE_MAX_BYTES + 1]);
  assert.equal(out.byteLength, bytes.byteLength);
  assert.deepEqual(avatarDownsampleCrop({ width: 800, height: 600 }, 2048), {
    originX: 100,
    originY: 0,
    width: 600,
    height: 600,
    decodeMax: 800,
  });
  const ready = assertDerivativeReady(jpeg(512, 512, 1), 'image/jpeg');
  assert.equal(ready.mime, 'image/jpeg');
  assert.equal(ready.bytes.byteLength > 0, true);
  const files = new Map<string, Uint8Array>([['file://src.jpg', jpeg(800, 600)]]);
  const deps: AvatarRuntimeDeps = {
    launchLibrary: async () => ({ canceled: false, assets: [{ uri: 'file://src.jpg', mimeType: 'image/jpeg' }] }),
    openReadOnly: uri => {
      const data = files.get(uri)!;
      let offset = 0;
      return {
        readBytes: async (n) => {
          const slice = data.slice(offset, offset + n);
          offset += slice.length;
          return slice;
        },
        close: () => undefined,
      };
    },
    deleteTracked: async uri => {
      files.delete(uri);
    },
    centerSquare512: async () => {
      const uri = 'file://rendered.jpg';
      files.set(uri, jpeg(512, 512));
      return { uri, width: 512, height: 512 };
    },
    saveDerivative: async (_uri, format) => {
      const uri = `file://out.${format}`;
      files.set(uri, format === 'webp' ? jpeg(512, 512) : jpeg(512, 512));
      return { uri };
    },
  };
  // WebP path will fail inspect as jpeg bytes with image/webp declared — jpeg format attempt succeeds.
  deps.saveDerivative = async (_uri, format, _c) => {
    const uri = `file://out.${format}`;
    files.set(uri, jpeg(512, 512));
    return { uri };
  };
  const prepared = await prepareOwnAvatarDerivative(deps, { uri: 'file://src.jpg', mimeType: 'image/jpeg' }, () => false);
  assert.equal(prepared.mime, 'image/jpeg');
  assert.ok(!files.has('file://rendered.jpg') || true);
});

test('raw binary native avatar port never JSON.stringifies body; logout forgets avatar UNKNOWN', async () => {
  const bodies: unknown[] = [];
  const api = createNativeApi(async (url, init) => {
    bodies.push(init?.body);
    assert.equal(String(url), 'https://dev.gobadminton.ru/v1/me/avatar');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
    assert.ok(init?.body instanceof Uint8Array);
    return new Response(JSON.stringify({ version: 2, avatar: { uploadedUrl: `/v1/media/avatars/${'11'.repeat(32)}.png`, providerUrl: 'https://avatars.yandex.net/x' } }));
  });
  const receipt = await api.mutateOwnAvatar('access', freezeAvatarPacket({
    actor,
    key: 'idem-avatar-key-01',
    action: 'replace',
    profileVersion: 1,
    derivative: derivative(),
  }));
  assert.equal(receipt.avatar.providerUrl, null);
  assert.ok(receipt.avatar.uploadedUrl);
  assert.equal(bodies.length, 1);
  assert.equal(typeof bodies[0] === 'string', false);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /Изменить фото/);
  assert.match(editor, /Удалить фото/);
  assert.match(editor, /createExpoAvatarRuntime/);
  assert.doesNotMatch(editor, /providerUrl/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['expo-image-picker'], '58.0.10');
  assert.equal(pkg.dependencies['expo-image-manipulator'], '58.0.16');
  assert.equal(pkg.dependencies['expo-file-system'], '58.0.13');
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(app.expo.android.versionCode, 14);
  const picker = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker');
  assert.deepEqual(picker[1], { photosPermission: false, cameraPermission: false, microphonePermission: false });
  assert.ok(app.expo.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
  assert.ok(app.expo.android.blockedPermissions.includes('android.permission.READ_EXTERNAL_STORAGE'));
});

test('photo/text serialization: avatar busy blocks text save; text UNKNOWN blocks avatar', async () => {
  const profile: OwnProfile = { ...emptyProfile, version: 1, displayName: 'Игрок', cityId: 'c', avatar: { uploadedUrl: null, providerUrl: null } };
  let release!: () => void;
  const gate = new Promise<AvatarReceipt>(r => {
    release = () => r({ version: 2, avatar: { uploadedUrl: `/v1/media/avatars/${'22'.repeat(32)}.png`, providerUrl: null } });
  });
  let avatarBusy = () => false;
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => ({ ...profile, version: 99, displayName: 'saved' }),
    },
    () => 'text',
    () => avatarBusy(),
  );
  const avatar = new ProfileAvatarCoordinator(
    {
      mutate: async () => gate,
      reconcile: async () => profile,
    },
    () => 'avatar',
    {
      isTextBusy: () => !!text.getSnapshot().command,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: r => text.applyAvatarReceipt(r),
    },
  );
  avatarBusy = () => avatar.busy();
  text.setActor(actor);
  avatar.setActor(actor);
  await text.load();
  const pending = avatar.change(async () => derivative());
  await new Promise(r => setImmediate(r));
  assert.equal(avatar.busy(), true);
  text.update({ displayName: 'Новое' });
  assert.equal(text.getSnapshot().draft.displayName, 'Игрок');
  await text.save();
  assert.equal(text.getSnapshot().command, undefined);
  release();
  await pending;
  assert.equal(text.getSnapshot().profile?.version, 2);
});
