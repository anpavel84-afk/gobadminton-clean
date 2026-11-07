/**
 * Public text surface catalogue and field-kind mapping for MOD-V2-A/B1a/B1b.
 * Provider policy version is independent from local ru-profanity-v1.
 * Review surfaces keep contextual prose semantics; ordinary A/B1a reject paths unchanged.
 */

import type { LocalTextKind } from "./local-text-policy";
import type { TextCategory } from "./provider";

export const PUBLIC_TEXT_POLICY_VERSION = "public-text-v1";

/** Exact surface keys persisted in content_moderation_approvals.surface_key. */
export const TEXT_SURFACES = [
  "profile_display_name",
  "profile_bio",
  "trainer_display_name",
  "trainer_bio",
  "organizer_display_name",
  "organizer_public_contact",
  "game_title",
  "game_host_display_name",
  "game_host_public_contact",
  "game_training_description",
  "game_settlement_terms",
  "game_trainer_display_name_snapshot",
  "comment_body",
  "role_review_body",
  "role_reply_body",
] as const;

export type TextSurface = (typeof TEXT_SURFACES)[number];

/** B1b public role-review/reply surfaces — human queue mandatory even on classifier ALLOW. */
export const REVIEW_TEXT_SURFACES = ["role_review_body", "role_reply_body"] as const;
export type ReviewTextSurface = (typeof REVIEW_TEXT_SURFACES)[number];

export function isReviewTextSurface(surface: TextSurface): surface is ReviewTextSurface {
  return (REVIEW_TEXT_SURFACES as readonly string[]).includes(surface);
}

/**
 * Hard reject for review/reply: clear safety categories.
 * Soft/queue categories (harassment, hate, illicit, violence) stay human-pending —
 * negative criticism and quoted abuse are contextual, not forbidden by sentiment alone.
 */
export const REVIEW_HARD_REJECT_CATEGORIES: readonly TextCategory[] = [
  "sexual",
  "sexual/minors",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "harassment/threatening",
  "hate/threatening",
  "illicit/violent",
  "violence/graphic",
];

export const REVIEW_QUEUE_CATEGORIES: readonly TextCategory[] = [
  "harassment",
  "hate",
  "illicit",
  "violence",
];

export const TEXT_SURFACE_KIND: Record<TextSurface, LocalTextKind> = {
  profile_display_name: "identity",
  profile_bio: "prose",
  trainer_display_name: "identity",
  trainer_bio: "prose",
  organizer_display_name: "identity",
  organizer_public_contact: "contact",
  game_title: "title",
  game_host_display_name: "identity",
  game_host_public_contact: "contact",
  game_training_description: "prose",
  game_settlement_terms: "prose",
  game_trainer_display_name_snapshot: "identity",
  comment_body: "prose",
  role_review_body: "prose",
  role_reply_body: "prose",
};

/** Neutral Russian correction hints keyed by client field id (never expose matched tokens). */
export const TEXT_FIELD_HINTS: Record<TextSurface, string> = {
  profile_display_name: "Измените отображаемое имя",
  profile_bio: "Измените описание профиля",
  trainer_display_name: "Измените имя в профиле тренера",
  trainer_bio: "Измените описание профиля тренера",
  organizer_display_name: "Измените имя организатора",
  organizer_public_contact: "Измените публичный контакт организатора",
  game_title: "Измените название игры",
  game_host_display_name: "Измените имя организатора игры",
  game_host_public_contact: "Измените публичный контакт игры",
  game_training_description: "Измените описание тренировки",
  game_settlement_terms: "Измените условия участия",
  game_trainer_display_name_snapshot: "Измените имя тренера в профиле тренера и создайте игру снова",
  comment_body: "Измените текст комментария",
  role_review_body: "Измените текст отзыва",
  role_reply_body: "Измените текст ответа",
};

export type TextFieldCandidate = Readonly<{
  surface: TextSurface;
  /** Exact value that will be stored / published. */
  text: string;
  /** Client-facing field id for 422 hints. */
  fieldId: string;
}>;

export type EntityKind =
  | "player_social_profile"
  | "trainer_profile"
  | "organizer"
  | "game"
  | "entity_comment"
  | "role_review_revision"
  | "role_reply_revision";

export type BindingKind = "candidate" | "publication";

/** Persisted content_moderation_approvals.decision for text (image allow/reject/review unchanged). */
export type TextClassificationDecision = "allow" | "review";
