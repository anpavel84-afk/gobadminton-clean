import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const controlsPath = fileURLToPath(new URL('../src/components/radar-controls.tsx', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('#602 non-compact RadarControls is a directory row with in-list Switch matching web', () => {
  const controls = read('../src/components/radar-controls.tsx');
  assert.equal(controlsPath.endsWith('radar-controls.tsx'), true);

  const compactEnd = controls.indexOf('</Pressable> : <View');
  assert.ok(compactEnd > 0, 'non-compact branch starts with View after compact Pressable');
  const directory = controls.slice(compactEnd, controls.indexOf('<Modal'));
  const sheet = controls.slice(controls.indexOf('<Modal'));

  assert.match(directory, /accessibilityRole="switch"/);
  assert.match(directory, /accessibilityLabel="Radar"/);
  assert.match(directory, /accessibilityState=\{\{checked:active\}\}/);
  assert.match(directory, /<Switch accessibilityRole="switch"/);
  assert.match(directory, /value=\{active\}/);
  assert.match(directory, /disabled=\{directorySwitchDisabled\}/);
  assert.match(directory, /onValueChange=\{onDirectorySwitch\}/);
  assert.match(directory, /Включить Radar/);
  assert.match(directory, /Radar включён/);
  assert.match(directory, /\{directorySubtitle\}/);
  assert.match(directory, /\{glyph\}/);
  assert.doesNotMatch(directory, /owner\.enable/);

  assert.match(controls, /Игроки поблизости/);
  assert.match(controls, /const directorySwitchDisabled = state\.busy \|\| state\.enabling \|\| !!state\.command \|\| state\.phase === 'restoring' \|\| state\.phase === 'consent'/);
  assert.match(controls, /const directorySubtitle = !active \|\| presentation\.tone === 'active' \? 'Игроки поблизости' : presentation\.caption/);

  const toggle = controls.slice(controls.indexOf('  const onDirectorySwitch ='), controls.indexOf('  const close ='));
  assert.match(toggle, /auth\.signIn\('\/players'\)/);
  assert.match(toggle, /owner\.stop\(\)/);
  assert.match(toggle, /owner\.consent\(\)/);
  assert.match(toggle, /setOpen\(true\)/);
  assert.doesNotMatch(toggle, /owner\.enable/);

  assert.match(sheet, /accessibilityLabel="Согласие на временную публикацию примерного местоположения"/);
  assert.match(sheet, /owner\.enable\(/);
  assert.match(controls, /\{compact \?/);
  assert.match(controls, /width:48,height:48/);
});
