import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { profileHeroMeta } from '../src/presentation.ts';
import { profileHeroDecorationXml } from '../src/profile-hero-art.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const bb5a8Path = fileURLToPath(new URL('../../web/public/canonical/bb5a8.svg', import.meta.url));
const bb5a8Bytes = readFileSync(bb5a8Path, 'utf8');

test('#621 profileHeroMeta uses «не указан» and joins city/area', () => {
  assert.equal(profileHeroMeta(null, 'Москва'), 'не указан · Москва');
  assert.equal(profileHeroMeta(undefined, 'Москва', 'Арбат'), 'не указан · Москва · Арбат');
  assert.equal(
    profileHeroMeta({ scaleId: 'gb-social-pilot', scaleVersion: 1, levelId: 'intermediate' }, 'Казань'),
    'Средний · Казань',
  );
  assert.equal(profileHeroMeta(null), 'не указан');
  assert.equal(profileHeroMeta(null, '', null), 'не указан');
});

test('#621 bb5a8 art string matches canonical bytes; ce252 only as uploaded-cover failure', () => {
  assert.equal(profileHeroDecorationXml, bb5a8Bytes);
  const art = read('../src/profile-hero-art.ts');
  assert.match(art, /bb5a8|FFEEC9|F7AB38/);
  assert.doesNotMatch(art, /AB3232|Ellipse 63/);
  const card = read('../src/components/player-card.tsx');
  const heroFn = card.slice(card.indexOf('export function PlayerProfileHero('));
  assert.match(heroFn, /profileHeroDecorationXml/);
  assert.match(heroFn, /coverFailureXml/);
  assert.match(heroFn, /opacity:\s*0\.18/);
  assert.match(heroFn, /borderWidth:\s*6/);
  assert.match(heroFn, /colors\.ink/);
  assert.match(heroFn, /colors\.lime/);
  assert.match(heroFn, /size=\{120\}/);
  // No uploaded cover → decoration; failure path uses coverFailureXml (ce252), not as default empty cover.
  assert.match(heroFn, /showFailure/);
  assert.match(heroFn, /uploadedUrl/);
  assert.match(card, /export const coverFailureXml/);
  assert.match(card, /AB3232/);
  assert.match(read('../src/components/player-hero.tsx'), /export \{ PlayerProfileHero \}/);
});

test('#621 PlayerProfileHero shared by OwnProfileCard and PlayerProfile; actions outside hero', () => {
  const own = read('../src/components/own-profile.tsx');
  assert.match(own, /PlayerProfileHero/);
  assert.match(own, /accessibilityLabel="Действия профиля"/);
  const heroIdx = own.indexOf('<PlayerProfileHero');
  const actionsIdx = own.indexOf('accessibilityLabel="Действия профиля"');
  assert.ok(heroIdx >= 0 && actionsIdx > heroIdx);
  assert.match(own, /Изменить профиль/);
  assert.match(own, /Изменить обложку/);
  assert.match(own, /Настройки/);
  const ownHeroBlock = own.slice(heroIdx, actionsIdx);
  assert.doesNotMatch(ownHeroBlock, /Изменить профиль|Изменить обложку|Настройки/);
  const card = read('../src/components/player-card.tsx');
  assert.match(card, /export function PlayerProfileHero\(/);
  const profileFn = card.slice(card.indexOf('export function PlayerProfile('));
  assert.match(profileFn, /<PlayerProfileHero\b/);
});

test('#622 hardware Back closes editor; settings scrolls to «Вход в аккаунт»', () => {
  const route = read('../app/profile.tsx');
  assert.match(route, /BackHandler/);
  assert.match(route, /hardwareBackPress/);
  assert.match(route, /useFocusEffect/);
  assert.match(route, /ProfileHardwareBack/);
  assert.match(route, /onClose\(\)/);
  assert.match(route, /← Мой профиль/);
  assert.match(route, /ScreenFrame as Page/);
  assert.match(route, /ProfileScroll/);
  assert.match(route, /scrollRef/);
  assert.match(route, /onLayout/);
  assert.match(route, /Вход в аккаунт/);
  assert.match(route, /scrollTo/);
  assert.match(route, /settingsY|scrollSettingsOnLayout/);
});
