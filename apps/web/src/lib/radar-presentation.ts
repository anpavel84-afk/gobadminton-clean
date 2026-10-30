import type { RadarActivation, RadarExposureMode, RadarItem, ProximityBand, RadarPlayer } from "./radar-types";
export const RADAR_DISCLOSURE = "Точки расположены условно; расстояние приблизительное.";
export const RADAR_EMPTY = "Сейчас Radar не показывает игроков рядом. Попробуйте позже.";
/** Honest copy: synthetic demo must never read as nearby real public players. */
export const RADAR_DEMO_NOTICE =
  "Синтетический демо-режим Radar: только внутренние демо-аккаунты в допущенных городах. Это не живые игроки рядом.";
export const RADAR_LIVE_GATED_NOTICE =
  "Radar сейчас выключен. Можно пользоваться обычным списком игроков.";
export function radarHonestyNotice(mode: RadarExposureMode | null | undefined): string {
  if (mode === "synthetic_demo") return RADAR_DEMO_NOTICE;
  return "";
}
export const bandLabel: Record<ProximityBand, string> = { near: "Ближняя зона", middle: "Средняя зона", outer: "Дальняя зона" };
export function radarPosition(item: Pick<RadarItem, "proximityBand" | "displaySlot">) {
  const radius = { near: 19, middle: 31, outer: 43 }[item.proximityBand];
  const angle = item.displaySlot * Math.PI / 180;
  return { left: `${50 + radius * Math.cos(angle)}%`, top: `${50 + radius * Math.sin(angle)}%` };
}
/** Authority/memory/privacy fence: every lease must still be live. */
export function effectiveDeadline(a: RadarActivation) {
  return Math.min(...[a.expiresAt, a.hardExpiresAt, a.foregroundUntil, a.locationValidUntil].map(Date.parse));
}
/**
 * User-visible confirmed session end for header ring/countdown.
 * Never foregroundUntil / locationValidUntil / next heartbeat.
 */
export function confirmedSessionDeadline(a: Pick<RadarActivation, "expiresAt" | "hardExpiresAt">) {
  return Math.min(Date.parse(a.expiresAt), Date.parse(a.hardExpiresAt));
}
export function remainingTime(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** Unknown catalog keys never become consumer text. */
export function radarLevel(player: RadarPlayer) {
  const labels: Record<string, string> = { beginner: "Начинающий", intermediate: "Средний", advanced: "Продвинутый", "2.5": "2.5", "3.0": "3.0", "3.5": "3.5", "4.0": "4.0" };
  return player.level ? labels[player.level.levelId] ?? "Уровень не указан" : "Уровень не указан";
}
