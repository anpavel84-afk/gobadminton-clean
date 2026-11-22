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

test('#660 r3: inline «Свайп» stays mounted (hidden) while floating (Codex r2 finding 1)', () => {
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  const swipeStart = header.indexOf('accessibilityLabel="Свайп — просмотр игроков карточками"');
  assert.ok(swipeStart >= 0, 'inline Свайп in header');
  const pressableStart = header.lastIndexOf('<Pressable', swipeStart);
  const pressableEnd = header.indexOf('</Pressable>', swipeStart) + '</Pressable>'.length;
  const inline = header.slice(pressableStart, pressableEnd);
  // Always mounted: hide visually/a11y/touch when floating — do not unmount.
  assert.match(inline, /accessibilityElementsHidden=\{showFloatingSwipe\}/);
  assert.match(inline, /importantForAccessibility=\{showFloatingSwipe \? 'no-hide-descendants' : 'yes'\}/);
  assert.match(inline, /disabled=\{showFloatingSwipe\}/);
  assert.match(inline, /pointerEvents=\{showFloatingSwipe \? 'none' : 'auto'\}/);
  assert.match(inline, /opacity:showFloatingSwipe \? 0 : 1/);
  assert.match(inline, /onLayout=\{event => setInlineSwipeBottom\(22 \+ event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)\}/);
  assert.equal((header.match(/accessibilityLabel="Свайп — просмотр игроков карточками"/g) ?? []).length, 1);
  assert.equal((players.match(/accessibilityLabel="Свайп — просмотр игроков карточками"/g) ?? []).length, 2);
  // NEGATIVE / regression: conditional unmount of the inline Pressable
  assert.doesNotMatch(header, /!showFloatingSwipe && <Pressable/);
});

test('#660 r3: no fixed-height placeholder slot — font scaling safe (Codex r2 finding 1)', () => {
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  const swipeStart = header.indexOf('accessibilityLabel="Свайп — просмотр игроков карточками"');
  const pressableStart = header.lastIndexOf('<Pressable', swipeStart);
  const beforeSwipe = header.slice(0, pressableStart);
  // NEGATIVE / regression: r2 slot View with minHeight:48 collapsed from ~72px (fontScale=2) to 48px when button unmounted.
  assert.doesNotMatch(beforeSwipe, /<View onLayout=\{event => setInlineSwipeBottom/);
  assert.doesNotMatch(header, /setInlineSwipeBottom[^;]+;\s*style=\{\{[^}]*minHeight:48/);
  assert.doesNotMatch(header, /minHeight:48\}>\s*\{!showFloatingSwipe/);
  // onLayout lives on the always-mounted Pressable (actual scaled height), not a fixed slot.
  assert.match(header.slice(pressableStart), /onLayout=\{event => setInlineSwipeBottom\(22 \+ event\.nativeEvent\.layout\.y \+ event\.nativeEvent\.layout\.height\)\}/);
});

test('#660 r4: no useless escaped greater-than in swipe-inline regexes (Codex r3s finding 1)', () => {
  // NEGATIVE / regression: eslint no-useless-escape on greater-than outside a character class.
  // Build the forbidden backslash+greater-than sequence without embedding it in this file.
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const uselessGt = String.fromCharCode(0x5c, 0x3e);
  assert.equal(self.includes(uselessGt), false, 'swipe-inline tests must not contain useless escaped greater-than');
  // Semantics of the r3 slot NEGATIVE stay identical without the escape.
  const players = read('../app/players/index.tsx');
  const headerStart = players.indexOf('ListHeaderComponent=');
  const headerEnd = players.indexOf('renderItem=', headerStart);
  const header = players.slice(headerStart, headerEnd);
  assert.doesNotMatch(header, /minHeight:48\}>\s*\{!showFloatingSwipe/);
});

test('#522 bounded swipe media warmup does not retarget inline Свайп CTA or browse gestures/commands', () => {
  const players = read('../app/players/index.tsx');
  // Inline/floating entry path unchanged — still stages catalog and opens browse.
  assert.match(players, /const openSwipeBrowse = \(\) => \{ browse\.stage\(filters, list\?\.data \?\? null\); router\.push\('\/players\/browse'\); \};/);
  assert.equal((players.match(/onPress=\{openSwipeBrowse\}/g) ?? []).length, 2);
  assert.doesNotMatch(players, /createBrowseMediaWarmup|Image\.prefetch|player-browse-media/);

  const browse = read('../src/components/player-browse.tsx');
  assert.match(browse, /createBrowseMediaWarmup/);
  assert.match(browse, /mediaWarmup\.current\.sync\(/);
  // Prefetch must not wrap or replace PanResponder / owner.act ownership.
  assert.match(browse, /PanResponder\.create\(/);
  assert.match(browse, /new BrowseGesture\(/);
  assert.match(browse, /void owner\.act\(kind==='request'\?'send':'withdraw'/);
  const action = browse.slice(browse.indexOf("const action = (kind:'skip'|'request'|'withdraw'"), browse.indexOf('const callbacks:PanResponderCallbacks'));
  assert.doesNotMatch(action, /mediaWarmup|prefetch|await.*warmup/i);
  // Visible card remains a single keyed Animated.View (no prepared-peer commit swap).
  assert.equal((browse.match(/<Animated\.View key=\{/g) ?? []).length, 1);
});
