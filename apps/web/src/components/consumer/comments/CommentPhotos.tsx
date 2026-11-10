"use client";
import { useState } from "react";
import { validCommentPhotos } from "../../../lib/comments-api";
import type { CommentPhoto, EntityComment, VenueCommunityPhoto } from "../../../lib/comments-types";
import { Button } from "../Button";

export function CommentPhotos({ comment, onRefresh, onOpenPhoto }: { comment: EntityComment; onRefresh: () => void; onOpenPhoto?: (photo: VenueCommunityPhoto, inlineItems: VenueCommunityPhoto[]) => void }) {
  if (comment.deleted || comment.entityKind !== "venue" || !validCommentPhotos(comment)) return null;
  const items = (comment.photos ?? []).map((photo) => ({ ...photo, source: { commentId: comment.id, parentCommentId: comment.parentCommentId, resourceVersion: comment.version, path: `/v1/comments/${comment.id}` } }));
  return <div className="gb-comment-photos">{comment.photos?.map((photo, i) => (
    <PublicPhoto key={`${comment.id}:${comment.version}:${photo.id}`} photo={photo} index={i} onRefresh={onRefresh} onOpen={onOpenPhoto ? () => onOpenPhoto(items[i]!, items) : undefined} />
  ))}</div>;
}
function PublicPhoto({ photo, index, onRefresh, onOpen }: { photo: CommentPhoto; index: number; onRefresh: () => void; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);
  const image = <img className="gb-comment-photos__image" src={photo.url} width={photo.width} height={photo.height} alt={`Фото ${index + 1} к комментарию`} onError={() => setFailed(true)} />;
  return failed ? <div className="gb-comment-photos__unavailable" role="status">
    <p>Фото {index + 1} недоступно. Оно могло быть удалено или доступ изменился.</p>
    <Button type="button" variant="outline" onClick={onRefresh}>Обновить комментарии</Button>
  </div> : (
    // Current server route rechecks rights for every no-store read. No storage fallback.
    onOpen ? <button type="button" className="gb-comment-photos__open" aria-label={`Открыть фото ${index + 1} к комментарию`} onClick={onOpen}>{image}</button> : image
  );
}
