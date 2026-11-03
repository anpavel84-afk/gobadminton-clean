"use client";

import { useEffect, useRef, useState } from "react";
import {
  commandRoleReviewReply,
  getMe,
  getRoleReputation,
  previewRoleReviewConsent,
  reportRoleReview,
} from "../../../lib/api-client";
import type {
  PublicRoleReviewItem,
  RoleKind,
  RoleReputationSummary,
  RoleReviewReportReason,
} from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ProfileDialog, SectionHeader } from "../players/ProfileComposition";
import "../../../styles/role-reputation.css";

const TOPIC_LABELS: Record<string, string> = {
  agreements: "Договорённости",
  flow: "Ход встречи",
  communication: "Общение",
  explanations: "Объяснения",
  attention: "Внимание",
  session_organization: "Организация занятия",
};

const REPORT_REASONS: Array<{ code: RoleReviewReportReason; label: string }> = [
  { code: "harassment", label: "Оскорбления" },
  { code: "spam", label: "Спам" },
  { code: "inappropriate", label: "Неуместный текст" },
  { code: "pii", label: "Личные данные" },
  { code: "threat", label: "Угрозы" },
  { code: "fabrication", label: "Вымысел" },
  { code: "other", label: "Другое" },
];

function roleHeading(role: RoleKind, count: number): string {
  const base = role === "training" ? "Отзывы о тренировках" : "Отзывы об организации";
  return count > 0 ? `${base} · ${count}` : base;
}

function heldGamesForm(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return "проведённых игр";
  if (n10 === 1) return "проведённая игра";
  if (n10 >= 2 && n10 <= 4) return "проведённые игры";
  return "проведённых игр";
}

/**
 * Public role reviews drawer. Uses ProfileDialog (Escape / focus return / body lock).
 * CAS errors keep server text and require explicit recheck — no auto-retry.
 */
