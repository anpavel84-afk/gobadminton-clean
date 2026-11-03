"use client";

import { useEffect, useRef, useState } from "react";
import {
  getGameRoleReputation,
  getPlayerRoleReputation,
  getRoleReputation,
} from "../../../lib/api-client";
import type {
  RoleKind,
  RoleReputationCardSummary,
  RoleReputationSummary,
} from "../../../lib/consumer-types";
import { Button } from "../Button";
import { RoleReviewsDialog } from "./RoleReviewsDialog";
import { RoleReviewComposer } from "./RoleReviewComposer";
import "../../../styles/role-reputation.css";

type LoadState = "idle" | "loading" | "ready" | "unavailable" | "error";

function roleTitle(role: RoleKind): string {
  return role === "organization" ? "Как организатор" : "Как тренер";
}

function heldLabel(count: number | null, incomplete: boolean): string | null {
  if (count == null) return null;
  const base =
    count === 0
      ? "По подтверждённой истории проведённых игр пока нет"
      : count === 1
        ? "1 проведённая игра по подтверждённой истории"
        : `${count} проведённых игр по подтверждённой истории`;
  return incomplete ? `${base}. История может быть неполной` : base;
}

function reviewsButtonLabel(count: number, role: RoleKind): string {
  const noun = role === "training" ? "о тренировках" : "об организации";
  return count > 0 ? `Отзывы ${noun} · ${count}` : `Отзывы ${noun}`;
}

/**
 * Compact public role reputation entry for game detail / profile.
 * Server counts only — never invent gallery counters. Reading does not require attendance.
 */
