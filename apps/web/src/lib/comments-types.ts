export type CommentEntityKind = "game" | "venue";

export type CommentAvatar = {
  uploadedUrl: string | null;
  providerUrl: string | null;
};

export type CommentAuthor = {
  publicPlayerId: string | null;
  displayName: string;
  avatar: CommentAvatar;
  profilePublic: boolean;
};

export type CommentPhoto = { id: string; width: number; height: number; url: string };

export type EntityComment = {
  id: string;
  entityKind: CommentEntityKind;
  entityId: string;
  parentCommentId: string | null;
  body: string | null;
  deleted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  mine: boolean;
  author: CommentAuthor | null;
  replyCount: number;
  /** Absent on legacy text-only game DTOs. */
  photos?: CommentPhoto[];
};

export type EntityCommentPage = {
  entityKind: CommentEntityKind;
  entityId: string;
  parentCommentId: string | null;
  items: EntityComment[];
  nextCursor: string | null;
  visibleCount: number | null;
  canCreate: boolean;
};

export type CreateCommentBody = {
  text?: string | null;
  photoIds?: string[];
  parentCommentId?: string | null;
};

export type UpdateCommentBody = {
  text?: string | null;
  photoIds?: string[];
  expectedVersion: number;
};

export type DeleteCommentBody = {
  expectedVersion: number;
};
