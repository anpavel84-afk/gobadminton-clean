"use client";

import { useEffect, useRef, useState } from "react";
import {
  commandOwnRoleReview,
  getMe,
  listOwnRoleReviews,
} from "../../../lib/api-client";
import type { OwnRoleReview } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { SurfacePanel } from "../Surfaces";
import { SectionHeader } from "../players/ProfileComposition";
import "../../../styles/role-reputation.css";

function roleLabel(role: OwnRoleReview["role"]): string {
  return role === "training" ? "Как о тренере" : "Как об организаторе";
}

function statusLabel(status: string, pending: OwnRoleReview["pendingIntakeStatus"]): string {
  if (pending === "waiting_intake") return "Ожидает разбора";
  switch (status) {
    case "published":
      return "Опубликован";
    case "submitted":
    case "revision_waiting":
      return "Ожидает разбора";
    case "needs_correction":
      return "Нужна правка";
    case "withdrawn":
      return "Отозван";
    case "removed":
      return "Снят";
    case "held_basis":
      return "Основание на проверке";
    default:
      return status;
  }
}

/**
 * Own public role-review history: recipient + role + progress/receipt.
 * Stale private GET after expiry/unmount must not repopulate.
 */
export function RoleReviewsHistory() {
  const [items, setItems] = useState<OwnRoleReview[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "auth">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<Record<string, string>>({});
  const [csrf, setCsrf] = useState<string | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);

  function clearPrivate() {
    epoch.current += 1;
    setItems([]);
    setCsrf(null);
    setNotice(null);
  }

  async function load() {
    const request = ++epoch.current;
    setState("loading");
    const me = await getMe();
    if (!mounted.current || request !== epoch.current) return;
    if (!me.ok) {
      clearPrivate();
      setState(me.status === 401 ? "auth" : "error");
      return;
    }
    setCsrf(me.data.csrfToken);
    const page = await listOwnRoleReviews();
    if (!mounted.current || request !== epoch.current) return;
    if (!page.ok) {
      clearPrivate();
      setState(page.status === 401 ? "auth" : "error");
      return;
    }
    setItems(page.data.items);
    setState(page.data.items.length ? "ready" : "empty");
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    const onExpire = () => {
      clearPrivate();
      setState("auth");
    };
    const onSession = () => {
      clearPrivate();
      void load();
    };
    window.addEventListener("gb-private-expired", onExpire);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      window.removeEventListener("gb-private-expired", onExpire);
      window.removeEventListener("gb-session-changed", onSession);
    };
  }, []);

  async function withdraw(item: OwnRoleReview) {
    if (!csrf || busy) return;
    const latch = `withdraw:${item.id}:${item.version}`;
    if (unknown[latch]) {
      setNotice("Отзыв мог быть отозван. Не повторяйте отправку.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const key = unknown[latch] ?? crypto.randomUUID().replace(/-/g, "");
    const result = await commandOwnRoleReview(
      item.id,
      { action: "withdraw", expectedVersion: item.version },
      csrf,
      key,
    );
    setBusy(false);
    if (!mounted.current) return;
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        setUnknown((prev) => ({ ...prev, [latch]: key }));
        setNotice("Не удалось подтвердить отзыв. Он мог быть отозван.");
        return;
      }
      setNotice(result.error || "Конфликт версии. Обновите список.");
      return;
    }
    void load();
  }

  return (
    <SurfacePanel tone="bordered" className="gb-postgame__panel">
      <SectionHeader title="Мои публичные отзывы о ролях" />
      <p className="gb-role-rep__hint">
        Адресат, роль и фактический статус. Приватная обратная связь из итогов игры сюда не входит.
      </p>
      {state === "loading" ? <p role="status">Загружаем…</p> : null}
      {state === "auth" ? <p>Войдите, чтобы увидеть свои отзывы о ролях.</p> : null}
      {state === "error" ? (
        <p role="alert">
          Не удалось загрузить.{" "}
          <Button variant="outline" type="button" onClick={() => void load()}>
            Повторить
          </Button>
        </p>
      ) : null}
      {state === "empty" ? <p>Пока нет публичных отзывов о ролях.</p> : null}
      {state === "ready"
        ? items.map((item) => (
            <article key={item.id} className="gb-role-rep-item" data-review-handle={item.reviewHandle}>
              <div className="gb-role-rep-item__meta">
                <strong>{item.subjectDisplayName ?? "Адресат роли"}</strong>
                <span>{roleLabel(item.role)}</span>
                <span>{statusLabel(item.status, item.pendingIntakeStatus)}</span>
              </div>
              {item.text ? <p className="gb-role-rep-item__text">{item.text}</p> : null}
              {item.receiptToken ? (
                <p className="gb-role-rep__hint">Квитанция: {item.receiptToken}</p>
              ) : null}
              {item.status !== "withdrawn" && item.status !== "removed" ? (
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => void withdraw(item)}
                >
                  Отозвать свой отзыв
                </Button>
              ) : null}
            </article>
          ))
        : null}
      {notice ? (
        <p className="gb-role-rep-pending" role="status">
          {notice}
        </p>
      ) : null}
    </SurfacePanel>
  );
}
