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
  assert.match(directory, /\{glyph\}/);
  assert.doesNotMatch(directory, /owner\.enable/);

  // Compact mobile chip (#404 / APK19): fit-content up to 220, light-green, no visible subtitle.
  assert.match(directory, /alignSelf:'flex-start'/);
  assert.match(directory, /maxWidth:220/);
  assert.match(directory, /borderRadius:12/);
  assert.match(directory, /#eff6e5|DIRECTORY_RADAR_BG/);
  assert.match(directory, /#dce8ca|DIRECTORY_RADAR_BORDER/);
  assert.match(directory, /numberOfLines=\{1\}/);
  assert.match(directory, /fontWeight:'700'/);
  assert.match(directory, /fontSize:12/);
  // Negative/regression: old full-width desktop row + visible subtitle Label was the bug.
  assert.doesNotMatch(directory, /alignSelf:'stretch'/);
  assert.doesNotMatch(directory, /<Label[^>]*>\{directorySubtitle\}<\/Label>/);
  assert.doesNotMatch(directory, /fontSize:12,lineHeight:16,color:colors\.secondary/);
  assert.match(directory, /accessibilityHint=\{directorySubtitle\}/);

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
