import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { colors, interaction, motionPolicy, primaryLabelStyle, primarySurface, typography } from '../src/theme.ts';
import { brandMarkXml } from '../assets/brand-mark.ts';
import { settlementLabel, gameTime } from '../src/presentation.ts';
import { game } from './fixtures.ts';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('every primary state uses pure black, opaque labels; native target sizes', () => {
  assert.equal(colors.purple, '#7945DE'); assert.equal(colors.lime, '#A7F447');
  assert.equal(primaryLabelStyle.color, '#000000'); assert.equal(primaryLabelStyle.opacity, 1);
  for (const [disabled, pressed] of [[false, false], [false, true], [true, false], [true, true]]) {
    const style = primarySurface(disabled!, pressed!);
    assert.equal(style.opacity, 1); assert.ok(style.minHeight >= 52);
    if (disabled) { assert.equal(style.backgroundColor, '#C9DDB1'); assert.equal(style.borderColor, '#8B9C78'); }
  }
  assert.ok(interaction.minHeight >= 48 && interaction.minWidth >= 48);
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /style=\{primaryLabelStyle\}/);
  assert.match(ui, /accessibilityState=\{\{ disabled \}\}/);
});
test('approved assets retain exact bytes and SVG renders with SvgXml, one brand label', () => {
  const assets: Record<string, string> = JSON.parse(read('../assets/provenance.json')).assets;
  for (const [file, sha] of Object.entries(assets)) {
    const data = readFileSync(new URL(`../assets/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), sha);
  }
  assert.equal(brandMarkXml, read('../assets/go-badminton.svg'));
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /<SvgXml xml=\{brandMarkXml\}/);
  assert.equal((ui.match(/accessibilityLabel="GoBadminton"/g) ?? []).length, 1);
});
test('native font/scaling/safe area/keyboard and static Reduce Motion wiring', () => {
  assert.equal(typography.fontFamily, 'Onest'); assert.equal(typography.allowFontScaling, true);
  const ui = read('../src/components/ui.tsx');
  assert.match(ui, /paddingBottom: insets.bottom \+ 24/);
  assert.match(ui, /paddingTop: insets.top/);
  assert.match(ui, /KeyboardAvoidingView/);
  assert.match(ui, /flexGrow: 1/);
  assert.doesNotMatch(ui, /maxFontSizeMultiplier|Animated\./);
  assert.deepEqual(motionPolicy, { orbitAnimated: false, arrivalAnimated: false, shimmerAnimated: false });
  const hooks = read('../src/hooks.ts');
  assert.match(hooks, /AccessibilityInfo.isReduceMotionEnabled/);
  assert.match(hooks, /addEventListener\('reduceMotionChanged'/);
  assert.match(read('../app/_layout.tsx'), /loadAsync\(\{ Onest: require\('\.\.\/assets\/onest.ttf'\)/);
});
test('story shortcuts on every step, direct details bypass entry, city selection remains outside request states', () => {
  const story = read('../app/story.tsx');
  assert.match(story, /title="Пропустить" onPress=\{finish\}/);
  assert.match(story, /title="Продолжить гостем" onPress=\{finish\}/);
  assert.match(story, /router.replace\('\/city'\)/);
  const details = read('../app/games/[id].tsx');
  assert.doesNotMatch(details, /usePreferences|Redirect|storyCompleted/);
  assert.match(details, /publicApi.game\(id, signal\)/);
  const catalog = read('../app/games/index.tsx');
  const content = catalog.slice(catalog.indexOf('return <Page>'));
  assert.ok(content.indexOf('title="Выбрать другой город"') < content.indexOf("state.status === 'loading'"));
});
test('conditions use server counts, timezone and external price terms without implying a free game', () => {
  assert.equal(settlementLabel(game), 'Без тренерского сбора');
  assert.match(gameTime(game), /18:00/);
  assert.match(gameTime(game), /Europe\/Moscow/);
  const fixed = { ...game, settlement: { mode: 'external', purpose: 'trainer_fee', priceStatus: 'fixed',
    priceUnit: 'per_player_per_session', priceMinor: '150050', currency: 'RUB', terms: '' } } as const;
  assert.equal(settlementLabel(fixed), '1500.50 RUB / игрока за занятие');
});
