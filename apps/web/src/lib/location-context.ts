export type SelectedLocation = {
  cityId: string;
  nameRu: string;
  timezone: string;
};

const STORAGE_KEY = "gb.consumer.location.v1";
const INTENT_KEY = "gb.consumer.authIntent.v1";

// Owner's two city-selection groups: Москва includes МО;
// Санкт-Петербург includes ЛО. Invalidate stale borough/city IDs
// left in sessionStorage by the superseded bulk Venue import.
const SUPPORTED_CITY_IDS = new Set([
  "a0000000-0000-4000-8000-000000000001",
  "a0000000-0000-4000-8000-000000000002",
]);

export function readSelectedLocation(): SelectedLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectedLocation;
    if (!parsed?.cityId || !parsed?.nameRu) return null;
    if (!SUPPORTED_CITY_IDS.has(parsed.cityId)) {
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* optional legacy cache */ }
      return null;
    }
    return { cityId: parsed.cityId, nameRu: parsed.cityId.endsWith("1") ? "Москва" : "Санкт-Петербург", timezone: "Europe/Moscow" };
  } catch {
    return null;
  }
}

export function writeSelectedLocation(location: SelectedLocation): void {
  if (!SUPPORTED_CITY_IDS.has(location.cityId)) return;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(location)); } catch { /* legacy session seed only */ }
}

export function clearSelectedLocation(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export type AuthIntent =
  | { kind: "create"; activityKind?: "regular" | "trainer_led" }
  | { kind: "participate"; gameId: string }
  | { kind: "return"; path: string };

export function writeAuthIntent(intent: AuthIntent): void {
  window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
}

export function readAuthIntent(): AuthIntent | null {
  try {
    const raw = window.sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthIntent;
  } catch {
    return null;
  }
}

export function clearAuthIntent(): void {
  window.sessionStorage.removeItem(INTENT_KEY);
}

export function dayBoundsIso(day: Date, timezoneHint?: string): {
  startsFrom: string;
  startsBefore: string;
} {
  // Local calendar day in browser; timezoneHint reserved for future city TZ binding.
  void timezoneHint;
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return {
    startsFrom: start.toISOString(),
    startsBefore: end.toISOString(),
  };
}

export function buildDateStrip(center = new Date(), count = 7): Date[] {
  const base = new Date(center);
  base.setHours(12, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(base);
    d.setDate(base.getDate() + index);
    return d;
  });
}

/** Only admitted local destinations may follow city selection. */
export function locationReturnPath(value: string | null): string {
  return value === "/games/create" ? value : "/games";
}
