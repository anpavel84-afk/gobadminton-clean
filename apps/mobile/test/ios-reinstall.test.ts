import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { IOS_INSTALL_MARKER, createReinstallGuard } from '../src/ios-reinstall.ts';
import type { ReinstallGuardDeps } from '../src/ios-reinstall.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function fakes(os: string, marker: boolean, overrides: (calls: string[]) => Partial<ReinstallGuardDeps> = () => ({})) {
  const calls: string[] = [];
  let present = marker;
  const deps: ReinstallGuardDeps = {
    os,
    markerExists: () => { calls.push('exists'); return present; },
    writeMarker: async () => { calls.push('write'); present = true; },
    deleteSession: async () => { calls.push('delete'); },
    ...overrides(calls),
  };
  return { guard: createReinstallGuard(deps), calls };
}

test('iOS fresh install: marker absent deletes the stored session, then writes the marker once', async () => {
  const { guard, calls } = fakes('ios', false);
  await guard();
  assert.deepEqual(calls, ['exists', 'delete', 'write']);
});

test('iOS existing install: marker present leaves the stored session untouched', async () => {
  const { guard, calls } = fakes('ios', true);
  await guard();
  assert.deepEqual(calls, ['exists']);
});

test('Android (and any non-iOS platform) is a no-op that never touches marker or store', async () => {
  for (const os of ['android', 'web']) {
    const { guard, calls } = fakes(os, false);
    await guard();
    await guard();
    assert.deepEqual(calls, []);
  }
});

test('guard is memoised: concurrent and later calls share one run', async () => {
  const { guard, calls } = fakes('ios', false);
  const first = guard();
  assert.equal(guard(), first);
  await Promise.all([first, guard()]);
  await guard();
  assert.deepEqual(calls, ['exists', 'delete', 'write']);
});

test('marker write failure resolves without throwing after the delete', async () => {
  const { guard, calls } = fakes('ios', false, log => ({ writeMarker: () => { log.push('write'); throw new Error('read-only'); } }));
  await guard();
  assert.deepEqual(calls, ['exists', 'delete', 'write']);
});

test('unreadable marker fails closed (delete) and a failed delete skips the marker so the next launch retries', async () => {
  const unreadable = fakes('ios', true, log => ({ markerExists: () => { log.push('exists'); throw new Error('no fs'); } }));
  await unreadable.guard();
  assert.deepEqual(unreadable.calls, ['exists', 'delete', 'write']);
  const undeletable = fakes('ios', false, log => ({ deleteSession: async () => { log.push('delete'); throw new Error('keychain'); } }));
  await undeletable.guard();
  assert.deepEqual(undeletable.calls, ['exists', 'delete']);
});

test('live adapter checks a marker File in Paths.document and loads expo-file-system lazily', () => {
  const text = source('../src/ios-reinstall.ts');
  assert.equal(IOS_INSTALL_MARKER, 'gobadminton.install-marker.v1');
  assert.match(text, /^import type \* as ExpoFileSystemModule from 'expo-file-system';$/m);
  assert.doesNotMatch(text, /^import (?!type ).*expo-file-system/m);
  assert.match(text, /require\('expo-file-system'\)/);
  assert.match(text, /new File\(Paths\.document, IOS_INSTALL_MARKER\)/);
  assert.match(text, /markerExists: \(\) => marker\(\)\.exists/);
  assert.match(text, /writeMarker: \(\) => marker\(\)\.write\('1'\)/);
});

test('auth-runtime wires the guard only for iOS and keeps Android store and setItem options exact', () => {
  const text = source('../src/auth-runtime.ts');
  assert.match(text, /const iosReinstallGuard = Platform\.OS === 'ios'\n {2}\? createExpoReinstallGuard\(Platform\.OS, \(\) => SecureStore\.deleteItemAsync\(SECURE_AUTH_KEY\)\)\n {2}: null;/);
  assert.match(text, /store: iosReinstallGuard \? \{\n {4}getItem: async key => \{ await iosReinstallGuard\(\); return SecureStore\.getItemAsync\(key\); \},/);
  assert.ok(text.includes(`  } : {
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  },`), 'Android store must stay the direct SecureStore calls');
  assert.equal(text.match(/SecureStore\.setItemAsync\(key, value, \{ keychainAccessible: SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY \}\)/g)?.length, 2);
  assert.equal(text.match(/deleteItemAsync/g)?.length, 1);
  assert.equal(text.match(/iosReinstallGuard\(\)/g)?.length, 2);
  assert.match(source('../src/native-auth-protocol.ts'), /^export const SECURE_AUTH_KEY = 'gobadminton\.mobile\.auth\.v1';$/m);
});
