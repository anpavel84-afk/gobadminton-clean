"use client";
import { useState } from "react";
import { AdminError, adminRequest, isDefiniteAdminFailure, type Session } from "../lib/admin-client";

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

type ResolveBody = {
  expectedCaseVersion: number;
  expectedDisputeVersion: number;
  expectedAttendanceVersion: number;
  resolution: keyof typeof resolutions;
  reason: string;
  reasonCode: string;
};

type IntakeBody = {
  disputeId: string;
  expectedDisputeVersion: number;
  reasonCode: string;
  assignToSelf: true;
};

type IntakeReceipt = {
  caseId: string;
  disputeId: string;
  disputeVersion: number;
  caseVersion: number;
  assignedTo: string;
};

type ResolveReceipt = {
  caseId: string;
  disputeId: string;
  disputeVersion: number;
  caseVersion: number;
  attendanceVersion: number;
  resolution: keyof typeof resolutions;
  leavesOpen: boolean;
  independentlyVerified: boolean;
};

/** Narrow frozen pending — not a generic state engine. */
type PendingOp = {
  kind: "intake" | "resolve";
  path: string;
  key: string;
  body: IntakeBody | ResolveBody;
  actorPrincipalId: string;
  target?: { caseId: string; disputeId: string };
  expectedVersions?: {
    caseVersion: number;
    disputeVersion: number;
    attendanceVersion: number;
  };
  resolution?: keyof typeof resolutions;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonNegInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function validateIntakeReceipt(
  raw: unknown,
  body: IntakeBody,
  actorPrincipalId: string,
): IntakeReceipt | null {
  if (!isObject(raw)) return null;
  if (typeof raw.caseId !== "string" || !raw.caseId) return null;
  if (typeof raw.disputeId !== "string" || raw.disputeId !== body.disputeId) return null;
  if (typeof raw.assignedTo !== "string" || raw.assignedTo !== actorPrincipalId) return null;
  const disputeVersion = asNonNegInt(raw.disputeVersion);
  const caseVersion = asNonNegInt(raw.caseVersion);
  if (disputeVersion !== body.expectedDisputeVersion + 1) return null;
  if (caseVersion !== 1) return null;
  return {
    caseId: raw.caseId,
    disputeId: raw.disputeId,
    disputeVersion,
    caseVersion,
    assignedTo: raw.assignedTo,
  };
}

function expectedAttendanceAfter(resolution: keyof typeof resolutions, expected: number): number {
  if (resolution === "insufficient_evidence" || resolution === "uphold_current") return expected;
  return expected + 1;
}

function validateResolveReceipt(raw: unknown, pending: PendingOp): ResolveReceipt | null {
  if (pending.kind !== "resolve" || !pending.target || !pending.expectedVersions || !pending.resolution) {
    return null;
  }
  if (!isObject(raw)) return null;
  const body = pending.body as ResolveBody;
  if (typeof raw.caseId !== "string" || raw.caseId !== pending.target.caseId) return null;
  if (typeof raw.disputeId !== "string" || raw.disputeId !== pending.target.disputeId) return null;
  if (raw.resolution !== pending.resolution || raw.resolution !== body.resolution) return null;
  const leavesOpen = raw.leavesOpen === true;
  if (leavesOpen !== (pending.resolution === "insufficient_evidence")) return null;
  const disputeVersion = asNonNegInt(raw.disputeVersion);
  const caseVersion = asNonNegInt(raw.caseVersion);
  const attendanceVersion = asNonNegInt(raw.attendanceVersion);
  if (disputeVersion !== pending.expectedVersions.disputeVersion + 1) return null;
  if (caseVersion !== pending.expectedVersions.caseVersion + 1) return null;
  if (
    attendanceVersion !==
    expectedAttendanceAfter(pending.resolution, pending.expectedVersions.attendanceVersion)
  ) {
    return null;
  }
  if (typeof raw.independentlyVerified !== "boolean") return null;
  if (leavesOpen && raw.independentlyVerified !== false) return null;
  return {
    caseId: raw.caseId,
    disputeId: raw.disputeId,
    disputeVersion,
    caseVersion,
    attendanceVersion,
    resolution: pending.resolution,
    leavesOpen,
    independentlyVerified: raw.independentlyVerified,
  };
}

/** Historical intake proof: exact identities; current versions may be ≥ receipt (not lower). */
function rereadMatchesIntake(detail: DisputeMaterial, receipt: IntakeReceipt, actorPrincipalId: string): boolean {
  if (detail.caseId !== receipt.caseId || detail.dispute.id !== receipt.disputeId) return false;
  if (detail.assignedTo !== receipt.assignedTo || detail.assignedTo !== actorPrincipalId) return false;
  if (!Number.isInteger(detail.dispute.version) || !Number.isInteger(detail.caseVersion)) return false;
  if (detail.dispute.version < receipt.disputeVersion) return false;
  if (detail.caseVersion < receipt.caseVersion) return false;
  return true;
}

function rereadMatchesResolve(detail: DisputeMaterial, receipt: ResolveReceipt): boolean {
  if (detail.caseId !== receipt.caseId || detail.dispute.id !== receipt.disputeId) return false;
  if (detail.dispute.version < receipt.disputeVersion) return false;
  if (detail.caseVersion < receipt.caseVersion) return false;
  if (receipt.leavesOpen) {
    return detail.dispute.status === "open";
  }
  // Exact closure at receipt version, or later valid higher versions of the same identities.
  if (detail.dispute.version === receipt.disputeVersion) {
    return detail.dispute.status === "resolved";
  }
  return detail.dispute.status === "resolved" || detail.dispute.status === "open";
}

function markUnknown(cause: unknown): boolean {
  return !isDefiniteAdminFailure(cause);
}

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
  const [pendingRef, setPendingRef] = useState<PendingOp | null>(null);

  async function readMaterial(nextCaseId: string, nextDisputeId: string): Promise<DisputeMaterial> {
    return adminRequest<DisputeMaterial>(`cases/${nextCaseId}/attendance-disputes/${nextDisputeId}`);
  }

  /** Ordinary refresh must not clear a preserved UNKNOWN / frozen pending. */
  async function open(nextCaseId: string, nextDisputeId: string) {
    setConfirmed(false);
    if (!uncertain) setNotice("");
    const next = await readMaterial(nextCaseId, nextDisputeId);
    setDetail(next);
    setCaseId(next.caseId);
    setDisputeId(next.dispute.id);
  }

  async function intake(retry = false) {
    await run(async () => {
      if (!retry && (uncertain || pendingRef)) return;
      let request: PendingOp | null = null;
      if (retry) {
        if (!pendingRef || pendingRef.kind !== "intake") return;
        if (pendingRef.actorPrincipalId !== session.principalId) {
          setNotice("Сессия изменилась. Исходное действие не привязываем к другому сотруднику.");
          return;
        }
        request = pendingRef;
      } else {
        const body: IntakeBody = {
          disputeId: intakeDisputeId.trim(),
          expectedDisputeVersion: Number(intakeVersion),
          reasonCode,
          assignToSelf: true,
        };
        request = {
          kind: "intake",
          path: "cases/attendance-dispute-intake",
          key: crypto.randomUUID(),
          body,
          actorPrincipalId: session.principalId,
        };
        setPendingRef(request);
      }
      try {
        if (!fresh) {
          await stepup();
        }
        const raw = await adminRequest<unknown>(request.path, request.body, session.csrfToken, request.key);
        const receipt = validateIntakeReceipt(raw, request.body as IntakeBody, session.principalId);
        if (!receipt) {
          setUncertain(true);
          setNotice("Ответ не разобран. Проверим результат того же действия.");
          return;
        }
        const next = await readMaterial(receipt.caseId, receipt.disputeId);
        if (!rereadMatchesIntake(next, receipt, session.principalId)) {
          setUncertain(true);
          setDetail(next);
          setNotice("Повторное чтение не подтвердило приём. Проверим то же действие.");
          return;
        }
        setDetail(next);
        setCaseId(next.caseId);
        setDisputeId(next.dispute.id);
        setPendingRef(null);
        setUncertain(false);
        setNotice("Обращение по возражению создано и назначено вам.");
      } catch (cause) {
        if (markUnknown(cause)) setUncertain(true);
        else {
          setPendingRef(null);
          setUncertain(false);
        }
        throw cause;
      }
    });
  }

  async function resolve(retry = false) {
    await run(async () => {
      if (!retry && (uncertain || pendingRef)) return;
      let request: PendingOp | null = null;
      if (retry) {
        if (!pendingRef || pendingRef.kind !== "resolve") return;
        if (pendingRef.actorPrincipalId !== session.principalId) {
          setNotice("Сессия изменилась. Исходное действие не привязываем к другому сотруднику.");
          return;
        }
        request = pendingRef;
      } else {
        if (!detail) return;
        const body: ResolveBody = {
          expectedCaseVersion: detail.caseVersion,
          expectedDisputeVersion: detail.dispute.version,
          expectedAttendanceVersion: detail.dispute.currentAssertion.version,
          resolution,
          reason: reason.trim(),
          reasonCode,
        };
        request = {
          kind: "resolve",
          path: `cases/${detail.caseId}/attendance-disputes/${detail.dispute.id}`,
          key: crypto.randomUUID(),
          body,
          actorPrincipalId: session.principalId,
          target: { caseId: detail.caseId, disputeId: detail.dispute.id },
          expectedVersions: {
            caseVersion: detail.caseVersion,
            disputeVersion: detail.dispute.version,
            attendanceVersion: detail.dispute.currentAssertion.version,
          },
          resolution,
        };
        setPendingRef(request);
      }
      const frozenResolution = request.resolution ?? (request.body as ResolveBody).resolution;
      try {
        if (!fresh) await stepup();
        const raw = await adminRequest<unknown>(request.path, request.body, session.csrfToken, request.key);
        const receipt = validateResolveReceipt(raw, request);
        if (!receipt) {
          setUncertain(true);
          setNotice("Ответ не подтвердил решение. Проверим результат того же действия.");
          return;
        }
        const next = await readMaterial(receipt.caseId, receipt.disputeId);
        if (!rereadMatchesResolve(next, receipt)) {
          setUncertain(true);
          setDetail(next);
          setNotice("Повторное чтение не подтвердило решение. Проверим то же действие.");
          return;
        }
        setDetail(next);
        setCaseId(next.caseId);
        setDisputeId(next.dispute.id);
        setReason("");
        setConfirmed(false);
        setPendingRef(null);
        setUncertain(false);
        setNotice(
          frozenResolution === "insufficient_evidence"
            ? "Спор оставлен открытым: недостаточно данных. independently_verified не выставлялся."
            : "Решение зафиксировано.",
        );
      } catch (cause) {
        if (cause instanceof AdminError && isDefiniteAdminFailure(cause)) {
          setConfirmed(false);
          setPendingRef(null);
          setUncertain(false);
          if (cause.code === "CASE_VERSION_CONFLICT" || cause.code === "VERSION_CONFLICT") {
            const target = request.target;
            if (target) await open(target.caseId, target.disputeId);
          }
          if ([401, 403, 404].includes(cause.status)) setDetail(null);
        } else setUncertain(true);
        throw cause;
      }
    });
  }

  async function recover() {
    if (!pendingRef) return;
    if (pendingRef.kind === "intake") {
      await intake(true);
      return;
    }
    await resolve(true);
  }

  const locked = busy || uncertain;
  const validReason = reason.trim().length >= 1 && reason.trim().length <= 500;
  const validCode = /^[a-z][a-z0-9_]{2,63}$/.test(reasonCode);
  const retryResolution =
    pendingRef?.kind === "resolve"
      ? pendingRef.resolution ?? (pendingRef.body as ResolveBody).resolution
      : null;

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
          <p>
            Ответ не получен. Проверим результат того же действия
            {retryResolution ? ` («${resolutions[retryResolution]}»)` : pendingRef?.kind === "intake" ? " (приём возражения)" : ""}
            .
          </p>
          <button className="button outline" disabled={busy} onClick={() => void recover()}>
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
