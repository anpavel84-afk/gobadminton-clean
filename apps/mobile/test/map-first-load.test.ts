import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const mapPath = fileURLToPath(new URL('../app/games/map.tsx', import.meta.url));
const map = readFileSync(mapPath, 'utf8');

test('#651 + #612 map first load: city-guarded fallback, a11y cities status, no visible cities Loading', () => {
  assert.match(map, /city && \(!pack \|\| catalog\)/);

  const fallbackStart = map.indexOf('city && (!pack || catalog) && <FlatList');
  assert.ok(fallbackStart >= 0);
  const renderItem = map.indexOf('renderItem=', fallbackStart);
  assert.ok(renderItem > fallbackStart);
  const fallbackEnd = map.indexOf('/>', map.indexOf('</Pressable>', renderItem));
  assert.ok(fallbackEnd > renderItem);
  const fallback = map.slice(fallbackStart, fallbackEnd + 2);
  assert.match(fallback, /accessibilityRole="header"[^>]*>Площадки списком</);
  assert.match(fallback, /Для выбранного города карта пока недоступна\./);

  const outsideFallback = map.slice(0, fallbackStart) + map.slice(fallbackEnd + 2);
  assert.doesNotMatch(outsideFallback, /Для выбранного города карта пока недоступна\./);
  assert.doesNotMatch(outsideFallback, /accessibilityRole="header"[^>]*>Площадки списком</);

  const citiesLoadingStart = map.indexOf("(!hydrated || cities.state.status === 'loading')");
  assert.ok(citiesLoadingStart >= 0);
  const citiesLoadingEnd = map.indexOf("cities.state.status === 'error'", citiesLoadingStart);
  assert.ok(citiesLoadingEnd > citiesLoadingStart);
  const citiesLoading = map.slice(citiesLoadingStart, citiesLoadingEnd);
  assert.doesNotMatch(citiesLoading, /<Loading/);
  assert.match(citiesLoading, /pointerEvents="none"/);
  assert.match(citiesLoading, /accessibilityLiveRegion="polite"/);
  assert.match(citiesLoading, /width:1,height:1/);
  assert.match(citiesLoading, /overflow:'hidden'/);
  assert.match(citiesLoading, /<Label>Загружаем города…<\/Label>/);

  // NEGATIVE / regression: visible Loading title must not return for cities load (#612/#651 overlap).
  assert.doesNotMatch(map, /<Loading title="Загружаем города…"/);
});
