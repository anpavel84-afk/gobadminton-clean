import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('player-browse tutorial Modal opts into iosModalOrientations (undefined on Android)', () => {
  assert.ok(root.includes('mobile'));
  const browse = read('../src/components/player-browse.tsx');
  assert.match(browse, /import \{ iosModalOrientations, Label, PrimaryButton, ScreenFrame, TextButton \} from '\.\/ui\.tsx';/);
  assert.match(browse, /<Modal transparent visible=\{focused && tutorialReady===actorKey && tutorial!==0 && !!peer && !match\} animationType="none" supportedOrientations=\{iosModalOrientations\} onRequestClose=\{\(\)=>setTutorial\(0\)\}>/);
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /export const iosModalOrientations = Platform\.OS === 'ios' \? \(\['portrait', 'landscape'\] as const\) : undefined;/);
});

test('ScreenFrame keyboardVerticalOffset is iOS-only; formSheet create path supplies it; ordinary path does not', () => {
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /keyboardVerticalOffset\?: number;/);
  assert.match(ui, /keyboardVerticalOffset=\{Platform\.OS === 'ios' \? keyboardVerticalOffset : undefined\}/);
  assert.match(ui, /behavior=\{Platform\.OS === 'ios' && keyboard \? 'padding' : undefined\}/);

  const create = read('../src/components/create-game.tsx');
  assert.match(create, /const sheetKeyboardOffset = sheet && Platform\.OS === 'ios' \? windowHeight \* 0\.1 : undefined;/);
  assert.match(create, /<ScreenFrame keyboard header=\{sheet \? undefined : <Header \/>\} keyboardVerticalOffset=\{sheetKeyboardOffset\}>/);
  // Ordinary (non-venue) create still goes through the same frame helper; offset stays undefined when !sheet.
  assert.match(create, /const sheet = Boolean\(venueId\);/);
  assert.ok(create.indexOf('const sheet =') < create.indexOf('sheetKeyboardOffset'));

  const venueRoute = read('../app/games/create/venue/[venueId].tsx');
  assert.doesNotMatch(venueRoute, /keyboardVerticalOffset/);
  assert.match(venueRoute, /return <CreateGame key=\{id\} venueId=\{id\} \/>;/);
});

test('Android KeyboardAvoidingView behavior stays undefined; sheet offset never forced on Android', () => {
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /behavior=\{Platform\.OS === 'ios' && keyboard \? 'padding' : undefined\}/);
  assert.match(ui, /keyboardVerticalOffset=\{Platform\.OS === 'ios' \? keyboardVerticalOffset : undefined\}/);
  assert.doesNotMatch(ui, /Platform\.OS === 'android'|Platform\.select\(/);

  const create = read('../src/components/create-game.tsx');
  assert.match(create, /sheet && Platform\.OS === 'ios' \? windowHeight \* 0\.1 : undefined/);
  assert.doesNotMatch(create, /Platform\.OS === 'android'|Platform\.select\(/);

  const layout = read('../app/_layout.tsx');
  assert.match(layout, /presentation: 'formSheet'/);
  assert.match(layout, /sheetAllowedDetents: \[0\.9\]/);
});
