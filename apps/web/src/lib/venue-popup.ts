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
  const last = count % 10, hundred = count % 100;
  const word = hundred >= 11 && hundred <= 14 ? "игр" : last === 1 ? "игра" : last >= 2 && last <= 4 ? "игры" : "игр";
  return `На этой площадке ${count} ${word}`;
}

export function venueDays(games: readonly Game[], timeZone: string, now: number) {
  const key = (value: number) => new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const today = key(now);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const next = tomorrow.toISOString().slice(0, 10);
  const groups = new Map<string, Game[]>();
  for (const game of [...games].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))) {
    const day = key(Date.parse(game.startsAt));
    const group = groups.get(day) ?? []; group.push(game); groups.set(day, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, items]) => ({
    id, games: items,
    label: id === today ? "Сегодня" : id === next ? "Завтра" : new Intl.DateTimeFormat("ru-RU", { timeZone, weekday: "short" }).format(Date.parse(items[0]!.startsAt)),
    date: new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short" }).format(Date.parse(items[0]!.startsAt)),
  }));
}

/** Attach exclusively to the handle, never to the scrollable content or controls. */
export function venueHandleGesture(onUp: () => void, onDown: () => void, scrollTop: () => number) {
  let origin: { x: number; y: number; id: number } | null = null;
  let suppress = false;
  return {
    onPointerDown(event: import("react").PointerEvent<HTMLElement>) {
      suppress = false; origin = null;
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerCancel() { origin = null; suppress = false; },
    onPointerUp(event: import("react").PointerEvent<HTMLElement>) {
      const start = origin; origin = null;
      if (!start || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y, dx = event.clientX - start.x;
      if (Math.abs(dy) <= 80 || Math.abs(dy) <= Math.abs(dx) || (dy > 0 && scrollTop() > 0)) return;
      suppress = true; event.preventDefault();
      if (dy > 0) onDown(); else onUp();
    },
    onClickCapture(event: import("react").MouseEvent<HTMLElement>) {
      if (suppress) { event.preventDefault(); event.stopPropagation(); suppress = false; }
    },
  };
}
