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

test('#660 r2: floating threshold includes list content paddingTop origin (Codex finding 1)', () => {
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  assert.match(players, /contentContainerStyle=\{\{ paddingHorizontal: 16, paddingTop: 22,/);
  // Threshold must add the 22px content-coordinate origin; header-relative y alone is the bug.
  assert.match(header, /onLayout=\{event => setInlineSwipeBottom\(22 \+ event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)\}/);
  // NEGATIVE / regression: bare header-relative bottom without content padding origin
  assert.doesNotMatch(header, /setInlineSwipeBottom\(event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)/);
});

test('#660 r2: measurable layout slot preserved; exactly one button (Codex finding 2)', () => {
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  const slotStart = header.indexOf('setInlineSwipeBottom');
  assert.ok(slotStart >= 0, 'inline swipe measurement present');
  const slotBlock = header.slice(header.lastIndexOf('<View', slotStart), header.indexOf('Все игроки'));
  // Slot View owns onLayout and minHeight so space + measurement survive floating mode.
  assert.match(slotBlock, /<View onLayout=\{event => setInlineSwipeBottom\(22 \+ event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)\}/);
  assert.match(slotBlock, /minHeight:48/);
  assert.match(slotBlock, /!showFloatingSwipe && <Pressable/);
  // Exactly one inline button instance in header; floating is the other (outside header).
  assert.equal((header.match(/accessibilityLabel="Свайп — просмотр игроков карточками"/g) ?? []).length, 1);
  assert.equal((players.match(/accessibilityLabel="Свайп — просмотр игроков карточками"/g) ?? []).length, 2);
  // NEGATIVE / regression: unmounting the Pressable must not remove the only onLayout (old bug).
  assert.doesNotMatch(header, /!showFloatingSwipe && <Pressable[^>]*onLayout=\{event => setInlineSwipeBottom/);
});
