"use client";

import { useEffect, useRef, useState } from "react";
import { publicTextModerationNotice } from "../../../lib/api-client";
import {
  createVenueReview,
  getOwnVenueReviewEligibility,
  getOwnVenueReview,
  isSelectedOwnVenueReview,
  isSubmitVenueReviewReceipt,
  venueReviewCommand,
  type SelectedOwnVenueReview,
  type SubmitVenueReviewCommand,
  previewVenueReviewConsent,
  type OwnVenueEligibilityBasis,
  type VenueAudience,
  type VenueTopic,
  type VenueReviewMutationReceipt,
} from "../../../lib/venue-reviews-api";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import "../../../styles/venue-reviews.css";

const TOPICS: Array<{ value: VenueTopic; label: string }> = [
  { value: "surface", label: "Покрытие" },
  { value: "lighting", label: "Свет" },
  { value: "amenities", label: "Удобства" },
];

export function venueReviewEligibilityHelp(basis: OwnVenueEligibilityBasis | undefined): string | null {
  if (!basis) return "Не удалось подтвердить возможность отзыва по этой игре.";
  if (basis.helpHint === "attendance_unmarked") {
    return "Посещение ещё не отмечено. Можно попросить уточнение в итогах игры — без самостоятельной отметки.";
  }
  if (basis.helpHint === "attendance_clarifying") {
    return "Уточняем посещение. Пока спор или отсутствие не закрыты, отзыв о площадке недоступен.";
  }
  if (basis.helpHint === "missing_history" || basis.admission === "missing_history") {
    return "Не удалось подтвердить историческую площадку этой игры. Это ограничение данных, а не новое разрешение.";
  }
  if (basis.admission === "deny" && basis.reason === "window_closed") {
    return "Срок подачи отзыва по этой игре истёк.";
  }
  if (basis.admission !== "may_submit") {
    return `Сейчас нельзя оставить отзыв по этой игре.${basis.reason ? ` Причина: ${basis.reason}.` : ""}`;
  }
  return null;
}

/**
 * Venue experience composer. Default audience is private self_draft;
 * public requires unchecked consent after exact projection preview.
 */
