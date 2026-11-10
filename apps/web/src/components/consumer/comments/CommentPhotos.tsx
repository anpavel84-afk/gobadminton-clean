"use client";
import { useState } from "react";
import { validCommentPhotos } from "../../../lib/comments-api";
import type { CommentPhoto, EntityComment } from "../../../lib/comments-types";
import { Button } from "../Button";

export function CommentPhotos({ comment, onRefresh }: { comment: EntityComment; onRefresh: () => void }) {
  if (comment.deleted || comment.entityKind !== "venue" || !validCommentPhotos(comment)) return null;
  return <div className="gb-comment-photos">{comment.photos?.map((photo, i) => (
    <PublicPhoto key={`${comment.id}:${comment.version}:${photo.id}`} photo={photo} index={i} onRefresh={onRefresh} />
  ))}</div>;
}
function PublicPhoto({ photo, index, onRefresh }: { photo: CommentPhoto; index: number; onRefresh: () => void }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="gb-comment-photos__unavailable" role="status">
    <p>Фото {index + 1} недоступно. Оно могло быть удалено или доступ изменился.</p>
    <Button type="button" variant="outline" onClick={onRefresh}>Обновить комментарии</Button>
  </div> : (
    // Current server route rechecks rights for every no-store read. No storage fallback.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="gb-comment-photos__image" src={photo.url} width={photo.width} height={photo.height} alt={`Фото ${index + 1} к комментарию`} onError={() => setFailed(true)} />
  );
}
