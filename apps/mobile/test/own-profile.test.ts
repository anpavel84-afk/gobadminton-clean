import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { ProfileError, parseOwnProfile } from '../src/profile.ts';
import type { OwnProfile } from '../src/profile.ts';

const emptyProfile: OwnProfile = {
  publicPlayerId: null, version: 0, displayName: '', cityId: null, areaKey: null, level: null, bio: null,
  directoryVisible: true, contactPolicy: 'requests', consentPolicyVersion: null, optedInAt: null,
  radarConsented: false, radarConsentPolicyVersion: null, radarConsentedAt: null, socialEligible: true,
  trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null },
};
const hex64 = 'a'.repeat(64);
const validCover = `/v1/media/covers/${hex64}.png`;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('#605 parseOwnProfile optional cover: valid path kept, invalid/foreign nulled, absent when wire omits, non-object throws', () => {
  const withCover = parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: validCover } });
  assert.deepEqual(withCover.cover, { uploadedUrl: validCover });
  assert.deepEqual(parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: null } }).cover, { uploadedUrl: null });
  assert.equal(parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: '/v1/media/avatars/' + hex64 + '.png' } }).cover?.uploadedUrl, null);
  assert.equal(parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: 'https://evil.example/cover.png' } }).cover?.uploadedUrl, null);
  assert.equal(parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: '/v1/media/covers/' + 'A'.repeat(64) + '.png' } }).cover?.uploadedUrl, null);
  const noCover = parseOwnProfile({ ...emptyProfile });
  assert.equal(Object.hasOwn(noCover, 'cover'), false);
  assert.throws(() => parseOwnProfile({ ...emptyProfile, cover: 'bad' }), ProfileError);
  assert.throws(() => parseOwnProfile({ ...emptyProfile, cover: [] }), ProfileError);
  assert.throws(() => parseOwnProfile({ ...emptyProfile, cover: { uploadedUrl: 1 } }), ProfileError);
});

test('#605 app/profile.tsx own card default; editor and account conditional', () => {
  const route = read('../app/profile.tsx');
  assert.match(route, /Мой профиль/);
  assert.match(route, /<OwnProfileCard/);
  assert.match(route, /<ProfileEditor/);
  assert.match(route, /Управляйте игровыми данными и тем, что видят другие\./);
  assert.match(route, /\{!editing && <OwnProfileCard/);
  assert.match(route, /\{editing &&/);
  assert.match(route, /\{settingsOpen &&/);
  assert.doesNotMatch(route, /BackLink/);
  assert.doesNotMatch(route, /auth\.me\.displayName|auth\.me\.email/);
});

test('#605 own-profile.tsx identity card copy and cover editor', () => {
  const source = read('../src/components/own-profile.tsx');
  assert.match(source, /Изменить профиль/);
  assert.match(source, /Настройки/);
  assert.match(source, /PlayerProfileHero/);
  assert.match(source, /Игровой профиль/);
  assert.match(source, /Не указан/);
  assert.match(source, /Не заполнено/);
  assert.match(source, /Изменить обложку/);
  assert.match(source, /coverImageSource/);
});

test('#522 own-profile trainer card after personal messages', () => {
  const source = read('../src/components/own-profile.tsx');
  assert.match(source, /Опциональная информация игрока/);
  assert.match(source, /Я тренер/);
  assert.match(source, /Профиль тренера выключен/);
  assert.match(source, /nativeAuth\.trainer/);
  const visibilityCard = source.indexOf('accessibilityLabel="Видимость профиля"');
  const messagesCard = source.indexOf('Настройки сообщений');
  const trainerCard = source.indexOf('accessibilityLabel="Тренерский профиль"');
  assert.ok(visibilityCard >= 0 && messagesCard > visibilityCard && trainerCard > messagesCard);
});

test('#522 P2: trainer card stale exposes reachable authoritative refresh CTA', () => {
  const source = read('../src/components/own-profile.tsx');
  const pendingStart = source.indexOf('const pendingTrainerStatus');
  assert.ok(pendingStart >= 0);
  const pendingEnd = source.indexOf('</>;', pendingStart);
  assert.ok(pendingEnd > pendingStart);
  const pendingFragment = source.slice(pendingStart, pendingEnd);
  // Recovery CTAs live in pendingTrainerStatus, then inject into the trainer card.
  assert.match(pendingFragment, /trainerState\.status === 'stale'/);
  assert.match(pendingFragment, /refreshAuthoritative/);
  assert.match(pendingFragment, /Обновить данные/);
  assert.match(pendingFragment, /command\?\.status === 'unknown'/);
  assert.match(pendingFragment, /reconcile/);
  const trainerCard = source.slice(source.indexOf('accessibilityLabel="Тренерский профиль"'));
  assert.match(trainerCard, /\{pendingTrainerStatus\}/);
  // Loading/error/UNKNOWN recovery controls remain reachable on the card.
  assert.match(trainerCard, /status === 'error'/);
  assert.match(trainerCard, /Повторить/);
});

test('#522 P2 R2: same-actor reauth profile-null keeps trainer pending recovery reachable once', () => {
  const own = read('../src/components/own-profile.tsx');
  // Same Looking/contact pattern: pending retry outside profile-only branch; no duplicate title.
  assert.match(own, /!profile && policyPending && pendingPolicyStatus/);
  assert.match(own, /!profile && lookingPending && pendingLookingStatus/);
  assert.match(own, /!profile && trainerPending && pendingTrainerStatus/);
  assert.match(own, /profile && player[\s\S]*pendingTrainerStatus/);
  assert.equal((own.match(/Повторить прежнее сохранение/g) || []).length, 1);
  assert.equal((own.match(/Повторить прежнее отключение/g) || []).length, 1);
  // pendingTrainerStatus owns reconcile; outside branch is composition only.
  const pendingStart = own.indexOf('const pendingTrainerStatus');
  const pendingEnd = own.indexOf('</>;', pendingStart);
  const pendingFragment = own.slice(pendingStart, pendingEnd);
  assert.match(pendingFragment, /trainerOwner\.reconcile\(\)/);
  assert.match(pendingFragment, /command\?\.status === 'unknown'/);
  // Outside-branch render precedes the profile card; inside-card injection remains for profile-present.
  const outsideIdx = own.indexOf('!profile && trainerPending && pendingTrainerStatus');
  const cardIdx = own.indexOf('accessibilityLabel="Тренерский профиль"');
  assert.ok(outsideIdx >= 0 && cardIdx > outsideIdx);
  const insideCard = own.slice(cardIdx);
  assert.match(insideCard, /\{pendingTrainerStatus\}/);
});

test('#605 player-card.tsx exports PlayerCover; PlayerProfile uses shared hero', () => {
  const source = read('../src/components/player-card.tsx');
  assert.match(source, /export function PlayerCover\(/);
  assert.match(source, /export function PlayerBadges\(/);
  assert.match(source, /export function PlayerAvatar\(/);
  assert.match(source, /export const coverFailureXml/);
  const profileFn = source.slice(source.indexOf('export function PlayerProfile('));
  assert.match(profileFn, /<PlayerProfileHero\b/);
  assert.match(read('../src/components/cover-editor.tsx'), /<PlayerCover\b/);
});
