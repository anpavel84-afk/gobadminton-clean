"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, isDefiniteAdminFailure, type Session } from "../lib/admin-client";

type PendingItem = {
  pendingIntakeId: string;
  kind: string;
  role: string;
  status: string;
  version: number;
  createdAt: string;
  hasAssignee: boolean;
  caseId: string | null;
};

type PendingPage = { items: PendingItem[]; nextBeforeId: string | null };

type RoleSource = {
  caseId: string;
  caseVersion: number;
  assignedTo: string | null;
  pendingKind: string;
  slot: {
    id: string;
    reviewHandle: string;
    role: string;
    status: string;
    version: number;
  };
  reviewRevision: {
    id: string;
    resourceVersion: number;
    text: string;
    topics: string[];
    projectionHash: string;
    lifecycle: string;
    proofRef: { gameId: string; role: string; version: number };
  } | null;
  replyRevision: {
    id: string;
    resourceVersion: number;
    text: string;
    projectionHash: string;
    lifecycle: string;
  } | null;
};

type CaseHint = {
  id: string;
  status: string;
  version: number;
  assignedTo: string | null;
  roleReputation?: {
    pendingKind: string;
    role: string;
    slotStatus: string;
    intakeStatus: string;
  };
};

type DecideBody = {
  action: "role_review_decide";
  expectedCaseVersion: number;
  expectedResourceVersion: number;
  targetKind: "review" | "reply";
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
  review_submit: "Новый отзыв",
  reply_submit: "Ответ адресата",
  report: "Жалоба на отзыв",
  appeal: "Апелляция",
  basis_dispute: "Спор об основании роли",
};

