"use client";
import { useState } from "react";
import type { VenueCommunityPhoto } from "../../../lib/comments-types";
import { Button } from "../Button";
import type { VenueCommunityPhotosModel } from "./useVenueCommunityPhotos";

export function VenueCommunityPhotos({ model, sectionId }: { model: VenueCommunityPhotosModel; sectionId: string }) {
  return <section id={sectionId} className="gb-venue-community__panel gb-community-photos" aria-label="Фотографии сообщества" data-community-section="photos" tabIndex={-1}>
    <header className="gb-venue-community__heading"><div><h2>Фотографии сообщества</h2><p>Фотографии из публикаций об этой площадке</p></div></header>
    <div className="gb-community-photos__grid">{model.items.map((photo, index) => <Thumbnail key={photo.url} photo={photo} index={index} onOpen={() => model.open(photo)} />)}</div>
    {model.phase === "loading" ? <p role="status">Загружаем фотографии…</p> : null}
    {model.phase === "ready" && !model.items.length ? <p>Пока нет фотографий сообщества.</p> : null}
    {model.phase === "restart" ? <p role="alert">Площадка или доступ изменились. Начните просмотр заново.</p> : null}
    {model.phase === "error" ? <p role="alert">Не удалось загрузить фотографии.</p> : null}
    {model.phase === "restart" || (model.phase === "error" && !model.items.length)
      ? <Button variant="outline" onClick={model.restart}>Обновить фотографии</Button>
      : model.cursor ? <Button variant="outline" disabled={model.phase === "loading"} onClick={model.loadMore}>{model.phase === "error" ? "Повторить загрузку" : "Ещё фотографии"}</Button> : null}
  </section>;
}
function Thumbnail({ photo, index, onOpen }: { photo: VenueCommunityPhoto; index: number; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return <button type="button" className="gb-community-photos__thumbnail" onClick={onOpen} aria-label={`Открыть фото ${index + 1}`}>
    {failed ? <span>Фото недоступно</span> : <img src={photo.url} width={photo.width} height={photo.height} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </button>;
}