export function VenueReviewComposer({
  venueId,
  csrfToken,
  actorId,
  onUnresolvedChange,
  gameId,
  eligibilityRefresh,
  onClose,
  onSubmitted,
  edit,
  onConflict,
  onFreshRead,
  onUnauthorized,
}: {
  venueId: string;
  csrfToken: string;
  actorId: string | null;
  onUnresolvedChange?: (value: boolean) => void;
  gameId: string;
  eligibilityRefresh?: object;
  onClose: () => void;
  onSubmitted?: () => void;
  edit?: SelectedOwnVenueReview;
  onConflict?: () => void;
  onFreshRead?: (value: SelectedOwnVenueReview) => void;
  onUnauthorized?: () => void;
}) {
  const [bases, setBases] = useState<OwnVenueEligibilityBasis[]>([]);
  const [topics, setTopics] = useState<VenueTopic[]>(["surface"]);
  const [editSnapshot, setEditSnapshot] = useState(edit);
  const [readRequired, setReadRequired] = useState(false);
  const stale = useRef(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<VenueAudience>("self_draft");
  const [consent, setConsent] = useState(false);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [previewAuthorLabel, setPreviewAuthorLabel] = useState("Участник игры");
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<VenueReviewMutationReceipt | null>(null);
  const [nativeHidden, setNativeHidden] = useState(false);
  const [reopenSignal, setReopenSignal] = useState(0);
  type Packet = ({ kind: "create"; body: Parameters<typeof createVenueReview>[0] }
    | { kind: "edit"; id: string; own: SelectedOwnVenueReview; body: SubmitVenueReviewCommand }) & {
    key: string; actorId: string; csrf: string; generation: number;
  };
  const [packet, setPacket] = useState<Packet | null>(null);
  const packetRef = useRef<Packet | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewSequence = useRef(0);
  const reviewId = edit?.id ?? null;
  const context = useRef({ venueId, actorId, csrfToken, gameId, reviewId, revoked: false });
  // Fence before effects: a late response must never settle a different actor or venue.
  if (context.current.venueId !== venueId || context.current.actorId !== actorId
    || context.current.csrfToken !== csrfToken || context.current.gameId !== gameId || context.current.reviewId !== reviewId) {
    context.current = { venueId, actorId, csrfToken, gameId, reviewId, revoked: false };
    epoch.current += 1;
    previewSequence.current += 1;
    packetRef.current = null;
    sendLock.current = false;
    setPacket(null); setBusy(false); setPreviewBusy(false);
    setNativeHidden(false);
    setConsent(false); setPreviewHash(null); setReceipt(null); setNotice(null);
    setText(""); setAudience("self_draft"); setTopics(["surface"]); setEditSnapshot(edit);
    stale.current = false; setReadRequired(false); setBases([]); setState("loading");
  }
  const draftKey = JSON.stringify([text, topics, gameId, audience]);
  const draft = useRef(draftKey);
  if (draft.current !== draftKey) {
    draft.current = draftKey;
    previewSequence.current += 1;
    setConsent(false); setPreviewHash(null); setPreviewBusy(false);
  }
  const csrf = context.current.revoked ? "" : csrfToken;
  const unknownKey = packet?.key ?? null;
  const locked = busy || Boolean(packet);
  useEffect(() => {
    onUnresolvedChange?.(Boolean(busy || packet));
  }, [busy, packet, onUnresolvedChange]);
  useEffect(() => () => onUnresolvedChange?.(false), [onUnresolvedChange]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current += 1; };
  }, [venueId, gameId, actorId, csrfToken, reviewId]);

  useEffect(() => {
    // A same-context refresh may update an idle form, never an admitted operation.
    if (packetRef.current || sendLock.current || receipt) return;
    previewSequence.current += 1;
    setPreviewBusy(false); setConsent(false); setPreviewHash(null);
    const controller = new AbortController();
    const request = ++epoch.current;
    setState(context.current.revoked ? "auth" : "loading");
    if (!context.current.revoked && actorId && csrfToken) void (async () => {
      try {
        if (edit) {
          const result = await getOwnVenueReview(edit.id, controller.signal);
          if (controller.signal.aborted || !mounted.current || request !== epoch.current || context.current.revoked) return;
          if (!result.ok) {
            if (result.status === 401 || result.status === 403) {
              context.current.revoked = true; setText(""); setState("auth"); onUnauthorized?.();
            } else setState("error");
            return;
          }
          if (!isSelectedOwnVenueReview(result.data, edit)) { setState("error"); return; }
          setEditSnapshot(result.data);
          setBases(result.data.editContext ? [result.data.editContext.basis] : []);
          setText(result.data.text ?? "");
          setTopics(result.data.topics.filter((value): value is VenueTopic => TOPICS.some(topic => topic.value === value)));
          setAudience(result.data.audience ?? "self_draft");
          if (!stale.current && result.data.editContext && result.data.editContext.gameId !== gameId) {
            stale.current = true; setReadRequired(true); onConflict?.(); setState("ready");
            setNotice("Основание выбранной редакции изменилось. Перечитайте отзыв перед новым подтверждением.");
            return;
          }
          // Only an explicit successful selected read clears a version-conflict fence.
          if (stale.current) {
            stale.current = false; setReadRequired(false); onFreshRead?.(result.data); onClose(); return;
          }
          setState("ready");
        } else {
          const result = await getOwnVenueReviewEligibility(venueId, controller.signal);
          if (controller.signal.aborted || !mounted.current || request !== epoch.current || context.current.revoked) return;
          if (!result.ok) {
            if (result.status === 401 || result.status === 403) {
              context.current.revoked = true; setText(""); setState("auth"); onUnauthorized?.();
            } else setState("error");
            return;
          }
          setBases(result.data.bases); setState("ready");
        }
      } catch {
        if (!controller.signal.aborted && mounted.current && request === epoch.current) setState("error");
      }
    })();
    else setState("auth");
    return () => controller.abort();
  }, [venueId, gameId, actorId, csrfToken, eligibilityRefresh, edit, refreshSequence]);

  useEffect(() => {
    const fence = () => {
      context.current.revoked = true;
      epoch.current += 1; previewSequence.current += 1;
      packetRef.current = null; sendLock.current = false;
      setPacket(null); setBusy(false); setPreviewBusy(false);
      setNativeHidden(false);
      setConsent(false); setPreviewHash(null); setReceipt(null); setText("");
      setAudience("self_draft"); setState("auth");
      setNotice("Сессия изменилась. Повтор прежней отправки недоступен; её результат не подтверждён.");
    };
    window.addEventListener("gb-private-expired", fence);
    window.addEventListener("gb-session-changed", fence);
    return () => {
      window.removeEventListener("gb-private-expired", fence);
      window.removeEventListener("gb-session-changed", fence);
    };
  }, []);

  const selected = bases.find((b) => b.gameId === gameId);
  const help = venueReviewEligibilityHelp(selected);
  const canSubmit = state === "ready" && !readRequired && !receipt && Boolean(gameId) && selected?.admission === "may_submit"
    && text.trim().length >= 1 && text.trim().length <= 500
    && (audience === "self_draft" || (consent && previewHash));
  function current(generation: number) {
    return mounted.current && !context.current.revoked && generation === epoch.current;
  }

  async function ensurePreview(): Promise<string | null> {
    if (audience !== "public_venue" || !csrf || locked || readRequired) return null;
    const generation = epoch.current;
    const revision = ++previewSequence.current;
    const admittedDraft = draft.current;
    setPreviewBusy(true);
    try {
      const result = await previewVenueReviewConsent({ venueId, text: text.trim(), topics }, csrf);
      if (!current(generation) || revision !== previewSequence.current || draft.current !== admittedDraft) return null;
      if (!result.ok) {
        setNotice(result.error || "Не удалось подготовить публичный просмотр.");
        return null;
      }
      setPreviewAuthorLabel(result.data.authorLabel);
      setPreviewHash(result.data.consentProjectionHash);
      setConsent(true);
      return result.data.consentProjectionHash;
    } catch {
      if (current(generation) && revision === previewSequence.current) setNotice("Не удалось подготовить публичный просмотр.");
      return null;
    } finally {
      if (current(generation) && revision === previewSequence.current) setPreviewBusy(false);
    }
  }

  async function onSubmit() {
    if (sendLock.current || !csrf || !actorId || context.current.revoked) return;
    let pending = packetRef.current;
    if (!pending && (!canSubmit || !selected || previewBusy)) return;
    const generation = epoch.current;
    const admittedDraft = draft.current;
    const admittedPreview = previewSequence.current;
    sendLock.current = true;
    setBusy(true); setNotice(null);
    try {
      if (!pending) {
        // Recheck only a new write. UNKNOWN retries retain their entire admitted packet.
        let fresh: OwnVenueEligibilityBasis | undefined;
        let freshOwn: SelectedOwnVenueReview | undefined;
        if (edit) {
          const result = await getOwnVenueReview(edit.id);
          if (!current(generation) || draft.current !== admittedDraft || previewSequence.current !== admittedPreview) return;
          if (!result.ok) {
            setNotice(result.error || "Не удалось перечитать отзыв.");
            setState(result.status === 401 || result.status === 403 ? "auth" : "error");
            if (result.status === 401 || result.status === 403) {
              context.current.revoked = true; setText(""); setConsent(false); setPreviewHash(null); onUnauthorized?.();
            }
            return;
          }
          if (!isSelectedOwnVenueReview(result.data, edit)) { setState("error"); return; }
          freshOwn = result.data;
          fresh = freshOwn.editContext?.basis;
          const oldContext = editSnapshot?.editContext;
          if (freshOwn.version !== editSnapshot?.version
            || freshOwn.editContext?.revisionId !== oldContext?.revisionId
            || freshOwn.editContext?.resourceVersion !== oldContext?.resourceVersion
            || freshOwn.editContext?.gameId !== oldContext?.gameId
            || fresh?.outcomeVersion !== selected?.outcomeVersion
            || fresh?.attendanceVersion !== selected?.attendanceVersion) {
            setEditSnapshot(freshOwn); setBases(fresh ? [fresh] : []);
            setConsent(false); setPreviewHash(null); previewSequence.current += 1;
            stale.current = true; setReadRequired(true); onConflict?.();
            setNotice("Версия изменилась. Перечитайте выбранный отзыв и подтвердите заново.");
            return;
          }
        } else {
          const result = await getOwnVenueReviewEligibility(venueId);
          if (!current(generation) || draft.current !== admittedDraft || previewSequence.current !== admittedPreview) return;
          if (!result.ok) {
            setNotice(result.error || "Не удалось проверить допуск.");
            setState(result.status === 401 || result.status === 403 ? "auth" : "error");
            if (result.status === 401 || result.status === 403) {
              context.current.revoked = true; setText(""); setConsent(false); setPreviewHash(null); onUnauthorized?.();
            }
            return;
          }
          setBases(result.data.bases);
          fresh = result.data.bases.find(b => b.gameId === gameId);
        }
        if (fresh?.admission !== "may_submit") { setBases(fresh ? [fresh] : []); return; }
        if (fresh.outcomeVersion !== selected?.outcomeVersion
          || fresh.attendanceVersion !== selected?.attendanceVersion) {
          setConsent(false); setPreviewHash(null);
          setNotice("Данные игры изменились. Проверьте обновлённый допуск перед новой отправкой.");
          return;
        }
        const body = {
          gameId: fresh.gameId, audience,
          expectedBasisVersions: { outcomeVersion: fresh.outcomeVersion, attendanceVersion: fresh.attendanceVersion },
          text: text.trim(), topics: [...topics],
          ...(audience === "public_venue" && previewHash ? { consentProjectionHash: previewHash } : {}),
        };
        const identity = { key: crypto.randomUUID().replace(/-/g, ""), actorId, csrf, generation };
        pending = freshOwn
          ? { ...identity, kind: "edit", id: freshOwn.id, own: freshOwn,
            body: { ...body, action: "submit_revision", expectedVersion: freshOwn.version } }
          : { ...identity, kind: "create", body: { ...body, venueId } };
        packetRef.current = pending;
        setPacket(pending);
      }
      if (!current(pending.generation) || pending.actorId !== actorId || pending.csrf !== csrf
        || (pending.kind === "create" && pending.body.venueId !== venueId) || pending.body.gameId !== gameId) return;
      const admitted = pending;
      // Exact in-memory packet only; retry never reads mutable controls or fresh credentials.
      const result = admitted.kind === "edit"
        ? await venueReviewCommand(admitted.id, admitted.body, admitted.csrf, admitted.key)
        : await createVenueReview(admitted.body, admitted.csrf, admitted.key);
      if (!current(admitted.generation) || packetRef.current !== admitted) return;
      if (!result.ok) {
        if (result.status === 0 || result.status >= 500) {
          setNotice(publicTextModerationNotice(result) || "Не удалось подтвердить отправку. Текст сохранён");
          return;
        }
        packetRef.current = null; setPacket(null);
        setNotice(publicTextModerationNotice(result) || (result.status === 409
          ? "Версия изменилась. Закройте окно и перечитайте данные перед новой отправкой."
          : result.error || "Отправка недоступна для этой игры."));
        if (result.status === 409) {
          setState("error"); setConsent(false); setPreviewHash(null);
          if (edit) { stale.current = true; setReadRequired(true); onConflict?.(); }
        }
        if (result.status === 401 || result.status === 403) {
          context.current.revoked = true;
          setNativeHidden(false); setText(""); setReceipt(null);
          setConsent(false); setPreviewHash(null); setState("auth"); onUnauthorized?.();
        }
        return;
      }
      if (admitted.kind === "edit" && !isSubmitVenueReviewReceipt(result.data, admitted.own, admitted.body.audience)) {
        setNotice("Не удалось подтвердить отправку. Исходный запрос сохранён."); return;
      }
      packetRef.current = null; setPacket(null);
      setReceipt(result.data);
      setNotice(null);
      onSubmitted?.();
    } catch {
      if (current(generation)) setNotice(pending
        ? "Не удалось подтвердить отправку. Текст сохранён"
        : "Не удалось проверить допуск. Текст сохранён");
    } finally {
      if (mounted.current && generation === epoch.current) { sendLock.current = false; setBusy(false); }
    }
  }
  function requestClose() {
    if (sendLock.current || packetRef.current) {
      setNotice("Проверьте результат отправки перед закрытием окна.");
      return;
    }
    onClose();
  }

  return (
    <>
    {nativeHidden && !context.current.revoked ? <Button
      data-testid="venue-review-resume"
      autoFocus
      style={{ minHeight: 44, minWidth: 44 }}
      onClick={() => { setNativeHidden(false); setReopenSignal(value => value + 1); }}
    >Проверить отправку</Button> : null}
    <ProfileDialog
      title={edit ? "Изменить отзыв о площадке" : "Как вам площадка?"}
      onClose={requestClose}
      className="profile-dialog--postgame"
      lockBodyScroll
      onNativeClose={() => {
        if (sendLock.current || packetRef.current) setNativeHidden(true);
        else onClose();
      }}
      reopenSignal={reopenSignal}
      describedBy="gb-venue-review-composer-hint"
    >
      <div className="gb-venue-reviews gb-venue-reviews__composer-body">
        <p id="gb-venue-review-composer-hint" className="gb-venue-reviews__lede">
          По умолчанию текст только вам. Публичный отзыв — без профиля, игры и состава.
        </p>
        {state === "loading" ? <p role="status">Проверяем допуск по этой игре…</p> : null}
        {state === "auth" ? <p role="status">Войдите, чтобы поделиться опытом.</p> : null}
        {state === "error" ? <p role="alert">Не удалось проверить допуск.</p> : null}
        {edit && (readRequired || state === "error") ? <div role="alert">
          <p>Сначала успешно перечитайте выбранный отзыв. Затем потребуется новое подтверждение.</p>
          <Button disabled={locked || state === "loading"} onClick={() => setRefreshSequence(value => value + 1)}>Перечитать выбранный отзыв</Button>
        </div> : null}
        {previewBusy ? <p role="status">Подготавливаем публичный просмотр…</p> : null}
        {state !== "ready" && notice ? <p role="status">{notice}</p> : null}
        {state === "ready" ? (
          <>
            <span
              className={
                selected?.admission === "may_submit"
                  ? "gb-venue-reviews__badge"
                  : "gb-venue-reviews__badge gb-venue-reviews__badge--muted"
              }
            >
              {selected?.admission === "may_submit"
                ? "Можно поделиться опытом"
                : "Пока нельзя отправить"}
            </span>
            <p className="gb-venue-reviews__lede">
              {audience === "self_draft" ? "Только вам" : "Публично на странице площадки"}
              {selected?.gameTitle ? ` · игра: «${selected.gameTitle}»` : null}
            </p>
            <p className="gb-venue-reviews__hint">
              Отзыв относится только к этой игре. В публичном отзыве не будет названия игры, состава и точного времени.
            </p>
            {help ? (
              <p role="status" className="gb-venue-reviews__lede">
                {help}
              </p>
            ) : null}
            <div className="gb-venue-reviews__field">
              <label htmlFor="venue-review-topic">О чём хотите рассказать</label>
              <select
                id="venue-review-topic"
                multiple={Boolean(edit)}
                value={edit ? topics : topics[0] ?? ""}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, option => option.value);
                  setTopics(TOPICS.filter(topic => values.includes(topic.value)).map(topic => topic.value));
                }}
                disabled={locked}
              >
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="gb-venue-reviews__field">
              <label htmlFor="venue-review-text">Ваш опыт на площадке</label>
              <textarea
                id="venue-review-text"
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                disabled={locked}
              />
              <p className="gb-venue-reviews__count">{text.trim().length} / 500</p>
              <p className="gb-venue-reviews__hint">
                Не указывайте имена и контакты — так отзыв останется без лишних деталей.
              </p>
            </div>
            <div className="gb-venue-reviews__audience" role="group" aria-label="Кому видно">
              <label>
                <input
                  type="radio"
                  name="venue-audience"
                  checked={audience === "self_draft"}
                  onChange={() => setAudience("self_draft")}
                  disabled={locked}
                />
                <span>Оставить только себе</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="venue-audience"
                  checked={audience === "public_venue"}
                  onChange={() => setAudience("public_venue")}
                  disabled={locked}
                />
                <span>Всем на странице площадки</span>
              </label>
            </div>
            {audience === "public_venue" ? (
              <div className="gb-venue-reviews__preview">
                <strong>Как увидят другие</strong>
                <p className="gb-venue-reviews__card-meta">{previewHash ? previewAuthorLabel : "Участник игры"}
                  {topics.length ? ` · ${TOPICS.filter(t => topics.includes(t.value)).map(t => t.label).join(", ")}` : ""}</p>
                <p className="gb-venue-reviews__card-text">{text.trim() || "—"}</p>
                <label style={{ display: "flex", gap: 10, marginTop: 12, minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={locked || readRequired || previewBusy || !text.trim()}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next) {
                        void ensurePreview();
                        return;
                      }
                      previewSequence.current += 1;
                      setConsent(false); setPreviewHash(null);
                    }}
                  />
                  <span>
                    Подтверждаю публикацию этого текста без моего профиля, игры и состава.
                  </span>
                </label>
              </div>
            ) : null}
            {notice ? <p role="status">{notice}</p> : null}
            {receipt ? (
              <div role="status">
                <p>{receipt.status === "self_draft" ? "Сохранено только вам."
                  : receipt.status === "submitted" || receipt.status === "submitted_waiting"
                    ? "Отправлен; ещё не опубликован."
                    : receipt.status === "revision_waiting" ? "Новая версия ожидает проверки."
                      : receipt.status === "needs_correction" ? "Нужны исправления."
                        : receipt.status === "withdrawn" ? "Отзыв отозван."
                          : receipt.status === "removed" ? "Отзыв снят с публикации."
                            : receipt.status === "published" ? "Статус: опубликован."
                              : `Статус отзыва: ${receipt.status}`}</p>
                <p>{receipt.publicVisible ? "Публичная версия отзыва доступна." : "Публичный отзыв не виден."}</p>
                {receipt.notBefore ? <p>Публикация возможна не ранее {receipt.notBefore}; она не гарантирована.</p> : null}
                {receipt.receiptToken ? <p className="gb-venue-reviews__hint">Квитанция: {receipt.receiptToken}</p> : null}
              </div>
            ) : null}
            <div className="gb-venue-reviews__actions">
              <Button
                disabled={busy || previewBusy || (!canSubmit && !unknownKey) || !csrf || !actorId}
                onClick={() => {
                  void onSubmit();
                }}
              >
                {unknownKey ? "Проверить отправку" : "Сохранить"}
              </Button>
              <Button variant="ghost" disabled={locked} onClick={requestClose}>
                Закрыть
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </ProfileDialog>
    </>
  );
}
