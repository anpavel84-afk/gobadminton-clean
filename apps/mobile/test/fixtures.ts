import type { PublicGame } from '../src/public-api.ts';
export const game: PublicGame = {
  id: 'public-game-1', title: 'Открытая игра', status: 'published', visibility: 'public',
  organizer: { id: null, displayName: 'Организатор', publicContact: 'Контакт из API' },
  venue: { id: 'venue-1', name: 'Зал из API', cityId: 'city-1', address: 'Адрес из API', timezone: 'Europe/Moscow' },
  startsAt: '2026-11-20T15:00:00Z', endsAt: '2026-11-20T17:00:00Z', timezone: 'Europe/Moscow',
  applicationDeadlineAt: '2026-11-20T14:00:00Z', capacity: 8, externalReservedCount: 2,
  confirmedCount: 3, availablePlaces: 3, formatKey: 'doubles',
  levelRule: { scaleId: 'test-scale', scaleVersion: 1, allowedLevelIds: ['test-level'] },
  settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Аренда оплачивается отдельно' },
  activityKind: 'regular', trainer: null, trainingDescription: null,
};
export const cities = [
  { id: 'city-1', nameRu: 'Казань', nameEn: 'Kazan', countryCode: 'RU', defaultTimezone: 'Europe/Moscow' },
  { id: 'city-2', nameRu: 'Волгоград', nameEn: 'Volgograd', countryCode: 'RU', defaultTimezone: 'Europe/Volgograd' },
];
