import { apiFetch } from "./api-client";
export type AuthMethod = "vk" | "yandex" | "email";
export type MethodDiscovery = { items: Array<{method: AuthMethod; type: "oauth" | "email_code"; available: boolean}> };
export type MethodInventory = {items: Array<{method: AuthMethod; type: "oauth" | "email_code"; status: "connected"; linkedAt: string; maskedEmail?: string}>};
export type EmailPurpose = "login_signup" | "link" | "change_current" | "change";
export type EmailChallenge = {challengeId: string; expiresAt: string; resendAvailableAt: string; deliveryState: "queued" | "sent" | "delivery_failed" | "expired" | "consumed"};
export type EmailProofResult = {authenticated?: true; returnPath?: string; linked?: true; changed?: true; proved?: true; proofChallengeId?: string};
const roots: Record<EmailPurpose, string> = {
  login_signup: "/v1/auth/email/challenges", link: "/v1/me/auth-methods/email/link/challenges",
  change_current: "/v1/me/auth-methods/email/change/current/challenges", change: "/v1/me/auth-methods/email/change/challenges",
};
export const listAuthMethods = () => apiFetch<MethodDiscovery>("/v1/auth/methods");
export const listOwnAuthMethods = () => apiFetch<MethodInventory>("/v1/me/auth-methods");
export function emailCommand<T>(purpose: EmailPurpose, suffix: string, body: object, csrfToken?: string) {
  return apiFetch<T>(roots[purpose] + suffix, {method: "POST", body: JSON.stringify(body), csrfToken, headers: {"X-GB-Email-Auth": "1"}});
}
export function requestEmail(purpose: EmailPurpose, body: {email?: string; returnPath?: string; proofChallengeId?: string}, csrfToken?: string) {
  return emailCommand<EmailChallenge>(purpose, "", body, csrfToken);
}
export function unlinkEmail(csrfToken: string) {
  return apiFetch<{unlinked: true}>("/v1/me/auth-methods/email", {method: "DELETE", body: "{}", csrfToken, headers: {"X-GB-Email-Auth": "1"}});
}
export function emailErrorCopy(code: string | undefined, status: number) {
  if (code === "RECENT_AUTH_REQUIRED") return "Войдите снова своим подключённым способом, затем повторите действие.";
  if (code === "LAST_AUTH_METHOD") return "Нельзя отключить последний способ входа. Сначала подключите другой.";
  if (code === "EMAIL_ALREADY_LINKED") return "Этот email уже подключён к аккаунту. Профили не объединяются.";
  if (code === "EMAIL_CURRENT_PROOF_REQUIRED" || code === "EMAIL_METHOD_CHANGED") return "Подтверждение устарело или способ входа изменился. Начните заново.";
  if (code === "ACCOUNT_UNAVAILABLE") return "Аккаунт сейчас недоступен.";
  if (status === 401) return "Сессия истекла. Войдите снова.";
  if (status === 403) return "Не удалось подтвердить этот запрос. Начните заново в этом браузере.";
  if (status === 429) return "Слишком много попыток. Дождитесь окончания таймера.";
  if (status === 503) return "Вход по email сейчас недоступен. Попробуйте позже.";
  if (status === 0) return "Ответ не получен. Проверьте вход на странице профиля или запросите новый код. Повторная отправка старого кода не восстановит ответ.";
  return "Проверьте email или код. Код мог истечь или уже использоваться.";
}