export function RoleReputationPanel({
  role,
  roleHandle,
  gameId,
  publicPlayerId,
  card,
  canWrite = false,
  csrfToken = null,
  onLogin,
}: {
  role: RoleKind;
  roleHandle?: string | null;
  gameId?: string;
  publicPlayerId?: string;
  /** Optional prefetched card summary (discovery batch). */
  card?: RoleReputationCardSummary | null;
  canWrite?: boolean;
  csrfToken?: string | null;
  onLogin?: () => void;
}) {
  const [summary, setSummary] = useState<RoleReputationSummary | null>(null);
  const [state, setState] = useState<LoadState>(card ? "ready" : "idle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const epoch = useRef(0);

  useEffect(() => {
    if (card && !roleHandle && !gameId && !publicPlayerId) {
      setSummary(null);
      setState(card.availability === "available" ? "ready" : "unavailable");
      return;
    }
    if (!roleHandle && !gameId && !publicPlayerId) {
      setState("unavailable");
      return;
    }
    const request = ++epoch.current;
    let cancelled = false;
    setState("loading");
    const load = async () => {
      const result = roleHandle
        ? await getRoleReputation(roleHandle, { gameId, limit: 3 })
        : gameId
          ? await getGameRoleReputation(gameId, role)
          : publicPlayerId
            ? await getPlayerRoleReputation(publicPlayerId, role, { limit: 3 })
            : null;
      if (cancelled || request !== epoch.current) return;
      if (!result || !result.ok) {
        setSummary(null);
        setState(result && result.status === 404 ? "unavailable" : "error");
        return;
      }
      if (!result.data || result.data.availability !== "available") {
        setSummary(null);
        setState("unavailable");
        return;
      }
      setSummary(result.data);
      setState("ready");
    };
    void load();
    return () => {
      cancelled = true;
      epoch.current += 1;
    };
  }, [roleHandle, gameId, publicPlayerId, role, card]);

  useEffect(() => {
    const onExpire = () => {
      epoch.current += 1;
      setComposerOpen(false);
    };
    window.addEventListener("gb-private-expired", onExpire);
    return () => window.removeEventListener("gb-private-expired", onExpire);
  }, []);

  const published = summary?.publishedReviewCount ?? card?.publishedReviewCount ?? 0;
  const held = summary?.heldGamesCount ?? card?.heldGamesCount ?? null;
  const incomplete = summary?.historyMayBeIncomplete ?? card?.historyMayBeIncomplete ?? true;
  const availability =
    summary?.availability ??
    card?.availability ??
    (state === "unavailable" ? "unavailable" : "available");
  const openHandle = summary?.roleHandle ?? card?.roleHandle ?? roleHandle ?? null;

  if (state === "loading" && !card) {
    return (
      <div className="gb-role-rep" data-role={role} data-state="loading" role="status">
        <p className="gb-role-rep__hint">Загружаем отзывы о роли…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="gb-role-rep" data-role={role} data-state="error" role="alert">
        <p className="gb-role-rep__hint">Не удалось загрузить отзывы о роли.</p>
      </div>
    );
  }

  if (availability === "unavailable" || (!openHandle && state !== "loading")) {
    return (
      <div className="gb-role-rep" data-role={role} data-state="unavailable">
        <p className="gb-role-rep__eyebrow">{roleTitle(role)}</p>
        <p className="gb-role-rep__hint">
          Публичная история этой роли сейчас недоступна. Это не значит, что человек «никогда не проводил»
          встречи — подтверждённая история может отсутствовать.
        </p>
      </div>
    );
  }

  const heldText = role === "organization" ? heldLabel(held, incomplete) : null;

  return (
    <div className="gb-role-rep" data-role={role} data-state="ready">
      <p className="gb-role-rep__eyebrow">{roleTitle(role)}</p>
      {heldText ? (
        <p className="gb-role-rep__held">
          {held != null && held > 0 ? <strong>{held}</strong> : null}
          {heldText}
        </p>
      ) : null}
      <p className="gb-role-rep__hint">
        {published > 0
          ? `${published} опубликованных отзывов. Приватные сообщения и ожидающие тексты сюда не входят.`
          : "Пока нет опубликованных отзывов по этой роли."}
      </p>
      <div className="gb-role-rep__actions">
        <Button
          variant="outline"
          type="button"
          disabled={!openHandle}
          onClick={() => setDialogOpen(true)}
        >
          {reviewsButtonLabel(published, role)}
        </Button>
        {canWrite ? (
          <Button
            type="button"
            onClick={() => {
              if (!csrfToken) {
                onLogin?.();
                return;
              }
              setComposerOpen(true);
            }}
          >
            Поделиться опытом
          </Button>
        ) : null}
      </div>
      {dialogOpen && openHandle ? (
        <RoleReviewsDialog
          roleHandle={openHandle}
          role={role}
          gameId={gameId}
          initial={summary}
          csrfToken={csrfToken}
          onClose={() => setDialogOpen(false)}
          onCompose={
            canWrite
              ? () => {
                  setDialogOpen(false);
                  if (!csrfToken) onLogin?.();
                  else setComposerOpen(true);
                }
              : undefined
          }
        />
      ) : null}
      {composerOpen && openHandle && csrfToken ? (
        <RoleReviewComposer
          roleHandle={openHandle}
          role={role}
          csrfToken={csrfToken}
          preferredGameId={gameId}
          onClose={() => setComposerOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Compact discovery/card footer actions outside the title Link — no nested interactive controls. */
export function RoleReputationCardActions({
  gameId,
  organization,
  training,
  trainerName,
}: {
  gameId: string;
  organization?: RoleReputationCardSummary | null;
  training?: RoleReputationCardSummary | null;
  trainerName?: string | null;
}) {
  const [open, setOpen] = useState<null | { role: RoleKind; handle: string }>(null);
  const hasOrg = organization?.availability === "available";
  const hasTrain = training?.availability === "available";
  if (!hasOrg && !hasTrain) return null;
  return (
    <div className="gb-role-rep-footer" data-game-id={gameId}>
      {hasTrain && training ? (
        <button
          type="button"
          onClick={() => setOpen({ role: "training", handle: training.roleHandle })}
        >
          {reviewsButtonLabel(training.publishedReviewCount, "training")}
          {trainerName ? ` · ${trainerName}` : ""}
        </button>
      ) : null}
      {hasOrg && organization ? (
        <>
          {organization.heldGamesCount != null ? (
            <span>
              {heldLabel(organization.heldGamesCount, organization.historyMayBeIncomplete)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen({ role: "organization", handle: organization.roleHandle })}
          >
            {reviewsButtonLabel(organization.publishedReviewCount, "organization")}
          </button>
        </>
      ) : null}
      {open ? (
        <RoleReviewsDialog
          roleHandle={open.handle}
          role={open.role}
          gameId={gameId}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
