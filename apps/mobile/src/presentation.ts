import type { PublicGame } from './public-api.ts';
export function gameTime(game: PublicGame) {
  const format = new Intl.DateTimeFormat('ru-RU', {
    timeZone: game.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  return `${format.format(new Date(game.startsAt))} — ${format.format(new Date(game.endsAt))} (${game.timezone})`;
}
export function deadline(game: PublicGame) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: game.timezone, dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(game.applicationDeadlineAt));
}
export function settlementLabel(game: PublicGame) {
  const settlement = game.settlement;
  if (settlement.purpose === 'no_trainer_fee') return 'Без тренерского сбора';
  if (settlement.priceStatus === 'by_agreement') return 'Стоимость с тренером — по договорённости';
  const digits = settlement.priceMinor.padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)} ${settlement.currency} / игрока за занятие`;
}
export function statusLabel(game: PublicGame) {
  return { published: 'Опубликована', cancelled: 'Отменена', completed: 'Завершена', draft: 'Черновик' }[game.status];
}
