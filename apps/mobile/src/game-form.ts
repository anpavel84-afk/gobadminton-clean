import { cityDate, nextCalendarDay } from './presentation.ts';

/** Interpret a strict minute-resolution local value in the selected city's timezone. */
export function gameLocalToIso(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const target = Date.parse(`${value}:00Z`);
  // Date.parse normalizes impossible days such as February 30; reject that normalization.
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 16) !== value) return "";
  let instant = target;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let n = 0; n < 4; n++) {
      const p = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
      const displayed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
      const correction = target - displayed;
      if (!correction) return new Date(instant).toISOString();
      instant += correction;
    }
  } catch { return ""; }
  return ""; // Nonexistent local time at a DST transition.
}

/** UI bound chosen for this slice, not an Owner duration policy or a wire-contract limit. */
export const MAX_GAME_DURATION_MINUTES = 1440;
export function gameDurationMinutes(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const minutes = Number(raw);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_GAME_DURATION_MINUTES ? minutes : null;
}

export function gameSchedule(localStart: string, duration: string, timeZone: string) {
  const startsAt = gameLocalToIso(localStart, timeZone);
  const minutes = gameDurationMinutes(duration);
  if (!startsAt || minutes === null) return null;
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60000).toISOString(), applicationDeadlineAt: startsAt };
}

export function gameStartIsFuture(startsAt: string, now = Date.now()): boolean {
  return Number.isFinite(Date.parse(startsAt)) && Date.parse(startsAt) > now;
}

/** Today / tomorrow / next 60 calendar days in the venue (or city) timezone. */
export function createGameDateOptions(timeZone: string, now = new Date()) {
  const today = cityDate(now, timeZone);
  const tomorrow = nextCalendarDay(today, 1);
  const days = Array.from({ length: 60 }, (_, i) => nextCalendarDay(today, i));
  return { today, tomorrow, days };
}

export type CreateGameDateChoice = 'today' | 'tomorrow' | 'custom';
export function createGameDateChoice(date: string, timeZone: string, now = new Date()): CreateGameDateChoice {
  const { today, tomorrow } = createGameDateOptions(timeZone, now);
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  return 'custom';
}

/** Half-hour local clock labels HH:MM from 00:00 through 23:30. */
export function createGameTimeSlots(): string[] {
  return Array.from({ length: 48 }, (_, i) => {
    const hour = String(Math.floor(i / 2)).padStart(2, '0');
    const minute = i % 2 === 0 ? '00' : '30';
    return `${hour}:${minute}`;
  });
}

export const DURATION_CHIPS = [60, 120, 180] as const;
export function durationChipSelected(duration: string, custom: boolean): 60 | 120 | 180 | 'custom' | null {
  if (custom) return 'custom';
  const minutes = gameDurationMinutes(duration);
  if (minutes === 60 || minutes === 120 || minutes === 180) return minutes;
  return duration === '60' || duration === '120' || duration === '180' ? Number(duration) as 60 | 120 | 180 : 'custom';
}

export function clampCapacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1000, Math.max(1, Math.trunc(value)));
}

export function clampLevel(value: number, min = 1, max = 7): number {
  const stepped = Math.round(value * 2) / 2;
  return Math.min(max, Math.max(min, stepped));
}
