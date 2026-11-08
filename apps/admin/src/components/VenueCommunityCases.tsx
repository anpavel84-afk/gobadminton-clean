"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, errorMessage, isDefiniteAdminFailure, type Session } from "../lib/admin-client";

/** Mirrors packages/contracts AdminCaseCommunity* — exact backend fields only. */
type CommunityVoteItem = {
  voteId: string;
  value: number | null;
  version: number;
  moderationState: "clear" | "withheld";
  withdrawn: boolean;
  eligibleForPublicCount: boolean;
};

type DecisionCapability = {
  action: "venue_community_decide";
  decisions: Array<"retain" | "withhold" | "restore">;
  resourceKind: "vote" | "comment";
  requiresExactVoteId?: boolean;
  voteId?: string;
  commentId?: string;
  expectedCaseVersion: number;
  expectedResourceVersion: number | null;
};

type RatingSummary = {
  venueId: string;
  canonicalVenueId: string | null;
  average: number | null;
  count: number | null;
  state: "empty" | "available" | "unavailable";
};

type AggregateSource = {
  caseId: string;
  reportId: string;
  subjectKind: "aggregate";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: string | null;
  summary: RatingSummary;
  votes: { items: CommunityVoteItem[]; nextCursor: string | null; limit: number };
  decisionCapability: DecisionCapability | null;
};

type OwnVoteSource = {
  caseId: string;
  reportId: string;
  subjectKind: "own_vote";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: string | null;
  voteId: string;
  reportedVersion: number;
  currentVersion: number | null;
  reportedValue: number | null;
  reportedModerationState: "clear" | "withheld" | null;
  reportedWithdrawn: boolean | null;
  currentValue: number | null;
  currentModerationState: "clear" | "withheld" | null;
  currentWithdrawn: boolean | null;
  mergedIntoVoteId: string | null;
  decisionCapability: DecisionCapability | null;
};

type CommentSource = {
  caseId: string;
  reportId: string;
  subjectKind: "venue_comment";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: string | null;
  commentId: string;
  reportedVersion: number;
  currentVersion: number | null;
  text: string | null;
  currentPublication: "live" | "edited" | "deleted" | "withheld" | "unavailable";
  decisionCapability: DecisionCapability | null;
};

type CommunitySource = AggregateSource | OwnVoteSource | CommentSource;

type DecideBody = {
  action: "venue_community_decide";
  expectedCaseVersion: number;
  expectedResourceVersion: number;
  reportId: string;
  resourceKind: "vote" | "comment";
  voteId?: string;
  commentId?: string;
  decision: "retain" | "withhold" | "restore";
  rationale: string;
  reasonCode: string;
};

/**
 * Full authorized-read identity held only in memory for this read/operation.
 * Exact CSRF string is compared in memory only — never placed in context keys,
 * DOM, logs, cookies, or localStorage.
 */
type AuthReadContext = {
  caseId: string;
  reportId: string;
  caseStatus: string;
  caseVersion: number;
  assignedTo: string | null;
  principalId: string;
  sessionId: string;
  sessionVersion: number;
  rolesKey: string;
  csrfToken: string;
  fresh: boolean;
  authMethod: string;
};

type BoundSource = CommunitySource & {
  boundContext: AuthReadContext;
  boundContextKey: string;
};

type PendingOp = {
  path: string;
  key: string;
  body: DecideBody;
  operationContext: AuthReadContext;
};

const decisions = {
  retain: "Оставить без изменений (только учёт)",
  withhold: "Снять с публичной видимости",
  restore: "Восстановить публичную видимость",
} as const;

const subjectLabels: Record<CommunitySource["subjectKind"], string> = {
  aggregate: "Сводка оценок сообщества",
  own_vote: "Собственная оценка",
  venue_comment: "Публикация в обсуждении",
};

const publicationLabels: Record<CommentSource["currentPublication"], string> = {
  live: "Текущая публикация доступна",
  edited: "Текст изменён автором после жалобы",
  deleted: "Публикация удалена автором (tombstone)",
  withheld: "Публикация снята модерацией",
  unavailable: "Текущее состояние недоступно",
};

