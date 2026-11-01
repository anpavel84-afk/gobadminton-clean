"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getAttendanceDispute,
  getAttendanceHistory,
  getGame,
  getGameResults,
  getMe,
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
  defaultOpenDisputeId,
  formatGameDateBadge,
  listOpenAttendanceDisputes,
} from "../../../lib/game-results";
import type { AttendanceDispute } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ContentContainer, SurfacePanel } from "../Surfaces";
import { Avatar, ProfileDialog, SectionHeader } from "../players/ProfileComposition";
import {
  type GameResultsMutationApi,
  type GameResultsMutationData,
  useGameResultsMutation,
} from "./useGameResultsMutation";
import { GameFeedbackPanel } from "./GameFeedbackPanel";
import "../../../styles/postgame.css";

type Tab = "attendance" | "clarification" | "feedback";
type MarkTarget = { record: AttendanceRecord; mode: "single" | "bulk-review" } | null;

/**
 * Immutable actor+game operation host: one useGameResultsMutation instance for this
 * mount only. Parent keys by `${actorId}:${gameId}` so A→B / game change remounts
 * (live=false + generation bump) and cannot retry or clear across hosts.
 */
function GameResultsMutationHost({
  actorId,
  gameId,
  csrf,
  onSuccess,
  onRefresh,
  children,
}: {
  actorId: string;
  gameId: string;
  csrf: string;
  onSuccess: (data: GameResultsMutationData) => void;
  onRefresh: () => void;
  children: (mutation: GameResultsMutationApi) => ReactNode;
}) {
  const mutation = useGameResultsMutation(actorId, gameId, csrf, onSuccess, onRefresh);
  return <>{children(mutation)}</>;
}

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
  const [markTarget, setMarkTarget] = useState<MarkTarget>(null);
  const [markValue, setMarkValue] = useState<AttendanceValue>("present");
  const [markLate, setMarkLate] = useState(false);
  const [markReason, setMarkReason] = useState("");
  const [bulkSelected, setBulkSelected] = useState<Record<string, boolean>>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState("");
  const [disputeDetail, setDisputeDetail] = useState<AttendanceDispute | null>(null);
  const [selectedDisputeId, setSelectedDisputeId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [responseValue, setResponseValue] = useState<AttendanceValue>("present");
  const [responseLate, setResponseLate] = useState(false);
  const [responseReason, setResponseReason] = useState("");
  const [responseCorrect, setResponseCorrect] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState<"held" | "not_held">("held");
  const [outcomeReason, setOutcomeReason] = useState("");
  const epoch = useRef(0);
  const disputeFetchGen = useRef(0);
  const selectedDisputeRef = useRef<string | null>(null);
  const actorRef = useRef<string | null>(null);
  actorRef.current = me?.id ?? null;
  selectedDisputeRef.current = selectedDisputeId;

  function resetResponseDraft() {
    setResponseText("");
    setResponseValue("present");
    setResponseLate(false);
    setResponseReason("");
    setResponseCorrect(false);
    setHelpText("");
  }

  function clearSensitiveUi() {
    setResults(null);
    setGame(null);
    setMarkTarget(null);
    setBulkSelected({});
    setBulkConfirmOpen(false);
    setDisputeOpen(false);
    setDisputeText("");
    setDisputeDetail(null);
    setSelectedDisputeId(null);
    selectedDisputeRef.current = null;
    resetResponseDraft();
    setHistoryOpen(false);
    setHistoryLines([]);
    setOutcomeOpen(false);
    setNotice(null);
    setError(null);
  }

  async function loadDisputeDetail(disputeId: string, opts?: { resetDraft?: boolean }) {
    const gen = ++disputeFetchGen.current;
    selectedDisputeRef.current = disputeId;
    setSelectedDisputeId(disputeId);
    if (opts?.resetDraft) resetResponseDraft();
    const detail = await getAttendanceDispute(disputeId);
    // Fence late fetch A after selecting B — do not adopt stale detail or clear UNKNOWN of A.
    if (gen !== disputeFetchGen.current || selectedDisputeRef.current !== disputeId) return;
    if (actorRef.current == null) return;
    setDisputeDetail(detail.ok ? detail.data : null);
  }

  async function reload() {
    const request = ++epoch.current;
    setState("loading");
    setError(null);
    // Readonly reload must not clear unresolved mutation identity / pending storage.
    const account = await getMe();
    if (request !== epoch.current) return;
    if (!account.ok) {
      actorRef.current = null;
      setMe(null);
      clearSensitiveUi();
      setState(account.status === 401 ? "auth" : "error");
      setError("Не удалось проверить вход.");
      return;
    }
    setMe(account.data);
    const [gameRes, resultsRes] = await Promise.all([getGame(gameId), getGameResults(gameId)]);
    // dispute detail loaded after results when open — see below after results ok
    if (request !== epoch.current) return;
    if (actorRef.current && actorRef.current !== account.data.id) return;
    if (!resultsRes.ok) {
      if (resultsRes.status === 401) {
        actorRef.current = null;
        setMe(null);
        clearSensitiveUi();
        setState("auth");
        return;
      }
      if (resultsRes.status === 404) {
        clearSensitiveUi();
        setState("forbidden");
        return;
      }
      setState("error");
      setError(resultsRes.error);
      return;
    }
    setResults(resultsRes.data);
    // Public getGame may 404 while authorized own results remain usable.
    setGame(gameRes.ok ? gameRes.data : null);
    const openList = listOpenAttendanceDisputes(resultsRes.data);
    const preferred =
      selectedDisputeRef.current && openList.some((item) => item.disputeId === selectedDisputeRef.current)
        ? selectedDisputeRef.current
        : defaultOpenDisputeId(resultsRes.data);
    if (preferred) {
      const gen = ++disputeFetchGen.current;
      selectedDisputeRef.current = preferred;
      setSelectedDisputeId(preferred);
      const detail = await getAttendanceDispute(preferred);
      if (request !== epoch.current) return;
      if (actorRef.current && actorRef.current !== account.data.id) return;
      if (gen !== disputeFetchGen.current || selectedDisputeRef.current !== preferred) return;
      setDisputeDetail(detail.ok ? detail.data : null);
    } else {
      setSelectedDisputeId(null);
      selectedDisputeRef.current = null;
      setDisputeDetail(null);
    }
    setState("ready");
  }

  useEffect(() => {
    epoch.current += 1;
    actorRef.current = null;
    setMe(null);
    clearSensitiveUi();
    setState("loading");
    void reload();
    const onSession = () => {
      // Synchronously invalidate async ownership + clear private/UI transients.
      epoch.current += 1;
      actorRef.current = null;
      setMe(null);
      clearSensitiveUi();
      setState("auth");
      // Prior actor pending remains under that actor's scope key — no silent delete/resend.
    };
    window.addEventListener("gb-private-expired", onSession);
    window.addEventListener("gb-session-changed", onSession);
    return () => {
      window.removeEventListener("gb-private-expired", onSession);
      window.removeEventListener("gb-session-changed", onSession);
      epoch.current += 1;
      actorRef.current = null;
    };
  }, [gameId]);

  const selectedBulkItems = useMemo(() => {
    const roster = results?.attendance?.roster ?? [];
    return roster.filter((row) => bulkSelected[row.contextId]);
  }, [results, bulkSelected]);

  function renderWritable(mutation: GameResultsMutationApi) {
    const writes = canOfferAttendanceWrites(results);
    const isManager = Boolean(results?.attendance?.roster);
    const my = results?.attendance?.myAttendance ?? null;
    const openDisputes = listOpenAttendanceDisputes(results);
    const selectedOpen = openDisputes.find((item) => item.disputeId === selectedDisputeId) ?? null;
    const busy = mutation.busy;
    const unknownOp = mutation.pending;
    const displayNotice = notice ?? (mutation.notice || null);

    function selectOpenDispute(disputeId: string) {
      setTab("clarification");
      void loadDisputeDetail(disputeId, { resetDraft: true });
    }

    function runWrite(path: string, body: object, method: string): boolean {
      if (!me || unknownOp || busy) return false;
      setNotice(null);
      // Synchronous admission: double-click before re-render is rejected by hook lock/pending.
      return mutation.run(path, body, method);
    }

    function submitMark() {
      if (!me || !markTarget || markTarget.mode !== "single") return;
      const record = markTarget.record;
      const reason = markReason.trim();
      if (record.version > 0 && !reason) {
        setNotice("Укажите причину исправления.");
        return;
      }
      runWrite(
        `/v1/games/${gameId}/attendance/${record.contextId}`,
        {
          expectedVersion: record.version,
          value: markValue,
          late: markValue === "present" ? markLate : false,
          ...(record.version > 0 ? { correctionReason: reason } : {}),
        },
        "PUT",
      );
    }

    function submitBulk() {
      if (!me || selectedBulkItems.length === 0) return;
      runWrite(
        `/v1/games/${gameId}/attendance/bulk-present`,
        {
          items: selectedBulkItems.map((row) => ({
            contextId: row.contextId,
            expectedVersion: row.version,
          })),
          confirmedExactSelection: true,
        },
        "POST",
      );
    }

    function submitAck(resolveOpenDispute = false) {
      if (!me || !my) return;
      if (my.value === "unknown") {
        setNotice("Неизвестную отметку нельзя подтвердить.");
        return;
      }
      const body: Record<string, unknown> = { attendanceVersion: my.version };
      if (resolveOpenDispute && my.dispute?.status === "open") {
        body.resolvingDisputeId = my.dispute.id;
        body.expectedDisputeVersion = my.dispute.version;
      }
      runWrite(
        `/v1/games/${gameId}/attendance/${my.contextId}/acknowledgements`,
        body,
        "POST",
      );
    }

    function submitRespond() {
      if (!me || !disputeDetail) return;
      const explanation = responseText.trim();
      if (!explanation) {
        setNotice("Укажите пояснение ответа.");
        return;
      }
      const body: Record<string, unknown> = {
        expectedVersion: disputeDetail.version,
        explanation,
      };
      if (responseCorrect) {
        const reason = responseReason.trim();
        if (!reason) {
          setNotice("Укажите причину исправления.");
          return;
        }
        body.correction = {
          expectedAttendanceVersion: disputeDetail.currentAssertion?.version ?? my?.version ?? 0,
          value: responseValue,
          late: responseValue === "present" ? responseLate : false,
          correctionReason: reason,
        };
      }
      runWrite(`/v1/attendance-disputes/${disputeDetail.id}/responses`, body, "POST");
    }

    function submitHelp(explanationRaw?: string) {
      if (!me || !disputeDetail) return;
      const explanation = (explanationRaw ?? helpText).trim();
      if (!explanation) {
        setNotice("Укажите, в чём нужна помощь.");
        return;
      }
      setHelpText(explanation);
      runWrite(
        `/v1/attendance-disputes/${disputeDetail.id}/help`,
        { expectedVersion: disputeDetail.version, explanation },
        "POST",
      );
    }

    function submitWithdraw() {
      if (!me || !disputeDetail) return;
      runWrite(
        `/v1/attendance-disputes/${disputeDetail.id}/withdraw`,
        { expectedVersion: disputeDetail.version },
        "POST",
      );
    }

    function submitDispute() {
      if (!me || !my) return;
      const explanation = disputeText.trim();
      if (!explanation) {
        setNotice("Укажите пояснение.");
        return;
      }
      runWrite(
        `/v1/games/${gameId}/attendance/${my.contextId}/disputes`,
        { attendanceVersion: my.version, explanation },
        "POST",
      );
    }

    async function openHistory(contextId: string) {
      const request = epoch.current;
      const history = await getAttendanceHistory(gameId, contextId);
      if (request !== epoch.current) return;
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

    function submitOutcome() {
      if (!me || !results) return;
      const needsReason = outcomeValue === "not_held" || results.outcome.version > 0;
      const reason = outcomeReason.trim();
      if (needsReason && !reason) {
        setNotice("Укажите причину.");
        return;
      }
      runWrite(
        `/v1/games/${gameId}/outcome`,
        {
          expectedVersion: results.outcome.version,
          outcome: outcomeValue,
          ...(needsReason ? { reason } : {}),
        },
        "PUT",
      );
    }

    return (
      <>
      {state === "loading" ? <p role="status">Загружаем итоги…</p> : null}
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
            <div className="gb-postgame__date" aria-hidden={!game}>
              {(() => {
                const badge = formatGameDateBadge(game?.startsAt, game?.timezone);
                return (
                  <>
                    <strong>{badge.day}</strong>
                    <span>{badge.month}</span>
                  </>
                );
              })()}
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
              Уточнение{openDisputes.length > 0 ? ` · ${openDisputes.length}` : ""}
            </button>
            <button type="button" role="tab" aria-selected={tab === "feedback"} onClick={() => setTab("feedback")}>
              Обратная связь
            </button>
          </div>

          {displayNotice ? <p className="gb-postgame__notice" role="status">{displayNotice}</p> : null}
          {unknownOp ? (
            <p className="gb-postgame__unknown" role="status">
              Состояние операции неизвестно — не считаем успехом.{" "}
              <Button variant="outline" disabled={busy} onClick={() => mutation.retry()}>
                Проверить ту же отправку
              </Button>
            </p>
          ) : null}

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
                    <Button disabled={busy || unknownOp} onClick={() => setOutcomeOpen(true)}>Указать итог</Button>
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
                        disabled={busy || unknownOp}
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
                          <div className="gb-postgame__actions">
                            {row.dispute?.status === "open" &&
                            (row.allowedActions.canRespondDispute || writes) ? (
                              <Button
                                variant="outline"
                                disabled={busy}
                                aria-pressed={selectedDisputeId === row.dispute.id}
                                onClick={() => selectOpenDispute(row.dispute!.id)}
                              >
                                {selectedDisputeId === row.dispute.id ? "Выбрано уточнение" : "Открыть уточнение"}
                              </Button>
                            ) : null}
                            {writes && row.allowedActions.canSetAttendance ? (
                              <Button
                                variant="outline"
                                disabled={busy || unknownOp}
                                onClick={() => {
                                  setMarkTarget({ record: row, mode: "single" });
                                  setMarkValue(
                                    row.value === "absent"
                                      ? "absent"
                                      : row.value === "unknown"
                                        ? "present"
                                        : "present",
                                  );
                                  setMarkLate(row.late);
                                  setMarkReason("");
                                }}
                              >
                                Изменить
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!writes ? (
                      <p className="gb-postgame__helper">
                        Запись посещения сейчас недоступна на сервере. Чтение своих данных сохраняется.
                      </p>
                    ) : null}
                  </SurfacePanel>
                ) : null}
                {/* Own attendance/provenance/ack/objection independent of manager roster.
                    Creator without seat (no myAttendance) is not a participant — skip. */}
                {my || !isManager ? (
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
                            <Button disabled={busy || unknownOp} onClick={() => submitAck()}>
                              Согласен с этой отметкой
                            </Button>
                          ) : null}
                          {writes && my.allowedActions.canDispute ? (
                            <Button variant="outline" disabled={busy || unknownOp} onClick={() => setDisputeOpen(true)}>
                              Запросить исправление
                            </Button>
                          ) : null}
                          <Button variant="outline" disabled={busy} onClick={() => void openHistory(my.contextId)}>
                            История изменений
                          </Button>
                        </div>
                        <p className="gb-postgame__helper">
                          «Согласен с этой отметкой» — явное согласие с точной версией отметки, не просто ознакомление.
                          Уведомление сохранено в «Моих играх», а не только в чате.
                        </p>
                      </>
                    ) : (
                      <p>Пока нет отметки по вашему участию. Молчание не создаёт согласие.</p>
                    )}
                  </SurfacePanel>
                ) : null}
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
            <div className="gb-postgame__layout">
              <div className="gb-postgame__main">
                <SurfacePanel tone="bordered" className="gb-postgame__panel">
                  <div className="gb-postgame__clarify-head">
                    <SectionHeader
                      title="Давайте уточним"
                      eyebrow={
                        isManager && selectedOpen
                          ? `Посещение · ${selectedOpen.displayName}`
                          : "Посещение · ваша отметка"
                      }
                    />
                    {(my?.dispute?.status === "open" || disputeDetail?.status === "open") && (
                      <p className="gb-postgame__pill" data-tone="wait">На уточнении</p>
                    )}
                  </div>
                  {isManager && openDisputes.length > 1 ? (
                    <div className="gb-postgame__dispute-picks" role="group" aria-label="Открытые уточнения">
                      {openDisputes.map((item) => (
                        <button
                          key={item.disputeId}
                          type="button"
                          className="gb-postgame__pill"
                          data-tone={selectedDisputeId === item.disputeId ? "wait" : undefined}
                          data-value={item.value}
                          aria-pressed={selectedDisputeId === item.disputeId}
                          disabled={busy}
                          onClick={() => selectOpenDispute(item.disputeId)}
                        >
                          {item.displayName}
                          {selectedDisputeId === item.disputeId ? " · выбрано" : ""}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {disputeDetail &&
                  selectedDisputeId === disputeDetail.id &&
                  (my?.dispute?.id === disputeDetail.id || isManager) ? (
                    <>
                      {selectedOpen ? (
                        <p>
                          Участник: <strong>{selectedOpen.displayName}</strong>. Оспаривается v
                          {selectedOpen.challengedVersion}; сейчас «{attendanceLabel(selectedOpen.value)}».
                        </p>
                      ) : null}
                      <p>
                        Вопрос к прежней отметке. Сейчас: «
                        {attendanceLabel(disputeDetail.currentAssertion?.value ?? selectedOpen?.value ?? my?.value ?? "unknown")}», версия{" "}
                        {disputeDetail.currentAssertion?.version ?? my?.version ?? "—"}.
                      </p>
                      <div className="gb-postgame__side-by-side">
                        <div className="gb-postgame__quote">
                          <strong>Оспариваемая отметка</strong>
                          <p>
                            {disputeDetail.challengedAssertion
                              ? `v${disputeDetail.challengedAssertion.version}: «${attendanceLabel(disputeDetail.challengedAssertion.value)}» · ${disputeDetail.challengedAssertion.actorDisplay}`
                              : `Версия ${disputeDetail.challengedVersion}`}
                          </p>
                        </div>
                        <div className="gb-postgame__quote">
                          <strong>Текущая отметка</strong>
                          <p>
                            v{disputeDetail.currentAssertion?.version ?? 0}: «
                            {attendanceLabel(disputeDetail.currentAssertion?.value ?? "unknown")}»
                            {disputeDetail.currentAssertion?.assertion.actorDisplay
                              ? ` · ${disputeDetail.currentAssertion.assertion.actorDisplay}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="gb-postgame__quote" data-tone="party">
                        <strong>{selectedOpen?.displayName ?? my?.displayName ?? "Участник"}</strong>
                        <p>{disputeDetail.explanation}</p>
                      </div>
                      {disputeDetail.latestManagerResponse ? (
                        <div className="gb-postgame__quote">
                          <strong>Ответ организатора</strong>
                          <p>{disputeDetail.latestManagerResponse}</p>
                        </div>
                      ) : null}
                      {disputeDetail.helpProgress ? (
                        <p className="gb-postgame__helper">
                          Помощь:{" "}
                          {disputeDetail.caseProgress?.linked
                            ? "обращение принято в работу"
                            : disputeDetail.helpProgress === "requested"
                              ? "запрос отправлен, ожидает служебного приёма"
                              : disputeDetail.helpProgress}
                          . Это не автоматическая жалоба и не назначение сотрудника.
                        </p>
                      ) : null}
                      <div className="gb-postgame__actions">
                        {writes && disputeDetail.allowedActions.canAcknowledgeCurrent ? (
                          <Button disabled={busy || unknownOp} onClick={() => submitAck(true)}>
                            Проверить текущую отметку
                          </Button>
                        ) : null}
                        {writes && disputeDetail.allowedActions.canRequestHelp ? (
                          <Button
                            variant="outline"
                            disabled={busy || unknownOp}
                            onClick={() =>
                              submitHelp(helpText.trim() || "Нужна помощь по уточнению посещения.")
                            }
                          >
                            Помощь по уточнению
                          </Button>
                        ) : null}
                        {writes && disputeDetail.allowedActions.canRespond ? (
                          <Button disabled={busy || unknownOp} onClick={() => submitRespond()}>
                            Ответить / исправить
                          </Button>
                        ) : null}
                      </div>
                      {writes && disputeDetail.allowedActions.canRespond ? (
                        <div className="gb-postgame__dialog-form">
                          <label className="profile-field">
                            Пояснение организатора
                            <textarea
                              maxLength={500}
                              rows={3}
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              disabled={busy || unknownOp}
                            />
                          </label>
                          <label className="profile-field">
                            <input
                              type="checkbox"
                              checked={responseCorrect}
                              onChange={(e) => setResponseCorrect(e.target.checked)}
                              disabled={busy || unknownOp}
                            />{" "}
                            Также исправить текущую отметку (спор останется открытым)
                          </label>
                          {responseCorrect ? (
                            <>
                              <label className="profile-field">
                                Новая отметка
                                <select
                                  value={responseValue}
                                  onChange={(e) => setResponseValue(e.target.value as AttendanceValue)}
                                  disabled={busy || unknownOp}
                                >
                                  <option value="present">Пришёл</option>
                                  <option value="absent">Не пришёл</option>
                                  <option value="unknown">Неизвестно</option>
                                </select>
                              </label>
                              {responseValue === "present" ? (
                                <label className="profile-field">
                                  <input
                                    type="checkbox"
                                    checked={responseLate}
                                    onChange={(e) => setResponseLate(e.target.checked)}
                                    disabled={busy || unknownOp}
                                  />{" "}
                                  Опоздание
                                </label>
                              ) : null}
                              <label className="profile-field">
                                Причина исправления
                                <textarea
                                  required
                                  maxLength={500}
                                  rows={2}
                                  value={responseReason}
                                  onChange={(e) => setResponseReason(e.target.value)}
                                  disabled={busy || unknownOp}
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {writes && disputeDetail.allowedActions.canWithdraw ? (
                        <button
                          type="button"
                          className="gb-postgame__text-action"
                          disabled={busy || unknownOp}
                          onClick={() => submitWithdraw()}
                        >
                          Отозвать возражение
                          <small>Отзыв не меняет текущую отметку и не создаёт согласие.</small>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p>Нет открытого уточнения по вашей отметке.</p>
                  )}
                </SurfacePanel>
              </div>
              <aside className="gb-postgame__rail">
                <SectionHeader title="Только по делу" />
                <p>
                  Видны ваша отметка и ход этого уточнения. Участие в запросе и факт посещения — разные вещи.
                </p>
                {disputeDetail?.helpProgress === "requested" && !disputeDetail.caseProgress?.linked ? (
                  <p className="gb-postgame__helper">Ожидается служебный приём обращения — без ложного назначения.</p>
                ) : null}
              </aside>
            </div>
          ) : null}

          {tab === "feedback" ? (
            <GameFeedbackPanel
              gameId={gameId}
              feedback={results?.feedback}
              mutation={mutation}
              busy={busy}
              unknownOp={unknownOp}
              onLocalNotice={setNotice}
              noteSubjects={(results?.attendance?.roster ?? []).map((row) => ({
                contextId: row.contextId,
                displayName: row.displayName,
              }))}
            />
          ) : null}
        </>
      ) : null}

      {markTarget?.mode === "single" && (
        <ProfileDialog
          title="Отметить посещение"
          className="profile-dialog--postgame"
          lockBodyScroll
          onClose={() => !busy && setMarkTarget(null)}
        >
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitMark();
            }}
          >
            <p>{markTarget.record.displayName}</p>
            <label className="profile-field">
              Отметка
              <select value={markValue} onChange={(e) => setMarkValue(e.target.value as AttendanceValue)} disabled={busy || unknownOp}>
                <option value="present">Пришёл</option>
                <option value="absent">Не пришёл</option>
                {markTarget.record.version > 0 ? <option value="unknown">Неизвестно</option> : null}
              </select>
            </label>
            {markValue === "present" ? (
              <label className="profile-field">
                <input type="checkbox" checked={markLate} onChange={(e) => setMarkLate(e.target.checked)} disabled={busy || unknownOp} />{" "}
                Опоздание
              </label>
            ) : null}
            {markTarget.record.version > 0 ? (
              <label className="profile-field">
                Причина исправления
                <textarea
                  value={markReason}
                  maxLength={500}
                  rows={3}
                  required
                  onChange={(e) => setMarkReason(e.target.value)}
                  disabled={busy || unknownOp}
                />
              </label>
            ) : null}
            <Button type="submit" disabled={busy || unknownOp || (markTarget.record.version > 0 && !markReason.trim())}>
              Сохранить
            </Button>
          </form>
        </ProfileDialog>
      )}

      {bulkConfirmOpen && (
        <ProfileDialog
          title="Пришли все выбранные"
          className="profile-dialog--postgame"
          lockBodyScroll
          onClose={() => !busy && setBulkConfirmOpen(false)}
        >
          <div className="gb-postgame__dialog-form">
            <p>Выбор пуст по умолчанию. Подтвердите конкретные имена и версии — без динамического «остатка».</p>
            <ul className="gb-postgame__bulk-list">
              {(results?.attendance?.roster ?? []).map((row) => (
                <li key={row.contextId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(bulkSelected[row.contextId])}
                      disabled={busy || unknownOp}
                      onChange={(e) =>
                        setBulkSelected((current) => ({ ...current, [row.contextId]: e.target.checked }))
                      }
                    />{" "}
                    {row.displayName} · {attendanceLabel(row.value)} · v{row.version}
                  </label>
                </li>
              ))}
            </ul>
            <Button disabled={busy || unknownOp || selectedBulkItems.length === 0} onClick={() => submitBulk()}>
              Да, пришли все выбранные
            </Button>
          </div>
        </ProfileDialog>
      )}

      {disputeOpen && my && (
        <ProfileDialog
          title="Запросить исправление"
          className="profile-dialog--postgame"
          lockBodyScroll
          onClose={() => !busy && setDisputeOpen(false)}
        >
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitDispute();
            }}
          >
            <p>
              Текущая отметка: {attendanceLabel(my.value)}, версия {my.version}.
            </p>
            <label className="profile-field">
              Пояснение
              <textarea required maxLength={500} rows={4} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} disabled={busy || unknownOp} />
            </label>
            <Button type="submit" disabled={busy || unknownOp || !disputeText.trim()}>Отправить</Button>
          </form>
        </ProfileDialog>
      )}

      {historyOpen && (
        <ProfileDialog
          title="История изменений"
          className="profile-dialog--postgame"
          lockBodyScroll
          onClose={() => setHistoryOpen(false)}
        >
          <ol className="gb-postgame__history">
            {historyLines.length === 0 ? <li>Пока нет записей.</li> : historyLines.map((line) => <li key={line}>{line}</li>)}
          </ol>
        </ProfileDialog>
      )}

      {outcomeOpen && results && (
        <ProfileDialog
          title="Итог встречи"
          className="profile-dialog--postgame"
          lockBodyScroll
          onClose={() => !busy && setOutcomeOpen(false)}
        >
          <form
            className="gb-postgame__dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitOutcome();
            }}
          >
            <label className="profile-field">
              Итог
              <select value={outcomeValue} onChange={(e) => setOutcomeValue(e.target.value as "held" | "not_held")} disabled={busy || unknownOp}>
                <option value="held">Состоялась</option>
                <option value="not_held">Не состоялась</option>
              </select>
            </label>
            {(outcomeValue === "not_held" || results.outcome.version > 0) && (
              <label className="profile-field">
                Причина
                <textarea required maxLength={500} rows={3} value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)} disabled={busy || unknownOp} />
              </label>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                unknownOp ||
                ((outcomeValue === "not_held" || results.outcome.version > 0) && !outcomeReason.trim())
              }
            >
              Сохранить итог
            </Button>
          </form>
        </ProfileDialog>
      )}
      </>
    );
  }

  return (
    <ContentContainer className="gb-postgame" data-surface="game-results">
      <a className="gb-postgame__back" href="/my-games">← К моим играм</a>
      <h1>Участники / Итоги</h1>

      {!me ? (
        <>
          {state === "loading" ? <p role="status">Загружаем итоги…</p> : null}
          {state === "auth" ? <p>Войдите, чтобы открыть итоги игры.</p> : null}
          {state === "error" ? (
            <div>
              <p>{error}</p>
              <Button onClick={() => void reload()}>Обновить</Button>
            </div>
          ) : null}
          {state !== "loading" && state !== "auth" && state !== "error" ? (
            <p>Войдите, чтобы открыть итоги игры.</p>
          ) : null}
        </>
      ) : (
        <GameResultsMutationHost
          key={`${me.id}:${gameId}`}
          actorId={me.id}
          gameId={gameId}
          csrf={me.csrfToken}
          onSuccess={() => {
            // Native callback applies only while this actor still owns the page host.
            if (!actorRef.current || actorRef.current !== me.id) return;
            setMarkTarget(null);
            setBulkConfirmOpen(false);
            setBulkSelected({});
            setDisputeOpen(false);
            setDisputeText("");
            setOutcomeOpen(false);
            setNotice(null);
            void reload();
          }}
          onRefresh={() => {
            if (!actorRef.current || actorRef.current !== me.id) return;
            void reload();
          }}
        >
          {(mutation) => renderWritable(mutation)}
        </GameResultsMutationHost>
      )}
    </ContentContainer>
  );
}

export function GameResultsAvatarFallback({ name }: { name: string }) {
  return <span aria-hidden>{initials(name)}</span>;
}
