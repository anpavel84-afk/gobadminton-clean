"use client";
import { useEffect, useRef, useState } from "react";
import { AdminError, adminRequest, freshStepUp, type Session } from "../lib/admin-client";

type Binding = {
  bindingId: string;
  entityKind: string;
  entityId: string;
  surface: string;
  resourceVersion: number;
  bindingKind: string;
  roleReputationDecisionId: string | null;
  venueReviewDecisionId: string | null;
  createdAt: string;
};
type Item = {
  approvalId: string;
  surface: string;
  decision: string;
  providerKey: string;
  providerModel: string;
  policyVersion: string;
  localPolicyVersion: string;
  checkedAt: string;
  bindingStatus: "bound" | "unbound_or_legacy";
  bindings: Binding[];
};
type Page = {
  historyScope: string;
  historyNote: string;
  items: Item[];
  nextBeforeCheckedAt: string | null;
  nextBeforeId: string | null;
};

type Filters = {
  surface: string;
  decision: string;
  policy: string;
  model: string;
};

const decisionLabel: Record<string, string> = { allow: "Разрешено", review: "На проверку" };
const bindingLabel: Record<string, string> = {
  bound: "Есть привязка",
  unbound_or_legacy: "Без привязки / устаревшее",
};

function sameFilters(a: Filters, b: Filters): boolean {
  return (
    a.surface === b.surface &&
    a.decision === b.decision &&
    a.policy === b.policy &&
    a.model === b.model
  );
}

