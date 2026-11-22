import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('iOS config leaves the DEV Android block exactly unchanged', () => {
  assert.deepEqual(readJson('../app.json').expo.android, {
    package: 'ru.gobadminton.mobile.dev',
    permissions: [],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
    ],
    softwareKeyboardLayoutMode: 'resize',
    intentFilters: [{
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: 'dev.gobadminton.ru', path: '/auth/native/callback' }],
      category: ['BROWSABLE', 'DEFAULT'],
    }],
    versionCode: 22,
  });
});

test('iOS block enables the https auth callback domain and declares exempt encryption only', () => {
  assert.deepEqual(readJson('../app.json').expo.ios, {
    supportsTablet: false,
    bundleIdentifier: 'ru.gobadminton.mobile.dev',
    associatedDomains: ['applinks:dev.gobadminton.ru', 'webcredentials:dev.gobadminton.ru'],
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  });
});

test('eas.json has local versions, simulator/internal profiles, no credentials, submit or Android override', () => {
  const eas = readJson('../eas.json');
  assert.deepEqual(Object.keys(eas).sort(), ['build', 'cli']);
  assert.deepEqual(eas.cli, { appVersionSource: 'local' });
  assert.deepEqual(eas.build, {
    development: { developmentClient: false, ios: { simulator: true } },
    preview: { distribution: 'internal' },
  });
  const text = readFileSync(new URL('../eas.json', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /credentials|submit|versionCode|autoIncrement|buildNumber|"android"/);
});
