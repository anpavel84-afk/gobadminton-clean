import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { IOS_AUTH_UNSUPPORTED, iosAuthSessionSupported, iosVersion } from '../src/ios-auth.ts';
import { NATIVE_REDIRECT } from '../src/native-auth-protocol.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('iOS version parsing gates the HTTPS auth callback at 17.4', () => {
  const table: [unknown, { major: number; minor: number } | null, boolean][] = [
    ['17.4', { major: 17, minor: 4 }, true],
    ['17.4.1', { major: 17, minor: 4 }, true],
    ['17.5', { major: 17, minor: 5 }, true],
    ['17.3.1', { major: 17, minor: 3 }, false],
    ['17.0', { major: 17, minor: 0 }, false],
    ['17', { major: 17, minor: 0 }, false],
    ['18', { major: 18, minor: 0 }, true],
    ['18.0', { major: 18, minor: 0 }, true],
    ['26.1', { major: 26, minor: 1 }, true],
    ['16.7', { major: 16, minor: 7 }, false],
    ['16.7.10', { major: 16, minor: 7 }, false],
    [18, { major: 18, minor: 0 }, true],
    ['', null, false],
    ['abc', null, false],
    ['17.4beta', null, false],
    [null, null, false],
    [undefined, null, false],
  ];
  for (const [input, parsed, supported] of table) {
    assert.deepEqual(iosVersion(input), parsed, String(input));
    assert.equal(iosAuthSessionSupported(input), supported, String(input));
  }
  assert.match(IOS_AUTH_UNSUPPORTED, /^Вход в приложении на iPhone доступен с iOS 17\.4\. Обновите iOS или войдите на сайте dev\.gobadminton\.ru\.$/);
});

test('signIn guard is iOS-only and precedes beginLogin; Android keeps the two-argument auth session call', async () => {
  const source = read('../src/auth.tsx');
  const guardLine = source.match(/^const iosSignInUnavailable = .+;$/m)![0];
  assert.match(guardLine, /^const iosSignInUnavailable = Platform\.OS === 'ios' && !iosAuthSessionSupported\(Platform\.Version\) \? IOS_AUTH_UNSUPPORTED : null;$/);
  const body = source.slice(source.indexOf('  async function signIn('), source.indexOf('  return <Context.Provider'));
  const guard = body.indexOf('if (iosSignInUnavailable)');
  assert.ok(guard > 0 && guard < body.indexOf('browserBusy.current = true') && guard < body.indexOf('nativeAuth.beginLogin('));
  assert.match(source, /signInUnavailable: iosSignInUnavailable/);
  assert.doesNotMatch(source, /gobadminton-dev:/);

  function run(os: string, version: unknown) {
    const calls: { begin: number; alerts: unknown[][]; sessions: unknown[][]; cancelled: number } = { begin: 0, alerts: [], sessions: [], cancelled: 0 };
    const Platform = { OS: os, Version: version };
    const signIn = runInNewContext(stripTypeScriptTypes(`${guardLine}\n(${body.trim()})`), {
      Platform, iosAuthSessionSupported, IOS_AUTH_UNSUPPORTED, NATIVE_REDIRECT,
      Alert: { alert: (...args: unknown[]) => { calls.alerts.push(args); } },
      browserBusy: { current: false },
      nativeAuth: {
        beginLogin: async () => { calls.begin++; return { url: 'https://dev.gobadminton.ru/v1/auth/native/start', generation: 1 }; },
        cancelLogin: async () => { calls.cancelled++; },
        callback: async () => null,
      },
      WebBrowser: { openAuthSessionAsync: async (...args: unknown[]) => { calls.sessions.push(args.map(arg => arg && typeof arg === 'object' ? { ...arg } : arg)); return { type: 'cancel' }; } },
      router: { replace: () => {} },
    }) as (returnPath?: string | null) => Promise<void>;
    return { calls, signIn };
  }
  for (const version of ['17.3.1', '16.7', '17.0']) {
    const old = run('ios', version); await old.signIn('/games');
    assert.equal(old.calls.begin, 0, version); assert.equal(old.calls.sessions.length, 0, version);
    assert.deepEqual(old.calls.alerts, [['Вход недоступен', IOS_AUTH_UNSUPPORTED]], version);
  }
  for (const version of ['17.4', '18']) {
    const current = run('ios', version); await current.signIn('/games');
    assert.equal(current.calls.begin, 1, version); assert.equal(current.calls.alerts.length, 0, version);
    assert.deepEqual(current.calls.sessions, [['https://dev.gobadminton.ru/v1/auth/native/start', NATIVE_REDIRECT, { preferUniversalLinks: true }]], version);
    assert.equal(current.calls.cancelled, 1, version);
  }
  for (const version of [33, 26, '17.3.1']) {
    const android = run('android', version); await android.signIn('/games');
    assert.equal(android.calls.begin, 1, String(version)); assert.equal(android.calls.alerts.length, 0, String(version));
    assert.deepEqual(android.calls.sessions, [['https://dev.gobadminton.ru/v1/auth/native/start', NATIVE_REDIRECT]], String(version));
    assert.equal(android.calls.cancelled, 1, String(version));
  }
});

test('profile guest card shows the iOS notice in place of the sign-in button only when unavailable', () => {
  const profile = read('../app/profile.tsx');
  assert.match(profile, /\{auth\.signInUnavailable \? <Label accessibilityRole="alert">\{auth\.signInUnavailable\}<\/Label>\s*: !busy && auth\.notice !== 'storage' && <TextButton title="Войти" onPress=\{\(\) => void act\(\(\) => auth\.signIn\(intent\)\)\} \/>\}/);
  assert.doesNotMatch(profile, /Platform/);
});