export function ModerationJournal({
  session,
  busy,
  now,
  run,
  stepup,
  onAuthorityLoss,
}: {
  session: Session;
  busy: boolean;
  now: number;
  run: (fn: () => Promise<void>) => Promise<void>;
  stepup: () => Promise<void>;
  onAuthorityLoss: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [surface, setSurface] = useState("");
  const [decision, setDecision] = useState("");
  const [policy, setPolicy] = useState("");
  const [model, setModel] = useState("");
  /** Filters that produced the currently displayed page (cursor append scope). */
  const [applied, setApplied] = useState<Filters | null>(null);
  const fresh = freshStepUp(session, now);
  const draft = { surface, decision, policy, model };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const pageRef = useRef(page);
  pageRef.current = page;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const draftDirty = applied !== null && !sameFilters(draft, applied);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  function responseStillAuthorized(gen: number, principalId: string): boolean {
    return (
      mounted.current &&
      gen === requestGeneration.current &&
      freshStepUp(sessionRef.current, Date.now()) &&
      sessionRef.current.principalId === principalId
    );
  }

  async function load(mode: "refresh" | "more") {
    await run(async () => {
      if (!freshStepUp(session, Date.now())) {
        requestGeneration.current += 1;
        setPage(null);
        setApplied(null);
        throw new AdminError("ADMIN_STEP_UP_REQUIRED", 403);
      }
      const gen = ++requestGeneration.current;
      const principalId = session.principalId;
      const filters: Filters | null =
        mode === "more" ? appliedRef.current : { ...draftRef.current };
      if (!filters) return;
      if (mode === "more" && !sameFilters(draftRef.current, filters)) return;

      const cursor =
        mode === "more" &&
        pageRef.current?.nextBeforeId &&
        pageRef.current?.nextBeforeCheckedAt
          ? {
              beforeCheckedAt: pageRef.current.nextBeforeCheckedAt,
              beforeId: pageRef.current.nextBeforeId,
            }
          : undefined;
      if (mode === "more" && !cursor) return;

      const params = new URLSearchParams();
      if (filters.surface.trim()) params.set("surface", filters.surface.trim());
      if (filters.decision) params.set("decision", filters.decision);
      if (filters.policy.trim()) params.set("policy", filters.policy.trim());
      if (filters.model.trim()) params.set("model", filters.model.trim());
      if (cursor) {
        params.set("beforeCheckedAt", cursor.beforeCheckedAt);
        params.set("beforeId", cursor.beforeId);
      }
      const qs = params.toString();
      try {
        const next = await adminRequest<Page>("audit/moderation" + (qs ? `?${qs}` : ""));
        if (!responseStillAuthorized(gen, principalId)) return;
        if (mode === "refresh") {
          if (!sameFilters(draftRef.current, filters)) return;
          setApplied(filters);
          setPage(next);
          return;
        }
        if (!appliedRef.current || !sameFilters(appliedRef.current, filters)) return;
        setPage((prev) =>
          cursor
            ? { ...next, items: [...(prev?.items ?? []), ...next.items] }
            : next,
        );
      } catch (error) {
        if (!responseStillAuthorized(gen, principalId)) return;
        setPage(null);
        setApplied(null);
        if (error instanceof AdminError && (error.status === 401 || error.code === "ADMIN_PERMISSION_DENIED" || error.code === "ADMIN_STEP_UP_REQUIRED")) {
          if (error.status === 401 || error.code === "ADMIN_PERMISSION_DENIED") onAuthorityLoss();
        }
        throw error;
      }
    });
  }

  useEffect(() => {
    if (!fresh) {
      requestGeneration.current += 1;
      setPage(null);
      setApplied(null);
      return;
    }
    void load("refresh");
    // Initial load when step-up becomes fresh; filters apply on explicit refresh.
  }, [session.principalId, session.stepUpAt, fresh]);

  return (
    <div className="moderation-journal">
      <h3>Метаданные модерации</h3>
      <p>
        Ограниченная история сохранённых allow/review решений и привязок. Это не полный журнал каждой
        попытки провайдера; отклонённые и временные события сюда не добавляются.
      </p>
      {!fresh ? (
        <div className="notice">
          <strong>Нужно подтверждение входа</strong>
          <p>Для чтения метаданных модерации подтвердите вход ключом доступа.</p>
          <button className="button outline" disabled={busy} onClick={() => void stepup()}>
            Подтвердить вход
          </button>
        </div>
      ) : (
        <>
          <div className="moderation-filters">
            <label className="form-field">
              <span>Поверхность</span>
              <input value={surface} maxLength={64} disabled={busy} onChange={(e) => setSurface(e.target.value)} />
            </label>
            <label className="form-field">
              <span>Решение</span>
              <select value={decision} disabled={busy} onChange={(e) => setDecision(e.target.value)}>
                <option value="">Все сохранённые</option>
                <option value="allow">Разрешено</option>
                <option value="review">На проверку</option>
              </select>
            </label>
            <label className="form-field">
              <span>Политика</span>
              <input value={policy} maxLength={128} disabled={busy} onChange={(e) => setPolicy(e.target.value)} />
            </label>
            <label className="form-field">
              <span>Модель</span>
              <input value={model} maxLength={128} disabled={busy} onChange={(e) => setModel(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button className="button outline" disabled={busy} onClick={() => void load("refresh")}>
              Обновить
            </button>
          </div>
          {page ? (
            <>
              <p className="moderation-scope">{page.historyNote}</p>
              {draftDirty ? (
                <p className="notice" role="status">
                  Фильтры изменены — нажмите «Обновить», чтобы загрузить первую страницу с новыми
                  фильтрами. «Ещё» отключено, пока черновик не совпадает с загруженной выборкой.
                </p>
              ) : null}
              {page.items.length ? (
                <ul className="events moderation-events">
                  {page.items.map((item) => (
                    <li key={item.approvalId}>
                      <strong>
                        {item.surface} · {decisionLabel[item.decision] ?? item.decision}
                      </strong>
                      <small>
                        {new Date(item.checkedAt).toLocaleString("ru-RU")} · {item.providerKey}/{item.providerModel}
                      </small>
                      <small>
                        Политика {item.policyVersion} / локально {item.localPolicyVersion} ·{" "}
                        {bindingLabel[item.bindingStatus] ?? item.bindingStatus}
                      </small>
                      {item.bindings.length > 0 && (
                        <ul className="moderation-bindings">
                          {item.bindings.map((b) => (
                            <li key={b.bindingId}>
                              {b.entityKind} · версия {b.resourceVersion} · {b.bindingKind}
                              {b.roleReputationDecisionId ? " · решение роли" : ""}
                              {b.venueReviewDecisionId ? " · решение площадки" : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="notice">Сохранённых allow/review записей по фильтру нет.</div>
              )}
              {page.nextBeforeId && page.nextBeforeCheckedAt && (
                <div className="actions">
                  <button
                    className="button outline"
                    disabled={busy || draftDirty}
                    onClick={() => void load("more")}
                  >
                    Ещё
                  </button>
                </div>
              )}
            </>
          ) : (
            <p role="status">Загружаем метаданные…</p>
          )}
        </>
      )}
    </div>
  );
}
