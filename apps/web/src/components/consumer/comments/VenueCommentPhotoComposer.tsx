"use client";
import { useRef, useState } from "react";
import { Button } from "../Button";
import type { VenueCommentPhotosModel } from "./useVenueCommentPhotos";

export function VenueCommentPhotoComposer({ model, target, disabled }: {
  model: VenueCommentPhotosModel; target: string; disabled: boolean;
}) {
  const [rights, setRights] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const items = model.items(target);
  return (
    <fieldset className="gb-comment-photo-composer" disabled={disabled}>
      <legend>Фотографии · до 4</legend>
      <p>JPEG, PNG или WebP до 5 МиБ. Фото сохраняется целиком. Проверка перед отправкой ещё не публикует фото.</p>
      <label className="gb-comment-photo-composer__rights">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        <span>Это мои фото или у меня есть права на публикацию. Узнаваемые люди согласны на публикацию. EXIF и геометки будут удалены.</span>
      </label>
      <div className="gb-comment-photo-composer__input">
        <Button type="button" variant="outline" disabled={!rights || disabled} onClick={() => pickerRef.current?.click()}>
          Добавить фото
        </Button>
        <input ref={pickerRef} className="gb-comment-photo-composer__native-input" type="file" accept="image/jpeg,image/png,image/webp" multiple
          aria-label="Добавить фото / выбрать прежний файл для повтора" tabIndex={-1} disabled={!rights || disabled}
          onChange={(e) => { if (rights && e.target.files) void model.add(target, e.target.files); e.target.value = ""; }} />
        <p className="gb-comment-photo-composer__hint">Для повтора после перезагрузки выберите тот же файл.</p>
      </div>
      {model.notice ? <p role="status">{model.notice}</p> : null}
      <ol className="gb-comment-photo-composer__list">
        {items.map((p, index) => (
          <li key={p.key}>
            {p.state === "ready" && p.selected && (p.retained?.url || p.receipt?.previewPath) ? (
              <img className="gb-comment-photo-composer__preview" src={p.retained?.url ?? p.receipt!.previewPath!} alt={`Выбранное фото ${index + 1}`} />
            ) : null}
            <p role="status">Фото {index + 1} · {p.state === "checking" ? "Проверяется…" : p.state === "ready" ? "Готово" : p.state === "rejected" ? "Отклонено" : p.state === "retryable" ? "Можно повторить позже" : "Результат пока неизвестен"}{!p.selected ? " · исключено из публикации" : ""}</p>
            {p.message ? <p>{p.message}</p> : null}
            <div className="gb-comment-photo-composer__actions">
              {p.state !== "checking" && p.state !== "ready" && p.state !== "rejected" && p.key !== "hold" ? (
                <Button type="button" variant="outline" disabled={disabled || (!rights && !p.withdrawKey)} onClick={() => model.retry(p)}>Повторить</Button>
              ) : null}
              <Button type="button" variant="outline" disabled={disabled || p.state === "checking" || p.key === "hold"} onClick={() => model.remove(p)}>Убрать фото {index + 1}</Button>
              {p.selected ? <span className="gb-comment-photo-composer__order" role="group" aria-label={`Порядок фото ${index + 1}`}>
                <Button type="button" variant="outline" aria-label={`Фото ${index + 1} раньше`} disabled={disabled || index === 0} onClick={() => model.move(p, -1)}>←</Button>
                <Button type="button" variant="outline" aria-label={`Фото ${index + 1} позже`} disabled={disabled || index === items.length - 1} onClick={() => model.move(p, 1)}>→</Button>
              </span> : null}
            </div>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}
