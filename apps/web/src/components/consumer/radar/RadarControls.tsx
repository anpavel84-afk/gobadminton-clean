"use client";

import { DEV_MOSCOW_LABEL, usesDevMoscowLocation } from "../../../lib/radar-dev-moscow";
import type { RadarView } from "../../../lib/radar-controller";
import { effectiveDeadline, remainingTime } from "../../../lib/radar-presentation";
import { Button } from "../Button";
import { AuthEntry, Toggle, ProfileDialog } from "../players/ProfileComposition";
import { RadarDurationChoice, acquireRadarLocation, useRadarSession, useRadarConfig } from "./RadarSessionProvider";

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
export function RadarSwitchControl({ map = false }: { map?: boolean }) {
  const { controller, view } = useRadarSession();
  const config = useRadarConfig();
  return <div className="radar-entry">{view.phase === "guest" && <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>}{!view.confirmedOn && view.phase !== "guest" && <Button disabled={!config?.publishingV2.enabled || radarSwitchDisabled(view)} onClick={() => controller?.permission()}>Включить Radar</Button>}{(map || view.confirmedOn) && <Toggle id="radar-switch" label="Radar" on={view.confirmedOn} disabled={!controller || (!view.confirmedOn && !config?.publishingV2.enabled) || radarSwitchDisabled(view)} describedBy="radar-switch-helper" onClick={() => { if (!controller || radarSwitchDisabled(view)) return; if (view.confirmedOn) void controller.stop(); else controller.permission(); }} />}<small id="radar-switch-helper">{view.phase === "off" || view.phase === "guest" ? "Включите, чтобы поделиться геопозицией." : radarPhaseTitle[view.phase]}</small></div>;
}
export function RadarStatusControls({ map = false }: { map?: boolean }) {
  const { controller, view } = useRadarSession();
  const config = useRadarConfig();
  if (!controller) return null;
  const status = view.status, active = view.phase === "active" && status?.state === "active";
  const demo = view.exposureMode === "synthetic_demo";
  const busy = ["checking", "locating", "activating", "stopping"].includes(view.phase);
  const due = active && view.now >= Date.parse(status.nextLocationUpdateAt);
  return <div className="radar-status-controls" aria-busy={busy}>
    {typeof window !== "undefined" && usesDevMoscowLocation(config, window.location.origin) && <section className="radar-notice"><span role="status"><strong>{DEV_MOSCOW_LABEL}</strong></span></section>}
    {active && !map && <section className="radar-on radar-on--compact"><span><small className="radar-countdown">Подтверждённый срок Radar: осталось {remainingTime(new Date(effectiveDeadline(status)).toISOString(), view.now)}</small><small>Примерное положение и расстояние видны участникам.</small>{status.gridSizeMeters === 1000 && <small>Местоположение определяется неточно.</small>}</span>{Date.parse(status.hardExpiresAt) > Date.parse(status.expiresAt) && <Button variant="outline" onClick={() => void controller.activate(() => acquireRadarLocation(controller), "renew")}>Продлить</Button>}</section>}
    {due && <section className="radar-notice"><span><strong>Обновите геопозицию, чтобы продолжить поиск</strong><small>Поиск приостановится, когда геопозиция устареет.</small></span><Button variant="outline" onClick={() => void controller.activate(() => acquireRadarLocation(controller), "location")}>{demo ? "Обновить демо-позицию" : "Обновить геопозицию"}</Button></section>}
    {view.phase === "permission" && <ProfileDialog title="Включить Radar и поделиться геопозицией?" onClose={() => controller.cancel()}><p>{typeof window !== "undefined" && usesDevMoscowLocation(config, window.location.origin) && <strong>{DEV_MOSCOW_LABEL}<br /></strong>}{config?.unifiedDirectory.disclosure.text ?? "Radar сейчас недоступен. Можно пользоваться обычным каталогом."}</p>{status?.state === "owned_elsewhere" && <p>В другой сессии Radar выключится.</p>}<RadarDurationChoice /><div className="profile-form-actions radar-consent-actions"><Button block disabled={!config?.publishingV2.enabled} onClick={() => void controller.activate(() => acquireRadarLocation(controller))}>{status?.state === "owned_elsewhere" ? "Перенести и включить" : "Согласен, включить Radar"}</Button><Button variant="ghost" onClick={() => controller.cancel()}>Отмена</Button></div></ProfileDialog>}
    {view.phase === "guest" && view.notice && <section className="radar-notice"><span><strong>Войдите, чтобы включить Radar</strong></span><AuthEntry returnPath="/players" /></section>}
    {view.phase !== "active" && view.phase !== "permission" && view.phase !== "guest" && view.phase !== "off" && <section className="radar-notice"><span role="status"><strong>{radarPhaseTitle[view.phase]}</strong><small>{view.notice || (view.phase === "denied" ? "Разрешите доступ к геопозиции в настройках браузера и попробуйте снова." : view.phase === "location_error" ? "Проверьте доступ к геопозиции и свой профиль, затем попробуйте снова." : view.phase === "expired" ? "Включите его снова, чтобы продолжить поиск." : view.phase === "disabled" ? "Можно пользоваться обычным списком игроков." : "")}</small></span><div className="radar-recovery-actions">{view.phase === "owned_elsewhere" && <Button onClick={() => controller.permission()}>Перенести сюда</Button>}{view.phase === "locating" && <Button variant="outline" onClick={() => controller.cancel()}>Отмена</Button>}{view.phase === "error" && <><Button variant="outline" onClick={() => void controller.reconcile()}>Проверить статус</Button>{status && "activationId" in status && <Button variant="dark" onClick={() => void controller.stop()}>{view.pendingStop ? "Повторить выключение" : "Выключить Radar"}</Button>}{!view.pendingStop && view.confirmedOn && <Button variant="ghost" onClick={() => void controller.stop()}>Обычный список игроков</Button>}<Button variant="ghost" href="/profile">Открыть профиль</Button></>}{["denied", "location_error"].includes(view.phase) && <><Button variant="outline" onClick={() => controller.permission()}>Попробовать снова</Button><Button variant="ghost" href="/profile">Открыть профиль</Button></>}</div></section>}
    {active && view.notice && <p className="radar-list-notice" role="status">{view.notice}</p>}
  </div>;
}
