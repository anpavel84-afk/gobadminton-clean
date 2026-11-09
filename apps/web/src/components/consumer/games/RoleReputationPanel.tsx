"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** Russian 1 / 2–4 / 5+ (and 11–14 many). */
function ruForm(count: number, one: string, few: string, many: string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

function heldGamesForm(count: number): string {
  return ruForm(count, "проведённая игра", "проведённые игры", "проведённых игр");
}

function publishedReviewsForm(count: number): string {
  return ruForm(count, "опубликованный отзыв", "опубликованных отзыва", "опубликованных отзывов");
}

/** Full phrase with count once — for card footers without a separate strong. */
function heldLabel(count: number | null, incomplete: boolean): string | null {
  if (count == null) return null;
  const base =
    count === 0
      ? "По подтверждённой истории проведённых игр пока нет"
      : `${count} ${heldGamesForm(count)} по подтверждённой истории`;
  return incomplete ? `${base}. История может быть неполной` : base;
}

/** Compact discovery history — organization held count only; never invent 0 from null. */
function compactHistoryLabel(count: number | null, incomplete: boolean): string | null {
  if (count == null) return null;
  if (count === 0) return heldLabel(0, incomplete);
  const base = `Подтверждённая история: ${count} ${heldGamesForm(count)}.`;
  return incomplete ? `${base} Может быть неполной.` : base;
}

function reviewCue(count: number): string {
  return count > 0 ? ` · Отзывы · ${count}` : " · Отзывы";
}

function roleReviewAriaLabel(role: RoleKind, name: string, count: number): string {
  const kind = role === "training" ? "Отзывы о тренировках" : "Отзывы об организации";
  const headed = count > 0 ? `${kind} · ${count}` : kind;
  // Public accessible copy stays plain «Тренер» / role name — no false verified claim.
  return `${headed}: ${name}`;
}

/** Panel/dialog body: numeric value once in strong + case form without repeating the digit. */
function heldCountBody(count: number | null, incomplete: boolean) {
  if (count == null) return null;
  if (count === 0) {
    return (
      <p className="gb-role-rep__held">
        {incomplete
          ? "По подтверждённой истории проведённых игр пока нет. История может быть неполной"
          : "По подтверждённой истории проведённых игр пока нет"}
      </p>
    );
  }
  const suffix = `${heldGamesForm(count)} по подтверждённой истории${
    incomplete ? ". История может быть неполной" : ""
  }`;
  return (
    <p className="gb-role-rep__held">
      <strong>{count}</strong> {suffix}
    </p>
  );
}

function reviewsButtonLabel(count: number, role: RoleKind): string {
  const noun = role === "training" ? "о тренировках" : "об организации";
  return count > 0 ? `Отзывы ${noun} · ${count}` : `Отзывы ${noun}`;
}

/** Neutral rule only — does not claim this viewer is eligible or ineligible. */
const WRITE_ELIGIBILITY_HINT =
  "Оставить отзыв можно только о своей прошедшей игре или тренировке с подтверждённым участием и посещением.";

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
        <p className="gb-role-rep__hint">{WRITE_ELIGIBILITY_HINT}</p>
      </div>
    );
  }

  return (
    <div className="gb-role-rep" data-role={role} data-state="ready">
      <p className="gb-role-rep__eyebrow">{roleTitle(role)}</p>
      {role === "organization" ? heldCountBody(held, incomplete) : null}
      <p className="gb-role-rep__hint">
        {published > 0
          ? `${published} ${publishedReviewsForm(published)}. Приватные сообщения и ожидающие тексты сюда не входят.`
          : "Пока нет опубликованных отзывов по этой роли."}
      </p>
      <p className="gb-role-rep__hint">{WRITE_ELIGIBILITY_HINT}</p>
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

/** Gated discovery compact triggers — only available roles become interactive. */
export type RoleReputationCompactTrigger = {
  onOpen: () => void;
  ariaLabel: string;
  cue: string;
  count: number;
};

export type RoleReputationCompactView = {
  gameId: string;
  trainingTrigger: RoleReputationCompactTrigger | null;
  organizationTrigger: RoleReputationCompactTrigger | null;
  historyLabel: string | null;
  /** True while RoleReviewsDialog is open — keep disclosure region mounted for focus return. */
  dialogOpen: boolean;
};

/** Compact discovery/card footer actions outside the title Link — no nested interactive controls. */
export function RoleReputationCardActions({
  gameId,
  organization,
  training,
  trainerName,
  organizerName,
  renderCompact,
}: {
  gameId: string;
  organization?: RoleReputationCardSummary | null;
  training?: RoleReputationCardSummary | null;
  trainerName?: string | null;
  organizerName?: string | null;
  /** Discovery D2 presentation; called before the ordinary null return so roles/actions survive without reputation. */
  renderCompact?: (view: RoleReputationCompactView) => ReactNode;
}) {
  const [open, setOpen] = useState<null | { role: RoleKind; handle: string }>(null);
  const hasOrg = organization?.availability === "available";
  const hasTrain = training?.availability === "available";

  const trainingTrigger: RoleReputationCompactTrigger | null =
    hasTrain && training
      ? {
          onOpen: () => setOpen({ role: "training", handle: training.roleHandle }),
          ariaLabel: roleReviewAriaLabel(
            "training",
            trainerName || training.subjectDisplayName || "Тренер",
            training.publishedReviewCount,
          ),
          cue: reviewCue(training.publishedReviewCount),
          count: training.publishedReviewCount,
        }
      : null;

  const organizationTrigger: RoleReputationCompactTrigger | null =
    hasOrg && organization
      ? {
          onOpen: () => setOpen({ role: "organization", handle: organization.roleHandle }),
          ariaLabel: roleReviewAriaLabel(
            "organization",
            organizerName || organization.subjectDisplayName || "Организатор",
            organization.publishedReviewCount,
          ),
          cue: reviewCue(organization.publishedReviewCount),
          count: organization.publishedReviewCount,
        }
      : null;

  const historyLabel =
    hasOrg && organization
      ? compactHistoryLabel(organization.heldGamesCount, organization.historyMayBeIncomplete)
      : null;

  const dialog =
    open ? (
      <RoleReviewsDialog
        roleHandle={open.handle}
        role={open.role}
        gameId={gameId}
        onClose={() => setOpen(null)}
      />
    ) : null;

  if (renderCompact) {
    return (
      <>
        {renderCompact({
          gameId,
          trainingTrigger,
          organizationTrigger,
          historyLabel,
          dialogOpen: open != null,
        })}
        {dialog}
      </>
    );
  }

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
      {dialog}
    </div>
  );
}
