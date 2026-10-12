import type { RadarView } from "./radar-controller";
import { effectiveDeadline } from "./radar-presentation";
export function radarHeaderStatus(view: RadarView): { tone: "active" | "attention" | "checking"; text: string; until?: number } | null {
  if (!view.me || !view.confirmedOn) return null;
  const demo = view.exposureMode === "synthetic_demo" ? " · демо" : "";
  if (view.pendingStop || view.phase === "stopping") return { tone: "attention", text: "Проверить выключение радара" + demo };
  if (view.phase === "owned_elsewhere") return { tone: "attention", text: "Радар включён на другом устройстве" + demo };
  if (view.phase === "active" && view.status?.state === "active") {
    const until = effectiveDeadline(view.status);
    const next = Date.parse(view.status.nextLocationUpdateAt);
    if (Number.isFinite(until) && until > view.now && Number.isFinite(next)) {
      return view.now >= next ? { tone: "attention", text: "Радар: обновите геопозицию" + demo } : { tone: "active", text: "Радар включён" + demo, until };
    }
  }
  return { tone: "checking", text: "Проверить статус радара" + demo };
}
