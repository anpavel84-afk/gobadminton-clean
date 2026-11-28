import {
  canonicalGamePath, canonicalPlayerPath, canonicalPostgamePath, canonicalVenuePath,
} from './native-auth-protocol.ts';
import type { City } from './public-api.ts';
export type Preferences = { storyCompleted: boolean; cityId: string | null };
export const emptyPreferences: Preferences = { storyCompleted: false, cityId: null };
export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return { ...emptyPreferences };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { ...emptyPreferences };
    const row = data as Record<string, unknown>;
    return {
      storyCompleted: row.storyCompleted === true,
      cityId: typeof row.cityId === 'string' && row.cityId.length > 0 && row.cityId.length <= 128 ? row.cityId : null,
    };
  } catch { return { ...emptyPreferences }; }
}
export function entryRoute(preferences: Preferences): '/story' | '/city' | '/games' {
  return preferences.cityId ? '/games' : preferences.storyCompleted ? '/city' : '/story';
}
export function completeStory(preferences: Preferences): Preferences { return { ...preferences, storyCompleted: true }; }
export function filterCities(cities: City[], query: string): City[] {
  const normalized = query.trim().toLocaleLowerCase('ru');
  return cities.filter(city => [city.nameRu, city.nameEn].some(name => name.toLocaleLowerCase('ru').includes(normalized)));
}
export function selectedCity(cities: City[], id: string | null): City | null {
  return cities.find(city => city.id === id) ?? null;
}

/** Cold-launch city field: loading placeholder until catalogue is ready (#624). */
export function cityFieldLabel(opts: {
  hydrated: boolean;
  status: string;
  city: { nameRu: string } | null | undefined;
  savedCityId: string | null | undefined;
  emptyLabel: string;
}): string {
  if (opts.city?.nameRu) return opts.city.nameRu;
  if (!opts.hydrated || opts.status === 'loading' || opts.status === 'idle') return 'Загружаем…';
  if (opts.savedCityId) return 'Выбор недоступен';
  return opts.emptyLabel;
}

/** Only the icon entry resolves onboarding. Deep routes and callback retain their own owners. */
export function hydratedEntryRoute(preferences: Preferences, preferencesHydrated: boolean,
  auth: { status: string; returnPath: string | null }, pathname = '/'): string | null {
  if (pathname !== '/' || !preferencesHydrated || auth.status === 'hydrating') return null;
  if (auth.status === 'signing-in') return '/profile';
  // Exact bare intents only — reserved `/players/browse` stays distinct from player-detail.
  const returnPath = canonicalVenuePath(auth.returnPath)
    ?? canonicalPostgamePath(auth.returnPath)
    ?? (auth.returnPath === '/players/browse' || auth.returnPath === '/friends' ? auth.returnPath : null)
    ?? canonicalPlayerPath(auth.returnPath)
    ?? canonicalGamePath(auth.returnPath);
  if (returnPath) return returnPath;
  if (auth.status === 'authenticated') return '/games';
  return entryRoute(preferences);
}
