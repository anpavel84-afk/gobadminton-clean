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

export function venueGameCount(count: number): string {
  const noun = count % 10 === 1 && count % 100 !== 11 ? "игра"
    : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "игры" : "игр";
  return `На этой площадке ${count} ${noun}`;
}

export function venueDate(value: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function venueDays(games: readonly Game[], timeZone: string): { date: string; games: Game[] }[] {
  const days = new Map<string, Game[]>();
  for (const game of [...games].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))) {
    const date = venueDate(game.startsAt, timeZone);
    const list = days.get(date) ?? []; list.push(game); days.set(date, list);
  }
  return [...days].map(([date, games]) => ({ date, games }));
}
export function venueDayLabel(date: string, timeZone: string, now: number, start: string): string {
  const today = venueDate(now, timeZone);
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return date === today ? "Сегодня" : date === venueDate(tomorrow.getTime(), "UTC") ? "Завтра"
    : new Intl.DateTimeFormat("ru-RU", { timeZone, weekday: "short" }).format(new Date(start));
}
