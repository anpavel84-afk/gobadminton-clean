"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, logout } from "../../../lib/api-client";
import type { Me } from "../../../lib/consumer-types";
import { privateViews } from "../../../lib/private-view";
import { GameContactPreference } from "../players/GameContactPreference";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";

/** Frozen StyleGuide section 09: Grouped settings. Unsupported commands stay gated. */
export function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0);
  const activeMe = useRef<Me | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    let releaseView: (() => void) | undefined;
    const retire = (nextState: string) => {
      // Invalidate synchronously, before React commits the child teardown.
      ++epoch.current; logoutRequest.current?.abort(); logoutRequest.current = null;
      activeMe.current = null; releaseView?.(); releaseView = undefined;
      setMe(null); setState(nextState); setNotice(null); setBusy(false);
    };
    const load = () => {
      retire("loading");
      const request = epoch.current;
      const generation = privateViews.currentGeneration;
      void getMe().then(result => {
        if (!live || request !== epoch.current) return;
        if (result.ok) {
          releaseView = privateViews.retain(generation);
          if (!releaseView) return;
          activeMe.current = result.data; setMe(result.data); setState("ready");
        }
        else setState(result.status === 401 ? "auth" : "error");
      });
    };
    const expired = () => retire("auth");
    const session = () => load();
    window.addEventListener("gb-session-changed", session);
    window.addEventListener("gb-private-expired", expired);
    load();
    return () => {
      live = false; ++epoch.current; logoutRequest.current?.abort(); logoutRequest.current = null;
      activeMe.current = null; releaseView?.();
      window.removeEventListener("gb-session-changed", session);
      window.removeEventListener("gb-private-expired", expired);
    };
  }, [reload]);

  async function onLogout() {
    if (!me || activeMe.current !== me || busy || logoutRequest.current) return;
    const request = epoch.current, controller = new AbortController();
    logoutRequest.current = controller;
    setBusy(true); setNotice(null);
    // Publish the session event only after this page verifies the response owner.
    const result = await logout(me.csrfToken, { signal: controller.signal, notifySession: false });
    if (request !== epoch.current || controller.signal.aborted) return;
    logoutRequest.current = null;
    setBusy(false);
    window.dispatchEvent(new Event("gb-session-changed"));
    if (!result.ok && result.status !== 401) {
      setNotice("Не удалось подтвердить выход. Проверьте соединение и попробуйте ещё раз.");
      return;
    }
    router.push("/games");
  }

  return <ConsumerShell active="profile" title="Настройки" mode="local">
    <div className="fr3 utility-page">
      <Link className="back-link" href="/profile">← Мой профиль</Link>
      <h1>Настройки</h1>
      {state === "loading" && <ProfileState title="Проверяем вход…" state="loading" />}
      {state === "error" && <ProfileState title="Не удалось загрузить аккаунт" state="error" retry={() => setReload(n => n + 1)}>Попробуйте ещё раз.</ProfileState>}
      {state === "auth" && <section className="profile-section"><p>Войдите, чтобы управлять своим аккаунтом.</p><AuthEntry returnPath="/profile/settings" /></section>}
      {state === "ready" && me && <GameContactPreference key={`${me.id}:${me.csrfToken}:${epoch.current}`} me={me} />}
      <section className="settings-list" aria-label="Настройки аккаунта">
        <h2>Вход и безопасность</h2>
        <Link href="/profile/settings/login-methods">Способы входа <span aria-hidden="true">→</span></Link>
        <Link href="/profile/settings/sessions">Активные сессии <span aria-hidden="true">→</span></Link>
        <h2>Помощь и документы</h2>
        <Link href="/help">Помощь <span aria-hidden="true">→</span></Link>
        <Link href="/legal">Документы сервиса <span aria-hidden="true">→</span></Link>
        <button type="button" className="settings-list__logout" onClick={() => void onLogout()} disabled={!me || busy}>{busy ? "Выходим…" : "Выйти"}</button>
        <button type="button" className="settings-list__danger" disabled data-gated="C-DEL">Удалить аккаунт <small>Пока недоступно</small></button>
      </section>
      {notice && <p className="profile-notice" role="alert">{notice}</p>}
    </div>
  </ConsumerShell>;
}
