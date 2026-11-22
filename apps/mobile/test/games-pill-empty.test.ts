import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('#600 settled empty games list renders «На карте» inline after empty-state CTA', () => {
  assert.ok(root.endsWith('mobile') || root.includes('mobile'));
  const games = read('../app/games/index.tsx');
  assert.match(games, /const emptySettled = !!city && state\.status === 'ready' && !items\.length;/);
  const emptyBlockStart = games.indexOf("{state.status === 'ready' && !items.length &&");
  assert.ok(emptyBlockStart >= 0);
  const emptyBlockEnd = games.indexOf('</View>}', emptyBlockStart);
  const emptyBlock = games.slice(emptyBlockStart, emptyBlockEnd);
  assert.match(emptyBlock, /PrimaryButton title="Создать игру"/);
  assert.match(emptyBlock, /mapEntry\('inline'\)/);
  assert.ok(emptyBlock.indexOf('PrimaryButton title="Создать игру"') < emptyBlock.indexOf("mapEntry('inline')"));
  assert.ok(emptyBlock.indexOf('TextButton title="Сбросить фильтр"') < emptyBlock.indexOf("mapEntry('inline')"));
  assert.match(games, /\{!emptySettled && mapEntry\('floating'\)\}/);
  assert.match(games, /placement === 'floating'\s*\?\s*\{position:'absolute',bottom:Platform\.OS === 'ios' \? 16 : insets\.bottom\+16,alignSelf:'center'\}/);
  assert.match(games, /alignSelf:'flex-start'/);
  // NEGATIVE / regression: #653 right:16 emptySettled branch is the bug — must not return
  assert.doesNotMatch(games, /emptySettled \? \{right:16\}/);
  assert.doesNotMatch(games, /right:16/);
  assert.doesNotMatch(emptyBlock, /position:'absolute'/);
  assert.match(games, /paddingBottom: city \? mapEntryHeight \+ insets\.bottom \+ 16 - \(Platform\.OS === 'ios' \? insets\.bottom : 0\) : 16/);
  assert.match(games, /accessibilityLabel="Все игры на карте"/);
  assert.match(games, /onLayout=\{placement === 'floating' \? event => setMapEntryHeight\(event\.nativeEvent\.layout\.height\) : undefined\}/);
  assert.equal((games.match(/>На карте</g) ?? []).length, 1);
  assert.equal((games.match(/accessibilityLabel="Все игры на карте"/g) ?? []).length, 1);
});