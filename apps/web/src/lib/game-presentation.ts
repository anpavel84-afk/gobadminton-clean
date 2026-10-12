import type { Game, Participation, ParticipationStatus, Settlement } from "./consumer-types";

export function formatGameWhen(game: Game, locale = "ru-RU"): string {
  const start = new Date(game.startsAt);
  const end = new Date(game.endsAt);
  const date = start.toLocaleDateString(locale, {
    timeZone: game.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const startTime = start.toLocaleTimeString(locale, {
    timeZone: game.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString(locale, {
    timeZone: game.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${startTime}–${endTime}`;
}

export function formatSeats(game: Game): string {
  if (game.status === "cancelled") return "Игра отменена";
  if (game.availablePlaces <= 0) return "Мест нет";
  return `Свободно ${game.availablePlaces} из ${game.capacity}`;
}

export function hostLine(game: Game): string {
  if (game.activityKind === "trainer_led" && game.trainer) {
    return `Ведёт ${game.trainer.displayName}`;
  }
  return `Организует ${game.organizer.displayName}`;
}

export function settlementTerms(settlement: Settlement): string {
  if (settlement.purpose === "no_trainer_fee") {
    return settlement.terms;
  }
  if (settlement.priceStatus === "by_agreement") {
    return `Оплата тренеру по договорённости · ${settlement.terms}`;
  }
  // Fixed price may appear in API data; do not invent production unit wording.
  return `Внешняя оплата тренеру · ${settlement.terms}`;
}

export function isTrainerLed(game: Game): boolean {
  return game.activityKind === "trainer_led";
}

export function participationLabel(status: ParticipationStatus): string {
  switch (status) {
    case "pending":
      return "Ждём ответа";
    case "confirmed":
      return "Место подтверждено";
    case "rejected":
      return "Заявка отклонена";
    case "withdrawn":
      return "Заявка отозвана";
    case "removed":
      return "Участие снято";
    case "cancelled_by_game":
      return "Игра отменена";
    case "expired":
      return "Заявка истекла";
    default:
      return status;
  }
}

export function participationChipKind(
  status: ParticipationStatus,
): "pending" | "confirmed" | "danger" | "subtle" {
  if (status === "pending") return "pending";
  if (status === "confirmed") return "confirmed";
  if (
    status === "cancelled_by_game" ||
    status === "rejected" ||
    status === "removed" ||
    status === "expired" ||
    status === "withdrawn"
  ) {
    return "danger";
  }
  return "subtle";
}

/** Cancellation / terminal states dominate prior confirmation for presentation. */
export function dominantParticipation(
  items: Participation[],
  gameId: string,
): Participation | null {
  const mine = items.filter((item) => item.gameId === gameId);
  if (mine.length === 0) return null;
  const cancelled = mine.find((item) => item.status === "cancelled_by_game");
  if (cancelled) return cancelled;
  const confirmed = mine.find((item) => item.status === "confirmed");
  if (confirmed) return confirmed;
  const pending = mine.find((item) => item.status === "pending");
  if (pending) return pending;
  return (
    mine.sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    )[0] ?? null
  );
}

export function levelFormatLine(game: Game): string {
  const levels = game.levelRule.allowedLevelIds.join(", ");
  return `${levels} · ${game.formatKey}`;
}

export function canRequestParticipation(
  game: Game,
  own: Participation | null,
): boolean {
  if (game.status !== "published") return false;
  if (Date.parse(game.applicationDeadlineAt) <= Date.now() || Date.parse(game.startsAt) <= Date.now()) return false;
  if (game.availablePlaces <= 0) return false;
  if (!own) return true;
  return own.status === "withdrawn";
}

export type CapacityTone = "available" | "few" | "full" | "closed" | "cancelled" | "past";

/** Presentation-only capacity/status tone from authoritative Game fields. */
export function capacityTone(game: Game): CapacityTone {
  if (game.status === "cancelled") return "cancelled";
  if (game.status !== "published") return "closed";
  const ends = new Date(game.endsAt).getTime();
  if (Number.isFinite(ends) && ends < Date.now()) return "past";
  if (Date.parse(game.applicationDeadlineAt) <= Date.now() || Date.parse(game.startsAt) <= Date.now()) return "closed";
  if (game.availablePlaces <= 0) return "full";
  if (game.availablePlaces <= 2) return "few";
  return "available";
}

export function capacityStatusLabel(game: Game): string {
  switch (capacityTone(game)) {
    case "cancelled":
      return "Игра отменена";
    case "closed":
      return "Заявки закрыты";
    case "past":
      return "Игра уже прошла";
    case "full":
      return "Мест нет";
    case "few":
      return `Осталось мало мест · ${formatSeats(game)}`;
    default:
      return formatSeats(game);
  }
}

/** Honest applicant label — Participation DTO has userId only. */
export function applicantLabel(userId: string): string {
  const short = userId.replace(/-/g, "").slice(0, 8);
  return short ? `Игрок · ${short}` : "Игрок";
}

export const DEFAULT_REJECT_REASON = "Организатор отклонил заявку";
export const DEFAULT_REMOVE_REASON = "Организатор снял участие";

/** Past by endsAt or terminal game status; never invents history rows. */
export function isPastGame(game: Game, now = Date.now()): boolean {
  if (game.status === "completed" || game.status === "cancelled") return true;
  const ends = Date.parse(game.endsAt);
  return Number.isFinite(ends) && ends < now;
}

/** Created-by-me active list: drafts + non-past published. */
export function isActiveCreatedGame(game: Game, now = Date.now()): boolean {
  if (game.status === "draft") return true;
  if (game.status === "published") return !isPastGame(game, now);
  return false;
}

/** Terminal participation outcomes belong in history even if game time is unknown. */
export function isTerminalParticipation(
  status: ParticipationStatus,
): boolean {
  return (
    status === "rejected" ||
    status === "withdrawn" ||
    status === "removed" ||
    status === "expired" ||
    status === "cancelled_by_game"
  );
}

export function isParticipatingHistoryRow(
  game: Game | null,
  status: ParticipationStatus,
  now = Date.now(),
): boolean {
  if (isTerminalParticipation(status)) return true;
  // Failed/null game reads are not history evidence — keep active rows in Upcoming.
  if (!game) return false;
  return isPastGame(game, now);
}

/** Honest management relation label from server GameManagement projection. */
export function managedGameRelationLabel(management: {
  role: "owner" | "manager";
  createdByMe: boolean;
}): string {
  if (management.createdByMe) return "Создана мной";
  if (management.role === "owner") return "Владелец";
  return "Управляю";
}

