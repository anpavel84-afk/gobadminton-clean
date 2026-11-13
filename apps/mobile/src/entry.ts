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
