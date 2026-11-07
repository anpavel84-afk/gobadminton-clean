"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Me } from "../../../lib/consumer-types";
import {
  clearPushLocalBinding,
  detectPushCapability,
  getPushState,
  prefetchPushEnablement,
  registerPushSubscription,
  setPushPreference,
  setServiceWorkerFence,
  subscribeFromGesture,
  subscriptionToPayload,
  unsubscribePushDevice,
  type PushEventPreferences,
  type PushState,
} from "../../../lib/push-client";
import { Button } from "../Button";
import { ProfileState, SectionHeader, Toggle } from "../players/ProfileComposition";
import "../../../styles/push-notifications.css";

const EVENT_TOGGLES: Array<{ key: keyof PushEventPreferences; label: string }> = [
  { key: "invites", label: "Приглашения на игру" },
  { key: "applicationDecisions", label: "Решения по заявкам" },
  { key: "newApplications", label: "Новые заявки" },
  { key: "gameChanges", label: "Отмена игры" },
  { key: "outcomeReminders", label: "Напоминания об итоге" },
];

/** Option B (#501): general block; separate game/postgame choices only after master consent. */
export const PUSH_DISCOVERABILITY_OFF_HINT =
  "После включения уведомлений вы сможете отдельно выбрать приглашения, заявки и отмены, а также «Подведите итоги».";

/** Canonical iPhone Home Screen helper before the permission gesture (no new flow). */
export const PUSH_IPHONE_HOMESCREEN_HINT =
  "На iPhone добавьте GoBadminton на экран «Домой» и откройте приложение оттуда, затем включите уведомления.";

export const PUSH_MESSAGE_ENABLE_LABEL = "Включить уведомления о сообщениях";

type Props = { me: Me };

type EventTogglesProps = {
  eventPreferences: PushEventPreferences;
  disabled?: boolean;
  onToggle: (key: keyof PushEventPreferences, next: boolean) => void;
};