const decisions = {
  approve: "Опубликовать ожидающую редакцию",
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

/** Honest affordance only — server remains final authority. */
function canManageCases(roles: readonly string[]) {
  return roles.some((r) => r === "superadmin" || r === "moderator");
}
function canReadAssignedEvidence(roles: readonly string[]) {
  return roles.some((r) => r === "superadmin" || r === "support");
}

export function RoleReputationCases({
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
  const [kindFilter, setKindFilter] = useState("");
  const [selectedIntake, setSelectedIntake] = useState<PendingItem | null>(null);
  const [caseId, setCaseId] = useState("");
  const [caseHint, setCaseHint] = useState<CaseHint | null>(null);
  const [source, setSource] = useState<(RoleSource & { boundCaseId: string }) | null>(null);
  const [targetKind, setTargetKind] = useState<"review" | "reply">("review");
  const [decision, setDecision] = useState<keyof typeof decisions>("retain");
  const [rationale, setRationale] = useState("");
  const [reasonCode, setReasonCode] = useState("role_review");
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

  function sourceStillCurrent(
    gen: number,
    id: string,
    version: number,
    assignee: string | null,
  ) {
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
  const activeRevision =
    targetKind === "review" ? source?.reviewRevision ?? null : source?.replyRevision ?? null;

  async function loadPending(more = false) {
    await run(async () => {
      const q = new URLSearchParams();
      if (kindFilter) q.set("kind", kindFilter);
      if (more && pending?.nextBeforeId) q.set("beforeId", pending.nextBeforeId);
      const path = `role-reputation/pending-intakes${q.toString() ? `?${q}` : ""}`;
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
    if (detail.roleReputation?.pendingKind === "reply_submit") setTargetKind("reply");
    else setTargetKind("review");
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
          path: "cases/role-reputation-intake",
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
            : "Обращение создано. Назначьте сотрудника с правом чтения источника (support) через обычное назначение.",
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
        const result = await adminRequest<RoleSource>(`cases/${id}/role-review-source`);
        if (!sourceStillCurrent(gen, id, version, assignee)) return;
        setSource({ ...result, boundCaseId: id });
        if (result.replyRevision && !result.reviewRevision) setTargetKind("reply");
        else if (result.reviewRevision) setTargetKind("review");
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
        if (cause instanceof AdminError && [401, 403, 404].includes(cause.status)) {
          setCaseHint(null);
        }
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
          setNotice("Сессия изменилась. Исходное действие не привязываем к другому сотруднику.");
          return;
        }
        request = pendingRef;
      } else {
        if (!caseHint || !source || !activeRevision) return;
        if (source.boundCaseId !== caseHint.id) return;
        const body: DecideBody = {
          action: "role_review_decide",
          expectedCaseVersion: caseHint.version,
          expectedResourceVersion: activeRevision.resourceVersion,
          targetKind,
          exactRevisionId: activeRevision.id,
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
        const id = caseHint?.id ?? (request.body as DecideBody).exactRevisionId;
        // Re-read case after decide; clear protected payload on version change.
        dropSource();
        if (caseHint) await openCase(caseHint.id);
        else if (uuid(String(id))) await openCase(String(id));
        setPendingRef(null);
        setUncertain(false);
        setRationale("");
        setConfirmed(false);
        setNotice(
          decision === "approve"
            ? "Решение записано. Публикация выполняется только явным approve ожидающей редакции."
            : "Решение записано. Статус «решено» сам по себе ничего не публикует.",
        );
      } catch (cause) {
        if (markUnknown(cause)) setUncertain(true);
        else {
          setPendingRef(null);
          setUncertain(false);
          if (cause instanceof AdminError && cause.code === "VERSION_CONFLICT" && caseHint) {
            await openCase(caseHint.id);
          }
        }
        throw cause;
      }
    });
  }

  const decideReady =
    Boolean(source && activeRevision && caseHint) &&
    assignedHere &&
    qualifiedReader &&
    fresh &&
    confirmed &&
    validReason &&
    rationale.trim().length >= 1 &&
    rationale.trim().length <= 500 &&
    // Reports about already-approved text: UI steers to retain, not approve.
    !(decision === "approve" && caseHint?.roleReputation?.pendingKind === "report");

  return (
    <section className="role-reputation-cases" aria-label="Разбор отзывов о роли">
      <h3>Отзывы о роли организатора или тренера</h3>
      <p>
        Ожидающие материалы ждут человека. Жалоба сама по себе ничего не удаляет; публикация — только
        явное решение по текущей ожидающей редакции. Отзыв и ответ разбираются отдельно.
      </p>
      {!fresh && (
        <div className="notice">
          <p>Подтвердите вход для приёма и чтения источника.</p>
          <button type="button" className="button outline" disabled={busy} onClick={() => void stepup()}>
            Подтвердить вход
          </button>
        </div>
      )}
      {manager && (
        <div className="actions">
          <button className="button outline" disabled={locked} onClick={() => void loadPending()}>
            Очередь ожиданий
          </button>
          <label className="form-field">
            <span>Вид ожидания</span>
            <select
              aria-label="Вид ожидания"
              value={kindFilter}
              disabled={locked}
              onChange={(e) => {
                setKindFilter(e.target.value);
                setPending(null);
              }}
            >
              <option value="">Все</option>
              {Object.entries(kindLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {pending &&
        (pending.items.length ? (
          <ul className="events">
            {pending.items.map((item) => (
              <li key={item.pendingIntakeId}>
                <strong>{kindLabels[item.kind] ?? item.kind}</strong>
                <small>
                  {item.role} · v{item.version} · {item.status}
                </small>
                <small>{item.pendingIntakeId}</small>
                <button
                  type="button"
                  className="button outline"
                  disabled={locked}
                  onClick={() => {
                    setSelectedIntake(item);
                    setConfirmed(false);
                  }}
                >
                  Выбрать
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="notice">Ожиданий пока нет.</div>
        ))}
      {pending?.nextBeforeId && (
        <button className="button outline" disabled={locked} onClick={() => void loadPending(true)}>
          Ещё ожидания
        </button>
      )}
      {manager && selectedIntake && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void intake();
          }}
        >
          <h4>Приём в обращение</h4>
          <dl>
            <div>
              <dt>Ожидание</dt>
              <dd>{selectedIntake.pendingIntakeId}</dd>
            </div>
            <div>
              <dt>Вид</dt>
              <dd>{kindLabels[selectedIntake.kind] ?? selectedIntake.kind}</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd>{selectedIntake.version}</dd>
            </div>
          </dl>
          <label className="form-field">
            <span>Код причины</span>
            <input
              value={reasonCode}
              maxLength={64}
              disabled={locked}
              onChange={(e) => {
                setReasonCode(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Подтверждаю приём текущим сотрудником
          </label>
          <button className="button" disabled={locked || !confirmed || !validReason || !fresh}>
            Создать обращение
          </button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => openCase(caseId.trim()));
        }}
      >
        <label className="form-field">
          <span>Идентификатор обращения по отзыву о роли</span>
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
          Открыть обращение
        </button>
      </form>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {uncertain && (
        <div className="notice danger">
          <p>Ответ не получен. Проверим результат того же действия.</p>
          <button
            type="button"
            className="button outline"
            disabled={busy}
            onClick={() => void (pendingRef?.kind === "intake" ? intake(true) : decide(true))}
          >
            Повторить проверку действия
          </button>
        </div>
      )}
      {caseHint && (
        <>
          <h4>Текущее обращение</h4>
          <dl>
            <div>
              <dt>Обращение</dt>
              <dd>{caseHint.id}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{caseHint.status}</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd>{caseHint.version}</dd>
            </div>
            <div>
              <dt>Ответственный</dt>
              <dd>{caseHint.assignedTo ?? "Не назначен"}</dd>
            </div>
            {caseHint.roleReputation ? (
              <>
                <div>
                  <dt>Вид материала</dt>
                  <dd>{kindLabels[caseHint.roleReputation.pendingKind] ?? caseHint.roleReputation.pendingKind}</dd>
                </div>
                <div>
                  <dt>Роль</dt>
                  <dd>{caseHint.roleReputation.role}</dd>
                </div>
                <div>
                  <dt>Статус слота</dt>
                  <dd>{caseHint.roleReputation.slotStatus}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Связь</dt>
                <dd>Нет привязки к отзыву о роли (или таблицы недоступны в этой среде).</dd>
              </div>
            )}
          </dl>
          {!qualifiedReader && (
            <div className="notice">
              Для чтения текста нужна роль support или superadmin. Модератор может назначить такого
              сотрудника через обычное назначение обращения.
            </div>
          )}
          {qualifiedReader && (
            <button
              type="button"
              className="button outline"
              disabled={locked || !fresh || !assignedHere}
              onClick={() => void readSource()}
            >
              Открыть источник для разбора
            </button>
          )}
          {source &&
            fresh &&
            source.boundCaseId === caseHint.id &&
            source.caseVersion === caseHint.version && (
              <div className="notice role-reputation-source">
                <h4>Источник (согласованная редакция)</h4>
                <p>
                  Критика остаётся мнением, пока нет отдельного решения. Жалоба не скрывает текст
                  автоматически.
                </p>
                <dl>
                  <div>
                    <dt>Слот</dt>
                    <dd>
                      {source.slot.role} · {source.slot.status} · v{source.slot.version}
                    </dd>
                  </div>
                  {source.reviewRevision && (
                    <>
                      <div>
                        <dt>Отзыв · редакция</dt>
                        <dd>
                          {source.reviewRevision.id} · v{source.reviewRevision.resourceVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>Текст отзыва</dt>
                        <dd>{source.reviewRevision.text}</dd>
                      </div>
                      {source.reviewRevision.topics.length > 0 && (
                        <div>
                          <dt>Темы</dt>
                          <dd>{source.reviewRevision.topics.join(", ")}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Доказательство роли</dt>
                        <dd>
                          игра {source.reviewRevision.proofRef.gameId} ·{" "}
                          {source.reviewRevision.proofRef.role} · v
                          {source.reviewRevision.proofRef.version}
                        </dd>
                      </div>
                    </>
                  )}
                  {source.replyRevision && (
                    <>
                      <div>
                        <dt>Ответ · редакция</dt>
                        <dd>
                          {source.replyRevision.id} · v{source.replyRevision.resourceVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>Текст ответа</dt>
                        <dd>{source.replyRevision.text}</dd>
                      </div>
                    </>
                  )}
                </dl>
                {qualifiedReader && assignedHere && activeRevision && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide();
                    }}
                  >
                    <h4>Решение человека</h4>
                    <label className="form-field">
                      <span>Объект</span>
                      <select
                        aria-label="Объект решения"
                        value={targetKind}
                        disabled={locked}
                        onChange={(e) => {
                          setTargetKind(e.target.value as "review" | "reply");
                          setConfirmed(false);
                        }}
                      >
                        <option value="review" disabled={!source.reviewRevision}>
                          Отзыв
                        </option>
                        <option value="reply" disabled={!source.replyRevision}>
                          Ответ
                        </option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Решение</span>
                      <select
                        aria-label="Решение"
                        value={decision}
                        disabled={locked}
                        onChange={(e) => {
                          setDecision(e.target.value as keyof typeof decisions);
                          setConfirmed(false);
                        }}
                      >
                        {Object.entries(decisions).map(([id, label]) => (
                          <option
                            key={id}
                            value={id}
                            disabled={
                              id === "approve" &&
                              caseHint.roleReputation?.pendingKind === "report"
                            }
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {caseHint.roleReputation?.pendingKind === "report" && (
                      <p>
                        По жалобе на уже опубликованный текст используйте «оставить без изменений», а
                        не повторную публикацию — иначе можно сбросить более новую ожидающую редакцию.
                      </p>
                    )}
                    {caseHint.roleReputation?.pendingKind === "basis_dispute" ? (
                      <p>
                        Исправление основания роли выполняется отдельной командой только для спора об
                        основании с точной привязкой к игре и роли — не через это решение по тексту.
                      </p>
                    ) : (
                      <p>Текстовое обращение не меняет исход игры или привязку роли.</p>
                    )}
                    <label className="form-field">
                      <span>Обоснование</span>
                      <input
                        value={rationale}
                        maxLength={500}
                        disabled={locked}
                        onChange={(e) => {
                          setRationale(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label className="form-field">
                      <span>Код причины</span>
                      <input
                        value={reasonCode}
                        maxLength={64}
                        disabled={locked}
                        onChange={(e) => {
                          setReasonCode(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label className="confirmation">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={locked}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      Подтверждаю решение для редакции {activeRevision.id}
                    </label>
                    <button className="button" disabled={locked || !decideReady}>
                      Записать решение
                    </button>
                  </form>
                )}
              </div>
            )}
        </>
      )}
    </section>
  );
}
