import type { Game } from "./consumer-types";

/** The caller supplies one venue's schedule; never reorder its snapshot. */
export function nearestGameLabel(games: readonly Game[], timeZone: string, now: number): string {
  const first = games.reduce<Game | undefined>((nearest, game) =>
    !nearest || Date.parse(game.startsAt) < Date.parse(nearest.startsAt) ? game : nearest, undefined);
  if (!first) return "Пока нет игр";
  const date = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  // Calendar arithmetic on the local date avoids assuming a 24-hour DST day.
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  const tomorrow = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1));
  const tomorrowDate = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
  const start = Date.parse(first.startsAt);
  const suffix = date(start) === date(now) ? "Сегодня" : date(start) === tomorrowDate ? "Завтра"
    : new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short" }).format(start);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${time.format(start)} – ${time.format(Date.parse(first.endsAt))} · ${suffix}`;
}
