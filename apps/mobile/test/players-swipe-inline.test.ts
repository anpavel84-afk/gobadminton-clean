import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('#660 inline «Свайп» CTA sits in the list header before «Все игроки»', () => {
  assert.ok(root.endsWith('mobile') || root.includes('mobile'));
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  const swipeIdx = header.indexOf('accessibilityLabel="Свайп — просмотр игроков карточками"');
  const allPlayersIdx = header.indexOf('>Все игроки<');
  assert.ok(swipeIdx >= 0, 'inline Свайп a11y label in ListHeaderComponent');
  assert.ok(allPlayersIdx >= 0, 'Все игроки heading in ListHeaderComponent');
  assert.ok(swipeIdx < allPlayersIdx, 'inline Свайп CTA before Все игроки');
  assert.match(header, /!showFloatingSwipe && <Pressable/);
  assert.match(header, /onPress=\{openSwipeBrowse\}/);
  assert.match(header, /onLayout=\{event => setInlineSwipeBottom\(event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)\}/);
  assert.match(header, />Свайп</);
});

test('#660 floating «Свайп» is scroll-gated; shared handler; Radar pill stays floating', () => {
  const players = read('../app/players/index.tsx');
  assert.match(players, /const showFloatingSwipe = scrollOffset > inlineSwipeBottom;/);
  assert.match(players, /onScroll=\{event => setScrollOffset\(event\.nativeEvent\.contentOffset\.y\)\} scrollEventThrottle=\{100\}/);
  assert.match(players, /const openSwipeBrowse = \(\) => \{ browse\.stage\(filters, list\?\.data \?\? null\); router\.push\('\/players\/browse'\); \};/);
  const floatingStart = players.indexOf('setFloatingEntryHeight');
  const floating = players.slice(players.indexOf('<View pointerEvents="box-none" onLayout={event => setFloatingEntryHeight', floatingStart));
  assert.match(floating, /showFloatingSwipe && <Pressable accessibilityRole="button" accessibilityLabel="Свайп — просмотр игроков карточками"/);
  assert.match(floating, /onPress=\{openSwipeBrowse\}/);
  assert.match(floating, /radarState\.activation\?\.state === 'active' && <Pressable/);
  assert.match(floating, /accessibilityLabel="Показать игроков и площадки на карте"/);
  // NEGATIVE / regression: floating «Свайп» must not cover the first card at rest
  assert.doesNotMatch(floating, /pointerEvents="box-none"[^>]*>\s*<Pressable accessibilityRole="button" accessibilityLabel="Свайп — просмотр игроков карточками"/);
  assert.equal((players.match(/onPress=\{openSwipeBrowse\}/g) ?? []).length, 2);
  assert.doesNotMatch(players, /browse\.stage\(filters,list\?\.data \?\? null\); router\.push\('\/players\/browse'\)/);
});