export function RoleReviewsDialog({
  roleHandle,
  role,
  gameId,
  initial,
  csrfToken = null,
  onClose,
  onCompose,
}: {
  roleHandle: string;
  role: RoleKind;
  gameId?: string;
  initial?: RoleReputationSummary | null;
  csrfToken?: string | null;
  onClose: () => void;
  onCompose?: () => void;
}) {
  const [summary, setSummary] = useState<RoleReputationSummary | null>(initial ?? null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unavailable">(
    initial?.availability === "available" ? "ready" : "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<PublicRoleReviewItem | null>(null);
  const [reportReason, setReportReason] = useState<RoleReviewReportReason>("harassment");
  const [reportDetail, setReportDetail] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyConsent, setReplyConsent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [unknownKeys, setUnknownKeys] = useState<Record<string, string>>({});
  const [sessionCsrf, setSessionCsrf] = useState<string | null>(csrfToken);
  const epoch = useRef(0);
  const mounted = useRef(true);

  async function load(cursor?: string | null, append = false) {
    const request = ++epoch.current;
    if (!append) setState("loading");
    const result = await getRoleReputation(roleHandle, {
      gameId,
      cursor: cursor ?? undefined,
      limit: 20,
    });
    if (!mounted.current || request !== epoch.current) return;
    if (!result.ok) {
      setState(result.status === 404 ? "unavailable" : "error");
      return;
    }
    if (result.data.availability !== "available") {
      setSummary(result.data);
      setState("unavailable");
      return;
    }
    setSummary((prev) =>
      append && prev
        ? {
            ...result.data,
            items: [...prev.items, ...result.data.items],
          }
        : result.data,
    );
    setState("ready");
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
    // Intentionally bind to handle/game only — identity change clears via remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleHandle, gameId]);

  useEffect(() => {
    setSessionCsrf(csrfToken);
  }, [csrfToken]);

  useEffect(() => {
    const onExpire = () => {
      epoch.current += 1;
      setSessionCsrf(null);
      setReporting(null);
      setReplyDrafts({});
      setReplyConsent({});
      setNotice("Сессия истекла. Войдите снова, чтобы ответить или пожаловаться.");
    };
    window.addEventListener("gb-private-expired", onExpire);
    return () => window.removeEventListener("gb-private-expired", onExpire);
  }, []);

  async function ensureCsrf(): Promise<string | null> {
    if (sessionCsrf) return sessionCsrf;
    const me = await getMe();
    if (!mounted.current) return null;
    if (!me.ok) return null;
    setSessionCsrf(me.data.csrfToken);
    return me.data.csrfToken;
  }

  async function submitReport() {
    if (!reporting || busy) return;
    const latchKey = `report:${reporting.reviewHandle}:${reporting.publishedRevision}`;
    if (unknownKeys[latchKey]) {
      setNotice("Жалоба могла быть принята. Не отправляйте повторно с тем же ключом.");
      return;
    }
    const csrf = await ensureCsrf();
    if (!csrf) {
      setNotice("Войдите, чтобы отправить жалобу.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const key = unknownKeys[latchKey] ?? crypto.randomUUID().replace(/-/g, "");
    const result = await reportRoleReview(
      reporting.reviewHandle,
      {
        targetKind: "review",
        expectedRevision: reporting.publishedRevision,
        reasonCode: reportReason,
        explanation: reportDetail.trim() || undefined,
      },
      csrf,
      gameId,
      key,
    );
    setBusy(false);
    if (!mounted.current) return;
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        setUnknownKeys((prev) => ({ ...prev, [latchKey]: key }));
        setNotice("Не удалось подтвердить жалобу. Она могла быть получена — не повторяйте отправку.");
        return;
      }
      setNotice(result.error || "Не удалось отправить жалобу. Обновите список и проверьте версию.");
      return;
    }
    setReporting(null);
    setReportDetail("");
    setNotice("Жалоба отправлена. Отзыв остаётся видимым до решения человека.");
  }

  async function submitReply(item: PublicRoleReviewItem) {
    if (busy || !item.allowedActions.canReply) return;
    const text = (replyDrafts[item.reviewHandle] ?? "").trim();
    if (!text) return;
    if (!replyConsent[item.reviewHandle]) {
      setNotice("Отметьте согласие с публичной публикацией ответа.");
      return;
    }
    const latchKey = `reply:${item.reviewHandle}:${item.replyAggregateVersion}`;
    if (unknownKeys[latchKey]) {
      setNotice("Ответ мог быть принят. Не отправляйте повторно.");
      return;
    }
    const csrf = await ensureCsrf();
    if (!csrf) {
      setNotice("Войдите, чтобы ответить.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const preview = await previewRoleReviewConsent(
      { targetKind: "reply", reviewHandle: item.reviewHandle, text },
      csrf,
    );
    if (!mounted.current) return;
    if (!preview.ok) {
      setBusy(false);
      setNotice(preview.error || "Не удалось подготовить согласие.");
      return;
    }
    const key = unknownKeys[latchKey] ?? crypto.randomUUID().replace(/-/g, "");
    const result = await commandRoleReviewReply(
      item.reviewHandle,
      {
        action: "submit_revision",
        expectedVersion: item.replyAggregateVersion,
        expectedReviewRevision: item.publishedRevision,
        text,
        consentProjectionHash: preview.data.consentProjectionHash,
      },
      csrf,
      key,
    );
    setBusy(false);
    if (!mounted.current) return;
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        setUnknownKeys((prev) => ({ ...prev, [latchKey]: key }));
        setNotice("Не удалось подтвердить ответ. Он мог быть принят — не повторяйте отправку.");
        return;
      }
      setNotice(result.error || "Конфликт версии. Обновите отзывы и проверьте снова.");
      return;
    }
    setReplyDrafts((prev) => ({ ...prev, [item.reviewHandle]: "" }));
    setReplyConsent((prev) => ({ ...prev, [item.reviewHandle]: false }));
    setNotice(
      result.data.pendingIntakeStatus === "waiting_intake"
        ? "Ответ отправлен и ожидает разбора. Пока без назначенного специалиста."
        : "Ответ принят.",
    );
    void load();
  }

  const count = summary?.publishedReviewCount ?? 0;

  return (
    <ProfileDialog
      title={roleHeading(role, count)}
      onClose={onClose}
      className="profile-dialog--postgame"
      lockBodyScroll
      describedBy="gb-role-rep-dialog-hint"
    >
      <p id="gb-role-rep-dialog-hint" className="gb-role-rep__hint">
        Опыт участников. Отрицательные впечатления тоже важны. Читать можно без прошлого участия.
      </p>
      {state === "loading" ? <p role="status">Загружаем отзывы…</p> : null}
      {state === "error" ? (
        <p role="alert">
          Не удалось загрузить.{" "}
          <Button variant="outline" type="button" onClick={() => void load()}>
            Обновить
          </Button>
        </p>
      ) : null}
      {state === "unavailable" ? (
        <p>Публичные отзывы по этой роли сейчас недоступны.</p>
      ) : null}
      {state === "ready" && summary ? (
        <>
          {summary.heldGamesCount != null ? (
            <p className="gb-role-rep__held">
              {summary.heldGamesCount > 0 ? (
                <>
                  <strong>{summary.heldGamesCount}</strong>{" "}
                  {`${heldGamesForm(summary.heldGamesCount)} по подтверждённой истории`}
                  {summary.historyMayBeIncomplete ? ". История может быть неполной" : ""}
                </>
              ) : (
                <>
                  По подтверждённой истории проведённых игр пока нет
                  {summary.historyMayBeIncomplete ? ". История может быть неполной" : ""}
                </>
              )}
            </p>
          ) : null}
          {!summary.items.length ? (
            <p>Пока нет опубликованных отзывов.</p>
          ) : (
            summary.items.map((item) => (
              <article key={item.reviewHandle} className="gb-role-rep-item">
                <div className="gb-role-rep-item__meta">
                  <strong>{item.authorLabel}</strong>
                  <span className="gb-role-rep-item__badge">✓ Участие подтверждено</span>
                  {item.experienceState === "basis_under_review" ? (
                    <span>Основание на проверке</span>
                  ) : null}
                </div>
                <p className="gb-role-rep-item__text">{item.text}</p>
                {item.topics.length ? (
                  <div className="gb-role-rep-item__topics">
                    {item.topics.map((t) => (
                      <span key={t}>{TOPIC_LABELS[t] ?? t}</span>
                    ))}
                  </div>
                ) : null}
                {item.reply ? (
                  <p className="gb-role-rep-reply">
                    Ответ{" "}
                    {item.role === "training" ? "тренера" : "организатора"}: {item.reply.text}
                  </p>
                ) : null}
                {item.subjectOwnReply ? (
                  <p className="gb-role-rep-pending" role="status">
                    Ваш ответ: {item.subjectOwnReply.status}
                    {item.subjectOwnReply.status === "submitted" ||
                    item.subjectOwnReply.status === "revision_waiting"
                      ? " — ожидает разбора"
                      : ""}
                  </p>
                ) : null}
                <div className="gb-role-rep__actions">
                  {item.allowedActions.canReport ? (
                    <Button variant="ghost" type="button" onClick={() => setReporting(item)}>
                      Сообщить о нарушении
                    </Button>
                  ) : null}
                  {item.allowedActions.canReply ? (
                    <div className="gb-role-rep-composer" style={{ width: "100%" }}>
                      <label className="profile-field">
                        Ваш ответ
                        <textarea
                          maxLength={500}
                          rows={3}
                          value={replyDrafts[item.reviewHandle] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setReplyDrafts((prev) => ({ ...prev, [item.reviewHandle]: value }));
                            setReplyConsent((prev) => ({ ...prev, [item.reviewHandle]: false }));
                          }}
                          disabled={busy}
                        />
                      </label>
                      <label className="gb-role-rep-consent">
                        <input
                          type="checkbox"
                          checked={Boolean(replyConsent[item.reviewHandle])}
                          onChange={(e) =>
                            setReplyConsent((prev) => ({
                              ...prev,
                              [item.reviewHandle]: e.target.checked,
                            }))
                          }
                          disabled={busy}
                        />
                        <span>Публикую ответ от своего имени по этой роли</span>
                      </label>
                      <Button
                        type="button"
                        disabled={busy || !(replyDrafts[item.reviewHandle] ?? "").trim()}
                        onClick={() => void submitReply(item)}
                      >
                        Отправить ответ
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
          {summary.nextCursor ? (
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void load(summary.nextCursor, true)}
            >
              Ещё отзывы
            </Button>
          ) : null}
          {onCompose ? (
            <Button type="button" onClick={onCompose}>
              Поделиться опытом
            </Button>
          ) : null}
        </>
      ) : null}
      {notice ? (
        <p className="gb-role-rep-pending" role="status">
          {notice}
        </p>
      ) : null}
      {reporting ? (
        <div className="gb-role-rep-composer">
          <SectionHeader title="Жалоба на отзыв" />
          <label className="profile-field">
            Причина
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value as RoleReviewReportReason)}
              disabled={busy}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="profile-field">
            Пояснение
            <textarea
              maxLength={500}
              rows={3}
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="gb-role-rep__actions">
            <Button type="button" disabled={busy} onClick={() => void submitReport()}>
              Отправить жалобу
            </Button>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setReporting(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </ProfileDialog>
  );
}
