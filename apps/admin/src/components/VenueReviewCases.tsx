"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, isDefiniteAdminFailure, type Session } from "../lib/admin-client";

type PendingItem = {
  pendingIntakeId: string;
  kind: string;
  status: string;
  version: number;
  createdAt: string;
  hasAssignee: boolean;
  caseId: string | null;
};
type PendingPage = { items: PendingItem[]; nextBeforeId: string | null };
type VenueSource = {
  caseId: string;
  caseVersion: number;
  assignedTo: string | null;
  pendingKind: string;
  slot: { id: string; reviewHandle: string; venueId: string; status: string; version: number };
  reviewRevision: {
    id: string;
    resourceVersion: number;
    text: string;
    topics: string[];
    projectionHash: string | null;
    lifecycle: string;
    audience: string;
    gameId: string;
  } | null;
};
type CaseHint = {
  id: string;
  status: string;
  version: number;
  assignedTo: string | null;
  venueReview?: { pendingKind: string; slotStatus: string; intakeStatus: string };
};
type DecideBody = {
  action: "venue_review_decide";
  expectedCaseVersion: number;
  expectedResourceVersion: number;
  exactRevisionId: string;
  decision: keyof typeof decisions;
  rationale: string;
  reasonCode: string;
};
type IntakeBody = {
  pendingIntakeId: string;
  expectedIntakeVersion: number;
  reasonCode: string;
  assignToSelf: true;
};
type PendingOp = {
  kind: "intake" | "decide";
  path: string;
  key: string;
  body: IntakeBody | DecideBody;
  actorPrincipalId: string;
};

const kindLabels: Record<string, string> = {
  review_submit: "Новый отзыв о площадке",
  report: "Жалоба на отзыв",
  appeal: "Апелляция",
  basis_dispute: "Спор об основании",
};
const decisions = {
  approve: "Одобрить редакцию (не раньше 48ч после правки)",
  retain: "Оставить опубликованное без изменений",
  request_correction: "Запросить исправление",
  remove: "Скрыть публикацию",
  restore: "Восстановить публикацию",
} as const;
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
function markUnknown(cause: unknown): boolean {
  return !isDefiniteAdminFailure(cause);
}
function canManageCases(roles: readonly string[]) {
  return roles.some((r) => r === "superadmin" || r === "moderator");
}
function canReadAssignedEvidence(roles: readonly string[]) {
  return roles.some((r) => r === "superadmin" || r === "support");
}

