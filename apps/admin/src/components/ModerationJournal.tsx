"use client";
import { useEffect, useState } from "react";
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

const decisionLabel: Record<string, string> = { allow: "Разрешено", review: "На проверку" };
const bindingLabel: Record<string, string> = {
  bound: "Есть привязка",
  unbound_or_legacy: "Без привязки / устаревшее",
};

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
  const fresh = freshStepUp(session, now);

  async function load(cursor?: { beforeCheckedAt: string; beforeId: string }) {
    await run(async () => {
      if (!freshStepUp(session, Date.now())) {
        setPage(null);
        throw new AdminError("ADMIN_STEP_UP_REQUIRED", 403);
      }
      const params = new URLSearchParams();
      if (surface.trim()) params.set("surface", surface.trim());
      if (decision) params.set("decision", decision);
      if (policy.trim()) params.set("policy", policy.trim());
      if (model.trim()) params.set("model", model.trim());
      if (cursor) {
        params.set("beforeCheckedAt", cursor.beforeCheckedAt);
        params.set("beforeId", cursor.beforeId);
      }
      const qs = params.toString();
      try {
        const next = await adminRequest<Page>("audit/moderation" + (qs ? `?${qs}` : ""));
        setPage((prev) =>
          cursor
            ? { ...next, items: [...(prev?.items ?? []), ...next.items] }
            : next,
        );
      } catch (error) {
        setPage(null);
        if (error instanceof AdminError && (error.status === 401 || error.code === "ADMIN_PERMISSION_DENIED" || error.code === "ADMIN_STEP_UP_REQUIRED")) {
          if (error.status === 401 || error.code === "ADMIN_PERMISSION_DENIED") onAuthorityLoss();
        }
        throw error;
      }
    });
  }

  useEffect(() => {
    if (!fresh) {
      setPage(null);
      return;
    }
    void load();
    // Initial load when step-up becomes fresh; filters apply on explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <button className="button outline" disabled={busy} onClick={() => void load()}>
              Обновить
            </button>
          </div>
          {page ? (
            <>
              <p className="moderation-scope">{page.historyNote}</p>
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
                    disabled={busy}
                    onClick={() =>
                      void load({
                        beforeCheckedAt: page.nextBeforeCheckedAt!,
                        beforeId: page.nextBeforeId!,
                      })
                    }
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
