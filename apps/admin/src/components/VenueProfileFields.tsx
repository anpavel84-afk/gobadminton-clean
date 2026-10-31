"use client";
import { useId } from "react";
import type { MessengerKind, NullableChoice, VenueProfileDraft, VenueProfileErrors } from "../lib/venue-profile-form";

const messengerNames = { telegram: "Telegram", whatsapp: "WhatsApp", vk: "VK" } as const;
export function VenueProfileFields({ draft, errors, disabled, onChange }: {
  draft: VenueProfileDraft;
  errors: VenueProfileErrors;
  disabled: boolean;
  onChange: (draft: VenueProfileDraft) => void;
}) {
  const id = useId();
  const contacts = (values: Partial<VenueProfileDraft>) => onChange({ ...draft, ...values, contactsChanged: true });
  const profile = (values: Partial<VenueProfileDraft>) => onChange({ ...draft, ...values, profileChanged: true });
  const feedback = (key: keyof VenueProfileErrors) => errors[key] && <span className="venue-field-error" id={`${id}-${key}`} role="alert">{errors[key]}</span>;
  return <div className="venue-profile-fields">
    <fieldset disabled={disabled} aria-describedby={`${id}-contacts-help`}>
      <legend>Публичные контакты площадки</legend>
      <p id={`${id}-contacts-help`}>Эти контакты будут видны всем посетителям. Указывайте только публичные контакты организации. Пустое поле удаляет соответствующий публичный контакт при сохранении.</p>
      <label className="form-field"><span>Телефон (виден всем)</span><input type="tel" autoComplete="off" value={draft.phone} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? `${id}-phone` : undefined} onChange={e => contacts({ phone: e.target.value })}/>{feedback("phone")}</label>
      <label className="form-field"><span>Сайт (виден всем)</span><input type="url" autoComplete="off" value={draft.website} aria-invalid={!!errors.website} aria-describedby={errors.website ? `${id}-website` : undefined} onChange={e => contacts({ website: e.target.value })}/>{feedback("website")}</label>
      {draft.messengers.map((item, index) => <div className="venue-messenger" key={index}>
        <label className="form-field"><span>Мессенджер {index + 1} (виден всем)</span><select value={item.kind} aria-invalid={!!errors[`messenger-${index}`]} aria-describedby={errors[`messenger-${index}`] ? `${id}-messenger-${index}` : undefined} onChange={e => contacts({ messengers: draft.messengers.map((row, i) => i === index ? { ...row, kind: e.target.value as MessengerKind } : row) })}>{Object.entries(messengerNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
        <label className="form-field"><span>Ссылка мессенджера {index + 1} (видна всем)</span><input type="url" autoComplete="off" value={item.url} aria-invalid={!!errors[`messenger-${index}`]} aria-describedby={errors[`messenger-${index}`] ? `${id}-messenger-${index}` : undefined} onChange={e => contacts({ messengers: draft.messengers.map((row, i) => i === index ? { ...row, url: e.target.value } : row) })}/>{feedback(`messenger-${index}`)}</label>
        <button type="button" className="button outline" onClick={() => contacts({ messengers: draft.messengers.filter((_, i) => i !== index) })}>Удалить мессенджер {index + 1}</button>
      </div>)}
      <div className="actions"><button type="button" className="button outline" disabled={draft.messengers.length >= 3} onClick={() => {
        const kind = (Object.keys(messengerNames) as MessengerKind[]).find(value => !draft.messengers.some(item => item.kind === value));
        if (kind) contacts({ messengers: [...draft.messengers, { kind, url: "" }] });
      }}>Добавить публичный мессенджер</button><button type="button" className="button outline" onClick={() => contacts({ phone: "", website: "", messengers: [] })}>Очистить публичные контакты</button></div>
    </fieldset>
    <fieldset disabled={disabled} aria-describedby={`${id}-profile-help`}>
      <legend>Публичные сведения о площадке</legend>
      <p id={`${id}-profile-help`}>Пустое число и «Неизвестно» сохраняются как неизвестные сведения. Ноль кортов и «Нет» — явные значения. Неизменённые группы сохраняются без перезаписи.</p>
      <label className="form-field"><span>Краткое публичное описание</span><textarea rows={3} maxLength={500} value={draft.description} aria-invalid={!!errors.description} aria-describedby={errors.description ? `${id}-description` : undefined} onChange={e => profile({ description: e.target.value })}/>{feedback("description")}</label>
      <label className="form-field"><span>Количество кортов</span><input type="text" inputMode="numeric" value={draft.courtCount} aria-invalid={!!errors.courtCount} aria-describedby={errors.courtCount ? `${id}-courtCount` : undefined} onChange={e => profile({ courtCount: e.target.value })}/>{feedback("courtCount")}</label>
      {([['parking', 'Парковка'], ['showers', 'Душевые']] as const).map(([key, label]) => <label className="form-field" key={key}><span>{label}</span><select value={draft[key]} onChange={e => profile({ [key]: e.target.value as NullableChoice })}><option value="unknown">Неизвестно</option><option value="yes">Есть</option><option value="no">Нет</option></select></label>)}
      <button type="button" className="button outline" onClick={() => profile({ courtCount: "", parking: "unknown", showers: "unknown", description: "" })}>Очистить сведения о кортах, удобствах и описании</button>
    </fieldset>
  </div>;
}
