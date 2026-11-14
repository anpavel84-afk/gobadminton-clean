import { nativeAuth } from '../src/auth-runtime.ts';
import { isNativeCallback } from '../src/native-auth-protocol.ts';

/** Expo Router intercepts the external URL before placing it in navigation history/params. */
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (isNativeCallback(path)) {
    try {
      const destination = await nativeAuth.callback(path);
      return destination ?? nativeAuth.getSnapshot().returnPath ?? '/profile';
    } catch { return '/profile'; }
  }
  // A nonapproved/custom-scheme callback cannot bypass the exact verified HTTPS tuple.
  try { if (new URL(path, 'https://dev.gobadminton.ru').pathname === '/auth/native/callback') return '/profile'; }
  catch { return '/games'; }
  return path;
}
