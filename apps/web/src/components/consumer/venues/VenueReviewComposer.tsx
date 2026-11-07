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
  preferredGameId,
  onClose,
  onSubmitted,
}: {
  venueId: string;
  csrfToken: string;
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
  const [unknownKey, setUnknownKey] = useState<string | null>(null);
  const [csrf, setCsrf] = useState(csrfToken);
  const epoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const request = ++epoch.current;
    setState("loading");
    setNotice(null);
    void getOwnVenueReviewEligibility(venueId).then((result) => {
      if (!mounted.current || request !== epoch.current) return;
      if (!result.ok) {
        setState(result.status === 401 ? "auth" : "error");
        return;
      }
      setBases(result.data.bases);
      const eligible = result.data.bases.filter((b) => b.admission === "may_submit");
      const preferred =
        preferredGameId && eligible.some((b) => b.gameId === preferredGameId)
          ? preferredGameId
          : eligible[0]?.gameId ?? "";
      setGameId(preferred);
      setState("ready");
    });
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, [venueId, preferredGameId]);

  useEffect(() => {
    setCsrf(csrfToken);
  }, [csrfToken]);

  useEffect(() => {
    setConsent(false);
    setPreviewHash(null);
  }, [text, topic, gameId, audience, venueId, csrf]);

  useEffect(() => {
    const onExpire = () => {
      epoch.current += 1;
      setCsrf("");
      setConsent(false);
      setAudience("self_draft");
      setState("auth");
      setNotice("Сессия истекла. Согласие сброшено.");
    };
    window.addEventListener("gb-private-expired", onExpire);
    return () => window.removeEventListener("gb-private-expired", onExpire);
  }, []);

  const selected = bases.find((b) => b.gameId === gameId);
  const help = helpCopy(selected);
  const canSubmit =
    Boolean(gameId) &&
    selected?.admission === "may_submit" &&
    text.trim().length >= 1 &&
    text.trim().length <= 500 &&
    (audience === "self_draft" || (consent && previewHash));

  async function ensurePreview(): Promise<string | null> {
    if (audience !== "public_venue" || !csrf) return null;
    const topics = topic ? [topic] : [];
    const result = await previewVenueReviewConsent(
      { venueId, text: text.trim(), topics },
      csrf,
    );
    if (!result.ok) {
      setNotice(result.error || "Не удалось подготовить публичный просмотр.");
      return null;
    }
    setPreviewHash(result.data.consentProjectionHash);
    return result.data.consentProjectionHash;
  }

  async function onSubmit() {
    if (!canSubmit || !selected || !csrf) return;
    setBusy(true);
    setNotice(null);
    const key = unknownKey ?? crypto.randomUUID().replace(/-/g, "");
    setUnknownKey(key);
    try {
      let hash = previewHash;
      if (audience === "public_venue") {
        hash = hash ?? (await ensurePreview());
        if (!hash || !consent) {
          setBusy(false);
          return;
        }
      }
      const topics = topic ? ([topic] as VenueTopic[]) : [];
      const result = await createVenueReview(
        {
          venueId,
          gameId,
          audience,
          expectedBasisVersions: {
            outcomeVersion: selected.outcomeVersion,
            attendanceVersion: selected.attendanceVersion,
          },
          text: text.trim(),
          topics,
          ...(audience === "public_venue" ? { consentProjectionHash: hash! } : {}),
        },
        csrf,
        key,
      );
      if (!mounted.current) return;
      if (!result.ok) {
        const moderationNotice = publicTextModerationNotice(result);
        if (moderationNotice) {
          setNotice(moderationNotice);
          if (result.problem?.code === "PUBLIC_TEXT_CONTENT_REJECTED") {
            setUnknownKey(null);
          }
          setBusy(false);
          return;
        }
        if (result.status === 0 || result.status >= 500) {
          setNotice("Не удалось подтвердить отправку. Текст сохранён");
        } else if (result.status === 409) {
          setNotice(
            "Версия изменилась. Перечитайте данные и отправьте снова тем же ключом после сверки.",
          );
        } else {
          setNotice(result.error || "Отправка недоступна для выбранной игры.");
          setUnknownKey(null);
        }
        setBusy(false);
        return;
      }
      setReceipt(result.data.receiptToken);
      setUnknownKey(null);
      setNotice(
        result.data.status === "self_draft"
          ? "Сохранено только вам."
          : "Отправлен; ещё не опубликован. Публикация — после независимой проверки и паузы 48 часов.",
      );
      onSubmitted?.();
    } catch {
      setNotice("Не удалось подтвердить отправку. Текст сохранён");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <ProfileDialog
      title="Как вам площадка?"
      onClose={onClose}
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
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
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
                  disabled={busy}
                />
                <span>Оставить только себе</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="venue-audience"
                  checked={audience === "public_venue"}
                  onChange={() => setAudience("public_venue")}
                  disabled={busy}
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
                    disabled={busy || !text.trim()}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next) {
                        void ensurePreview().then((hash) => {
                          if (hash) setConsent(true);
                        });
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
                disabled={busy || (!canSubmit && !unknownKey) || !csrf}
                onClick={() => {
                  void onSubmit();
                }}
              >
                {unknownKey ? "Проверить отправку" : "Сохранить"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Закрыть
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </ProfileDialog>
  );
}
