import { badRequest } from "../auth/problem";

/** Preference column / API group for a game-event push kind. */
export type GamePushEventGroup =
  | "invites"
  | "applicationDecisions"
  | "newApplications"
  | "gameChanges"
  | "outcomeReminders";

export type GamePushKind =
  | "game_invitation"
  | "participation_confirmed"
  | "participation_rejected"
  | "new_pending_application"
  | "game_cancelled"
  | "game_time_changed"
  | "game_venue_changed"
  | "outcome_reminder";

export const GAME_PUSH_KINDS: readonly GamePushKind[] = [
  "game_invitation",
  "participation_confirmed",
  "participation_rejected",
  "new_pending_application",
  "game_cancelled",
  "game_time_changed",
  "game_venue_changed",
  "outcome_reminder",
] as const;

export const GAME_PUSH_COPY: Record<GamePushKind, string> = {
  game_invitation: "Приглашение на игру",
  participation_confirmed: "Заявка подтверждена",
  participation_rejected: "Заявка отклонена",
  new_pending_application: "Новая заявка на игру",
  game_cancelled: "Игра отменена",
  game_time_changed: "Изменено время игры",
  game_venue_changed: "Изменено место игры",
  outcome_reminder: "Напоминание об итоге игры",
};

export const GAME_PUSH_PREF_COLUMN: Record<GamePushEventGroup, string> = {
  invites: "notify_invites",
  applicationDecisions: "notify_application_decisions",
  newApplications: "notify_new_applications",
  gameChanges: "notify_game_changes",
  outcomeReminders: "notify_outcome_reminders",
};

export function eventGroupForKind(kind: GamePushKind): GamePushEventGroup {
  switch (kind) {
    case "game_invitation":
      return "invites";
    case "participation_confirmed":
    case "participation_rejected":
      return "applicationDecisions";
    case "new_pending_application":
      return "newApplications";
    case "game_cancelled":
    case "game_time_changed":
    case "game_venue_changed":
      return "gameChanges";
    case "outcome_reminder":
      return "outcomeReminders";
  }
}

/** Neutral click targets — no title/address/PII; ordinary auth routes only. */
export function pathForGamePush(
  kind: GamePushKind,
  gameId: string,
): string {
  if (kind === "outcome_reminder") {
    return assertSafeGamePushPath(`/my-games/${gameId}/results`, kind);
  }
  return assertSafeGamePushPath(`/games/${gameId}`, kind);
}

export function assertSafeGamePushPath(
  path: string,
  kind: GamePushKind,
): string {
  if (
    !path.startsWith("/") ||
    path.includes("://") ||
    path.includes("\\") ||
    path.includes("#")
  ) {
    throw badRequest("PUSH_PATH_INVALID", "Некорректный путь уведомления");
  }
  if (kind === "outcome_reminder") {
    if (!/^\/my-games\/[0-9a-f-]{36}\/results$/i.test(path)) {
      return "/my-games";
    }
    return path;
  }
  if (!/^\/games\/[0-9a-f-]{36}$/i.test(path)) {
    return "/games";
  }
  return path;
}

export function isGamePushKind(value: unknown): value is GamePushKind {
  return (
    typeof value === "string" &&
    (GAME_PUSH_KINDS as readonly string[]).includes(value)
  );
}
