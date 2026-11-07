import { publicTextModerationNotice, type ApiResult } from "./api-client";

/**
 * Neutral inline notice for public role-review / reply moderation outcomes (#506 B1b).
 * Preserves unsent composer text; never exposes tokens/categories/scores.
 */
export function publicRoleReviewModerationNotice(
  result: Extract<ApiResult<unknown>, { ok: false }> | { code?: string; status?: number },
): string | null {
  if ("problem" in result || "ok" in result) {
    const failed = result as Extract<ApiResult<unknown>, { ok: false }>;
    if (failed.ok === false) {
      const notice = publicTextModerationNotice(failed);
      if (notice) {
        if (failed.problem?.code === "PUBLIC_TEXT_CONTENT_REJECTED") {
          const fields = failed.problem.fields;
          if (fields?.text) return fields.text;
          return "Измените текст отзыва";
        }
        return notice;
      }
    }
  }
  const code = "problem" in result
    ? (result as Extract<ApiResult<unknown>, { ok: false }>).problem?.code
    : (result as { code?: string }).code;
  if (code === "PUBLIC_TEXT_CONTENT_REJECTED") return "Измените текст отзыва";
  if (code === "MODERATION_TEMPORARILY_UNAVAILABLE" || code === "MODERATION_POLICY_MISMATCH") {
    return "Проверка текста временно недоступна. Попробуйте позже — прежний текст не изменён.";
  }
  if (code === "MODERATION_RATE_LIMITED") {
    return "Слишком много проверок текста. Попробуйте позже.";
  }
  return null;
}
