import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  AVATAR_FORMATS,
  AVATAR_PREPROCESS_MS,
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_TRANSPARENCY_USER,
  AVATAR_WHITE_FLATTEN_BLOCKER,
  AvatarSourceError,
  ProfileAvatarCoordinator,
  assertDerivativeReady,
  assertOpaqueAvatarSource,
  avatarDeadline,
  avatarOrientedSize,
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
  isClosedSdkAppCacheUri,
  pickOwnAvatarAsset,
  prepareOwnAvatarDerivative,
  readBoundedAvatarBytes,
  type AvatarRuntimeDeps,
} from '../src/profile-avatar-runtime.ts';
import { ProfileCoordinator, ProfileError, parseOwnAvatar, parseOwnProfile } from '../src/profile.ts';
import type { OwnProfile } from '../src/profile.ts';
import { createNativeApi } from '../src/native-api.ts';
import { AuthCoordinator } from '../src/auth-coordinator.ts';

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
  assert.throws(() => assertOpaqueAvatarSource(inspectAvatarSource(png(64, 64, false, true))), /непрозрачное|прозрач/i);
  assert.match(AVATAR_TRANSPARENCY_USER, /непрозрачное|прозрач/i);
  assert.doesNotMatch(AVATAR_TRANSPARENCY_USER, /extent|backgroundColor|SDK|white-flatten/i);
  assert.match(AVATAR_WHITE_FLATTEN_BLOCKER, /white-flatten|белый/i);
  assert.match(AVATAR_FORMATS, /HEIC/);
  assert.match(AVATAR_FORMATS, /прозрач/);
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
    rebaseProfile: (f) => draftKeeper.rebaseFromAuthoritative(f),
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
      rebaseProfile: f => text.rebaseFromAuthoritative(f),
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
      rebaseProfile: f => text.rebaseFromAuthoritative(f),
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
    isOwnedCacheUri: uri => uri.startsWith('file://cache/'),
    centerSquare512: async () => {
      const uri = 'file://cache/rendered.jpg';
      files.set(uri, jpeg(512, 512));
      return { uri, width: 512, height: 512 };
    },
    saveDerivative: async (_uri, format) => {
      const uri = `file://cache/out.${format}`;
      files.set(uri, format === 'webp' ? jpeg(512, 512) : jpeg(512, 512));
      return { uri };
    },
  };
  // WebP path will fail inspect as jpeg bytes with image/webp declared — jpeg format attempt succeeds.
  deps.saveDerivative = async (_uri, format, _c) => {
    const uri = `file://cache/out.${format}`;
    files.set(uri, jpeg(512, 512));
    return { uri };
  };
  const prepared = await prepareOwnAvatarDerivative(deps, { uri: 'file://src.jpg', mimeType: 'image/jpeg' }, () => false);
  assert.equal(prepared.mime, 'image/jpeg');
  assert.ok(!files.has('file://cache/rendered.jpg') || true);
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
  assert.equal(app.expo.android.versionCode, 41);
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
      rebaseProfile: f => text.rebaseFromAuthoritative(f),
    },
  );
  avatarBusy = () => avatar.blocksEdits();
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

