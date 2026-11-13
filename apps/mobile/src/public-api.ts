import type { Game } from '@gobadminton/contracts/game-types';

// Type-only subpath: contracts' root index uses node:fs and must never enter Metro.
export type PublicGame = Pick<Game, 'id' | 'title' | 'status' | 'visibility' | 'venue' |
  'organizer' | 'startsAt' | 'endsAt' | 'timezone' | 'applicationDeadlineAt' |
  'capacity' | 'confirmedCount' | 'externalReservedCount' | 'availablePlaces' |
  'formatKey' | 'levelRule' | 'settlement' | 'activityKind' | 'trainer' | 'trainingDescription'>;
export type City = { id: string; nameRu: string; nameEn: string; countryCode: string; defaultTimezone: string };
export type GamePage = { items: PublicGame[]; nextCursor: string | null };
export const API_ORIGIN = 'https://dev.gobadminton.ru';
export type FailureKind = 'network' | 'unavailable' | 'server' | 'invalid';
export class PublicApiError extends Error {
  readonly kind: FailureKind;
  readonly status?: number;
  constructor(kind: FailureKind, status?: number) {
    super(kind);
    this.name = 'PublicApiError';
    this.kind = kind;
    this.status = status;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicApiError('invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string { return typeof value === 'string'; }
function strings(row: Record<string, unknown>, keys: string[]) { return keys.every(key => text(row[key])); }
function date(value: unknown) { return text(value) && Number.isFinite(Date.parse(value)); }
function zone(value: unknown) {
  try { if (!text(value)) return false; new Intl.DateTimeFormat('ru', { timeZone: value }); return true; }
  catch { return false; }
}
function game(value: unknown): PublicGame {
  const row = object(value), venue = object(row.venue), organizer = object(row.organizer);
  const rule = object(row.levelRule), settlement = object(row.settlement);
  const counts = ['capacity', 'confirmedCount', 'externalReservedCount', 'availablePlaces'];
  if (!strings(row, ['id', 'title', 'formatKey']) || !row.id ||
      !['published', 'cancelled', 'completed'].includes(String(row.status)) || row.visibility !== 'public' ||
      !strings(venue, ['id', 'name', 'cityId', 'address', 'timezone']) ||
      !strings(organizer, ['displayName', 'publicContact']) ||
      !['startsAt', 'endsAt', 'applicationDeadlineAt'].every(key => date(row[key])) || !zone(row.timezone) ||
      !counts.every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0) ||
      !text(rule.scaleId) || !Number.isInteger(rule.scaleVersion) ||
      !Array.isArray(rule.allowedLevelIds) || !rule.allowedLevelIds.every(text) ||
      !text(settlement.terms) || settlement.mode !== 'external' ||
      !['regular', 'trainer_led'].includes(String(row.activityKind)) ||
      !(row.trainingDescription === null || text(row.trainingDescription))) throw new PublicApiError('invalid');
  if (settlement.purpose === 'trainer_fee') {
    if (settlement.priceStatus === 'fixed') {
      if (!text(settlement.priceMinor) || !/^\d+$/.test(settlement.priceMinor) || !text(settlement.currency) ||
          settlement.priceUnit !== 'per_player_per_session') throw new PublicApiError('invalid');
    } else if (settlement.priceStatus !== 'by_agreement') throw new PublicApiError('invalid');
  } else if (settlement.purpose !== 'no_trainer_fee') throw new PublicApiError('invalid');
  if (row.trainer !== null && !strings(object(row.trainer), ['profileId', 'displayName', 'declarationSource'])) {
    throw new PublicApiError('invalid');
  }
  return row as unknown as PublicGame;
}
export function parseCities(value: unknown): City[] {
  const { items } = object(value);
  if (!Array.isArray(items)) throw new PublicApiError('invalid');
  return items.map(item => {
    const row = object(item);
    if (!strings(row, ['id', 'nameRu', 'nameEn', 'countryCode', 'defaultTimezone']) || !row.id) throw new PublicApiError('invalid');
    return row as City;
  });
}
export function parsePage(value: unknown): GamePage {
  const row = object(value);
  if (!Array.isArray(row.items) || !(row.nextCursor === null || text(row.nextCursor))) throw new PublicApiError('invalid');
  return { items: row.items.map(game), nextCursor: row.nextCursor as string | null };
}
export type PublicApi = ReturnType<typeof createPublicApi>;
export function createPublicApi(fetcher: typeof fetch = fetch) {
  // No arbitrary URL, method, headers, body, cookies or account configuration is accepted.
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 15000);
    try {
      const response = await fetcher(`${API_ORIGIN}/v1${path}`, {
        method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
        redirect: 'error', signal: controller.signal,
      });
      if (response.status === 404 || response.status === 410 || response.status === 204) throw new PublicApiError('unavailable', response.status);
      if (!response.ok) throw new PublicApiError('server', response.status);
      const value: unknown = await response.json();
      if (value === null) throw new PublicApiError('unavailable', response.status);
      return value;
    } catch (error) {
      if (error instanceof PublicApiError) throw error;
      throw new PublicApiError(error instanceof SyntaxError ? 'invalid' : 'network');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return {
    async meta(signal?: AbortSignal) {
      const row = object(await get('/meta', signal));
      if (!text(row.apiVersion)) throw new PublicApiError('invalid');
      return { apiVersion: row.apiVersion };
    },
    async cities(signal?: AbortSignal) { return parseCities(await get('/cities', signal)); },
    async games(cityId: string, cursor?: string, signal?: AbortSignal) {
      if (!cityId.trim()) throw new PublicApiError('invalid');
      const query = `cityId=${encodeURIComponent(cityId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      return parsePage(await get(`/games?${query}`, signal));
    },
    async game(id: string, signal?: AbortSignal) {
      if (!id.trim()) throw new PublicApiError('unavailable');
      return game(await get(`/games/${encodeURIComponent(id)}`, signal));
    },
  };
}
export const publicApi = createPublicApi();
