"use client";
import { useState } from "react";
import { AdminError, adminRequest, type Session } from "../lib/admin-client";

type DisputeMaterial = {
  caseId: string;
  caseVersion: number;
  caseStatus: string;
  assignedTo: string | null;
  dispute: {
    id: string;
    gameId: string;
    contextId: string;
    status: string;
    version: number;
    challengedVersion: number;
    explanation: string;
    helpProgress: string | null;
    subjectDisplay: string;
    challengedAssertion: { version: number; value: string; late: boolean; source: string; recordedAt: string } | null;
    currentAssertion: { value: string; version: number; late: boolean; source: string | null };
    history: { version: number; action: string; explanation: string | null; recordedAt: string }[];
  };
  allowedActions: { canResolve: boolean };
};

const resolutions = {
  uphold_current: "Утвердить текущую известную отметку",
  correct_present: "Исправить на «Пришёл»",
  correct_absent: "Исправить на «Не пришёл»",
  clear_unknown: "Сбросить в неизвестно",
  insufficient_evidence: "Оставить открытым — недостаточно данных",
} as const;

const valueLabel = (value: string) =>
  value === "present" ? "Пришёл" : value === "absent" ? "Не пришёл" : "Неизвестно";

export function AttendanceDisputes({
  session,
  busy,
  fresh,
  run,
  stepup,
}: {
  session: Session;
  busy: boolean;
  fresh: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  stepup: () => Promise<void>;
}) {
  const manager = session.roles.some((r) => ["superadmin", "moderator"].includes(r));
  const [caseId, setCaseId] = useState("");
  const [disputeId, setDisputeId] = useState("");
  const [intakeDisputeId, setIntakeDisputeId] = useState("");
  const [intakeVersion, setIntakeVersion] = useState("1");
  const [detail, setDetail] = useState<DisputeMaterial | null>(null);
  const [resolution, setResolution] = useState<keyof typeof resolutions>("uphold_current");
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState("attendance_review");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pendingRef, setPendingRef] = useState<{ path: string; key: string; body: object } | null>(null);

  async function open(nextCaseId: string, nextDisputeId: string) {
    setDetail(null);
    setConfirmed(false);
    setUncertain(false);
    setNotice("");
    const next = await adminRequest<DisputeMaterial>(
      `cases/${nextCaseId}/attendance-disputes/${nextDisputeId}`,
    );
    setDetail(next);
    setCaseId(next.caseId);
    setDisputeId(next.dispute.id);
  }

  async function intake() {
    await run(async () => {
      const key = crypto.randomUUID();
      const body = {
        disputeId: intakeDisputeId.trim(),
        expectedDisputeVersion: Number(intakeVersion),
        reasonCode,
        assignToSelf: true as const,
      };
      setPendingRef({ path: "cases/attendance-dispute-intake", key, body });
      try {
        if (!fresh) {
          await stepup();
        }
        const result = await adminRequest<{ caseId: string; disputeId: string }>(
          "cases/attendance-dispute-intake",
          body,
          session.csrfToken,
          key,
        );
        await open(result.caseId, result.disputeId);
        setNotice("Обращение по возражению создано и назначено вам.");
      } catch (cause) {
        if (cause instanceof AdminError && cause.status >= 500) setUncertain(true);
        throw cause;
      }
    });
  }

  async function resolve(retry = false) {
    await run(async () => {
      if (!detail) return;
      const request = retry
        ? pendingRef
        : {
            path: `cases/${detail.caseId}/attendance-disputes/${detail.dispute.id}`,
            key: crypto.randomUUID(),
            body: {
              expectedCaseVersion: detail.caseVersion,
              expectedDisputeVersion: detail.dispute.version,
              expectedAttendanceVersion: detail.dispute.currentAssertion.version,
              resolution,
              reason: reason.trim(),
              reasonCode,
            },
          };
      if (!request) return;
      setPendingRef(request);
      try {
        if (!fresh) await stepup();
        await adminRequest(request.path, request.body, session.csrfToken, request.key);
        await open(detail.caseId, detail.dispute.id);
        setReason("");
        setConfirmed(false);
        setNotice(
          resolution === "insufficient_evidence"
            ? "Спор оставлен открытым: недостаточно данных. independently_verified не выставлялся."
            : "Решение зафиксировано.",
        );
      } catch (cause) {
        if (cause instanceof AdminError && cause.status < 500) {
          setConfirmed(false);
          if (cause.code === "CASE_VERSION_CONFLICT" || cause.code === "VERSION_CONFLICT") {
            await open(detail.caseId, detail.dispute.id);
          }
          if ([401, 403, 404].includes(cause.status)) setDetail(null);
        } else setUncertain(true);
        throw cause;
      }
    });
  }

  const locked = busy || uncertain;
  const validReason = reason.trim().length >= 1 && reason.trim().length <= 500;
  const validCode = /^[a-z][a-z0-9_]{2,63}$/.test(reasonCode);

  return (
    <section className="attendance-disputes">
      <h3>Уточнение посещения</h3>
      <p>
        Только назначенное обращение и связанное возражение. Организатор игры здесь не решает спор. Нужны актуальные
        версии и свежее подтверждение входа.
      </p>
      {manager ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void intake();
          }}
        >
          <h4>Служебный приём возражения</h4>
          <p>Создаёт обращение без жалобы abuse_report, связывает игру и назначает вас.</p>
          <label className="form-field">
            <span>Идентификатор возражения</span>
            <input
              value={intakeDisputeId}
              maxLength={36}
              disabled={locked}
              onChange={(e) => setIntakeDisputeId(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Ожидаемая версия возражения</span>
            <input
              value={intakeVersion}
              maxLength={10}
              disabled={locked}
              onChange={(e) => setIntakeVersion(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Код причины</span>
            <input value={reasonCode} maxLength={64} disabled={locked} onChange={(e) => setReasonCode(e.target.value)} />
          </label>
          {!fresh ? (
            <button type="button" className="button outline" disabled={busy} onClick={() => void stepup()}>
              Подтвердить вход
            </button>
          ) : null}
          <button className="button" disabled={locked || !fresh || !validCode || intakeDisputeId.trim().length < 32}>
            Создать обращение по возражению
          </button>
        </form>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => open(caseId.trim(), disputeId.trim()));
        }}
      >
        <label className="form-field">
          <span>Обращение</span>
          <input value={caseId} maxLength={36} disabled={locked} onChange={(e) => setCaseId(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Возражение</span>
          <input value={disputeId} maxLength={36} disabled={locked} onChange={(e) => setDisputeId(e.target.value)} />
        </label>
        <button className="button outline" disabled={locked || caseId.trim().length < 32 || disputeId.trim().length < 32}>
          Открыть материалы дела
        </button>
      </form>
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
      {uncertain ? (
        <div className="notice danger">
          <p>Ответ не получен. Проверим результат того же действия.</p>
          <button className="button outline" disabled={busy} onClick={() => void resolve(true)}>
            Повторить проверку действия
          </button>
        </div>
      ) : null}
      {detail ? (
        <>
          <h4>Уточнение посещения</h4>
          <p>
            {detail.dispute.subjectDisplay} · игра {detail.dispute.gameId.slice(0, 8)}…
          </p>
          <p className="notice">Статус: {detail.dispute.status === "open" ? "На уточнении" : detail.dispute.status}</p>
          <h4>Материалы этого дела</h4>
          <p>
            Оспаривается версия {detail.dispute.challengedVersion}
            {detail.dispute.challengedAssertion
              ? `: «${valueLabel(detail.dispute.challengedAssertion.value)}»`
              : ""}
            . Сейчас: «{valueLabel(detail.dispute.currentAssertion.value)}», версия{" "}
            {detail.dispute.currentAssertion.version}.
          </p>
          <ol className="events">
            {detail.dispute.history.map((item) => (
              <li key={`${item.version}-${item.action}`}>
                <strong>
                  v{item.version} · {item.action}
                </strong>
                {item.explanation ? <span>{item.explanation}</span> : null}
                <small>{new Date(item.recordedAt).toLocaleString("ru-RU")}</small>
              </li>
            ))}
          </ol>
          <h4>Отдельное решение проверяющего</h4>
          <p>Доступно только при назначении на это обращение. Provenance выводит сервер; клиент не задаёт independently_verified.</p>
          {!fresh ? (
            <div className="notice">
              <p>Подтвердите вход перед записью решения.</p>
              <button type="button" className="button outline" disabled={busy} onClick={() => void stepup()}>
                Подтвердить вход
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolve();
            }}
          >
            <label className="form-field">
              <span>Решение</span>
              <select
                value={resolution}
                disabled={locked || !detail.allowedActions.canResolve}
                onChange={(e) => setResolution(e.target.value as keyof typeof resolutions)}
              >
                {Object.entries(resolutions).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Обоснование</span>
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                disabled={locked || !detail.allowedActions.canResolve}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Код причины</span>
              <input
                value={reasonCode}
                maxLength={64}
                disabled={locked || !detail.allowedActions.canResolve}
                onChange={(e) => setReasonCode(e.target.value)}
              />
            </label>
            <label className="confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={locked || !detail.allowedActions.canResolve}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Подтверждаю решение по назначенному обращению
            </label>
            <button
              className="button"
              disabled={
                locked ||
                !fresh ||
                !confirmed ||
                !validReason ||
                !validCode ||
                !detail.allowedActions.canResolve
              }
            >
              Рассмотреть решение
            </button>
            {!detail.allowedActions.canResolve ? (
              <p className="notice">Решение недоступно: нет назначения, спор закрыт или запись выключена.</p>
            ) : null}
          </form>
        </>
      ) : null}
    </section>
  );
}
