"use client";

import { DEV_MOSCOW_LABEL, usesDevMoscowLocation } from "../../../lib/radar-dev-moscow";
import type { RadarView } from "../../../lib/radar-controller";
import { Button } from "../Button";
import { AuthEntry, Toggle } from "../players/ProfileComposition";
import { useRadarSession, useRadarConfig } from "./RadarSessionProvider";

export const radarPhaseTitle: Record<RadarView["phase"], string> = {
  checking: "Проверяем Radar…", guest: "Войдите, чтобы включить Radar", off: "Radar выключен",
  permission: "Показать игроков рядом?", locating: "Определяем местоположение…", denied: "Нет доступа к местоположению",
  location_error: "Не удалось определить местоположение", activating: "Включаем Radar…", active: "Radar включён",
  owned_elsewhere: "Radar включён в другой сессии", expired: "Radar завершён", stopping: "Выключаем Radar…",
  stopped: "Radar выключен", background: "Radar приостановлен", error: "Проверьте статус Radar", disabled: "Radar сейчас недоступен",
};
export function radarSwitchDisabled(view: RadarView) {
  return ["checking", "permission", "locating", "activating", "stopping", "background", "error", "disabled"].includes(view.phase);
}
export type RadarSwitchPresentation = "default" | "directory-desktop";

function DirectoryRadarGlyph() {
  return (
    <svg className="radar-dir-switch__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" opacity=".35" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <path d="M12 12L17 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function RadarSwitchControl({
  map = false,
  presentation = "default",
}: {
  map?: boolean;
  /** directory-desktop: compact icon + two lines + switch for /players toolbar only. */
  presentation?: RadarSwitchPresentation;
}) {
  const { controller, view } = useRadarSession();
  const config = useRadarConfig();
  const publishingOff = !config?.publishingV2.enabled;
  const switchDisabled = !controller || (!view.confirmedOn && publishingOff) || radarSwitchDisabled(view);
  const onToggle = () => {
    if (!controller || radarSwitchDisabled(view)) return;
    if (view.confirmedOn) void controller.stop();
    else controller.permission();
  };

  if (presentation === "directory-desktop") {
    const on = view.confirmedOn;
    const title = on ? "Radar включён" : "Включить Radar";
    const subtitle = on
      ? (view.phase === "active" ? "Игроки поблизости" : radarPhaseTitle[view.phase])
      : "Игроки поблизости";
    return (
      <div className="radar-entry radar-entry--directory-desktop" data-presentation="directory-desktop">
        {view.phase === "guest" ? (
          <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>
        ) : (
          <button
            type="button"
            id="radar-switch"
            className={`radar-dir-switch${on ? " is-on" : ""}`}
            role="switch"
            aria-checked={on}
            aria-label="Radar"
            aria-describedby="radar-switch-helper"
            disabled={switchDisabled || (publishingOff && !on)}
            onClick={onToggle}
          >
            <DirectoryRadarGlyph />
            <span className="radar-dir-switch__copy">
              <strong>{title}</strong>
              <small id="radar-switch-helper">{subtitle}</small>
            </span>
            <i className="radar-dir-switch__track" aria-hidden="true"><b /></i>
          </button>
        )}
      </div>
    );
  }

  return <div className="radar-entry">{view.phase === "guest" && <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>}{!view.confirmedOn && view.phase !== "guest" && <Button disabled={publishingOff || radarSwitchDisabled(view)} onClick={() => controller?.permission()}>Включить Radar</Button>}{(map || view.confirmedOn) && <Toggle id="radar-switch" label="Radar" on={view.confirmedOn} disabled={switchDisabled} describedBy="radar-switch-helper" onClick={onToggle} />}<small id="radar-switch-helper">{view.phase === "off" || view.phase === "guest" ? "Включите, чтобы поделиться геопозицией." : radarPhaseTitle[view.phase]}</small></div>;
}
export type RadarStatusPresentation = "default" | "directory-compact";

export function RadarStatusControls({
  map: _map = false,
  presentation = "default",
}: {
  /** Retained for call-site compatibility with RadarSwitchControl; status UI does not branch on map. */
  map?: boolean;
  /** directory-compact: desktop /players strip — hide DEV synthetic label; keep permission/error/recovery/consent. */
  presentation?: RadarStatusPresentation;
}) {
  const { controller, view } = useRadarSession();
  const config = useRadarConfig();
  if (!controller) return null;
  const status = view.status, active = view.phase === "active" && status?.state === "active";
  const busy = ["checking", "locating", "activating", "stopping"].includes(view.phase);
  const directoryCompact = presentation === "directory-compact";
  // Active/renew/distance/location feedback lives in the header Radar overlay only —
  // in-flow rows must not shift the city/search/filter/Radar toolbar.
  // Directory-compact: suppress DEV label and recovery strips (header owns them).
  // Map/default: keep non-active recovery when the header is not the sole surface.
  if (directoryCompact || active || view.phase === "permission" || view.phase === "off") {
    return <div className="radar-status-controls" data-presentation={presentation} aria-busy={busy} />;
  }
  return <div className="radar-status-controls" data-presentation={presentation} aria-busy={busy}>
    {!directoryCompact && typeof window !== "undefined" && usesDevMoscowLocation(config, window.location.origin) && <section className="radar-notice"><span role="status"><strong>{DEV_MOSCOW_LABEL}</strong></span></section>}
    {/* The persistent header affordance owns the single shared consent dialog. */}
    {view.phase === "guest" && view.notice && <section className="radar-notice"><span><strong>Войдите, чтобы включить Radar</strong></span><AuthEntry returnPath="/players" /></section>}
    {view.phase !== "guest" && <section className="radar-notice"><span role="status"><strong>{radarPhaseTitle[view.phase]}</strong><small>{view.notice || (view.phase === "denied" ? "Разрешите доступ к геопозиции в настройках браузера и попробуйте снова." : view.phase === "location_error" ? "Проверьте доступ к геопозиции и свой профиль, затем попробуйте снова." : view.phase === "expired" ? "Включите его снова, чтобы продолжить поиск." : view.phase === "disabled" ? "Можно пользоваться обычным списком игроков." : "")}</small></span><div className="radar-recovery-actions">{view.phase === "owned_elsewhere" && <Button onClick={() => controller.permission()}>Перенести сюда</Button>}{view.phase === "locating" && <Button variant="outline" onClick={() => controller.cancel()}>Отмена</Button>}{view.phase === "error" && <><Button variant="outline" onClick={() => void controller.reconcile()}>Проверить статус</Button>{status && "activationId" in status && <Button variant="dark" onClick={() => void controller.stop()}>{view.pendingStop ? "Повторить выключение" : "Выключить Radar"}</Button>}{!view.pendingStop && view.confirmedOn && <Button variant="ghost" onClick={() => void controller.stop()}>Обычный список игроков</Button>}<Button variant="ghost" href="/profile">Открыть профиль</Button></>}{["denied", "location_error"].includes(view.phase) && <><Button variant="outline" onClick={() => controller.permission()}>Попробовать снова</Button><Button variant="ghost" href="/profile">Открыть профиль</Button></>}</div></section>}
  </div>;
}
