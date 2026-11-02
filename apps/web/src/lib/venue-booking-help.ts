import type { VenueSummary } from "./consumer-types";
import { gameDurationMinutes, gameSchedule } from "./game-form";

export type VenueBookingDraftInput = {
  venueName: string;
  venueAddress: string;
  startDate: string;
  startTime: string;
  durationMinutes: string;
  timezone: string;
};

export type VenueBookingDraft = {
  text: string;
  localWhenLabel: string;
  durationLabel: string;
};

/** Build a plain-Russian enquiry draft from complete local form facts; never invent UTC defaults. */
export function buildVenueBookingDraft(input: VenueBookingDraftInput): VenueBookingDraft | null {
  const venueName = input.venueName.trim();
  const venueAddress = input.venueAddress.trim();
  const startDate = input.startDate.trim();
  const startTime = input.startTime.trim();
  const timezone = input.timezone.trim();
  if (!venueName || !venueAddress || !startDate || !startTime || !timezone) return null;
  const schedule = gameSchedule(`${startDate}T${startTime}`, input.durationMinutes, timezone);
  const duration = gameDurationMinutes(input.durationMinutes);
  if (!schedule || duration === null) return null;

  const [y, m, d] = startDate.split("-");
  const localWhenLabel = `${d}.${m}.${y}, ${startTime} (${timezone})`;
  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  const durationLabel = mins === 0
    ? `${hours} ч`
    : hours === 0
      ? `${mins} мин`
      : `${hours} ч ${mins} мин`;

  const text = [
    `Здравствуйте! Хотим договориться о корте на площадке «${venueName}».`,
    `Адрес: ${venueAddress}.`,
    `Желаемое время: ${localWhenLabel}, длительность ${durationLabel}.`,
    `Это запрос от игроков сервиса GoBadminton; бронь и оплату оформляем напрямую с площадкой, не через приложение.`,
    `Подскажите, пожалуйста, доступен ли корт и как лучше подтвердить договорённость.`,
  ].join("\n");

  return { text, localWhenLabel, durationLabel };
}

export function selectedKnownVenueContacts(venue: VenueSummary | null | undefined): unknown {
  if (!venue) return null;
  return venue.publicContacts ?? null;
}

export async function copyVenueBookingText(
  text: string,
  clipboard?: { writeText: (value: string) => Promise<void> },
): Promise<"copied" | "copy_failed"> {
  const api = clipboard ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (!api?.writeText) return "copy_failed";
  try {
    await api.writeText(text);
    return "copied";
  } catch {
    return "copy_failed";
  }
}
