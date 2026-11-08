import { emptyAvatar, type PlayerAvatar } from "./avatar-presentation";

/**
 * Presentation-only quarantine for public / peer-visible avatar DTOs.
 * Unreviewed VK/Yandex providerUrl is never eligible for public projection.
 * Safe hostname sanitizer at OAuth ingest stays separate; uploadedUrl unchanged.
 */
export function projectPublicAvatar(
  avatar: Partial<PlayerAvatar> | null | undefined,
): PlayerAvatar {
  if (!avatar) return emptyAvatar();
  return {
    uploadedUrl: typeof avatar.uploadedUrl === "string" ? avatar.uploadedUrl : null,
    providerUrl: null,
  };
}

/** Own avatar mutate receipt (fresh or idempotent replay). */
export function projectOwnAvatarReceipt<T extends { avatar?: PlayerAvatar | null }>(
  body: T,
): T {
  if (!body || typeof body !== "object" || body.avatar == null) return body;
  return { ...body, avatar: projectPublicAvatar(body.avatar) };
}

/** Own social-profile DTO (patch / visibility / get). */
export function projectOwnProfileAvatar<T extends { avatar?: PlayerAvatar | null }>(
  body: T,
): T {
  return projectOwnAvatarReceipt(body);
}

/** Comment create/edit/list author projection. */
export function projectCommentAvatar<
  T extends { author?: { avatar?: PlayerAvatar | null } | null },
>(body: T): T {
  if (!body?.author || body.author.avatar == null) return body;
  return {
    ...body,
    author: { ...body.author, avatar: projectPublicAvatar(body.author.avatar) },
  };
}

/** First-DM create-request receipt with embedded peer avatar. */
export function projectConversationRequestAvatar<
  T extends {
    conversation?: { peer?: { avatar?: PlayerAvatar | null } | null } | null;
  },
>(body: T): T {
  const peer = body?.conversation?.peer;
  if (!peer || peer.avatar == null) return body;
  return {
    ...body,
    conversation: {
      ...body.conversation!,
      peer: { ...peer, avatar: projectPublicAvatar(peer.avatar) },
    },
  };
}

/** Friendship mutation / view peer avatar. */
export function projectFriendshipAvatar<
  T extends { peer?: { avatar?: PlayerAvatar | null } | null },
>(body: T): T {
  if (!body?.peer || body.peer.avatar == null) return body;
  return {
    ...body,
    peer: { ...body.peer, avatar: projectPublicAvatar(body.peer.avatar) },
  };
}