/** Master-ON event groups; defaults remain OFF until explicit toggle. */
export function PushGameEventToggles({ eventPreferences, disabled, onToggle }: EventTogglesProps) {
  return (
    <fieldset className="gb-push-settings__events" disabled={disabled}>
      <legend className="gb-push-settings__events-legend">События игр</legend>
      <p className="gb-push-settings__events-note">
        Выберите, какие уведомления об играх получать.
      </p>
      <ul className="gb-push-settings__event-list">
        {EVENT_TOGGLES.map((item) => {
          const on = eventPreferences[item.key] === true;
          return (
            <li key={item.key}>
              <Toggle
                label={item.label}
                on={on}
                disabled={disabled}
                onClick={() => onToggle(item.key, !on)}
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function PushSettings({ me }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "retired">("loading");
  const [push, setPush] = useState<PushState | null>(null);
  const [capability, setCapability] = useState(detectPushCapability());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [pendingOpId, setPendingOpId] = useState<string | null>(null);
  const epoch = useRef(0);
  const retired = useRef(false);
  const mutation = useRef(false);
  const warm = useRef<{
    registration: ServiceWorkerRegistration | null;
    applicationServerKey: Uint8Array<ArrayBuffer> | null;
  }>({ registration: null, applicationServerKey: null });

  const retire = useCallback(() => {
    ++epoch.current;
    retired.current = true;
    mutation.current = false;
    setPush(null);
    setNotice(null);
    setBusy(false);
    setState("retired");
  }, []);

  useEffect(() => {
    const request = ++epoch.current;
    retired.current = false;
    mutation.current = false;
    setState("loading");
    setNotice(null);
    setCapability(detectPushCapability());
    window.addEventListener("gb-private-expired", retire);
    window.addEventListener("gb-session-changed", retire);
    void getPushState().then((result) => {
      if (request !== epoch.current) return;
      if (!result.ok) {
        if (result.status === 401) retire();
        else setState("error");
        return;
      }
      setPush(result.data);
      setState("ready");
      if (result.data.accountFence) {
        void setServiceWorkerFence(result.data.accountFence);
      }
      if (result.data.featureAvailable && result.data.vapidPublicKey) {
        void prefetchPushEnablement(result.data.vapidPublicKey).then((prefetched) => {
          if (request !== epoch.current) return;
          warm.current = prefetched;
        });
      }
    });
    return () => {
      ++epoch.current;
      retired.current = true;
      window.removeEventListener("gb-private-expired", retire);
      window.removeEventListener("gb-session-changed", retire);
    };
  }, [reload, me.id, me.csrfToken, retire]);

  async function enable(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (retired.current || !push || mutation.current || busy) return;
    if (!push.featureAvailable || !push.vapidPublicKey) {
      setNotice("Системные уведомления сейчас недоступны на сервере.");
      return;
    }
    const cap = detectPushCapability();
    setCapability(cap);
    if (cap === "unsupported") {
      setNotice("Этот браузер не поддерживает системные уведомления.");
      return;
    }
    if (cap === "needs_homescreen") {
      setNotice(
        "На iPhone добавьте GoBadminton на экран «Домой» и откройте приложение оттуда, затем включите уведомления.",
      );
      return;
    }
    if (cap === "denied") {
      setNotice("Разрешение системы отклонено. Измените его в настройках устройства.");
      return;
    }
    if (cap === "offline") {
      setNotice("Нет соединения. Проверьте сеть и попробуйте снова.");
      return;
    }

    // Prefer warm SW/key from mount prefetch — do not await network before prompt.
    const registration = warm.current.registration;
    const applicationServerKey = warm.current.applicationServerKey;
    if (!registration || !applicationServerKey) {
      setNotice("Подготовка уведомлений ещё не завершена. Подождите секунду и нажмите снова.");
      void prefetchPushEnablement(push.vapidPublicKey).then((prefetched) => {
        warm.current = prefetched;
      });
      return;
    }

    mutation.current = true;
    setBusy(true);
    setNotice(null);
    const request = epoch.current;
    if (!pendingOpId) setPendingOpId(crypto.randomUUID());

    try {
      const sub = await subscribeFromGesture({ registration, applicationServerKey });
      const payload = subscriptionToPayload(sub);
      if (!push.preferenceEnabled) {
        const pref = await setPushPreference(
          { enabled: true, expectedVersion: push.preferenceVersion },
          me.csrfToken,
        );
        if (request !== epoch.current) return;
        if (!pref.ok) {
          if (pref.status === 401) {
            retire();
            return;
          }
          setNotice(
            pref.status === 409
              ? "Настройка изменилась. Обновите данные перед повтором."
              : "Не удалось сохранить предпочтение. Исходный запрос сохранён — не повторяйте вслепую.",
          );
          return;
        }
      }
      const reg = await registerPushSubscription(payload, me.csrfToken);
      if (request !== epoch.current) return;
      if (!reg.ok) {
        if (reg.status === 401) {
          retire();
          return;
        }
        setNotice(
          reg.status === 409
            ? "Подписка уже занята или достигнут лимит устройств."
            : "Не удалось зарегистрировать устройство. Исходный запрос сохранён.",
        );
        return;
      }
      await setServiceWorkerFence(reg.data.accountFence);
      setPendingOpId(null);
      setReload((n) => n + 1);
      setNotice("Уведомления о сообщениях включены на этом устройстве.");
    } catch (error) {
      if (request !== epoch.current) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "PERMISSION_DENIED") {
        setCapability("denied");
        setNotice("Разрешение системы отклонено. Уведомления не включены.");
      } else {
        setNotice("Не удалось включить уведомления. Попробуйте ещё раз.");
      }
    } finally {
      if (request === epoch.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  }

  async function toggleEvent(key: keyof PushEventPreferences, value: boolean) {
    if (retired.current || !push || mutation.current || busy || !push.preferenceEnabled) return;
    mutation.current = true;
    setBusy(true);
    setNotice(null);
    const request = epoch.current;
    const pref = await setPushPreference(
      {
        enabled: true,
        expectedVersion: push.preferenceVersion,
        eventPreferences: { [key]: value },
      },
      me.csrfToken,
    );
    if (request !== epoch.current) return;
    mutation.current = false;
    setBusy(false);
    if (!pref.ok) {
      if (pref.status === 401) {
        retire();
        return;
      }
      setNotice(
        pref.status === 409
          ? "Настройка изменилась. Обновите данные перед повтором."
          : "Не удалось сохранить группу уведомлений.",
      );
      return;
    }
    setPush((prev) =>
      prev
        ? {
            ...prev,
            preferenceEnabled: pref.data.preferenceEnabled,
            preferenceVersion: pref.data.preferenceVersion,
            eventPreferences: pref.data.eventPreferences,
          }
        : prev,
    );
  }

  async function disableCurrent() {
    if (retired.current || !push?.currentDevice || mutation.current || busy) return;
    mutation.current = true;
    setBusy(true);
    setNotice(null);
    const request = epoch.current;
    const result = await unsubscribePushDevice(push.currentDevice.id, me.csrfToken);
    if (request !== epoch.current) return;
    mutation.current = false;
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401) {
        retire();
        return;
      }
      setNotice("Не удалось отключить устройство. Попробуйте ещё раз.");
      return;
    }
    await clearPushLocalBinding();
    if (push.preferenceEnabled && push.deviceCount <= 1) {
      const pref = await setPushPreference(
        { enabled: false, expectedVersion: push.preferenceVersion },
        me.csrfToken,
      );
      if (request !== epoch.current) return;
      if (!pref.ok && pref.status !== 401) {
        setNotice("Устройство отключено, но предпочтение не обновлено. Обновите страницу.");
      }
    }
    setReload((n) => n + 1);
    setNotice("Уведомления на этом устройстве выключены.");
  }

  if (state === "retired") return null;

  const statusText = (() => {
    if (!push?.featureAvailable) {
      return "Системные уведомления пока недоступны на тестовом сервере.";
    }
    if (capability === "unsupported") {
      return "Этот браузер не поддерживает системные уведомления.";
    }
    if (capability === "needs_homescreen") {
      return "На iPhone функция работает в приложении, добавленном на экран «Домой».";
    }
    if (capability === "denied") {
      return "Система запретила уведомления. Измените разрешение в настройках устройства.";
    }
    if (capability === "offline") {
      return "Нет соединения. Состояние подписки можно изменить после восстановления сети.";
    }
    if (push.preferenceEnabled && push.currentDevice) {
      return `Уведомления включены на этом устройстве. Активных устройств: ${push.deviceCount} из ${push.maxDevices}.`;
    }
    if (push.preferenceEnabled && !push.currentDevice) {
      return `Предпочтение включено, но это устройство ещё не подписано. Активных устройств: ${push.deviceCount} из ${push.maxDevices}.`;
    }
    return "Уведомления о сообщениях выключены. Включение только по вашему действию; системный запрос появится сразу после нажатия.";
  })();

  // Loading (push null) and master-OFF with feature available: explain separate game/postgame choices + iPhone Home Screen.
  const showMasterOffHints =
    capability !== "denied" &&
    (push == null || (push.featureAvailable && !push.preferenceEnabled));

  return (
    <section className="profile-section" data-surface="push-settings" aria-label="Уведомления">
      <SectionHeader title="Уведомления" eyebrow="Настройки" />
      <div className="gb-push-settings">
        <p className="gb-push-settings__status">{statusText}</p>
        {showMasterOffHints && (
          <>
            <p className="gb-push-settings__status" data-surface="push-discoverability">
              {PUSH_DISCOVERABILITY_OFF_HINT}
            </p>
            <p className="gb-push-settings__status" data-surface="push-iphone-homescreen">
              {PUSH_IPHONE_HOMESCREEN_HINT}
            </p>
          </>
        )}
        {state === "loading" ? (
          <ProfileState title="Загружаем настройки уведомлений…" state="loading" />
        ) : state === "error" ? (
          <ProfileState
            title="Не удалось загрузить уведомления"
            state="error"
            retry={() => setReload((n) => n + 1)}
          >
            Попробуйте ещё раз.
          </ProfileState>
        ) : (
          <>
            <div className="gb-push-settings__actions">
              <Button
                type="button"
                disabled={busy || !push?.featureAvailable || capability === "denied"}
                onClick={(event) => void enable(event)}
              >
                {busy ? "Включаем…" : PUSH_MESSAGE_ENABLE_LABEL}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !push?.currentDevice}
                onClick={() => void disableCurrent()}
              >
                Выключить на этом устройстве
              </Button>
            </div>
            {push?.preferenceEnabled && push.eventPreferences && (
              <PushGameEventToggles
                eventPreferences={push.eventPreferences}
                disabled={busy || !push.preferenceEnabled}
                onToggle={(key, next) => void toggleEvent(key, next)}
              />
            )}
            {push && push.devices.length > 0 && (
              <ul className="gb-push-settings__devices" aria-label="Подключённые устройства">
                {push.devices.map((device) => (
                  <li key={device.id} className="gb-push-settings__device">
                    <span>
                      {device.current ? "Это устройство" : "Другое устройство"}
                      <br />
                      <small>с {new Date(device.createdAt).toLocaleString("ru-RU")}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {notice && (
          <p className="profile-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