export function VenueReviewCases({
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
  const manager = canManageCases(session.roles);
  const qualifiedReader = canReadAssignedEvidence(session.roles);
  const [pending, setPending] = useState<PendingPage | null>(null);
  const [selectedIntake, setSelectedIntake] = useState<PendingItem | null>(null);
  const [caseId, setCaseId] = useState("");
  const [caseHint, setCaseHint] = useState<CaseHint | null>(null);
  const [source, setSource] = useState<(VenueSource & { boundCaseId: string }) | null>(null);
  const [decision, setDecision] = useState<keyof typeof decisions>("approve");
  const [rationale, setRationale] = useState("");
  const [reasonCode, setReasonCode] = useState("venue_review");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pendingRef, setPendingRef] = useState<PendingOp | null>(null);
  const sourceGen = useRef(0);
  const sourceScope = useRef({
    fresh,
    caseId: null as string | null,
    version: null as number | null,
    assignedTo: null as string | null,
  });
  sourceScope.current = {
    fresh,
    caseId: caseHint?.id ?? null,
    version: caseHint?.version ?? null,
    assignedTo: caseHint?.assignedTo ?? null,
  };

  function dropSource() {
    sourceGen.current += 1;
    setSource(null);
  }
  function sourceStillCurrent(gen: number, id: string, version: number, assignee: string | null) {
    const scope = sourceScope.current;
    return (
      gen === sourceGen.current &&
      scope.fresh &&
      scope.caseId === id &&
      scope.version === version &&
      scope.assignedTo === assignee
    );
  }

  useEffect(() => {
    if (!fresh) dropSource();
  }, [fresh]);
  useEffect(() => {
    dropSource();
    return () => {
      sourceGen.current += 1;
    };
  }, [caseHint?.id, caseHint?.version, caseHint?.assignedTo]);

  const locked = busy || uncertain;
  const validReason = /^[a-z][a-z0-9_]{2,63}$/.test(reasonCode);
  const assignedHere = caseHint?.assignedTo === session.principalId;

  async function loadPending(more = false) {
    if (!manager) return;
    await run(async () => {
      const q = new URLSearchParams();
      if (more && pending?.nextBeforeId) q.set("beforeId", pending.nextBeforeId);
      const path = `venue-reviews/pending-intakes${q.toString() ? `?${q}` : ""}`;
      const next = await adminRequest<PendingPage>(path);
      setPending(more && pending ? { ...next, items: [...pending.items, ...next.items] } : next);
    });
  }

  async function openCase(id: string) {
    dropSource();
    setConfirmed(false);
    if (!uncertain) setNotice("");
    const detail = await adminRequest<CaseHint>(`cases/${id}`);
    setCaseHint(detail);
    setCaseId(detail.id);
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
        if (!selectedIntake) return;
        const body: IntakeBody = {
          pendingIntakeId: selectedIntake.pendingIntakeId,
          expectedIntakeVersion: selectedIntake.version,
          reasonCode,
          assignToSelf: true,
        };
        request = {
          kind: "intake",
          path: "cases/venue-review-intake",
          key: crypto.randomUUID(),
          body,
          actorPrincipalId: session.principalId,
        };
        setPendingRef(request);
      }
      try {
        if (!fresh) await stepup();
        const raw = await adminRequest<{ caseId: string }>(
          request.path,
          request.body,
          session.csrfToken,
          request.key,
        );
        if (!raw?.caseId || !uuid(raw.caseId)) {
          setUncertain(true);
          setNotice("Ответ не разобран. Проверим результат того же действия.");
          return;
        }
        await openCase(raw.caseId);
        setPendingRef(null);
        setUncertain(false);
        setSelectedIntake(null);
        setNotice(
          qualifiedReader
            ? "Обращение создано и назначено вам. Откройте источник явно перед решением."
            : "Обращение создано. Назначьте сотрудника с правом чтения источника.",
        );
        setPending(null);
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

  async function readSource() {
    await run(async () => {
      if (!caseHint) return;
      const id = caseHint.id;
      const version = caseHint.version;
      const assignee = caseHint.assignedTo;
      dropSource();
      const gen = ++sourceGen.current;
      try {
        if (!fresh) await stepup();
        const result = await adminRequest<VenueSource>(`cases/${id}/venue-review-source`);
        if (!sourceStillCurrent(gen, id, version, assignee)) return;
        setSource({ ...result, boundCaseId: id });
      } catch (cause) {
        if (
          gen !== sourceGen.current ||
          sourceScope.current.caseId !== id ||
          sourceScope.current.version !== version ||
          sourceScope.current.assignedTo !== assignee
        ) {
          throw cause;
        }
        setSource(null);
        if (cause instanceof AdminError && [401, 403, 404].includes(cause.status)) setCaseHint(null);
        throw cause;
      }
    });
  }

  async function decide(retry = false) {
    await run(async () => {
      if (!retry && (uncertain || pendingRef)) return;
      let request: PendingOp | null = null;
      if (retry) {
        if (!pendingRef || pendingRef.kind !== "decide") return;
        if (pendingRef.actorPrincipalId !== session.principalId) {
          setNotice("Сессия изменилась. Не повторяем решение от другого сотрудника.");
          return;
        }
        request = pendingRef;
      } else {
        if (!caseHint || !source?.reviewRevision || !confirmed || !validReason || !rationale.trim()) {
          return;
        }
        if (source.boundCaseId !== caseHint.id) return;
        const body: DecideBody = {
          action: "venue_review_decide",
          expectedCaseVersion: caseHint.version,
          expectedResourceVersion: source.reviewRevision.resourceVersion,
          exactRevisionId: source.reviewRevision.id,
          decision,
          rationale: rationale.trim(),
          reasonCode,
        };
        request = {
          kind: "decide",
          path: `cases/${caseHint.id}/commands`,
          key: crypto.randomUUID(),
          body,
          actorPrincipalId: session.principalId,
        };
        setPendingRef(request);
      }
      try {
        if (!fresh) await stepup();
        await adminRequest(request.path, request.body, session.csrfToken, request.key);
        setPendingRef(null);
        setUncertain(false);
        setConfirmed(false);
        setRationale("");
        setNotice(`Решение «${decisions[decision]}» записано.`);
        await openCase(caseId || caseHint!.id);
        dropSource();
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

  return (
    <section className="panel" aria-label="Отзывы о площадке">
      <h3>Отзывы о площадке</h3>
      <p>
        Durable intake создаёт заявитель; Case — назначенный сотрудник. pilot_viewer остаётся
        только для чтения. Публикация вычисляется на чтении: одобрение + 48 часов после правки.
      </p>
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
      {uncertain ? (
        <div className="notice danger">
          <p>Ответ не получен. Проверим результат того же действия.</p>
          <button
            className="button outline"
            disabled={busy}
            onClick={() => void (pendingRef?.kind === "intake" ? intake(true) : decide(true))}
          >
            Повторить проверку действия
          </button>
        </div>
      ) : null}
      {manager ? (
        <>
          <div className="actions">
            <button className="button outline" disabled={locked} onClick={() => void loadPending()}>
              Очередь отзывов площадки
            </button>
          </div>
          {pending ? (
            pending.items.length ? (
              <ul className="events">
                {pending.items.map((item) => (
                  <li key={item.pendingIntakeId}>
                    <button
                      className="game-row"
                      disabled={locked}
                      onClick={() => setSelectedIntake(item)}
                    >
                      <strong>{kindLabels[item.kind] ?? item.kind}</strong>
                      <small>
                        v{item.version} · {item.pendingIntakeId}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="notice">Ожиданий нет.</div>
            )
          ) : null}
          {pending?.nextBeforeId ? (
            <button
              className="button outline"
              disabled={locked}
              onClick={() => void loadPending(true)}
            >
              Ещё ожидания
            </button>
          ) : null}
          {selectedIntake ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void intake();
              }}
            >
              <p>
                Выбрано: {kindLabels[selectedIntake.kind] ?? selectedIntake.kind} · v
                {selectedIntake.version}
              </p>
              <label className="form-field">
                <span>Код причины</span>
                <input
                  value={reasonCode}
                  maxLength={64}
                  disabled={locked}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
              </label>
              <button className="button" disabled={locked || !validReason || !fresh}>
                Принять к разбору (назначить себе)
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => openCase(caseId.trim()));
        }}
      >
        <label className="form-field">
          <span>Обращение по отзыву площадки</span>
          <input
            value={caseId}
            maxLength={36}
            disabled={locked}
            onChange={(e) => {
              setCaseId(e.target.value);
              setCaseHint(null);
              dropSource();
            }}
          />
        </label>
        <button className="button outline" disabled={locked || !uuid(caseId.trim())}>
          Открыть
        </button>
      </form>
      {caseHint?.venueReview ? (
        <p>
          Связка: {caseHint.venueReview.pendingKind} · {caseHint.venueReview.slotStatus} ·{" "}
          {caseHint.venueReview.intakeStatus}
        </p>
      ) : null}
      {caseHint && qualifiedReader && assignedHere ? (
        <button className="button outline" disabled={locked || !fresh} onClick={() => void readSource()}>
          Читать согласованный источник
        </button>
      ) : null}
      {source?.reviewRevision ? (
        <div>
          <p>
            <strong>Редакция {source.reviewRevision.resourceVersion}</strong> ·{" "}
            {source.reviewRevision.audience} · {source.reviewRevision.lifecycle}
          </p>
          <p>{source.reviewRevision.text}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void decide();
            }}
          >
            <label className="form-field">
              <span>Решение</span>
              <select
                value={decision}
                disabled={locked}
                onChange={(e) => setDecision(e.target.value as keyof typeof decisions)}
              >
                {Object.entries(decisions).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Обоснование</span>
              <textarea
                value={rationale}
                maxLength={500}
                disabled={locked}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Код причины</span>
              <input
                value={reasonCode}
                maxLength={64}
                disabled={locked}
                onChange={(e) => setReasonCode(e.target.value)}
              />
            </label>
            <label className="confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={locked}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Подтверждаю решение по точной редакции
            </label>
            <button
              className="button"
              disabled={locked || !confirmed || !validReason || !rationale.trim() || !fresh}
            >
              Записать решение
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
