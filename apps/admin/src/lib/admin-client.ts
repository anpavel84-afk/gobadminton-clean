import { adminPath } from "./admin-path";
export type Ticket = { principalId: string; status: "active" | "pending_mfa"; csrfToken: string };
export type Session = { principalId: string; userId: string; status: string; version: number; roles: string[]; sessionId: string; expiresAt: string; stepUpAt: string; csrfToken: string };
export class AdminError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
export async function adminRequest<T>(path: string, body?: unknown, csrf?: string, key?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(adminPath("/v1/admin/" + path), {
    method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new AdminError(problem.code ?? "ADMIN_REQUEST_FAILED", response.status);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export function errorMessage(error: unknown) {
  if (error instanceof AdminError) {
    if (error.status === 401) return "Вход истёк или доступ отозван. Войдите заново.";
    if (error.code === "ADMIN_STEP_UP_REQUIRED") return "Подтвердите вход ключом доступа ещё раз.";
    if (error.code === "ADMIN_ACTIVATION_REQUIRED") return "Код активации недействителен или истёк.";
    if (error.code === "ADMIN_PERMISSION_DENIED") return "Для этого раздела нет разрешения.";
    if (["MODERATION_VERSION_CONFLICT", "VERSION_CONFLICT"].includes(error.code)) return "Игра уже изменена. Проверьте новое состояние и подтвердите действие заново.";
    if (error.code === "RESTRICTION_VERSION_CONFLICT" || error.code === "RESTRICTION_ALREADY_REVOKED") return "Ограничения уже изменены. Проверьте новое состояние и подтвердите действие заново.";
    if (error.code === "RESTRICTION_EXPIRY_INVALID") return "Укажите будущую дату в пределах 30 дней.";
    if (error.code === "CASES_DISABLED") return "Обращения сейчас недоступны.";
    if (error.code === "CASE_VERSION_CONFLICT") return "Обращение уже изменено. Проверьте новое состояние и подтвердите действие заново.";
    if (error.code === "CASE_CLOSED") return "Сначала откройте обращение снова.";
    if (error.code === "CASE_EVIDENCE_POLICY_DISABLED") return "Сохранение материалов сейчас недоступно.";
    if (["CASE_UNAVAILABLE", "EVIDENCE_UNAVAILABLE", "REPORT_UNAVAILABLE", "ASSIGNEE_UNAVAILABLE", "CASE_LINK_UNAVAILABLE"].includes(error.code)) return "Запись недоступна. Проверьте идентификатор и текущий доступ.";
    if (error.code === "REPORT_ALREADY_LINKED") return "Жалоба уже связана с обращением. Обновите очередь.";
    if (error.code === "USER_NOT_FOUND") return "Учётная запись не найдена.";
    if (error.code === "USER_RESTRICTIONS_DISABLED") return "Ограничения пользователей сейчас недоступны.";
    if (error.code === "IDEMPOTENCY_KEY_REUSED") return "Этот повтор не совпадает с исходным действием. Обновите данные.";
    if (error.code === "MODERATION_RESTORE_REQUIRED") return "Сначала восстановите публичный доступ к игре.";
    if (["GAME_ALREADY_CANCELLED", "GAME_NOT_CANCELLABLE"].includes(error.code)) return "Игру уже нельзя отменить. Обновите её состояние.";
    if (error.code === "GAME_MODERATION_DISABLED") return "Модерация игр сейчас недоступна.";
    if (error.status === 429) return "Слишком много попыток. Подождите минуту.";
    if (error.code === "ADMIN_CHALLENGE_INVALID") return "Подтверждение истекло. Начните новую попытку.";
    if (error.code === "ADMIN_PROVIDER_UNAVAILABLE") return "Этот способ входа сейчас недоступен.";
    if (error.status === 403) return "Не удалось подтвердить доступ. Обновите страницу и войдите заново.";
  }
  if (error instanceof Error && ["NotAllowedError", "AbortError"].includes(error.name)) return "Подтверждение отменено. Можно попробовать снова.";
  return "Не удалось завершить действие. Проверьте соединение и повторите попытку.";
}

export const NAV_ITEMS = [
  { id: "overview", label: "Обзор", roles: null },
  { id: "security", label: "Безопасность", roles: ["superadmin"] },
  { id: "venues", label: "Площадки", roles: ["superadmin", "content_manager"] },
  { id: "games", label: "Модерация игр", roles: ["superadmin", "moderator"] },
  { id: "users", label: "Ограничения пользователей", roles: ["superadmin", "moderator"] },
  { id: "cases", label: "Обращения", roles: ["superadmin", "moderator", "support"] },
] as const;
// Navigation is an affordance only. No frontend permission can authorize an API operation.
export function visibleNavigation(roles: readonly string[]) {
  return NAV_ITEMS.filter(item => item.roles === null || item.roles.some(role => roles.includes(role)));
}
export function freshStepUp(session: Session, now = Date.now()) {
  const at = Date.parse(session.stepUpAt);
  return Number.isFinite(at) && at <= now && at > now - 10 * 60 * 1000;
}