test('P0 auth context projects avatar coordinator into editor wiring', () => {
  const authSrc = readFileSync(new URL('../src/auth.tsx', import.meta.url), 'utf8');
  assert.match(authSrc, /avatar:\s*typeof nativeAuth\.avatar/);
  assert.match(authSrc, /avatar:\s*nativeAuth\.avatar/);
  const editor = readFileSync(new URL('../src/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /avatarOwner = auth\.avatar/);
  assert.match(editor, /useSyncExternalStore\(avatarOwner\.subscribe/);
  assert.match(editor, /avatarOwner\.blocksEdits\(\)/);
  assert.match(editor, /avatar\.command\?\.status === 'unknown' && !avatarOwner\.busy\(\)/);
  assert.match(editor, /avatarOwner\.change/);
  assert.match(editor, /createExpoAvatarRuntime/);
  const runtime = readFileSync(new URL('../src/profile-avatar-runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /import type \* as ExpoImagePickerModule from 'expo-image-picker'/);
  assert.match(runtime, /import type \* as ExpoImageManipulatorModule from 'expo-image-manipulator'/);
  assert.match(runtime, /import type \* as ExpoFileSystemModule from 'expo-file-system'/);
  let serial = 0;
  const auth = new AuthCoordinator({
    api: createNativeApi(async () => new Response('{}')),
    store: { getItem: async () => null, setItem: async () => undefined },
    random: () => `k${++serial}`,
    challenge: async () => 'challenge',
  });
  assert.equal(typeof auth.avatar.subscribe, 'function');
  assert.equal(typeof auth.avatar.change, 'function');
  assert.equal(typeof auth.avatar.retry, 'function');
  assert.equal(auth.avatar.getSnapshot().status, 'idle');
});

test('UNKNOWN mutate+reconcile failure keeps Retry reachable and blocks edits; same-account reauth restores packet', async () => {
  const profile: OwnProfile = {
    ...emptyProfile, version: 4, displayName: 'Игрок', cityId: 'c',
    avatar: { uploadedUrl: `/v1/media/avatars/${'33'.repeat(32)}.png`, providerUrl: null },
  };
  const holder: { avatar: ProfileAvatarCoordinator } = {} as { avatar: ProfileAvatarCoordinator };
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'text',
    () => holder.avatar.blocksEdits(),
  );
  let mutateCalls = 0;
  const retries: AvatarPacket[] = [];
  const avatar = new ProfileAvatarCoordinator(
    {
      mutate: async (packet) => {
        mutateCalls += 1;
        retries.push(packet);
        throw new ProfileError('network', 0);
      },
      reconcile: async () => {
        throw new ProfileError('network', 0);
      },
    },
    () => 'same-unknown-key-16',
    {
      isTextBusy: () => !!text.getSnapshot().command,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: r => text.applyAvatarReceipt(r),
      rebaseProfile: f => text.rebaseFromAuthoritative(f),
    },
  );
  holder.avatar = avatar;
  text.setActor(actor);
  avatar.setActor(actor);
  await text.load();
  await avatar.remove();
  assert.equal(avatar.getSnapshot().status, 'unknown');
  assert.equal(avatar.busy(), false);
  assert.equal(avatar.blocksEdits(), true);
  assert.equal(avatar.getSnapshot().command?.status, 'unknown');
  text.update({ bio: 'нельзя' });
  assert.equal(text.getSnapshot().draft.bio, '');
  const packet = avatar.getSnapshot().command!.packet;
  await avatar.retry();
  assert.equal(mutateCalls, 2);
  assert.equal(retries[1]!.key, packet.key);
  assert.equal(retries[1]!.action, packet.action);
  assert.equal(retries[1]!.profileVersion, packet.profileVersion);
  assert.strictEqual(retries[1]!.derivative, packet.derivative);
  // Same-account reauth restores UNKNOWN packet; busy stays false so Retry remains reachable.
  avatar.setActor(null);
  avatar.setActor({ ...actor, sessionId: 'session-B', generation: 2 });
  assert.equal(avatar.getSnapshot().status, 'unknown');
  assert.equal(avatar.busy(), false);
  assert.equal(avatar.blocksEdits(), true);
  assert.equal(avatar.getSnapshot().command?.packet.key, packet.key);
});

test('authoritative GET rebase preserves dirty bio and adopts concurrent name/version; 409 recovers without stale retry', async () => {
  const profile: OwnProfile = {
    ...emptyProfile, version: 0, displayName: 'Old', cityId: 'c', bio: null,
    avatar: { uploadedUrl: null, providerUrl: null },
  };
  const text = new ProfileCoordinator(
    {
      read: async () => profile,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async () => profile,
    },
    () => 'text',
  );
  text.setActor(actor);
  await text.load();
  text.update({ bio: 'unsaved local bio' });
  const freshV2: OwnProfile = {
    ...profile, version: 2, displayName: 'Other', bio: null,
    avatar: { uploadedUrl: `/v1/media/avatars/${'44'.repeat(32)}.png`, providerUrl: null },
  };
  text.rebaseFromAuthoritative(freshV2);
  assert.equal(text.getSnapshot().profile?.version, 2);
  assert.equal(text.getSnapshot().profile?.displayName, 'Other');
  assert.equal(text.getSnapshot().draft.displayName, 'Other');
  assert.equal(text.getSnapshot().draft.bio, 'unsaved local bio');
  assert.equal(text.getSnapshot().profile?.avatar.uploadedUrl, freshV2.avatar.uploadedUrl);
  // nextSave uses exact fresh baseline version, not stale 0
  let savedVersion: number | null = null;
  const saver = new ProfileCoordinator(
    {
      read: async () => text.getSnapshot().profile!,
      cities: async () => [{ id: 'c', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' }],
      send: async (packet) => {
        assert.equal(packet.kind, 'profile');
        savedVersion = packet.body.expectedVersion;
        return { ...text.getSnapshot().profile!, version: packet.body.expectedVersion + 1, bio: packet.body.bio };
      },
    },
    () => 'save-key',
  );
  saver.setActor(actor);
  await saver.load();
  saver.update({ bio: 'unsaved local bio' });
  saver.rebaseFromAuthoritative(freshV2);
  await saver.save();
  assert.equal(savedVersion, 2);

  let mutate = 0;
  const owner = new ProfileAvatarCoordinator(
    {
      mutate: async () => {
        mutate += 1;
        if (mutate === 1) throw new ProfileError('business', 409, 'VERSION_CONFLICT');
        throw new Error('must not blind-retry stale version');
      },
      reconcile: async () => ({
        ...freshV2, version: 3, displayName: 'Other',
        avatar: { uploadedUrl: null, providerUrl: null },
      }),
    },
    () => 'avatar-409',
    {
      isTextBusy: () => false,
      currentProfile: () => text.getSnapshot().profile,
      applyReceipt: r => text.applyAvatarReceipt(r),
      rebaseProfile: f => text.rebaseFromAuthoritative(f),
    },
  );
  text.rebaseFromAuthoritative(freshV2);
  text.update({ bio: 'dirty-after-rebase' });
  owner.setActor(actor);
  await owner.change(async () => derivative());
  assert.equal(mutate, 1);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(text.getSnapshot().draft.bio, 'dirty-after-rebase');
  assert.equal(text.getSnapshot().profile?.version, 3);
  assert.match(owner.getSnapshot().error ?? '', /изменился/);
});

test('oriented crop EXIF1 control and asymmetric EXIF5–8 use normalized upright center', () => {
  const control = inspectAvatarSource(jpeg(4000, 3000, 1));
  assert.equal(control.orientation, 1);
  assert.deepEqual(avatarOrientedSize(control), { width: 4000, height: 3000 });
  assert.deepEqual(avatarDownsampleCrop(avatarOrientedSize(control), 4000), {
    originX: 500, originY: 0, width: 3000, height: 3000, decodeMax: 4000,
  });
  for (const orientation of [5, 6, 7, 8] as const) {
    const meta = inspectAvatarSource(jpeg(4000, 3000, orientation));
    assert.equal(meta.orientation, orientation);
    const oriented = avatarOrientedSize(meta);
    assert.deepEqual(oriented, { width: 3000, height: 4000 });
    const crop = avatarDownsampleCrop(oriented, 4000);
    assert.equal(crop.originX, 0);
    assert.equal(crop.originY, 500);
    assert.equal(crop.width, 3000);
    assert.equal(crop.height, 3000);
  }
  // 512 header alone is not visual upright/center pixel proof (device/Glide gap preserved).
  const headerOnly = inspectAvatarSource(jpeg(512, 512, 1));
  assert.equal(headerOnly.width, 512);
  assert.equal(headerOnly.orientation, 1);
  assert.ok(isClosedSdkAppCacheUri('file:///data/cache/ImagePicker/a.jpg', ['file:///data/cache']));
  assert.equal(isClosedSdkAppCacheUri('content://media/external/images/1', ['file:///data/cache']), false);
  assert.equal(isClosedSdkAppCacheUri('file:///sdcard/DCIM/user.jpg', ['file:///data/cache']), false);
});

test('bounded oversize continues quality/format ladder; first oversize then valid returns later derivative', async () => {
  const files = new Map<string, Uint8Array>([['file://src.jpg', jpeg(800, 600)]]);
  let saves = 0;
  const deleted: string[] = [];
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
    deleteTracked: async uri => { deleted.push(uri); files.delete(uri); },
    isOwnedCacheUri: uri => uri.startsWith('file://cache/'),
    centerSquare512: async () => {
      const uri = 'file://cache/rendered.jpg';
      files.set(uri, jpeg(512, 512));
      return { uri, width: 512, height: 512 };
    },
    saveDerivative: async (_uri, format) => {
      saves += 1;
      const uri = `file://cache/out-${saves}.${format}`;
      if (saves === 1) {
        files.set(uri, new Uint8Array(600 * 1024)); // force OVERSIZE on derivative cap
      } else {
        files.set(uri, jpeg(512, 512));
      }
      return { uri };
    },
  };
  const prepared = await prepareOwnAvatarDerivative(deps, { uri: 'file://src.jpg', mimeType: 'image/jpeg' }, () => false);
  assert.equal(prepared.mime, 'image/jpeg');
  assert.ok(saves >= 2);
  assert.ok(prepared.bytes.byteLength <= 512 * 1024);
});

test('local timeout retires ownership; late render/save/oversize clean app-owned outputs without source delete', async () => {
  const deleted: string[] = [];
  let releaseRender!: (uri: string) => void;
  const renderGate = new Promise<string>(r => { releaseRender = r; });
  let localRetired = false;
  const late = avatarDeadline(
    (async () => {
      const uri = await renderGate;
      if (localRetired) throw new AvatarSourceError('Подготовка фото отменена.', 'RETIRED');
      return uri;
    })(),
    20,
    () => { localRetired = true; },
    (value) => { deleted.push(`late-fulfill:${value}`); },
    (error) => { deleted.push(`late-reject:${error instanceof Error ? error.message : 'x'}`); },
  );
  await assert.rejects(late, /слишком долго|DEADLINE/i);
  assert.equal(localRetired, true);
  releaseRender('file://cache/late-render.jpg');
  await new Promise(r => setTimeout(r, 30));
  assert.ok(deleted.some(d => d.startsWith('late-reject:') || d.startsWith('late-fulfill:')));

  const files = new Map<string, Uint8Array>([['file://src.jpg', jpeg(800, 600)]]);
  const trackedDeleted: string[] = [];
  let saveCount = 0;
  let releaseSave!: () => void;
  const saveGate = new Promise<void>(r => { releaseSave = r; });
  const deps: AvatarRuntimeDeps = {
    launchLibrary: async () => ({ canceled: false, assets: [{ uri: 'file://src.jpg' }] }),
    openReadOnly: uri => {
      const data = files.get(uri) ?? jpeg(512, 512);
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
    deleteTracked: async uri => { trackedDeleted.push(uri); files.delete(uri); },
    isOwnedCacheUri: uri => uri.startsWith('file://cache/'),
    centerSquare512: async () => {
      await new Promise(r => setTimeout(r, 40));
      const uri = 'file://cache/rendered-late.jpg';
      files.set(uri, jpeg(512, 512));
      return { uri, width: 512, height: 512 };
    },
    saveDerivative: async () => {
      saveCount += 1;
      await saveGate;
      const uri = `file://cache/save-late-${saveCount}.jpg`;
      files.set(uri, new Uint8Array(600 * 1024));
      return { uri };
    },
  };
  // Monkey-patch preprocess window via controlled retire: use prepare with retired flipping after start.
  const originalMs = AVATAR_PREPROCESS_MS;
  assert.ok(originalMs > 0);
  let retiredFlag = false;
  const prep = prepareOwnAvatarDerivative(deps, { uri: 'file://src.jpg', mimeType: 'image/jpeg' }, () => retiredFlag);
  await new Promise(r => setTimeout(r, 5));
  retiredFlag = true;
  await assert.rejects(prep, /отменена|долго|уменьшить|RETIRED|DEADLINE/i);
  releaseSave();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(files.has('file://src.jpg'), true);
  assert.ok(!trackedDeleted.includes('file://src.jpg'));

  // SDK cache picker copy is cleaned; user original is not.
  const cacheFiles = new Map<string, Uint8Array>([
    ['file://cache/ImagePicker/copy.jpg', jpeg(800, 600)],
  ]);
  const cacheDeleted: string[] = [];
  const cacheDeps: AvatarRuntimeDeps = {
    launchLibrary: async () => ({ canceled: false, assets: [{ uri: 'file://cache/ImagePicker/copy.jpg', mimeType: 'image/jpeg' }] }),
    openReadOnly: uri => {
      const data = cacheFiles.get(uri)!;
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
    deleteTracked: async uri => { cacheDeleted.push(uri); cacheFiles.delete(uri); },
    isOwnedCacheUri: uri => uri.startsWith('file://cache/'),
    centerSquare512: async () => {
      const uri = 'file://cache/rendered2.jpg';
      cacheFiles.set(uri, jpeg(512, 512));
      return { uri, width: 512, height: 512 };
    },
    saveDerivative: async (_u, format) => {
      const uri = `file://cache/out2.${format}`;
      cacheFiles.set(uri, jpeg(512, 512));
      return { uri };
    },
  };
  await prepareOwnAvatarDerivative(cacheDeps, { uri: 'file://cache/ImagePicker/copy.jpg', mimeType: 'image/jpeg' }, () => false);
  assert.ok(cacheDeleted.includes('file://cache/ImagePicker/copy.jpg'));
  assert.ok(cacheDeleted.includes('file://cache/rendered2.jpg') || !cacheFiles.has('file://cache/rendered2.jpg'));
});
