import type { RadarView } from "./radar-controller";
import { confirmedSessionDeadline, effectiveDeadline } from "./radar-presentation";
export function radarHeaderStatus(view: RadarView): { tone: "active" | "attention" | "checking"; text: string; until?: number } | null {
  if (!view.me || !view.confirmedOn) return null;
  const demo = view.exposureMode === "synthetic_demo" ? " · демо" : "";
  if (view.pendingStop || view.phase === "stopping") return { tone: "attention", text: "Проверить выключение радара" + demo };
  if (view.phase === "owned_elsewhere") return { tone: "attention", text: "Радар включён на другом устройстве" + demo };
  if (view.phase === "active" && view.status?.state === "active") {
    // Display until = confirmed session end; authority still uses effectiveDeadline elsewhere.
    const until = confirmedSessionDeadline(view.status);
    const authority = effectiveDeadline(view.status);
    const next = Date.parse(view.status.nextLocationUpdateAt);
    if (Number.isFinite(until) && until > view.now && Number.isFinite(authority) && authority > view.now && Number.isFinite(next)) {
      return view.now >= next ? { tone: "attention", text: "Радар: обновите геопозицию" + demo } : { tone: "active", text: "Радар включён" + demo, until };
    }
  }
  return { tone: "checking", text: "Проверить статус радара" + demo };
}

/** The outer lime arc shrinks continuously over the CONFIRMED session window.
 * No local animation timer is required: the existing RadarSessionProvider
 * publishes the authoritative second-by-second view.now. */
export function radarRingFraction(view: RadarView): number {
  const a = view.status;
  if (!view.confirmedOn || view.phase !== "active" || a?.state !== "active") return 0;
  const start = Date.parse(a.startedAt), expires = confirmedSessionDeadline(a);
  if (![start, expires, view.now].every(Number.isFinite) || expires <= start) return 0;
  return Math.max(0, Math.min(1, (expires - view.now) / (expires - start)));
}
