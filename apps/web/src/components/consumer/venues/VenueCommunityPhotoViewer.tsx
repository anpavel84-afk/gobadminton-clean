"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ProfileDialog } from "../players/ProfileComposition";
import { Button } from "../Button";
import type { VenueCommunityPhotosModel } from "./useVenueCommunityPhotos";

export function VenueCommunityPhotoViewer({ model }: { model: VenueCommunityPhotosModel }) {
  const content = useRef<HTMLDivElement>(null);
  const actions = useRef(model); actions.current = model;
  useEffect(() => {
    const dialog = content.current?.closest("dialog");
    if (!dialog) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopPropagation(); actions.current.move(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    dialog.addEventListener("keydown", key);
    return () => dialog.removeEventListener("keydown", key);
  }, []);
  const drag = useRef<{ id: number; x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = model.selected;
  if (!photo || !model.selection) return null;
  const credit = model.credit?.url === photo.url ? model.credit : null;
  const unavailable = failed === photo.url || credit?.unavailable;
  const inline = Boolean(model.selection.items);
  const label = inline ? `Фото ${model.selection.index + 1} к публикации`
    : `Фото ${model.selection.index + 1}${model.cursor ? "" : ` из ${model.items.length}`}`;
  const next = model.selection.index < model.selectedItems.length - 1 || (!inline && Boolean(model.cursor));
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId || d.axis) return;
    const x = Math.abs(event.clientX - d.x), y = Math.abs(event.clientY - d.y);
    if (Math.max(x, y) >= 10) d.axis = x > y ? "x" : "y";
  }
  return <ProfileDialog title="Фотографии сообщества" className="gb-community-photo-viewer" onClose={model.close} onNativeClose={model.close} lockBodyScroll>
    <div ref={content} className="gb-community-photo-viewer__content">
      <p aria-live="polite">{label}</p>
      <div className="gb-community-photo-viewer__image" onPointerDown={(e) => {
        if (e.button !== 0 || !e.isPrimary) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }} onPointerMove={pointerMove} onPointerCancel={() => { drag.current = null; }} onPointerUp={(e) => {
        pointerMove(e); const d = drag.current; drag.current = null;
        if (d?.id === e.pointerId && d.axis === "x" && Math.abs(e.clientX - d.x) >= 48 && Math.abs(e.clientX - d.x) > Math.abs(e.clientY - d.y)) model.move(e.clientX < d.x ? 1 : -1);
      }}>
        {unavailable ? <p role="status">Фото недоступно. Оно могло быть удалено или доступ изменился.</p>
          : <img key={photo.url} src={photo.url} width={photo.width} height={photo.height} alt={label} draggable={false} onError={() => setFailed(photo.url)} />}
      </div>
      <div className="gb-community-photo-viewer__actions">
        <Button variant="outline" aria-label="Предыдущее фото" disabled={model.selection.index === 0 || model.sourceBusy} onClick={() => model.move(-1)}>←</Button>
        <Button variant="outline" aria-label="Следующее фото" disabled={!next || model.phase === "loading" || model.sourceBusy} onClick={() => model.move(1)}>→</Button>
        <Button variant="outline" disabled={model.sourceBusy} onClick={() => void model.jump()}>К публикации</Button>
      </div>
      <p>{credit?.name ? `Фото: ${credit.name}` : "Источник: публикация сообщества"}</p>
      {model.sourceBusy || model.phase === "loading" ? <p role="status">Загружаем…</p> : null}
      {model.sourceError ? <p role="alert">{model.sourceError}</p> : null}
      {model.phase === "error" ? <p role="alert">Не удалось загрузить следующую страницу. Текущее фото сохранено.</p> : null}
      {model.phase === "error" ? <Button variant="outline" onClick={() => model.move(1)}>Повторить загрузку</Button> : null}
      {unavailable || model.sourceError ? <Button variant="outline" onClick={model.restart}>Обновить фотографии</Button> : null}
    </div>
  </ProfileDialog>;
}
