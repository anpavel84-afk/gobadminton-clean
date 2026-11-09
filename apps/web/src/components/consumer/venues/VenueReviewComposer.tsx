"use client";

import { useEffect, useRef, useState } from "react";
import { publicTextModerationNotice } from "../../../lib/api-client";
import {
  createVenueReview,
  getOwnVenueReviewEligibility,
  previewVenueReviewConsent,
  type OwnVenueEligibilityBasis,
  type VenueAudience,
  type VenueTopic,
} from "../../../lib/venue-reviews-api";
import { Button } from "../Button";
import { ProfileDialog } from "../players/ProfileComposition";
import "../../../styles/venue-reviews.css";

const TOPICS: Array<{ value: VenueTopic; label: string }> = [
  { value: "surface", label: "Покрытие" },
  { value: "lighting", label: "Свет" },
  { value: "amenities", label: "Удобства" },
];

function helpCopy(basis: OwnVenueEligibilityBasis | undefined): string | null {
  if (!basis) return null;
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
    return "Сейчас нельзя поделиться опытом по выбранной игре.";
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
  preferredGameId,
  onClose,
  onSubmitted,
}: {
  venueId: string;
  csrfToken: string;
  actorId: string | null;
  onUnresolvedChange?: (value: boolean) => void;
  preferredGameId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [bases, setBases] = useState<OwnVenueEligibilityBasis[]>([]);
  const [gameId, setGameId] = useState(preferredGameId ?? "");
  const [topic, setTopic] = useState<VenueTopic | "">("surface");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<VenueAudience>("self_draft");
  const [consent, setConsent] = useState(false);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  type Packet = {
    body: Parameters<typeof createVenueReview>[0]; key: string;
    actorId: string; csrf: string; generation: number;
  };
  const [packet, setPacket] = useState<Packet | null>(null);
  const packetRef = useRef<Packet | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewSequence = useRef(0);
  const context = useRef({ venueId, actorId, csrfToken, preferredGameId, revoked: false });
  // Fence before effects: a late response must never settle a different actor or venue.
  if (context.current.venueId !== venueId || context.current.actorId !== actorId
    || context.current.csrfToken !== csrfToken || context.current.preferredGameId !== preferredGameId) {
    context.current = { venueId, actorId, csrfToken, preferredGameId, revoked: false };
    epoch.current += 1;
    previewSequence.current += 1;
    packetRef.current = null;
    sendLock.current = false;
    setPacket(null); setBusy(false); setPreviewBusy(false);
    setConsent(false); setPreviewHash(null); setReceipt(null); setNotice(null);
    setText(""); setAudience("self_draft"); setBases([]); setState("loading");
  }
  const draftKey = JSON.stringify([text, topic, gameId, audience]);
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
    const request = ++epoch.current;
    setState(context.current.revoked ? "auth" : "loading");
    if (!context.current.revoked) void getOwnVenueReviewEligibility(venueId).then((result) => {
      if (!mounted.current || request !== epoch.current || context.current.revoked) return;
      if (!result.ok) {
        setState(result.status === 401 ? "auth" : "error");
        return;
      }
      setBases(result.data.bases);
      const eligible = result.data.bases.filter((b) => b.admission === "may_submit");
      setGameId(preferredGameId && eligible.some((b) => b.gameId === preferredGameId)
        ? preferredGameId : eligible[0]?.gameId ?? "");
      setState("ready");
    });
    return () => { mounted.current = false; epoch.current += 1; };
  }, [venueId, preferredGameId, actorId, csrfToken]);

  useEffect(() => {
    const fence = () => {
      context.current.revoked = true;
      epoch.current += 1; previewSequence.current += 1;
      packetRef.current = null; sendLock.current = false;
      setPacket(null); setBusy(false); setPreviewBusy(false);
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
  const help = helpCopy(selected);
  const canSubmit = Boolean(gameId) && selected?.admission === "may_submit"
    && text.trim().length >= 1 && text.trim().length <= 500
    && (audience === "self_draft" || (consent && previewHash));
  function current(generation: number) {
    return mounted.current && !context.current.revoked && generation === epoch.current;
  }

  async function ensurePreview(): Promise<string | null> {
    if (audience !== "public_venue" || !csrf || locked) return null;
    const generation = epoch.current;
    const revision = ++previewSequence.current;
    const admittedDraft = draft.current;
    setPreviewBusy(true);
    try {
      const result = await previewVenueReviewConsent({ venueId, text: text.trim(), topics: topic ? [topic] : [] }, csrf);
      if (!current(generation) || revision !== previewSequence.current || draft.current !== admittedDraft) return null;
      if (!result.ok) {
        setNotice(result.error || "Не удалось подготовить публичный просмотр.");
        return null;
      }
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
    let admitted = packetRef.current;
    if (!admitted) {
      if (!canSubmit || !selected || previewBusy) return;
      admitted = {
        key: crypto.randomUUID().replace(/-/g, ""), actorId, csrf, generation: epoch.current,
        body: {
          venueId, gameId, audience,
          expectedBasisVersions: { outcomeVersion: selected.outcomeVersion, attendanceVersion: selected.attendanceVersion },
          text: text.trim(), topics: topic ? [topic] : [],
          ...(audience === "public_venue" && previewHash ? { consentProjectionHash: previewHash } : {}),
        },
      };
      packetRef.current = admitted;
      setPacket(admitted);
    }
    if (!current(admitted.generation) || admitted.actorId !== actorId || admitted.csrf !== csrf || admitted.body.venueId !== venueId) return;
    const pending = admitted;
    sendLock.current = true;
    setBusy(true); setNotice(null);
    const matches = () => current(pending.generation) && packetRef.current === pending;
    try {
      // Exact in-memory packet only; retry never reads mutable controls or fresh credentials.
      const result = await createVenueReview(pending.body, pending.csrf, pending.key);
      if (!matches()) return;
      if (!result.ok) {
        if (result.status === 0 || result.status >= 500) {
          setNotice(publicTextModerationNotice(result) || "Не удалось подтвердить отправку. Текст сохранён");
          return;
        }
        packetRef.current = null; setPacket(null);
        setNotice(publicTextModerationNotice(result) || (result.status === 409
          ? "Версия изменилась. Закройте окно и перечитайте данные перед новой отправкой."
          : result.error || "Отправка недоступна для выбранной игры."));
        if (result.status === 409) setState("error");
        if (result.status === 401 || result.status === 403) {
          context.current.revoked = true;
          setConsent(false); setPreviewHash(null); setState("auth");
        }
        return;
      }
      packetRef.current = null; setPacket(null);
      setReceipt(result.data.receiptToken);
      setNotice(result.data.status === "self_draft" ? "Сохранено только вам."
        : "Отправлен; ещё не опубликован. Публикация — после независимой проверки и паузы 48 часов.");
      onSubmitted?.();
    } catch {
      if (matches()) setNotice("Не удалось подтвердить отправку. Текст сохранён");
    } finally {
      if (mounted.current && pending.generation === epoch.current) { sendLock.current = false; setBusy(false); }
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
    <ProfileDialog
      title="Как вам площадка?"
      onClose={requestClose}
      className="profile-dialog--postgame"
      lockBodyScroll
      describedBy="gb-venue-review-composer-hint"
    >
      <div className="gb-venue-reviews gb-venue-reviews__composer-body">
        <p id="gb-venue-review-composer-hint" className="gb-venue-reviews__lede">
          По умолчанию текст только вам. Публичный отзыв — без профиля, игры и состава.
        </p>
        {state === "loading" ? <p role="status">Загружаем доступные игры…</p> : null}
        {state === "auth" ? <p role="status">Войдите, чтобы поделиться опытом.</p> : null}
        {state === "error" ? <p role="alert">Не удалось проверить допуск.</p> : null}
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
              {selected?.gameTitle ? ` · выбранная игра: «${selected.gameTitle}»` : null}
            </p>
            <div className="gb-venue-reviews__field">
              <label htmlFor="venue-review-game">Игра, после которой оставляете отзыв</label>
              <select
                id="venue-review-game"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                disabled={locked}
              >
                <option value="">Выберите игру</option>
                {bases.map((b) => (
                  <option key={b.gameId} value={b.gameId}>
                    {(b.gameTitle || "Игра") +
                      (b.admission === "may_submit"
                        ? " · присутствие подтверждено"
                        : " · пока недоступно")}
                  </option>
                ))}
              </select>
              <p className="gb-venue-reviews__hint">
                Список игр виден только вам. В публичном отзыве не будет названия игры, состава и
                точного времени.
              </p>
            </div>
            {help ? (
              <p role="status" className="gb-venue-reviews__lede">
                {help}
                {selected?.helpHint === "attendance_unmarked" ? (
                  <>
                    {" "}
                    <a href={gameId ? `/games/${encodeURIComponent(gameId)}/results` : "/me/games"}>
                      К итогам игры
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="gb-venue-reviews__field">
              <label htmlFor="venue-review-topic">О чём хотите рассказать</label>
              <select
                id="venue-review-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value as VenueTopic | "")}
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
                <p className="gb-venue-reviews__card-meta">Участник игры</p>
                <p className="gb-venue-reviews__card-text">{text.trim() || "—"}</p>
                <label style={{ display: "flex", gap: 10, marginTop: 12, minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={locked || previewBusy || !text.trim()}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next) {
                        void ensurePreview();
                        return;
                      }
                      setConsent(false);
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
              <p className="gb-venue-reviews__hint">Квитанция ожидания: {receipt}</p>
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
  );
}
