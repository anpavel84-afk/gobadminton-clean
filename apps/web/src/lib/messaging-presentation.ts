import type { ApiResult } from "./api-client";
import type { Conversation, DirectMessage, GameInvitation } from "./messaging-types";
export const requestCopy: Record<Conversation["requestState"], string> = {
  pending: "Запрос на общение", accepted: "Личная переписка", declined: "Запрос отклонён", expired: "Срок запроса истёк", closed: "Общение недоступно",
};
export const invitationCopy: Record<GameInvitation["status"], [string, string]> = {
  pending: ["Ожидает ответа", "Место не зарезервировано. При принятии проверим возможность участия."],
  accepted: ["Приглашение принято", "Актуальный статус участия смотрите в игре."],
  declined: ["Приглашение отклонено", "Участие по этому приглашению не оформлено."],
  expired: ["Срок приглашения истёк", "Чтобы присоединиться, нужно новое приглашение."],
  revoked: ["Приглашение отозвано", "Это приглашение больше не действует."],
  cancelled_by_game: ["Игра отменена", "Приглашение больше не действует."],
};
export function canCompose(c: Conversation | null) { return c?.requestState === "accepted"; }
export function canDecideRequest(c: Conversation) { return c.requestState === "pending" && c.role === "recipient"; }
export function mergeMessages(old: DirectMessage[], fresh: DirectMessage[]) {
  return [...new Map([...old, ...fresh].map(m => [m.id, m])).values()].sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0);
}
export function socialError(r: Extract<ApiResult<unknown>, { ok: false }>) {
  if (r.status === 0 || r.status >= 500) return "Результат не подтверждён. Отправка могла завершиться. Проверьте результат перед следующим действием.";
  if (r.status === 401) return "Войдите снова, чтобы продолжить.";
  if (r.problem?.code === "GAME_FULL") return "Свободных мест нет. Участие не подтверждено.";
  if (r.status === 404 || r.status === 403) return "Это действие сейчас недоступно.";
  if (r.status === 429) return "Слишком много попыток. Попробуйте немного позже.";
  if (r.status === 409) return "Условия изменились. Обновите данные перед следующим действием.";
  return "Не удалось выполнить действие. Проверьте данные и попробуйте снова.";
}
export function messageTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
