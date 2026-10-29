"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getMe,
  listMySessions,
  logout,
  revokeMySession,
  revokeOtherSessions,
} from "../../../lib/api-client";
import type { Me, SessionItem } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { AuthEntry, ProfileState } from "../players/ProfileComposition";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Style Guide Kit DataRow for session rows; no invented browser/geo labels. */
export function ActiveSessionsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState("loading");
    void (async () => {
      const identity = await getMe();
      if (!live) return;
      if (!identity.ok) {
        setState(identity.status === 401 ? "auth" : "error");
        return;
      }
      setMe(identity.data);
      const listed = await listMySessions();
      if (!live) return;
      if (!listed.ok) {
        setState(listed.status === 401 ? "auth" : "error");
        return;
      }
      setItems(listed.data.items);
      setState("ready");
    })();
    return () => {
      live = false;
    };
  }, [reload]);

  async function onRevoke(sessionId: string) {
    if (!me || busy) return;
    setBusy(sessionId);
    setNotice(null);
    const result = await revokeMySession(sessionId, me.csrfToken);
    setBusy(null);
    if (!result.ok) {
      setNotice(
        result.problem?.code === "CURRENT_SESSION"
          ? "Текущую сессию завершите через выход."
          : "Не удалось завершить сессию.",
      );
      if (result.status === 401) setState("auth");
      return;
    }
    setItems(result.data.items);
    setNotice("Сессия завершена.");
  }

  async function onRevokeOthers() {
    if (!me || busy) return;
    setBusy("others");
    setNotice(null);
    const result = await revokeOtherSessions(me.csrfToken);
    setBusy(null);
    if (!result.ok) {
      setNotice("Не удалось завершить другие сессии.");
      if (result.status === 401) setState("auth");
      return;
    }
    setItems(result.data.items);
    setNotice(
      result.data.revokedCount > 0
        ? `Завершено сессий: ${result.data.revokedCount}.`
        : "Других активных сессий нет.",
    );
  }

  async function onLogoutCurrent() {
    if (!me || busy) return;
    setBusy("logout");
    setNotice(null);
    const result = await logout(me.csrfToken);
    setBusy(null);
    if (!result.ok && result.status !== 401) {
      setNotice("Не удалось подтвердить выход.");
      return;
    }
    window.location.assign("/games");
  }

  const others = items.filter((item) => !item.current).length;

  return (
    <ConsumerShell active="profile" title="Активные сессии" mode="local">
      <div className="fr3 utility-page">
        <header className="gb-page-local-header">
          <Link className="back-link" href="/profile/settings">
            ← Настройки
          </Link>
          <h1>Активные сессии</h1>
        </header>
        <div className="utility-page__body">
          <p>Здесь только ваши сессии входа. Отключение способа входа не завершает сессии.</p>
          {state === "loading" && <ProfileState title="Загружаем сессии…" state="loading" />}
          {state === "error" && (
            <ProfileState title="Не удалось загрузить сессии" state="error" retry={() => setReload((n) => n + 1)}>
              Попробуйте ещё раз.
            </ProfileState>
          )}
          {state === "auth" && (
            <section className="profile-section">
              <p>Войдите, чтобы управлять сессиями.</p>
              <AuthEntry returnPath="/profile/settings/sessions" />
            </section>
          )}
          {state === "ready" && (
            <>
              <section className="settings-list account-security-list" aria-label="Активные сессии">
                {items.map((item) => (
                  <div className="data-row" key={item.id}>
                    <span>
                      <small>{item.current ? "Текущая сессия" : "Другая сессия"}</small>
                      <strong>
                        {item.current ? "Этот браузер" : "Активна на другом устройстве"}
                      </strong>
                    </span>
                    <em>{item.current ? "Сейчас" : formatWhen(item.lastSeenAt)}</em>
                    {item.current ? (
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() => void onLogoutCurrent()}
                      >
                        {busy === "logout" ? "Выходим…" : "Выйти"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() => void onRevoke(item.id)}
                      >
                        {busy === item.id ? "Завершаем…" : "Завершить"}
                      </Button>
                    )}
                  </div>
                ))}
              </section>
              <div className="account-security-actions">
                <Button
                  variant="dark"
                  disabled={Boolean(busy) || others === 0}
                  onClick={() => void onRevokeOthers()}
                >
                  {busy === "others" ? "Завершаем…" : "Завершить другие сессии"}
                </Button>
              </div>
            </>
          )}
          {notice && (
            <p className="profile-notice" role="alert">
              {notice}
            </p>
          )}
        </div>
      </div>
    </ConsumerShell>
  );
}
