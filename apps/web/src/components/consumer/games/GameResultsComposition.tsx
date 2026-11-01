"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  acknowledgeAttendance,
  bulkPresentAttendance,
  disputeAttendance,
  getAttendanceHistory,
  getGame,
  getGameResults,
  getMe,
  putGameAttendance,
  putGameOutcome,
} from "../../../lib/api-client";
import type {
  AttendanceRecord,
  AttendanceValue,
  Game,
  GameResults,
  Me,
} from "../../../lib/consumer-types";
import {
  attendanceLabel,
  attendanceSourceLabel,
  canOfferAttendanceWrites,
} from "../../../lib/game-results";
import { Button } from "../Button";
import { ContentContainer, SurfacePanel } from "../Surfaces";
import { Avatar, ProfileDialog, SectionHeader } from "../players/ProfileComposition";
import "../../../styles/postgame.css";

type Tab = "attendance" | "clarification" | "feedback";
type MarkTarget = { record: AttendanceRecord; mode: "single" | "bulk-review" } | null;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatWhen(iso: string | undefined, timezone?: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || undefined,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function GameResultsComposition({ gameId }: { gameId: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [results, setResults] = useState<GameResults | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "error" | "forbidden">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");
  const [busy, setBusy] = useState(false);
  const [unknownOp, setUnknownOp] = useState(false);
  const [markTarget, setMarkTarget] = useState<MarkTarget>(null);
  const [markValue, setMarkValue] = useState<AttendanceValue>("present");
  const [markLate, setMarkLate] = useState(false);
  const [markReason, setMarkReason] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Record<string, boolean>>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState<"held" | "not_held">("held");
  const [outcomeReason, setOutcomeReason] = useState("");
  const mutation = useRef(false);
  const epoch = useRef(0);

  const writes = canOfferAttendanceWrites(results);
  const isManager = Boolean(results?.attendance?.roster);
  const my = results?.attendance?.myAttendance ?? null;

  async function reload() {
    const request = ++epoch.current;
    setState("loading");
    setError(null);
    setUnknownOp(false);
    const account = await getMe();
    if (request !== epoch.current) return;
    if (!account.ok) {
      setState(account.status === 401 ? "auth" : "error");
      setError("Не удалось проверить вход.");
      return;
    }
    setMe(account.data);
    const [gameRes, resultsRes] = await Promise.all([getGame(gameId), getGameResults(gameId)]);
    if (request !== epoch.current) return;
    if (!resultsRes.ok) {
      if (resultsRes.status === 401) {
        setState("auth");
        return;
      }
      if (resultsRes.status === 404) {
        setState("forbidden");
        setResults(null);
        setGame(null);
        return;
      }
      setState("error");
      setError(resultsRes.error);
      return;
    }
    setResults(resultsRes.data);
    setGame(gameRes.ok ? gameRes.data : null);
    setState("ready");
  }

  useEffect(() => {
    void reload();
    const onSession = () => {
      setMe(null);
      setResults(null);
      setState("auth");
    };
    window.addEventListener("gb-private-expired", onSession);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      window.removeEventListener("gb-private-expired", onSession);
      window.removeEventListener("gb-session-changed", onSession);
      epoch.current += 1;
    };
  }, [gameId]);

  const selectedBulkItems = useMemo(() => {
    const roster = results?.attendance?.roster ?? [];
    return roster.filter((row) => bulkSelected[row.contextId]);
  }, [results, bulkSelected]);

  async function runMutation(label: string, work: () => Promise<{ ok: boolean; status: number; error?: string; problem?: { code?: string } }>) {
    if (!me || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setNotice(null);
    setUnknownOp(false);
    try {
      const result = await work();
      if (!result.ok) {
        if (result.status === 0 || result.status >= 500) {
          setUnknownOp(true);
          setNotice(`${label}: результат неизвестен. Проверьте ту же операцию, не меняя данные.`);
          return;
        }
        if (result.problem?.code === "VERSION_CONFLICT") {
          setNotice("Версия устарела. Обновите данные и повторите.");
          await reload();
          return;
        }
        setNotice(result.error ?? "Не удалось выполнить действие.");
        return;
      }
      setNotice(null);
      await reload();
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  async function submitMark() {
    if (!me || !markTarget || markTarget.mode !== "single") return;
    const record = markTarget.record;
    await runMutation("Отметка", () =>
      putGameAttendance(
        gameId,
        record.contextId,
        {
          expectedVersion: record.version,
          value: markValue,
          late: markValue === "present" ? markLate : false,
          ...(record.version > 0 ? { correctionReason: markReason.trim() || "Исправление" } : {}),
        },
        me.csrfToken,
      ),
    );
    setMarkTarget(null);
  }

  async function submitBulk() {
    if (!me || selectedBulkItems.length === 0) return;
    await runMutation("Массовая отметка", () =>
      bulkPresentAttendance(
        gameId,
        {
          items: selectedBulkItems.map((row) => ({
            contextId: row.contextId,
            expectedVersion: row.version,
          })),
          confirmedExactSelection: true,
        },
        me.csrfToken,
      ),
    );
    setBulkConfirmOpen(false);
    setBulkSelected({});
  }

  async function submitAck() {
    if (!me || !my) return;
    await runMutation("Подтверждение", () =>
      acknowledgeAttendance(gameId, my.contextId, my.version, me.csrfToken),
    );
  }

  async function submitDispute() {
    if (!me || !my) return;
    await runMutation("Возражение", () =>
      disputeAttendance(
        gameId,
        my.contextId,
        { attendanceVersion: my.version, explanation: disputeText.trim() },
        me.csrfToken,
      ),
    );
    setDisputeOpen(false);
    setDisputeText("");
  }

  async function openHistory(contextId: string) {
    const history = await getAttendanceHistory(gameId, contextId);
    if (!history.ok) {
      setNotice(history.error);
      return;
    }
    setHistoryLines(
      history.data.items.map(
        (item) =>
          `v${item.version}: ${attendanceLabel(item.after.value)}${item.after.late ? " · опоздание" : ""} · ${item.actorDisplay} · ${item.source} · ${item.recordedAt}`,
      ),
    );
    setHistoryOpen(true);
  }

  async function submitOutcome() {
    if (!me || !results) return;
    await runMutation("Итог", () =>
      putGameOutcome(
        gameId,
        {
          expectedVersion: results.outcome.version,
          outcome: outcomeValue,
          ...(outcomeValue === "not_held" || results.outcome.version > 0
            ? { reason: outcomeReason.trim() || "Уточнение итога" }
            : {}),
        },
        me.csrfToken,
      ),
    );
    setOutcomeOpen(false);
  }

  return (
    <ContentContainer className="gb-postgame" data-surface="game-results">
      <a className="gb-postgame__back" href="/my-games">← К моим играм</a>
      <h1>Участники / Итоги</h1>

      {state === "loading" ? <p role="status">Загружаем итоги…</p> : null}
      {state === "auth" ? <p>Войдите, чтобы открыть итоги игры.</p> : null}
      {state === "forbidden" ? <p>Итоги этой игры недоступны.</p> : null}
      {state === "error" ? (
        <div>
          <p>{error}</p>
          <Button onClick={() => void reload()}>Обновить</Button>
        </div>
      ) : null}

      {state === "ready" && results ? (
        <>
          <SurfacePanel tone="bordered" className="gb-postgame__context">
            <div className="gb-postgame__date">
              <strong>{game ? formatWhen(game.startsAt, game.timezone).split(",")[0] : "Игра"}</strong>
            </div>
            <div>
              <h2>{game?.title ?? "Контекст игры"}</h2>
              <p>
                {game
                  ? `${formatWhen(game.startsAt, game.timezone)} · ${game.venue.name}`
                  : "Компактный игровой контекст"}
              </p>
            </div>
          </SurfacePanel>

          <div className="gb-postgame__tabs" role="tablist" aria-label="Разделы итогов">
            <button type="button" role="tab" aria-selected={tab === "attendance"} onClick={() => setTab("attendance")}>
              Посещение
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "clarification"}
              onClick={() => setTab("clarification")}
            >
              Уточнение{my?.dispute?.status === "open" ? " · 1" : ""}
            </button>
            <button type="button" role="tab" aria-selected={tab === "feedback"} onClick={() => setTab("feedback")}>
              Обратная связь
            </button>
          </div>

          {notice ? <p className="gb-postgame__notice" role="status">{notice}</p> : null}
          {unknownOp ? <p className="gb-postgame__unknown" role="status">Состояние операции неизвестно — не считаем успехом.</p> : null}

          {tab === "attendance" ? (
            <div className="gb-postgame__layout">
              <div className="gb-postgame__main">
                <SurfacePanel tone="bordered" className="gb-postgame__panel">
                  <SectionHeader title="Итог встречи" />
                  <p>Как прошла игра? Укажите итог явно. Посещение уточняется отдельно.</p>
                  <p>
                    Сейчас:{" "}
                    {results.outcome.value === "unknown"
                      ? "ещё не указан"
                      : results.outcome.value === "held"
                        ? "игра состоялась"
                        : "не состоялась"}
                    {results.outcome.version > 0 ? ` · версия ${results.outcome.version}` : ""}
                  </p>
                  {results.allowedActions.canRecordOutcome ? (
                    <Button disabled={busy} onClick={() => setOutcomeOpen(true)}>Указать итог</Button>
                  ) : null}
                </SurfacePanel>

                {isManager ? (
                  <SurfacePanel tone="bordered" className="gb-postgame__panel">
                    <SectionHeader title="Фактическое посещение" />
                    <p>
                      {results.attendance?.summary?.rosterCount ?? 0} записей состава на момент игры. Отметка не
                      выводится из заявки автоматически.
                    </p>
                    {writes && results.attendance?.allowedActions.canBulkPresent ? (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setBulkSelected({});
                          setBulkConfirmOpen(true);
                        }}
                      >
                        Пришли все
                      </Button>
                    ) : null}
                    {results.attendance?.summary ? (
                      <ul className="gb-postgame__stats">
                        <li>{results.attendance.summary.marked} отмечено</li>
                        <li>{results.attendance.summary.unknown} неизвестно</li>
                        <li>{results.attendance.summary.underClarification} на уточнении</li>
                        <li>{results.attendance.summary.agreed} согласовано</li>
                      </ul>
                    ) : null}
                    <div className="gb-postgame__roster" role="table" aria-label="Состав">
                      {(results.attendance?.roster ?? []).map((row) => (
                        <div key={row.contextId} className="gb-postgame__row" role="row">
                          <div className="gb-postgame__who">
                            <Avatar name={row.displayName} />
                            <div>
                              <strong>{row.displayName}</strong>
                              <small>
                                {row.dispute?.status === "open"
                                  ? "На уточнении"
                                  : row.acknowledgedVersion === row.version && row.value !== "unknown"
                                    ? "Участник подтвердил"
                                    : row.value === "unknown"
                                      ? "Ещё без отметки"
                                      : "Ждёт ответа участника"}
                              </small>
                            </div>
                          </div>
                          <span className="gb-postgame__pill" data-value={row.value}>
                            {attendanceLabel(row.value)}
                            {row.late ? " · опоздание" : ""}
                          </span>
                          {writes && row.allowedActions.canSetAttendance ? (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setMarkTarget({ record: row, mode: "single" });
                                setMarkValue(row.value === "absent" ? "absent" : "present");
                                setMarkLate(row.late);
                                setMarkReason("");
                              }}
                            >
                              Изменить
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {!writes ? (
                      <p className="gb-postgame__helper">
                        Запись посещения сейчас недоступна на сервере. Чтение своих данных сохраняется.
                      </p>
                    ) : null}
                  </SurfacePanel>
                ) : (
                  <SurfacePanel tone="soft" className="gb-postgame__panel gb-postgame__notice-card">
                    <SectionHeader title="Организатор отметил ваше посещение" />
                    {my && my.value !== "unknown" ? (
                      <>
                        <p className="gb-postgame__pill" data-tone="wait">
                          {my.dispute?.status === "open"
                            ? "На уточнении"
                            : my.acknowledgedVersion === my.version
                              ? "Подтверждено вами"
                              : "Ждёт вашего ответа"}
                        </p>
                        <p>Проверьте отметку. Отсутствие ответа не означает согласие.</p>
                        <p>
                          <strong>{attendanceLabel(my.value)}</strong>
                          {my.late ? " · опоздание" : ""} · версия {my.version}
                          {my.assertion.actorDisplay ? ` · ${my.assertion.actorDisplay}` : ""}
                          {my.assertion.source ? ` · ${attendanceSourceLabel(my.assertion.source)}` : ""}
                        </p>
                        <div className="gb-postgame__actions">
                          {writes && my.allowedActions.canAcknowledge ? (
                            <Button disabled={busy} onClick={() => void submitAck()}>Всё верно</Button>
                          ) : null}
                          {writes && my.allowedActions.canDispute ? (
                            <Button variant="outline" disabled={busy} onClick={() => setDisputeOpen(true)}>
                              Запросить исправление
                            </Button>
                          ) : null}
                          <Button variant="outline" disabled={busy} onClick={() => void openHistory(my.contextId)}>
                            История изменений
                          </Button>
                        </div>
                        <p className="gb-postgame__helper">
                          Уведомление сохранено в «Моих играх», а не только в чате.
                        </p>
                      </>
                    ) : (
                      <p>Пока нет отметки по вашему участию. Молчание не создаёт согласие.</p>
                    )}
                  </SurfacePanel>
                )}
              </div>

              <aside className="gb-postgame__rail">
                <SectionHeader title="Об этой встрече" eyebrow="Контекст" />
                <p>
                  {results.outcome.value === "unknown"
                    ? "Итог ещё не указан. Время окончания не подтверждает, что игра состоялась."
                    : results.outcome.value === "held"
                      ? "Игра отмечена как состоявшаяся."
                      : "Игра отмечена как несостоявшаяся."}
                </p>
                <SectionHeader title="Только по делу" />
                <p>Отметки доступны вам и каждому участнику о себе. Отзывы не становятся публичным рейтингом.</p>
              </aside>
            </div>
          ) : null}

          {tab === "clarification" ? (
            <SurfacePanel tone="bordered" className="gb-postgame__panel">
              <SectionHeader title="Уточнение" />
              {my?.dispute?.status === "open" ? (
                <>
                  <p className="gb-postgame__pill" data-tone="wait">На уточнении</p>
                  <p>
                    Открытое возражение к версии {my.dispute.challengedVersion}. Новая отметка организатора не закрывает
                    его молча.
                  </p>
                  <p>Полный ответ организатора и независимое разрешение — в следующем срезе (PG-2).</p>
                </>
              ) : (
                <p>Нет открытого уточнения по вашей отметке.</p>
              )}
            </SurfacePanel>
          ) : null}

          {tab === "feedback" ? (
            <SurfacePanel tone="bordered" className="gb-postgame__panel">
              <SectionHeader title="Обратная связь" />
              <p>Раздел появится позже. Кнопки отправки сейчас не предлагаются.</p>
            </SurfacePanel>
          ) : null}
        </>
      ) : null}

      {markTarget?.mode === "single" && (
        <ProfileDialog title="Отметить посещение" onClose={() => !busy && setMarkTarget(null)}>
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitMark();
            }}
          >
            <p>{markTarget.record.displayName}</p>
            <label className="profile-field">
              Отметка
              <select value={markValue} onChange={(e) => setMarkValue(e.target.value as AttendanceValue)} disabled={busy}>
                <option value="present">Пришёл</option>
                <option value="absent">Не пришёл</option>
              </select>
            </label>
            {markValue === "present" ? (
              <label className="profile-field">
                <input type="checkbox" checked={markLate} onChange={(e) => setMarkLate(e.target.checked)} disabled={busy} />{" "}
                Опоздание
              </label>
            ) : null}
            {markTarget.record.version > 0 ? (
              <label className="profile-field">
                Причина исправления
                <textarea value={markReason} maxLength={500} rows={3} onChange={(e) => setMarkReason(e.target.value)} disabled={busy} />
              </label>
            ) : null}
            <Button type="submit" disabled={busy || (markTarget.record.version > 0 && !markReason.trim())}>
              Сохранить
            </Button>
          </form>
        </ProfileDialog>
      )}

      {bulkConfirmOpen && (
        <ProfileDialog title="Пришли все выбранные" onClose={() => !busy && setBulkConfirmOpen(false)}>
          <div className="gb-postgame__dialog-form">
            <p>Выбор пуст по умолчанию. Подтвердите конкретные имена и версии — без динамического «остатка».</p>
            <ul className="gb-postgame__bulk-list">
              {(results?.attendance?.roster ?? []).map((row) => (
                <li key={row.contextId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(bulkSelected[row.contextId])}
                      disabled={busy}
                      onChange={(e) =>
                        setBulkSelected((current) => ({ ...current, [row.contextId]: e.target.checked }))
                      }
                    />{" "}
                    {row.displayName} · {attendanceLabel(row.value)} · v{row.version}
                  </label>
                </li>
              ))}
            </ul>
            <Button disabled={busy || selectedBulkItems.length === 0} onClick={() => void submitBulk()}>
              Да, пришли все выбранные
            </Button>
          </div>
        </ProfileDialog>
      )}

      {disputeOpen && my && (
        <ProfileDialog title="Запросить исправление" onClose={() => !busy && setDisputeOpen(false)}>
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitDispute();
            }}
          >
            <p>
              Текущая отметка: {attendanceLabel(my.value)}, версия {my.version}.
            </p>
            <label className="profile-field">
              Пояснение
              <textarea required maxLength={500} rows={4} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} disabled={busy} />
            </label>
            <Button type="submit" disabled={busy || !disputeText.trim()}>Отправить</Button>
          </form>
        </ProfileDialog>
      )}

      {historyOpen && (
        <ProfileDialog title="История изменений" onClose={() => setHistoryOpen(false)}>
          <ol className="gb-postgame__history">
            {historyLines.length === 0 ? <li>Пока нет записей.</li> : historyLines.map((line) => <li key={line}>{line}</li>)}
          </ol>
        </ProfileDialog>
      )}

      {outcomeOpen && results && (
        <ProfileDialog title="Итог встречи" onClose={() => !busy && setOutcomeOpen(false)}>
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitOutcome();
            }}
          >
            <label className="profile-field">
              Итог
              <select value={outcomeValue} onChange={(e) => setOutcomeValue(e.target.value as "held" | "not_held")} disabled={busy}>
                <option value="held">Состоялась</option>
                <option value="not_held">Не состоялась</option>
              </select>
            </label>
            {(outcomeValue === "not_held" || results.outcome.version > 0) && (
              <label className="profile-field">
                Причина
                <textarea required maxLength={500} rows={3} value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)} disabled={busy} />
              </label>
            )}
            <Button type="submit" disabled={busy}>Сохранить итог</Button>
          </form>
        </ProfileDialog>
      )}
    </ContentContainer>
  );
}

export function GameResultsAvatarFallback({ name }: { name: string }) {
  return <span aria-hidden>{initials(name)}</span>;
}
