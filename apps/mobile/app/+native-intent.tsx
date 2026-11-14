import { nativeAuth } from '../src/auth-runtime.ts';
import { canonicalMessagePath, canonicalReturnPath, isNativeCallback } from '../src/native-auth-protocol.ts';

/** Expo Router intercepts the external URL before placing it in navigation history/params. */
export async function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (isNativeCallback(path)) {
    try {
      const destination = await nativeAuth.callback(path);
      return canonicalReturnPath(destination) ?? canonicalReturnPath(nativeAuth.getSnapshot().returnPath) ?? '/profile';
    } catch { return '/profile'; }
  }
  // A nonapproved/custom-scheme callback cannot bypass the exact verified HTTPS tuple.
  try { if (new URL(path, 'https://dev.gobadminton.ru').pathname === '/auth/native/callback') return '/profile'; }
  catch { return '/games'; }
  if (path.startsWith('/messages')) return canonicalMessagePath(path) ?? '/messages';
  try {
    const url = new URL(path);
    if (url.pathname.startsWith('/messages')) return url.origin === 'https://dev.gobadminton.ru' && path === `${url.origin}${url.pathname}` && !url.search && !url.hash && !url.username && !url.password
      ? canonicalMessagePath(url.pathname) ?? '/messages' : '/messages';
  } catch { /* Existing internal game intents keep their established handling. */ }
  return path;
}
