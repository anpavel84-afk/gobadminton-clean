import { apiFetch } from "./api-client";
import type { PostgameReminder, PostgameRemindersPage } from "./consumer-types";

export type { PostgameReminder, PostgameRemindersPage };

export function listPostgameReminders(limit = 20) {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch<PostgameRemindersPage>(`/v1/me/postgame-reminders?${q}`, {
    method: "GET",
  });
}

export function laterPostgameReminder(
  reminderId: string,
  expectedVersion: number,
  csrfToken: string,
  idempotencyKey?: string,
) {
  return apiFetch<PostgameRemindersPage>(`/v1/me/postgame-reminders/${reminderId}`, {
    method: "POST",
    body: JSON.stringify({ command: "later", expectedVersion }),
    csrfToken,
    idempotent: true,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export function reminderResultsHref(reminder: Pick<PostgameReminder, "resultsPath" | "gameId">): string {
  if (typeof reminder.resultsPath === "string" && reminder.resultsPath.startsWith("/my-games/")) {
    return reminder.resultsPath;
  }
  return `/my-games/${reminder.gameId}/results`;
}
