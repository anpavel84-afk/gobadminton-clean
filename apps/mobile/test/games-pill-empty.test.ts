import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('#600 settled empty games list anchors «На карте» pill to the right edge', () => {
  assert.ok(root.endsWith('mobile') || root.includes('mobile'));
  const games = read('../app/games/index.tsx');
  assert.match(games, /const emptySettled = !!city && state\.status === 'ready' && !items\.length;/);
  assert.match(games, /\.\.\.\(emptySettled \? \{right:16\} : \{alignSelf:'center'\}\)/);
  assert.match(games, /position:'absolute',bottom:Platform\.OS === 'ios' \? 16 : insets\.bottom\+16/);
  assert.match(games, /alignSelf:'center'/);
  assert.match(games, /right:16/);
  // NEGATIVE / regression: empty-state branch must not use an unconditional centered pill
  assert.doesNotMatch(games, /position:'absolute',bottom:Platform\.OS === 'ios' \? 16 : insets\.bottom\+16,alignSelf:'center'/);
  assert.match(games, /paddingBottom: city \? mapEntryHeight \+ insets\.bottom \+ 16 - \(Platform\.OS === 'ios' \? insets\.bottom : 0\) : 16/);
  assert.match(games, /accessibilityLabel="Все игры на карте"/);
  assert.match(games, /onLayout=\{event => setMapEntryHeight\(event\.nativeEvent\.layout\.height\)\}/);
});
