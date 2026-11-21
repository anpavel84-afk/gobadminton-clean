import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('ScreenFrame content view keeps overflow hidden on Android and visible on iOS for FAB shadows', () => {
  assert.ok(root.includes('mobile'));
  const ui = read('../src/components/ui.tsx');
  assert.match(
    ui,
    /<View style=\{\{ flex: 1, overflow: Platform\.OS === 'ios' \? 'visible' : 'hidden' \}\}>\{children\}<\/View>/,
  );
  assert.doesNotMatch(ui, /Platform\.OS === 'android'|Platform\.select\(/);
  // Android branch of the ternary remains overflow 'hidden' (same clipping as before).
  assert.match(ui, /Platform\.OS === 'ios' \? 'visible' : 'hidden'/);
});
