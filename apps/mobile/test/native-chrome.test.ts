import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(path, out);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

test('#586 Loading is plain status text without card or placeholder bars', () => {
  const ui = read('../src/components/ui.tsx');
  const body = ui.slice(ui.indexOf('export function Loading('), ui.indexOf('export function ErrorState('));
  assert.doesNotMatch(body, /styles\.placeholder/);
  assert.doesNotMatch(body, /styles\.card/);
});

test('#587 Header has no back prop or Назад bar; BackLink is left-aligned', () => {
  const ui = read('../src/components/ui.tsx');
  const header = ui.slice(ui.indexOf('export function Header('), ui.indexOf('/** Web-parity contextual back link'));
  assert.doesNotMatch(header, /\bback\b/);
  assert.doesNotMatch(header, /title="Назад"/);
  const backLink = ui.slice(ui.indexOf('export function BackLink('), ui.indexOf('/** Real create route'));
  assert.match(backLink, /alignSelf:\s*'flex-start'/);
});

test('no Header back= under apps/mobile/app or apps/mobile/src', () => {
  const appDir = new URL('../app', import.meta.url).pathname;
  const srcDir = new URL('../src', import.meta.url).pathname;
  for (const file of [...walkTsx(appDir), ...walkTsx(srcDir)]) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /<Header\s+back/, file);
    assert.doesNotMatch(text, /Header\s+back=/, file);
  }
});

test('#586 native-map loading is a11y-only; failure UI unchanged', () => {
  const map = read('../src/components/native-map.tsx');
  const loadingBranch = map.slice(
    map.indexOf("statusTop !== undefined && !failed && (state.status !== 'ready' || phase !== 'loaded')"),
    map.indexOf("statusTop !== undefined && failed"),
  );
  assert.doesNotMatch(loadingBranch, /<Loading/);
  assert.match(map, /Карта не загрузилась/);
  assert.match(map, /Повторить загрузку карты/);
});

test('#587 tabs have no BackLink; sub-screens use exact titles', () => {
  assert.doesNotMatch(read('../app/my-games.tsx'), /BackLink/);
  assert.doesNotMatch(read('../app/profile.tsx'), /BackLink/);
  const cases: [string, string][] = [
    ['../app/my-games/[gameId]/results.tsx', '← К моим играм'],
    ['../app/city.tsx', '← К играм'],
    ['../app/players/[publicPlayerId].tsx', '← Все игроки'],
    ['../app/games/[id].tsx', '← Все игры'],
    ['../app/games/create/venue/[venueId].tsx', '← Все игры'],
    ['../src/components/create-game.tsx', '← Все игры'],
    ['../src/components/game-management.tsx', '← Мои игры'],
    ['../src/components/contact-editor.tsx', '← К сообщениям'],
  ];
  for (const [rel, title] of cases) {
    const source = read(rel);
    assert.match(source, /<BackLink/, rel);
    assert.match(source, new RegExp(`title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), rel);
  }
  const venueDetail = read('../src/components/venue-detail.tsx');
  assert.match(venueDetail, /<BackLink/);
  assert.match(venueDetail, /← Назад к карте/);
  assert.match(venueDetail, /← К игре/);
  assert.match(read('../src/components/contact-editor.tsx'), /accessibilityLabel="Назад к сообщениям"/);
});
