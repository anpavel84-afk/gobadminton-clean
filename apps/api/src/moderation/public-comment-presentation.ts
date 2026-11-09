import { localProfanitySpans } from "./local-text-policy";

/** Presentation only; deliberately separate from approval/cache policy versions. */
export const PUBLIC_COMMENT_PRESENTATION_VERSION = "public-comment-mask-v1";

/** Public comment bodies only. Never use the returned text as a write/approval input. */
export function maskPublicCommentBody(body: string | null): string | null {
  if (body === null) return null;
  let cursor = 0;
  let masked = "";
  for (const { start, end } of localProfanitySpans(body)) {
    masked += body.slice(cursor, start) + "*".repeat([...body.slice(start, end)].length);
    cursor = end;
  }
  return masked + body.slice(cursor);
}
