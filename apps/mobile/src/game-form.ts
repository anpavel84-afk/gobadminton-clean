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
