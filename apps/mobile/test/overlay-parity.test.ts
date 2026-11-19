import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('#620 venue-sheet CTA collapses Modal before create navigation with single-flight guard', () => {
  assert.ok(root.endsWith('mobile') || root.includes('mobile'));
  const sheet = read('../src/components/venue-sheet.tsx');
  const handler = sheet.slice(sheet.indexOf('const openExpandedCreate'), sheet.indexOf('const close ='));
  assert.match(handler, /createNavLock\.current/);
  assert.match(handler, /onExpand\(false\)/);
  assert.match(handler, /requestAnimationFrame\(\(\) => \{ router\.push\(path\); \}\)/);
  assert.ok(handler.indexOf('onExpand(false)') < handler.indexOf('requestAnimationFrame'));
  assert.match(sheet, /useFocusEffect/);
  assert.match(sheet, /createNavLock\.current = false/);
  assert.match(sheet, /PrimaryButton title="Создать игру на этой площадке →" align="left" onPress=\{openExpandedCreate\}/);
  assert.match(sheet, /<Modal transparent visible/);
  assert.doesNotMatch(sheet, /onPress=\{\(\) => router\.push\(create\)\}/);
});

test('#620 venue-detail CTA has single-flight create guard', () => {
  const detail = read('../src/components/venue-detail.tsx');
  assert.match(detail, /createNavLock/);
  assert.match(detail, /useFocusEffect/);
  assert.match(detail, /openVenueCreate/);
  assert.match(detail, /PrimaryButton title="Создать игру на этой площадке →" align="left" onPress=\{openVenueCreate\}/);
  assert.doesNotMatch(detail, /onPress=\{\(\) => router\.push\(venueCreatePath\(venue\.id\)!\)\}/);
});

test('#600 games list «На карте» is in-flow without items and floating only with items', () => {
  const games = read('../app/games/index.tsx');
  assert.match(games, /hasListItems/);
  assert.match(games, /!hasListItems && mapEntry\(false\)/);
  assert.match(games, /hasListItems && mapEntry\(true\)/);
  assert.match(games, /hasListItems \? mapEntryHeight \+ insets\.bottom \+ 16/);
  assert.match(games, /accessibilityLabel="Показать площадки на карте"/);
  assert.match(games, /position:'absolute'/);
  assert.equal((games.match(/>На карте</g) ?? []).length, 1);
});

test('#601 players floating «На карте» only when Radar is active; Свайп always', () => {
  const players = read('../app/players/index.tsx');
  assert.match(players, /pointerEvents="box-none"/);
  assert.match(players, /floatingEntryHeight\+insets\.bottom\+48/);
  assert.match(players, /accessibilityLabel="Свайп — просмотр игроков карточками"/);
  assert.match(players, /radarState\.activation\?\.state === 'active' && <Pressable/);
  assert.match(players, />На карте</);
  assert.match(players, />Свайп</);
});
