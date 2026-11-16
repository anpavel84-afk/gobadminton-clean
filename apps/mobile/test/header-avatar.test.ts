import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { headerAvatarPresentation } from '../src/header-avatar.ts';
import type { OwnProfile } from '../src/profile.ts';
import { API_ORIGIN } from '../src/public-api.ts';

const hex = 'a'.repeat(64);
const uploadedPath = `/v1/media/avatars/${hex}.png`;

function profile(partial: Partial<OwnProfile> & { avatar?: OwnProfile['avatar'] }): OwnProfile {
  return {
    publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null, bio: null,
    directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
    radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true,
    trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
    ...partial,
  };
}

test('uploaded avatar -> API_ORIGIN-prefixed uri', () => {
  const result = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Игрок',
    profile: profile({ displayName: 'Павел', avatar: { uploadedUrl: uploadedPath, providerUrl: null } }),
  });
  assert.equal(result.uri, `${API_ORIGIN}${uploadedPath}`);
  assert.equal(result.initials, 'П');
});

test('null uploadedUrl -> uri null and initials from profile displayName', () => {
  const result = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Me Name',
    profile: profile({ displayName: 'Профиль Имя', avatar: { uploadedUrl: null, providerUrl: null } }),
  });
  assert.equal(result.uri, null);
  assert.equal(result.initials, 'ПИ');
});

test('profile null (not loaded) -> initials from me.displayName', () => {
  const result = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Иван Петров',
    profile: null,
  });
  assert.equal(result.uri, null);
  assert.equal(result.initials, 'ИП');
});

test('unauthenticated -> uri null and ?', () => {
  const result = headerAvatarPresentation({
    authenticated: false,
    meDisplayName: 'Иван',
    profile: profile({ displayName: 'Павел', avatar: { uploadedUrl: uploadedPath, providerUrl: null } }),
  });
  assert.equal(result.uri, null);
  assert.equal(result.initials, '?');
});

test('invalid/foreign URL and providerUrl -> uri null', () => {
  for (const uploadedUrl of [
    'https://evil.example/a.png',
    '../v1/media/avatars/' + hex + '.png',
    'https://avatars.yandex.net/account/photo',
    'https://sun9.userapi.com/photo',
  ]) {
    const result = headerAvatarPresentation({
      authenticated: true,
      meDisplayName: 'Игрок',
      profile: profile({ displayName: 'Игрок', avatar: { uploadedUrl, providerUrl: null } }),
    });
    assert.equal(result.uri, null, uploadedUrl);
  }
});

test('failedUri equal -> null', () => {
  const uri = `${API_ORIGIN}${uploadedPath}`;
  const result = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Игрок',
    profile: profile({ displayName: 'Игрок', avatar: { uploadedUrl: uploadedPath, providerUrl: null } }),
    failedUri: uri,
  });
  assert.equal(result.uri, null);
  assert.equal(result.initials, 'И');
});

test('remove after upload (two inputs) -> back to initials', () => {
  const withPhoto = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Игрок',
    profile: profile({ displayName: 'Иван', avatar: { uploadedUrl: uploadedPath, providerUrl: null } }),
  });
  assert.equal(withPhoto.uri, `${API_ORIGIN}${uploadedPath}`);

  const removed = headerAvatarPresentation({
    authenticated: true,
    meDisplayName: 'Игрок',
    profile: profile({ displayName: 'Иван', avatar: { uploadedUrl: null, providerUrl: null } }),
  });
  assert.equal(removed.uri, null);
  assert.equal(removed.initials, 'И');
});

test('Header source wires headerAvatarPresentation and auth.profile.subscribe', () => {
  const source = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  assert.match(source, /headerAvatarPresentation/);
  assert.match(source, /auth\.profile\.subscribe/);
});
