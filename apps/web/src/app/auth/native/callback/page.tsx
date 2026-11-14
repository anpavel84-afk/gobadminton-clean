"use client";

import { useEffect } from "react";

/** No searchParams, code rendering, links containing the callback, analytics or automatic exchange. */
export default function NativeCallbackFallback() {
  useEffect(() => {
    // A missing/unverified app must not retain the one-use handoff in browser navigation.
    window.history.replaceState(null, "", "/auth/native/callback");
  }, []);
  return <main>
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex,nofollow" />
    <h1>Вернитесь в приложение GoBadminton</h1>
    <p>Если приложение не открылось, начните вход в приложении заново. Ссылка входа одноразовая и быстро истекает.</p>
    <p>Автоматическое открытие приложения требует подтверждённых HTTPS-ссылок на устройстве.</p>
  </main>;
}