const unavailableCopy: Record<string, string> = {
  venue_unavailable: "Площадка недоступна — исходные данные не раскрываются.",
  revision_missing: "Зафиксированная редакция не найдена.",
  fingerprint_mismatch: "Содержимое изменилось и недоступно по отпечатку.",
  merged_superseded: "Запись объединена и замещена — восстановление недоступно.",
  vote_missing: "Оценка не найдена.",
  comment_missing: "Публикация не найдена.",
  empty_body: "Текст зафиксированной редакции отсутствует.",
};

const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

function markUnknown(cause: unknown): boolean {
  return !isDefiniteAdminFailure(cause);
}

/** Honest affordance only — server remains final authority (evidence.assigned.read). */
function canReadAssignedEvidence(roles: readonly string[]) {
  return roles.some((r) => r === "superadmin" || r === "support");
}

function normalizeRolesKey(roles: readonly string[]) {
  return roles.slice().sort().join(",");
}

function buildAuthReadContext(input: {
  caseId: string;
  reportId: string;
  caseStatus: string;
  caseVersion: number;
  assignedTo: string | null;
  session: Session;
  fresh: boolean;
}): AuthReadContext {
  return {
    caseId: input.caseId,
    reportId: input.reportId,
    caseStatus: input.caseStatus,
    caseVersion: input.caseVersion,
    assignedTo: input.assignedTo,
    principalId: input.session.principalId,
    sessionId: input.session.sessionId,
    sessionVersion: input.session.version,
    rolesKey: normalizeRolesKey(input.session.roles),
    csrfToken: input.session.csrfToken,
    fresh: input.fresh,
    authMethod: input.session.authMethod ?? "",
  };
}

/** Non-secret bind key — intentionally omits CSRF (exact CSRF compared only in memory). */
function authContextKey(ctx: AuthReadContext) {
  return [
    ctx.caseId,
    ctx.reportId,
    ctx.caseStatus,
    String(ctx.caseVersion),
    ctx.assignedTo ?? "",
    ctx.principalId,
    ctx.sessionId,
    String(ctx.sessionVersion),
    ctx.rolesKey,
    ctx.fresh ? "1" : "0",
    ctx.authMethod,
  ].join("\u001f");
}

function authContextsMatch(a: AuthReadContext, b: AuthReadContext) {
  return authContextKey(a) === authContextKey(b) && a.csrfToken === b.csrfToken;
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "недоступно" : String(value);
}

function formatAverage(value: number | null | undefined): string {
  return value == null ? "недоступно" : String(value);
}

function formatVoteValue(value: number | null | undefined): string {
  return value == null ? "недоступно" : String(value);
}

function formatFlag(value: boolean | null | undefined): string {
  if (value == null) return "недоступно";
  return value ? "да" : "нет";
}

