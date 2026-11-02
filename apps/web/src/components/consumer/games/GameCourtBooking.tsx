"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGameCourtBooking } from "../../../lib/api-client";
import type { CourtBookingStatus, GameCourtBooking as CourtBookingDto } from "../../../lib/consumer-types";
import { useSocialMutation } from "../messages/useSocialMutation";
import { Button } from "../Button";

const STATUS_OPTIONS: Array<{ value: CourtBookingStatus; label: string }> = [
  { value: "unspecified", label: "Не указано" },
  { value: "arranging", label: "Договариваемся" },
  { value: "organizer_confirmed", label: "Подтверждено организатором" },
  { value: "not_arranged", label: "Не удалось договориться" },
];

function statusLabel(status: CourtBookingStatus): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? "Не указано";
}

function isCourtBooking(data: unknown): data is CourtBookingDto {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  const actions = row.allowedActions;
  return (
    typeof row.gameId === "string"
    && typeof row.status === "string"
    && typeof row.version === "number"
    && row.declarationSource === "organizer_declared"
    && !!actions
    && typeof actions === "object"
    && !Array.isArray(actions)
    && typeof (actions as { canUpdate?: unknown }).canUpdate === "boolean"
  );
}

export function GameCourtBookingPanel({
  gameId,
  meId,
  csrfToken,
}: {
  gameId: string;
  meId: string;
  csrfToken: string;
}) {
  const [booking, setBooking] = useState<CourtBookingDto | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [draftStatus, setDraftStatus] = useState<CourtBookingStatus>("unspecified");
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const epoch = useRef(0);
  const liveGame = useRef(gameId);
  liveGame.current = gameId;
  const scope = `${meId}:court-booking:${gameId}`;
  const path = useMemo(() => `/v1/games/${gameId}/court-booking`, [gameId]);

  const mutation = useSocialMutation<CourtBookingDto>(
    scope,
    csrfToken,
    (data) => {
      if (liveGame.current !== gameId) return;
      setBooking(data);
      setDraftStatus(data.status);
      setSavedFlash(true);
      setLocalNotice("Статус сохранён со слов организатора.");
    },
    () => {
      void reload();
    },
    true,
    {
      holdCorruptStorage: true,
      validatePending: (pending) =>
        pending.method === "PUT"
        && pending.path === `/v1/games/${gameId}/court-booking`
        && typeof (pending.body as { expectedVersion?: unknown }).expectedVersion === "number"
        && typeof (pending.body as { status?: unknown }).status === "string",
      validateSuccess: (data, pending) => {
        if (!pending || !isCourtBooking(data)) return false;
        if (data.gameId !== gameId) return false;
        const body = pending.body as { expectedVersion?: number; status?: CourtBookingStatus };
        if (body.status !== data.status) return false;
        if (typeof body.expectedVersion !== "number") return false;
        // Success must advance past the frozen expectedVersion; GET match alone cannot clear UNKNOWN.
        return data.version === body.expectedVersion + 1;
      },
    },
  );

  const unknownOp = mutation.pending || mutation.code === "hold";

  async function reload() {
    const token = ++epoch.current;
    setLoadState("loading");
    setBooking(null);
    setLocalNotice(null);
    setSavedFlash(false);
    const result = await getGameCourtBooking(gameId);
    if (token !== epoch.current || liveGame.current !== gameId) return;
    if (!result.ok) {
      setLoadState(result.status === 404 || result.status === 401 ? "denied" : "error");
      return;
    }
    setBooking(result.data);
    setDraftStatus(result.data.status);
    setLoadState("ready");
  }

  useEffect(() => {
    void reload();
    return () => { epoch.current += 1; };
  }, [gameId, meId, csrfToken]);

  useEffect(() => {
    const onSession = () => {
      epoch.current += 1;
      setBooking(null);
      setLoadState("loading");
      setLocalNotice(null);
      setSavedFlash(false);
    };
    window.addEventListener("gb-session-changed", onSession);
    return () => window.removeEventListener("gb-session-changed", onSession);
  }, []);

  const canUpdate = Boolean(booking?.allowedActions.canUpdate);

  function admitSave() {
    if (!booking || !canUpdate || unknownOp || mutation.busy) return;
    setSavedFlash(false);
    setLocalNotice(null);
    const body = { expectedVersion: booking.version, status: draftStatus };
    const admitted = mutation.run(path, body, "PUT");
    if (!admitted) {
      setLocalNotice("Сначала разберите предыдущую неподтверждённую отправку.");
    }
  }

  if (loadState === "denied") return null;
  if (loadState === "loading" && !booking) {
    return (
      <section className="gb-game-section gb-court-booking" aria-label="Договорённость о корте" role="status">
        <h2>Договорённость о корте</h2>
        <p>Загружаем статус…</p>
      </section>
    );
  }
  if (loadState === "error") {
    return (
      <section className="gb-game-section gb-court-booking" aria-label="Договорённость о корте">
        <h2>Договорённость о корте</h2>
        <p>Не удалось загрузить статус. Попробуйте ещё раз.</p>
        <Button type="button" variant="outline" onClick={() => void reload()}>Обновить</Button>
      </section>
    );
  }
  if (!booking) return null;

  return (
    <section className="gb-game-section gb-court-booking" aria-label="Договорённость о корте">
      <h2>Договорённость о корте</h2>
      <p className="gb-court-booking__source">Со слов организатора. Площадка это не подтверждает.</p>
      {canUpdate ? (
        <label className="gb-game-field gb-game-field--wide">
          <span>Статус (со слов организатора)</span>
          <select
            value={draftStatus}
            disabled={mutation.busy || unknownOp}
            onChange={(event) => {
              setDraftStatus(event.target.value as CourtBookingStatus);
              setSavedFlash(false);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          <strong>{statusLabel(booking.status)}</strong>
          <span> · со слов организатора</span>
        </p>
      )}
      {canUpdate ? (
        <div className="gb-game-form-actions">
          <Button
            type="button"
            disabled={mutation.busy || unknownOp || draftStatus === booking.status}
            loading={mutation.busy}
            onClick={admitSave}
          >
            Сохранить статус
          </Button>
          {mutation.pending && mutation.code !== "hold" ? (
            <Button type="button" variant="outline" disabled={mutation.busy} onClick={() => mutation.retry()}>
              Повторить ту же отправку
            </Button>
          ) : null}
        </div>
      ) : null}
      {savedFlash ? <p role="status">Сохранено.</p> : null}
      {localNotice ? <p role="status">{localNotice}</p> : null}
      {mutation.notice ? <p role="status">{mutation.notice}</p> : null}
    </section>
  );
}
