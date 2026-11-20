import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

const assetPath = (file: string) => fileURLToPath(new URL(`../assets/${file}`, import.meta.url));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const variableSha = '3faa4b905661849b2332e394b42f91b5bf5575e553c516caa81811e868a4d589';
const faces = [
  { weight: 400, file: 'onest-regular.ttf', postScriptName: 'Onest-Regular', subfamily: 'Regular' },
  { weight: 500, file: 'onest-medium.ttf', postScriptName: 'Onest-Medium', subfamily: 'Medium' },
  { weight: 600, file: 'onest-semibold.ttf', postScriptName: 'Onest-SemiBold', subfamily: 'SemiBold' },
  { weight: 700, file: 'onest-bold.ttf', postScriptName: 'Onest-Bold', subfamily: 'Bold' },
  { weight: 800, file: 'onest-extrabold.ttf', postScriptName: 'Onest-ExtraBold', subfamily: 'ExtraBold' },
] as const;

function fontFacts(file: string) {
  const data = readFileSync(assetPath(file));
  const tables = new Map<string, number>();
  for (let index = 0; index < data.readUInt16BE(4); index += 1) {
    const record = 12 + 16 * index;
    tables.set(data.toString('latin1', record, record + 4), data.readUInt32BE(record + 8));
  }
  const name = tables.get('name')!;
  const strings = name + data.readUInt16BE(name + 4);
  const names = new Map<number, string>();
  for (let index = 0; index < data.readUInt16BE(name + 2); index += 1) {
    const record = name + 6 + 12 * index;
    if (data.readUInt16BE(record) !== 3) continue;
    const start = strings + data.readUInt16BE(record + 10);
    names.set(data.readUInt16BE(record + 6), Buffer.from(data.subarray(start, start + data.readUInt16BE(record + 8))).swap16().toString('utf16le'));
  }
  return { names, weightClass: data.readUInt16BE(tables.get('OS/2')! + 4), variable: tables.has('fvar') };
}

// react-native RCTFont.mm RCTGetFontWeight: anchored, case-insensitive PostScript suffix, first match wins.
const rnSuffixWeights: [string, string][] = [
  ['normal', 'regular'], ['ultralight', 'ultralight'], ['extralight', 'ultralight'], ['thin', 'thin'], ['light', 'light'],
  ['regular', 'regular'], ['medium', 'medium'], ['semibold', 'semibold'], ['demibold', 'semibold'], ['extrabold', 'heavy'],
  ['ultrabold', 'heavy'], ['bold', 'bold'], ['heavy', 'heavy'], ['black', 'black'],
];
// RCTAttributedTextUtils.mm RCTUIFontWeightFromInteger buckets for the style fontWeight.
const rnStyleWeights: Record<number, string> = { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'heavy' };

test('iOS static Onest faces keep exact bytes recorded in provenance', () => {
  const provenance = JSON.parse(read('../assets/provenance.json'));
  assert.equal(provenance.assets['onest.ttf'], variableSha);
  for (const face of faces) {
    const sha = createHash('sha256').update(readFileSync(assetPath(face.file))).digest('hex');
    assert.equal(provenance.assets[face.file], sha, face.file);
    const source = provenance.assetSources[face.file];
    assert.equal(source.sha256, sha, face.file);
    assert.equal(source.method, `fontTools varLib.instancer from onest.ttf sha256 ${variableSha}, wght=${face.weight}`);
    assert.equal(source.postScriptName, face.postScriptName);
    assert.equal(source.usWeightClass, face.weight);
  }
});

test('each static face is one Onest family member whose PostScript suffix resolves to its fontWeight on iOS', () => {
  for (const face of faces) {
    const facts = fontFacts(face.file);
    assert.equal(facts.variable, false, face.file);
    assert.equal(facts.weightClass, face.weight, face.file);
    assert.equal(facts.names.get(6), face.postScriptName);
    assert.equal(facts.names.get(16), 'Onest');
    assert.equal(facts.names.get(17), face.subfamily);
    const suffix = rnSuffixWeights.find(([candidate]) => face.postScriptName.toLowerCase().endsWith(candidate));
    assert.equal(suffix?.[1], rnStyleWeights[face.weight], face.postScriptName);
  }
  const variable = fontFacts('onest.ttf');
  assert.equal(variable.variable, true);
  // Same PostScript name as the static Regular: iOS must never register both.
  assert.equal(variable.names.get(6), 'Onest-Regular');
});

test('expo-font plugin embeds the static faces on iOS only and keeps the variable face on Android', () => {
  const plugin = JSON.parse(read('../app.json')).expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-font');
  const props = plugin[1];
  // expo-font withFonts.js: each platform receives [...fonts, ...<platform>.fonts].
  const android = [...(props.fonts ?? []), ...(props.android?.fonts ?? [])];
  const ios = [...(props.fonts ?? []), ...(props.ios?.fonts ?? [])];
  assert.deepEqual(android, ['./assets/onest.ttf']);
  assert.deepEqual(ios, faces.map(face => `./assets/${face.file}`));
});

test('runtime load: Android keeps the variable Onest alias, iOS maps 400-800 to the static faces', () => {
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /import \{ Platform \} from 'react-native';/);
  assert.equal((layout.match(/loadAsync\(/g) ?? []).length, 2);
  assert.match(layout, /: loadAsync\(\{ Onest: require\('\.\.\/assets\/onest\.ttf'\) \}\);/);
  const ios = layout.slice(layout.indexOf("Platform.OS === 'ios'"), layout.indexOf(': loadAsync({ Onest:'));
  assert.match(ios, /^Platform\.OS === 'ios'\s*\?\s*loadAsync\(\[\{ fontFamily: 'Onest', fontDefinitions: \[/);
  assert.doesNotMatch(ios, /onest\.ttf/);
  const mapping = [...ios.matchAll(/\{ path: require\('\.\.\/assets\/(onest-[a-z]+\.ttf)'\), weight: (\d+) \}/g)]
    .map(match => ({ file: match[1], weight: Number(match[2]) }));
  assert.deepEqual(mapping, faces.map(face => ({ file: face.file, weight: face.weight })));
  for (const { file, weight } of mapping) assert.equal(fontFacts(file!).weightClass, weight);
});