export function VenueCommunityCases({
  session,
  busy,
  fresh,
  run,
  stepup,
  caseId,
  caseStatus,
  caseVersion,
  assignedTo,
  reportId,
  onCaseMutated,
}: {
  session: Session;
  busy: boolean;
  fresh: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  stepup: () => Promise<void>;
  caseId: string;
  caseStatus: string;
  caseVersion: number;
  assignedTo: string | null;
  reportId: string;
  onCaseMutated: (caseId: string) => Promise<void>;
}) {
  const qualifiedReader = canReadAssignedEvidence(session.roles);
  const assignedHere = assignedTo === session.principalId;
  const currentContext = buildAuthReadContext({
    caseId,
    reportId,
    caseStatus,
    caseVersion,
    assignedTo,
    session,
    fresh,
  });
  const currentContextKey = authContextKey(currentContext);
  const [source, setSource] = useState<BoundSource | null>(null);
  const [selectedVoteId, setSelectedVoteId] = useState("");
  const [decision, setDecision] = useState<"retain" | "withhold" | "restore">("retain");
  const [rationale, setRationale] = useState("");
  const [reasonCode, setReasonCode] = useState("venue_community");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pendingRef, setPendingRef] = useState<PendingOp | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const sourceGen = useRef(0);
  const suppressScopeDrop = useRef(false);
  const sourceScope = useRef(currentContext);
  sourceScope.current = currentContext;

  function dropSource() {
    sourceGen.current += 1;
    setSource(null);
    setSelectedVoteId("");
    setConfirmed(false);
    setRationale("");
    setLoadError("");
  }

  function sourceStillCurrent(gen: number, expected: AuthReadContext) {
    return gen === sourceGen.current && authContextsMatch(sourceScope.current, expected);
  }

  useEffect(() => {
    if (!fresh) dropSource();
  }, [fresh]);

  useEffect(() => {
    if (suppressScopeDrop.current) {
      suppressScopeDrop.current = false;
      return;
    }
    dropSource();
    setNeedsReload(false);
    return () => {
      sourceGen.current += 1;
    };
  }, [
    caseId,
    caseStatus,
    caseVersion,
    assignedTo,
    reportId,
    session.principalId,
    session.sessionId,
    session.version,
    session.csrfToken,
    session.authMethod,
    session.roles.join("|"),
  ]);

  const locked = busy || uncertain;
  const validReason = /^[a-z][a-z0-9_]{2,63}$/.test(reasonCode);
  const canOpenSource = qualifiedReader && assignedHere && fresh && uuid(caseId) && uuid(reportId);

  /** Private body/detail/rationale only when bind matches CURRENT qualified context this render. */
  const boundMatchesCurrent =
    source != null &&
    source.boundContextKey === currentContextKey &&
    authContextsMatch(source.boundContext, currentContext) &&
    currentContext.fresh &&
    qualifiedReader &&
    assignedHere;
  const visibleSource = boundMatchesCurrent ? source : null;

  function communityPath(
    id: string,
    linked: string,
    cursor?: string | null,
  ) {
    const q = new URLSearchParams();
    if (cursor) q.set("cursor", cursor);
    const suffix = q.toString() ? `?${q}` : "";
    return `cases/${id}/community-reports/${linked}${suffix}`;
  }

  async function loadCommunitySource(mode: "replace" | "next" | "refresh", opts?: {
    context?: AuthReadContext;
    clearNotice?: boolean;
  }) {
    const expected = opts?.context ?? currentContext;
    if (
      !(
        canReadAssignedEvidence(session.roles) &&
        expected.assignedTo === expected.principalId &&
        expected.fresh &&
        uuid(expected.caseId) &&
        uuid(expected.reportId) &&
        authContextsMatch(sourceScope.current, expected)
      )
    ) {
      return;
    }
    if (mode === "replace" || mode === "refresh") {
      dropSource();
      setNeedsReload(false);
      if (opts?.clearNotice !== false && !uncertain) setNotice("");
    }
    const prior = source;
    const cursor =
      mode === "next" && prior?.subjectKind === "aggregate" && boundMatchesCurrent
        ? prior.votes.nextCursor
        : null;
    if (mode === "next" && !cursor) return;
    const gen = mode === "next" ? sourceGen.current : ++sourceGen.current;
    try {
      const result = await adminRequest<CommunitySource>(
        communityPath(expected.caseId, expected.reportId, cursor),
      );
      if (!sourceStillCurrent(gen, expected)) return;
      if (result.caseId !== expected.caseId || result.reportId !== expected.reportId) {
        setSource(null);
        setLoadError("Ответ не соответствует выбранному обращению.");
        return;
      }
      const bindKey = authContextKey(expected);
      if (mode === "next" && prior?.subjectKind === "aggregate" && result.subjectKind === "aggregate") {
        const seen = new Set(prior.votes.items.map((item) => item.voteId));
        const appended = result.votes.items.filter((item) => !seen.has(item.voteId));
        setSource({
          ...result,
          votes: {
            ...result.votes,
            items: [...prior.votes.items, ...appended],
          },
          boundContext: expected,
          boundContextKey: bindKey,
        });
      } else {
        setSource({ ...result, boundContext: expected, boundContextKey: bindKey });
        setSelectedVoteId("");
        setRationale("");
        setConfirmed(false);
        const cap = result.decisionCapability;
        if (cap?.decisions?.length) {
          setDecision(cap.decisions.includes("retain") ? "retain" : cap.decisions[0]!);
        }
      }
      setLoadError("");
    } catch (cause) {
      if (!sourceStillCurrent(gen, expected)) {
        throw cause;
      }
      if (mode !== "next") setSource(null);
      if (cause instanceof AdminError) {
        if ([401, 403, 404].includes(cause.status)) {
          setLoadError(errorMessage(cause));
          setSource(null);
          setRationale("");
          setConfirmed(false);
          setSelectedVoteId("");
        } else if (cause.status === 409) {
          setNeedsReload(true);
          setLoadError(errorMessage(cause));
        } else {
          setLoadError(errorMessage(cause));
        }
      } else {
        setLoadError("Не удалось загрузить источник. Проверьте соединение.");
      }
      throw cause;
    }
  }

  async function readSource(mode: "replace" | "next" | "refresh" = "replace") {
    await run(async () => {
      await loadCommunitySource(mode, { context: currentContext });
    });
  }

  async function decide(retry = false) {
    await run(async () => {
      if (!retry && (uncertain || pendingRef)) return;
      let request: PendingOp | null = null;
      const liveContext = buildAuthReadContext({
        caseId,
        reportId,
        caseStatus,
        caseVersion,
        assignedTo,
        session,
        fresh,
      });
      if (retry) {
        if (!pendingRef) return;
        if (!authContextsMatch(pendingRef.operationContext, liveContext)) {
          // HOLD unknown: keep key/payload/uncertain; never remint or auto-POST.
          setNotice(
            "Контекст авторизованного чтения изменился. Исходное действие удерживаем без повтора — нужна безопасная сверка истории.",
          );
          dropSource();
          return;
        }
        request = pendingRef;
      } else {
        if (!source || !confirmed || !validReason || !rationale.trim()) return;
        if (!authContextsMatch(source.boundContext, liveContext)) return;
        if (source.boundContextKey !== authContextKey(liveContext)) return;
        if (!liveContext.fresh || !qualifiedReader || assignedTo !== session.principalId) return;
        if (needsReload) return;
        const cap = source.decisionCapability;
        if (!cap || cap.action !== "venue_community_decide") return;
        if (!cap.decisions.includes(decision)) return;
        if (cap.expectedCaseVersion !== liveContext.caseVersion) {
          setNeedsReload(true);
          setNotice("Версия обращения изменилась. Сначала обновите источник — старое полномочие не отправляем.");
          return;
        }
        let voteId: string | undefined;
        let commentId: string | undefined;
        let expectedResourceVersion: number | null = cap.expectedResourceVersion;
        if (cap.resourceKind === "vote") {
          if (cap.requiresExactVoteId) {
            if (!selectedVoteId || source.subjectKind !== "aggregate") return;
            const picked = source.votes.items.find((item) => item.voteId === selectedVoteId);
            if (!picked) return;
            voteId = picked.voteId;
            expectedResourceVersion = picked.version;
            if (decision !== "retain" && picked.withdrawn) return;
            if (decision === "withhold" && picked.moderationState !== "clear") return;
            if (decision === "restore" && picked.moderationState !== "withheld") return;
          } else {
            voteId = cap.voteId;
            if (!voteId || !uuid(voteId)) return;
          }
        } else {
          commentId = cap.commentId;
          if (!commentId || !uuid(commentId)) return;
        }
        if (expectedResourceVersion == null || expectedResourceVersion < 1) return;
        const body: DecideBody = {
          action: "venue_community_decide",
          expectedCaseVersion: cap.expectedCaseVersion,
          expectedResourceVersion,
          reportId: liveContext.reportId,
          resourceKind: cap.resourceKind,
          ...(cap.resourceKind === "vote" ? { voteId } : { commentId }),
          decision,
          rationale: rationale.trim(),
          reasonCode,
        };
        request = {
          path: `cases/${liveContext.caseId}/commands`,
          key: crypto.randomUUID(),
          body,
          operationContext: liveContext,
        };
        setPendingRef(request);
      }
      try {
        // Final gate immediately before POST: same authorized context + case version.
        const prePost = buildAuthReadContext({
          caseId,
          reportId,
          caseStatus,
          caseVersion,
          assignedTo,
          session,
          fresh,
        });
        if (!authContextsMatch(request.operationContext, prePost)) {
          setNotice(
            "Контекст авторизованного чтения изменился. Исходное действие удерживаем без повтора — нужна безопасная сверка истории.",
          );
          dropSource();
          return;
        }
        if (request.body.expectedCaseVersion !== prePost.caseVersion) {
          setNeedsReload(true);
          setNotice("Версия обращения изменилась. Сначала обновите источник — старое полномочие не отправляем.");
          return;
        }
        if (!prePost.fresh) await stepup();
        const receipt = await adminRequest<{
          caseId?: string;
          caseVersion?: number;
          decision?: string;
          auditId?: string;
          decisionId?: string;
        }>(request.path, request.body, session.csrfToken, request.key);
        setPendingRef(null);
        setUncertain(false);
        setConfirmed(false);
        setRationale("");
        setNeedsReload(false);
        const receiptBits = [
          receipt?.decisionId ? `decision ${receipt.decisionId}` : null,
          receipt?.auditId ? `audit ${receipt.auditId}` : null,
          receipt?.caseVersion != null ? `case v${receipt.caseVersion}` : null,
        ].filter(Boolean);
        setNotice(
          `Решение «${decisions[request.body.decision]}» записано.${receiptBits.length ? ` ${receiptBits.join(" · ")}` : ""}`,
        );
        const mutatedId = caseId;
        const linked = reportId;
        suppressScopeDrop.current = true;
        await onCaseMutated(mutatedId);
        const scope = sourceScope.current;
        if (
          scope.caseId === mutatedId &&
          scope.reportId === linked &&
          scope.fresh &&
          scope.principalId === session.principalId
        ) {
          await loadCommunitySource("replace", {
            context: scope,
            clearNotice: false,
          });
        } else {
          suppressScopeDrop.current = false;
          dropSource();
        }
      } catch (cause) {
        if (markUnknown(cause)) {
          setUncertain(true);
          setNotice("");
        } else {
          setPendingRef(null);
          setUncertain(false);
          if (cause instanceof AdminError) {
            if (["CASE_VERSION_CONFLICT", "VERSION_CONFLICT"].includes(cause.code) || cause.status === 409) {
              setNeedsReload(true);
              setNotice(errorMessage(cause));
            } else if ([401, 403, 404].includes(cause.status)) {
              dropSource();
              setNotice(errorMessage(cause));
            } else if ([422, 429, 503].includes(cause.status)) {
              setNotice(errorMessage(cause));
            } else {
              setNotice(errorMessage(cause));
            }
          }
        }
        throw cause;
      }
    });
  }

  const capability = visibleSource?.decisionCapability ?? null;
  const offeredDecisions = capability?.decisions ?? [];
  const aggregateVotes = visibleSource?.subjectKind === "aggregate" ? visibleSource.votes.items : [];
  const selectedVote = aggregateVotes.find((item) => item.voteId === selectedVoteId) ?? null;
  const canSubmitDecision =
    Boolean(visibleSource) &&
    Boolean(capability) &&
    offeredDecisions.includes(decision) &&
    confirmed &&
    validReason &&
    rationale.trim().length > 0 &&
    fresh &&
    !needsReload &&
    !locked &&
    capability?.expectedCaseVersion === caseVersion &&
    (capability?.resourceKind === "comment"
      ? Boolean(capability.commentId) && capability.expectedResourceVersion != null
      : capability?.requiresExactVoteId
        ? Boolean(selectedVote) &&
          !(decision !== "retain" && selectedVote?.withdrawn) &&
          (decision !== "restore" || selectedVote?.moderationState === "withheld") &&
          (decision !== "withhold" || selectedVote?.moderationState === "clear")
        : Boolean(capability?.voteId) && capability?.expectedResourceVersion != null);

  return (
    <section className="panel" aria-label="Сообщество площадки">
      <h3>Сообщество площадки</h3>
      <p>
        Точный источник жалобы на сообщество площадки. Читает только назначенный сотрудник с правом
        evidence.assigned.read и свежим подтверждением входа. Глобальные роли moderator /
        content_manager / pilot_viewer сами по себе доступ не дают.
      </p>
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
      {loadError ? (
        <div className="notice danger" role="status">
          {loadError}
        </div>
      ) : null}
      {uncertain ? (
        <div className="notice danger">
          <p>Ответ не получен. Проверим результат того же действия.</p>
          <button className="button outline" disabled={busy} onClick={() => void decide(true)}>
            Повторить проверку действия
          </button>
        </div>
      ) : null}
      {needsReload ? (
        <div className="notice">
          <p>Версия устарела. Сначала обновите источник — новое действие не запускаем автоматически.</p>
          <button
            className="button outline"
            disabled={locked || !canOpenSource}
            onClick={() => void readSource("refresh")}
          >
            Обновить источник
          </button>
        </div>
      ) : null}
      {!qualifiedReader ? (
        <div className="notice">
          Для чтения источника нужна роль support или superadmin. Модератор может назначить такого
          сотрудника через обычное назначение.
        </div>
      ) : null}
      {qualifiedReader && !assignedHere ? (
        <div className="notice">Источник доступен только назначенному на это обращение сотруднику.</div>
      ) : null}
      {qualifiedReader && assignedHere && !fresh ? (
        <div className="notice">
          <p>Подтвердите вход для просмотра источника сообщества.</p>
          <button type="button" className="button outline" disabled={busy} onClick={() => void stepup()}>
            Подтвердить вход
          </button>
        </div>
      ) : null}
      {canOpenSource ? (
        <div className="actions">
          <button className="button outline" disabled={locked} onClick={() => void readSource("replace")}>
            Открыть источник сообщества
          </button>
          {visibleSource ? (
            <button className="button outline" disabled={locked} onClick={() => void readSource("refresh")}>
              Обновить источник
            </button>
          ) : null}
        </div>
      ) : null}
      {visibleSource ? (
        <div>
          <h4>{subjectLabels[visibleSource.subjectKind]}</h4>
          <dl>
            <div>
              <dt>Площадка</dt>
              <dd>{visibleSource.canonicalVenueId}</dd>
            </div>
            <div>
              <dt>Причина жалобы</dt>
              <dd>{visibleSource.reasonCode}</dd>
            </div>
            <div>
              <dt>Статус жалобы</dt>
              <dd>{visibleSource.reportState}</dd>
            </div>
            {visibleSource.detail != null && visibleSource.detail !== "" ? (
              <div>
                <dt>Текст жалобы (только назначенный источник)</dt>
                <dd>{visibleSource.detail}</dd>
              </div>
            ) : null}
          </dl>
          {!visibleSource.sourceAvailable ? (
            <p role="status">
              {unavailableCopy[visibleSource.unavailableReason ?? ""] ??
                "Точный исходный материал сейчас недоступен."}
            </p>
          ) : null}
          {visibleSource.subjectKind === "aggregate" ? (
            <>
              <h4>Публичная сводка</h4>
              <dl>
                <div>
                  <dt>Состояние</dt>
                  <dd>{visibleSource.summary.state}</dd>
                </div>
                <div>
                  <dt>Среднее</dt>
                  <dd>{formatAverage(visibleSource.summary.average)}</dd>
                </div>
                <div>
                  <dt>Число оценок</dt>
                  <dd>{formatCount(visibleSource.summary.count)}</dd>
                </div>
              </dl>
              <h4>Оценки (страница по курсору отчёта)</h4>
              {visibleSource.votes.items.length ? (
                <ul className="events">
                  {visibleSource.votes.items.map((item) => (
                    <li key={item.voteId}>
                      <strong>Оценка {formatVoteValue(item.value)}</strong>
                      <small>
                        v{item.version} ·{" "}
                        {item.moderationState === "withheld" ? "снята" : "открыта"}
                        {item.withdrawn ? " · отозвана" : ""}
                        {item.eligibleForPublicCount ? " · в публичном счёте" : " · вне публичного счёта"}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="notice">На этой странице оценок нет.</div>
              )}
              {visibleSource.votes.nextCursor ? (
                <button
                  className="button outline"
                  disabled={locked}
                  onClick={() => void readSource("next")}
                >
                  Ещё оценки
                </button>
              ) : null}
            </>
          ) : null}
          {visibleSource.subjectKind === "own_vote" ? (
            <dl>
              <div>
                <dt>Заявленная оценка</dt>
                <dd>{formatVoteValue(visibleSource.reportedValue)}</dd>
              </div>
              <div>
                <dt>Заявленная версия</dt>
                <dd>{visibleSource.reportedVersion}</dd>
              </div>
              <div>
                <dt>Заявленная модерация</dt>
                <dd>
                  {visibleSource.reportedModerationState == null
                    ? "недоступно"
                    : visibleSource.reportedModerationState === "withheld"
                      ? "снята"
                      : "открыта"}
                </dd>
              </div>
              <div>
                <dt>Заявленный отзыв голоса</dt>
                <dd>{formatFlag(visibleSource.reportedWithdrawn)}</dd>
              </div>
              <div>
                <dt>Текущая оценка</dt>
                <dd>{formatVoteValue(visibleSource.currentValue)}</dd>
              </div>
              <div>
                <dt>Текущая версия</dt>
                <dd>{visibleSource.currentVersion == null ? "недоступно" : visibleSource.currentVersion}</dd>
              </div>
              <div>
                <dt>Текущая модерация</dt>
                <dd>
                  {visibleSource.currentModerationState == null
                    ? "недоступно"
                    : visibleSource.currentModerationState === "withheld"
                      ? "снята"
                      : "открыта"}
                </dd>
              </div>
              <div>
                <dt>Текущий отзыв голоса</dt>
                <dd>{formatFlag(visibleSource.currentWithdrawn)}</dd>
              </div>
              {visibleSource.mergedIntoVoteId ? (
                <div>
                  <dt>Замещена объединением</dt>
                  <dd>{visibleSource.mergedIntoVoteId}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {visibleSource.subjectKind === "venue_comment" ? (
            <dl>
              <div>
                <dt>Заявленный текст</dt>
                <dd>{visibleSource.text == null ? "недоступно" : visibleSource.text}</dd>
              </div>
              <div>
                <dt>Заявленная версия</dt>
                <dd>{visibleSource.reportedVersion}</dd>
              </div>
              <div>
                <dt>Текущая версия</dt>
                <dd>{visibleSource.currentVersion == null ? "недоступно" : visibleSource.currentVersion}</dd>
              </div>
              <div>
                <dt>Текущее состояние публикации</dt>
                <dd>{publicationLabels[visibleSource.currentPublication]}</dd>
              </div>
            </dl>
          ) : null}
          {capability && offeredDecisions.length > 0 && !needsReload ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void decide();
              }}
            >
              <h4>Решение по ресурсу</h4>
              <p>Текст автора и негативная критика не редактируются. Блокировка аккаунта здесь недоступна.</p>
              {capability.requiresExactVoteId ? (
                <label className="form-field">
                  <span>Точная оценка из загруженной страницы</span>
                  <select
                    aria-label="Точная оценка из загруженной страницы"
                    value={selectedVoteId}
                    disabled={locked}
                    onChange={(e) => {
                      setSelectedVoteId(e.target.value);
                      setConfirmed(false);
                    }}
                  >
                    <option value="">Выберите оценку</option>
                    {aggregateVotes.map((item) => (
                      <option key={item.voteId} value={item.voteId}>
                        {formatVoteValue(item.value)} · v{item.version}
                        {item.withdrawn ? " · отозвана" : ""}
                        {item.moderationState === "withheld" ? " · снята" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="form-field">
                <span>Решение</span>
                <select
                  aria-label="Решение по сообществу площадки"
                  value={decision}
                  disabled={locked}
                  onChange={(e) => {
                    setDecision(e.target.value as typeof decision);
                    setConfirmed(false);
                  }}
                >
                  {offeredDecisions.map((id) => (
                    <option key={id} value={id}>
                      {decisions[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Обоснование</span>
                <textarea
                  aria-label="Обоснование"
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
                Подтверждаю решение по точному ресурсу этого обращения
              </label>
              {!fresh ? (
                <button type="button" className="button outline" disabled={busy} onClick={() => void stepup()}>
                  Подтвердить вход
                </button>
              ) : null}
              <button className="button" disabled={!canSubmitDecision}>
                Записать решение
              </button>
            </form>
          ) : null}
          {visibleSource && !capability ? (
            <p role="status">
              Сервер не предлагает действий retain/withhold/restore для текущего состояния (закрыто,
              недоступно, tombstone/withdrawn/superseded или нет capability).
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
