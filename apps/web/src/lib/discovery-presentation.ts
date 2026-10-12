import type { Game } from "./consumer-types";

/** Calendar days belong to the selected city, not the browser's timezone. */
export function cityDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function nextCalendarDay(day: string, offset = 1): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function discoveryDayBounds(day: string, timeZone: string) {
  function midnight(value: string) {
    const target = Date.parse(`${value}T00:00:00Z`);
    let instant = target;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let n = 0; n < 4; n++) {
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
      const displayed = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      const correction = target - displayed;
      instant += correction;
      if (!correction) break;
    }
    return new Date(instant).toISOString();
  }
  return { startsFrom: midnight(day), startsBefore: midnight(nextCalendarDay(day)) };
}

export function discoveryDateLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

export function discoveryGameWhen(game: Game) {
  const options = { timeZone: game.timezone, hour: "2-digit", minute: "2-digit" } as const;
  return {
    day: new Date(game.startsAt).toLocaleDateString("ru-RU", { timeZone: game.timezone, weekday: "short", day: "numeric", month: "short" }),
    time: `${new Date(game.startsAt).toLocaleTimeString("ru-RU", options)} — ${new Date(game.endsAt).toLocaleTimeString("ru-RU", options)}`,
  };
}

export function discoveryCityHeading(name: string) {
  return name === "Москва" ? "в Москве" : name === "Санкт-Петербург" ? "в Санкт-Петербурге" : `· ${name}`;
}

/** Unsupported API keys have no consumer label; omit that metadata. */
export function discoveryFormat(key: string): string | null {
  switch (key) {
    case "doubles": return "Парная игра";
    case "singles": return "Одиночная игра";
    case "mixed":
    case "mixed_doubles": return "Микст";
    default: return null;
  }
}

/** Each request advances the lower bound; an unset day has no upper bound. */
export function futureDiscoveryBounds(day: string, timeZone: string, now = Date.now()) {
  if (!day) return { startsFrom: new Date(now).toISOString() };
  const bounds = discoveryDayBounds(day, timeZone);
  return { ...bounds, startsFrom: new Date(Math.max(Date.parse(bounds.startsFrom), now)).toISOString() };
}

/** Apply again on network, cache, merge and render; a cached seat is never schedule authority. */
export function futureDiscoveryItems<T extends { startsAt: string }>(items: T[], now = Date.now()): T[] {
  return items.filter(item => Number.isFinite(Date.parse(item.startsAt)) && Date.parse(item.startsAt) > now);
}
