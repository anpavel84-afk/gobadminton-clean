"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRoleReview,
  getOwnRoleReviewEligibility,
  previewRoleReviewConsent,
} from "../../../lib/api-client";
import type { OwnRoleEligibilityBasis, RoleKind } from "../../../lib/consumer-types";
import { Button } from "../Button";
import { ProfileDialog, SectionHeader } from "../players/ProfileComposition";
import "../../../styles/role-reputation.css";

const ORG_TOPICS = [
  { value: "agreements", label: "Договорённости" },
  { value: "flow", label: "Ход встречи" },
  { value: "communication", label: "Общение" },
];

const TRAIN_TOPICS = [
  { value: "explanations", label: "Объяснения" },
  { value: "attention", label: "Внимание" },
  { value: "session_organization", label: "Организация занятия" },
];

/**
 * Public role-review composer. Audience starts private-personal; public requires
 * unchecked consent that resets on text/role/subject/session changes.
 * Eligibility comes from server list — never invent recipient from profile alone.
 */
export function RoleReviewComposer({
  roleHandle,
  role,
  csrfToken,
  preferredGameId,
  onClose,
}: {
  roleHandle: string;
  role: RoleKind;
  csrfToken: string;
  preferredGameId?: string;
  onClose: () => void;
}) {
  const [bases, setBases] = useState<OwnRoleEligibilityBasis[]>([]);
  const [gameId, setGameId] = useState(preferredGameId ?? "");
  const [text, setText] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [audience, setAudience] = useState<"personal" | "public">("personal");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error" | "auth">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [unknownKey, setUnknownKey] = useState<string | null>(null);
  const [csrf, setCsrf] = useState(csrfToken);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const topicOptions = role === "organization" ? ORG_TOPICS : TRAIN_TOPICS;

  useEffect(() => {
    mounted.current = true;
    const request = ++epoch.current;
    setState("loading");
    setNotice(null);
    void getOwnRoleReviewEligibility(roleHandle).then((result) => {
      if (!mounted.current || request !== epoch.current) return;
      if (!result.ok) {
        setState(result.status === 401 ? "auth" : "error");
        return;
      }
      const eligible = result.data.bases.filter((b) => b.admission === "may_submit");
      setBases(result.data.bases);
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
  }, [roleHandle, preferredGameId]);

  useEffect(() => {
    setCsrf(csrfToken);
  }, [csrfToken]);

  useEffect(() => {
    // Consent must never carry across edit / role / subject / session changes.
    setConsent(false);
  }, [text, topics, gameId, role, roleHandle, audience, csrf]);

  useEffect(() => {
    const onExpire = () => {
      epoch.current += 1;
      setCsrf("");
      setConsent(false);
      setAudience("personal");
      setState("auth");
      setNotice("Сессия истекла. Черновик в памяти очищен от согласия.");
    };
    window.addEventListener("gb-private-expired", onExpire);
    return () => window.removeEventListener("gb-private-expired", onExpire);
  }, []);

  function toggleTopic(value: string) {
    setTopics((current) =>
      current.includes(value)
        ? current.filter((t) => t !== value)
        : current.length < 2
          ? [...current, value]
          : current,
    );
  }

  async function submit() {
    if (busy || !csrf) return;
    if (audience !== "public") {
      setNotice(
        "Личное сообщение организатору/тренеру остаётся в приватной обратной связи игры. Здесь публикуется только публичный отзыв о роли.",
      );
      return;
    }
    const basis = bases.find((b) => b.gameId === gameId && b.admission === "may_submit");
    if (!basis) {
      setNotice("Выберите свою подтверждённую встречу из списка допуска.");
      return;
    }
    const body = text.trim();
    if (!body) return;
    if (!consent) {
      setNotice("Отметьте согласие с публичной публикацией.");
      return;
    }
    if (unknownKey) {
      setNotice("Отправка могла быть принята. Не повторяйте с тем же ключом.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const preview = await previewRoleReviewConsent(
      { role, subjectRoleHandle: roleHandle, text: body, topics },
      csrf,
    );
    if (!mounted.current) return;
    if (!preview.ok) {
      setBusy(false);
      setNotice(preview.error || "Не удалось подготовить согласие.");
      return;
    }
    const key = crypto.randomUUID().replace(/-/g, "");
    const result = await createRoleReview(
      {
        gameId: basis.gameId,
        role,
        expectedBasisVersions: {
          proofVersion: basis.proofVersion,
          outcomeVersion: basis.outcomeVersion,
          attendanceVersion: basis.attendanceVersion,
        },
        text: body,
        topics,
        consentProjectionHash: preview.data.consentProjectionHash,
      },
      csrf,
      key,
    );
    setBusy(false);
    if (!mounted.current) return;
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        setUnknownKey(key);
        setNotice("Не удалось подтвердить отправку. Отзыв мог быть принят — не повторяйте.");
        return;
      }
      setNotice(result.error || "Не удалось отправить. Обновите допуск и версии.");
      return;
    }
    setReceipt(result.data.receiptToken);
    setNotice(
      result.data.pendingIntakeStatus === "waiting_intake"
        ? "Отзыв отправлен и ожидает разбора. Пока без назначенного специалиста."
        : "Отзыв принят.",
    );
  }

  const eligible = bases.filter((b) => b.admission === "may_submit");

  return (
    <ProfileDialog
      title="Поделиться опытом"
      onClose={onClose}
      className="profile-dialog--postgame"
      lockBodyScroll
      describedBy="gb-role-rep-composer-hint"
    >
      <p id="gb-role-rep-composer-hint" className="gb-role-rep__hint">
        Ваша прошедшая встреча. Писать можно только о своём подтверждённом опыте. Навык игрока не
        оценивается.
      </p>
      {state === "loading" ? <p role="status">Проверяем допуск…</p> : null}
      {state === "auth" ? <p>Войдите снова, чтобы продолжить.</p> : null}
      {state === "error" ? <p role="alert">Не удалось загрузить список встреч.</p> : null}
      {state === "ready" ? (
        <div className="gb-role-rep-composer">
          <SectionHeader
            title={role === "training" ? "О тренировке" : "Об организации встречи"}
          />
          {!eligible.length ? (
            <p>
              Нет подтверждённой встречи для публичного отзыва по этой роли. Читать отзывы можно без
              записи своего текста.
            </p>
          ) : (
            <>
              <label className="profile-field">
                Ваша встреча
                <select
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value)}
                  disabled={busy || Boolean(receipt)}
                >
                  {eligible.map((b) => (
                    <option key={b.gameId} value={b.gameId}>
                      {new Date(b.endsAt).toLocaleString("ru-RU")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="gb-role-rep-privacy" role="radiogroup" aria-label="Кто увидит текст">
                <button
                  type="button"
                  className="gb-role-rep-privacy__option"
                  data-active={audience === "personal"}
                  aria-pressed={audience === "personal"}
                  disabled={busy || Boolean(receipt)}
                  onClick={() => setAudience("personal")}
                >
                  <strong>
                    {role === "training" ? "Тренеру лично" : "Организатору лично"}
                  </strong>
                  <small>Вы и адресат · по умолчанию. Публичный раздел этот текст не покажет.</small>
                </button>
                <button
                  type="button"
                  className="gb-role-rep-privacy__option"
                  data-active={audience === "public"}
                  aria-pressed={audience === "public"}
                  disabled={busy || Boolean(receipt)}
                  onClick={() => setAudience("public")}
                >
                  <strong>Публично</strong>
                  <small>Всем, кому доступен этот раздел роли</small>
                </button>
              </div>
              <label className="profile-field">
                Текст отзыва
                <textarea
                  maxLength={500}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy || Boolean(receipt) || audience !== "public"}
                />
              </label>
              <fieldset className="profile-field" disabled={busy || Boolean(receipt) || audience !== "public"}>
                <legend>Темы (до 2)</legend>
                <div className="gb-role-rep-item__topics">
                  {topicOptions.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      data-active={topics.includes(t.value)}
                      onClick={() => toggleTopic(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {audience === "public" ? (
                <label className="gb-role-rep-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={busy || Boolean(receipt)}
                  />
                  <span>
                    Публикую отзыв о роли. Согласие сбрасывается при правке текста или смене встречи.
                  </span>
                </label>
              ) : (
                <p className="gb-role-rep__hint">
                  Чтобы написать лично организатору или тренеру, откройте итоги своей игры — приватная
                  обратная связь отделена от публичных отзывов.
                </p>
              )}
              <Button
                type="button"
                disabled={
                  busy ||
                  Boolean(receipt) ||
                  audience !== "public" ||
                  !text.trim() ||
                  !consent ||
                  Boolean(unknownKey)
                }
                onClick={() => void submit()}
              >
                Отправить публичный отзыв
              </Button>
            </>
          )}
        </div>
      ) : null}
      {receipt ? (
        <p className="gb-role-rep-pending" role="status">
          Квитанция: {receipt}. Ожидание разбора — без выдуманного исполнителя.
        </p>
      ) : null}
      {notice ? (
        <p className="gb-role-rep-pending" role="status">
          {notice}
        </p>
      ) : null}
    </ProfileDialog>
  );
}
