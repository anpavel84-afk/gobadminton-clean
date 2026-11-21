import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('iOS hero/title lineHeights leave room under RN NSParagraphStyle min=max lock', () => {
  assert.ok(root.includes('mobile'));
  const games = read('../app/games/index.tsx');
  assert.match(games, /fontSize: 36, lineHeight: Platform\.OS === 'ios' \? 44 : 39/);
  const players = read('../app/players/index.tsx');
  assert.match(players, /fontSize: 32, lineHeight: Platform\.OS === 'ios' \? 39 : 35/);
  const match = read('../src/components/friendly-match.tsx');
  assert.match(match, /fontSize:compact\?44:52,lineHeight:\(compact\?44:52\)\+\(Platform\.OS==='ios'\?8:2\)/);
  assert.equal((match.match(/lineHeight:\(compact\?44:52\)\+\(Platform\.OS==='ios'\?8:2\)/g) ?? []).length, 2);
});

test('iOS floating map/swipe CTAs sit at bottom 16; tab bar already owns the home indicator', () => {
  const nav = read('../src/components/main-navigation.tsx');
  assert.match(nav, /paddingBottom: insets\.bottom \+ 5/);
  const games = read('../app/games/index.tsx');
  assert.match(games, /bottom:Platform\.OS === 'ios' \? 16 : insets\.bottom\+16/);
  assert.match(games, /paddingBottom: city \? mapEntryHeight \+ insets\.bottom \+ 16 - \(Platform\.OS === 'ios' \? insets\.bottom : 0\) : 16/);
  const players = read('../app/players/index.tsx');
  assert.match(players, /bottom:Platform\.OS === 'ios' \? 16 : insets\.bottom\+16/);
  assert.match(players, /Platform\.OS === 'ios' \? floatingEntryHeight\+48 : floatingEntryHeight\+insets\.bottom\+48/);
});

test('players city/area search chrome is iOS-only; name field I4 wiring unchanged', () => {
  const players = read('../app/players/index.tsx');
  const city = players.slice(players.indexOf('accessibilityLabel="Поиск города"'), players.indexOf('accessibilityLabel="Имя игрока"'));
  assert.match(city, /clearButtonMode=\{Platform\.OS === 'ios' \? 'while-editing' : undefined\}/);
  assert.match(city, /returnKeyType=\{Platform\.OS === 'ios' \? 'search' : undefined\}/);
  assert.match(city, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(city, /autoCapitalize=\{Platform\.OS === 'ios' \? 'none' : undefined\}/);
  const name = players.slice(players.indexOf('accessibilityLabel="Имя игрока"'), players.indexOf('accessibilityLabel="Район / метро"'));
  assert.match(name, /clearButtonMode="while-editing"/);
  assert.match(name, /returnKeyType=\{Platform\.OS === 'ios' \? 'search' : undefined\}/);
  const area = players.slice(players.indexOf('accessibilityLabel="Район / метро"'), players.indexOf('DiscoveryChip title="Все"'));
  assert.match(area, /clearButtonMode=\{Platform\.OS === 'ios' \? 'while-editing' : undefined\}/);
  assert.match(area, /returnKeyType=\{Platform\.OS === 'ios' \? 'search' : undefined\}/);
  assert.match(area, /autoCorrect=\{Platform\.OS === 'ios' \? false : undefined\}/);
  assert.match(area, /autoCapitalize=\{Platform\.OS === 'ios' \? 'words' : undefined\}/);
});

test('Android typography and FAB expressions stay on the non-ios branches', () => {
  const games = read('../app/games/index.tsx');
  assert.match(games, /lineHeight: Platform\.OS === 'ios' \? 44 : 39/);
  assert.match(games, /insets\.bottom\+16/);
  assert.match(games, /mapEntryHeight \+ insets\.bottom \+ 16/);
  const players = read('../app/players/index.tsx');
  assert.match(players, /lineHeight: Platform\.OS === 'ios' \? 39 : 35/);
  assert.match(players, /floatingEntryHeight\+insets\.bottom\+48/);
  const match = read('../src/components/friendly-match.tsx');
  assert.match(match, /Platform\.OS==='ios'\?8:2/);
  for (const file of ['../app/games/index.tsx', '../app/players/index.tsx', '../src/components/friendly-match.tsx'] as const) {
    assert.doesNotMatch(read(file), /Platform\.OS === 'android'|Platform\.OS !== 'ios'|Platform\.select\(/, file);
  }
});
