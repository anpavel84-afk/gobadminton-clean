"use client";
import { Button } from "../Button";
import type { CandidateEvidence } from "../../../lib/venue-photo-candidates-api";
import type { VenuePhotoCandidateModel } from "./useVenuePhotoCandidate";

/** Existing form/media primitives inside the existing host; game-cover state is separate. */
export function VenueCandidatePhotoField({ model, disabled = false, compact = false }: {
  model: VenuePhotoCandidateModel; disabled?: boolean; compact?: boolean;
}) {
  const locked = disabled || model.locked;
  const showEditor = !compact || (model.canCorrectUpload && model.stage !== "failed");
  const textFields: Array<{ key: keyof Pick<CandidateEvidence, "creditText" | "creditUrl" | "sourceUrl" | "sourceAuthor" | "permissionBasis">; label: string; max: number }> = [
    { key: "creditText", label: "Подпись фото (Фото: имя автора)", max: 120 },
    { key: "creditUrl", label: "Ссылка на автора / подпись (HTTPS)", max: 300 },
    { key: "sourceUrl", label: "Ссылка на источник фото (HTTPS)", max: 300 },
    { key: "sourceAuthor", label: "Автор источника (необязательно)", max: 120 },
    { key: "permissionBasis", label: "Основание разрешения на публикацию", max: 600 },
  ];
  return <section className="gb-game-form-group gb-venue-candidate" aria-label="Фото площадки" aria-busy={model.stage === "sending" || model.stage === "preparing"}>
    <h2 className="gb-game-form-group-title">Фото площадки · необязательно</h2>
    <p>Предложение фото не меняет фото этой игры. До принятия сотрудником оно приватное; официальная галерея и обложка остаются прежними.</p>
    {compact && model.canCorrectUpload && model.stage === "failed" && <Button variant="outline" disabled={locked} onClick={model.invalidateConfirmation}>Исправить фото площадки</Button>}
    {showEditor && <>
      <label className="gb-game-field">Выбрать фото площадки<input type="file" aria-label="Выбрать фото площадки" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (file) model.select(file);
      }} /><small>Исходник: JPEG, PNG, WebP до 10 МиБ и 50 Мп. Подготовим фрагмент 1200 × 400 до 512 КиБ без EXIF и геометок. API принимает до 5 МиБ.</small></label>
      {model.hasFile && <>
        <label className="gb-game-field">Фрагмент площадки по горизонтали<input type="range" min="0" max="1" step=".01" value={model.crop.x} disabled={locked} onChange={e => model.changeCrop({ ...model.crop, x: Number(e.target.value) })} /></label>
        <label className="gb-game-field">Фрагмент площадки по вертикали<input type="range" min="0" max="1" step=".01" value={model.crop.y} disabled={locked} onChange={e => model.changeCrop({ ...model.crop, y: Number(e.target.value) })} /></label>
        {textFields.map(field => <label className="gb-game-field" key={field.key}>{field.label}<input type="text" maxLength={field.max} value={model.evidence[field.key] ?? ""} disabled={locked} onChange={e => model.changeEvidence({ ...model.evidence, [field.key]: field.key === "sourceAuthor" ? e.target.value || null : e.target.value })} /></label>)}
        <p>Укажите реальные источник, автора и основание разрешения. Без обязательных ссылок и прав можно продолжить создание игры без фото площадки.</p>
        <label className="gb-game-field"><span><input type="checkbox" checked={model.rights} disabled={locked} onChange={e => model.changeRights(e.target.checked)} /> Подтверждаю право передать и опубликовать фото и согласие узнаваемых людей. EXIF и геометки будут удалены.</span></label>
        <Button disabled={locked || !model.canConfirm} onClick={model.confirm}>Подтвердить фото площадки и права</Button>
      </>}
      {model.hasFile && <Button variant="outline" disabled={locked} onClick={model.clear}>Без фото площадки</Button>}
    </>}
    {model.preview && <div className="gb-venue-media"><img src={model.preview} alt={model.receipt ? "Приватное фото площадки на рассмотрении" : "Подготовленный фрагмент фото площадки"} style={{ width: "100%", aspectRatio: "3 / 1", objectFit: "cover" }} /></div>}
    <p role="status">{model.stage === "preparing" ? "Подготавливаем фото площадки…" : model.stage === "sending" ? "Проверяем предложение фото…" : model.notice}</p>
    {!showEditor && model.hasFile && model.stage === "prepared" && <p>Фото не подтверждено и отправлено не будет. Вернитесь к редактированию или продолжите без него.</p>}
    {model.canonicalVenueId && <p>Площадка сохранена. Действия с фото не создают её или игру повторно.</p>}
    {model.stage === "confirmed" && model.canonicalVenueId && <Button disabled={disabled} onClick={model.send}>Отправить подтверждённое фото</Button>}
    {model.stage === "unknown" && <Button variant="outline" disabled={disabled} onClick={model.retry}>Проверить / повторить ту же команду фото</Button>}
    {model.receipt && <>
      <p>Статус: {({ awaiting_review: "на рассмотрении", accepted: "принято", rejected: "отклонено", withdrawn: "снято" })[model.receipt.status]}</p>
      <Button variant="outline" disabled={disabled || model.busy} onClick={model.refresh}>Обновить статус фото</Button>
      {model.receipt.status === "awaiting_review" && model.stage !== "unknown" && <Button variant="outline" disabled={disabled || model.busy} onClick={model.withdraw}>Снять предложение фото</Button>}
    </>}
  </section>;
}
