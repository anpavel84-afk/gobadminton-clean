export const IOS_AUTH_UNSUPPORTED = 'Вход в приложении на iPhone доступен с iOS 17.4. Обновите iOS или войдите на сайте dev.gobadminton.ru.';

export function iosVersion(value: unknown): { major: number; minor: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(String(value).trim());
  return match ? { major: Number(match[1]), minor: Number(match[2] ?? 0) } : null;
}

// expo-web-browser uses ASWebAuthenticationSession.Callback.https only on iOS 17.4+; older iOS cannot return to the HTTPS redirect.
export function iosAuthSessionSupported(value: unknown): boolean {
  const version = iosVersion(value);
  return !!version && (version.major > 17 || (version.major === 17 && version.minor >= 4));
}
