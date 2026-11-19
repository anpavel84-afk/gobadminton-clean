import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('#603 #604 #606 #588 Group B2 source assertions', () => {
  const myGames = read('../app/my-games.tsx');
  const messages = read('../src/components/messages.tsx');
  const city = read('../app/city.tsx');
  const editor = read('../src/components/profile-editor.tsx');
  const cityRow = read('../src/components/city-row.tsx');
  const radar = read('../src/components/radar-controls.tsx');
  const ui = read('../src/components/ui.tsx');

  // #603 MYGAMES-01
  assert.match(myGames, /PrimaryButton title="Создать игру"/);
  assert.match(myGames, /flexDirection:\s*'row'/);
  assert.match(myGames, /label:\s*'Приглашения'/);
  assert.match(myGames, /router\.push\('\/messages'\)/);
  assert.match(myGames, /После игры ждут ответа · \{attention\.length\}/);
  assert.match(myGames, /К итогам ↓/);
  assert.match(myGames, /colors\.lavender/);
  assert.match(myGames, /title="Найти игру"/);
  assert.match(myGames, /router\.push\('\/games'\)/);
  assert.doesNotMatch(myGames, /TextButton title="Найти игру"/);
  assert.doesNotMatch(myGames, /TextButton title="Создать игру"/);
  assert.doesNotMatch(myGames, /TextButton title="К итогам"/);
  assert.doesNotMatch(myGames, /в загруженных источниках/);

  // #604 MSG-01
  assert.match(messages, /header=\{<Header \/>\}/);
  assert.match(messages, /Личные и игровые/);
  assert.match(messages, />Сообщения</);
  assert.match(messages, /Фильтр сообщений/);
  assert.match(messages, /Непрочитанные/);
  assert.match(messages, /Требуют ответа/);
  assert.match(messages, /DiscoverySheet/);
  assert.match(messages, /filterLoadedInbox/);
  assert.match(messages, /formatInboxActivityDate/);
  assert.match(messages, /textAlign:\s*'left'/);
  assert.match(messages, /textAlign:\s*'right'/);
  assert.doesNotMatch(messages, /✓ \$\{|✓ '/);
  assert.doesNotMatch(messages, /title=\{`\$\{state\.filter === filter \? '✓ '/);

  // #606 CITY-01 (R4: web-style «Город» card + «Выбрать»; profile keeps radio CityRow)
  assert.match(cityRow, /export function CityRow/);
  assert.match(cityRow, /textAlign:\s*'left'/);
  assert.match(cityRow, /region/);
  assert.match(cityRow, /borderBottomWidth:\s*1/);
  assert.match(cityRow, /variant/);
  assert.match(city, /CityRow/);
  assert.match(city, /Где хотите играть\?/);
  assert.match(city, /styles\.card/);
  assert.match(city, /Город/);
  assert.match(editor, /CityRow/);
  assert.doesNotMatch(editor, /variant="select"/);
  assert.doesNotMatch(editor, /title=\{`\$\{c\.id === state\.draft\.cityId \? '✓ '/);

  // #588 BACK-02
  assert.match(radar, /accessibilityLabel="Закрыть"/);
  assert.match(radar, /DiscoveryIcon name="close"/);
  assert.match(radar, /justifyContent:\s*'flex-end'/);
  assert.doesNotMatch(radar, /TextButton title="Закрыть"/);
  assert.match(messages, /accessibilityLabel="Назад"/);
  assert.match(messages, /router\.navigate\('\/messages'\)/);
  assert.match(messages, />←</);
  assert.doesNotMatch(messages, /TextButton title="Назад"/);
  assert.match(ui, /DiscoveryIcon name="close"/);
});

test('#604 inbox filter and date helpers are pure and match web formatting', async () => {
  const source = read('../src/components/messages.tsx');
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const start = source.indexOf('export function formatInboxActivityDate');
  const end = source.indexOf('\nconst inboxFilterLabels');
  assert.ok(start >= 0 && end > start);
  const body = stripTypeScriptTypes(source.slice(start, end)).replace(/\bexport\s+/g, '');
  const helpers = runInNewContext(`${body}\n({ formatInboxActivityDate, filterLoadedInbox });`, {}) as {
    formatInboxActivityDate: (iso: string) => string;
    filterLoadedInbox: (items: ReadonlyArray<{ unreadCount: number; attention: boolean; id: string }>, filter: 'all' | 'unread' | 'attention') => Array<{ id: string }>;
  };
  const iso = '2026-11-14T15:30:00Z';
  assert.equal(
    helpers.formatInboxActivityDate(iso),
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
  );
  const rows = [
    { id: 'a', unreadCount: 0, attention: false },
    { id: 'b', unreadCount: 2, attention: false },
    { id: 'c', unreadCount: 0, attention: true },
  ];
  // VM realm arrays are not deepStrictEqual to host arrays; compare primitive lists.
  assert.equal(helpers.filterLoadedInbox(rows, 'all').map(r => r.id).join(','), 'a,b,c');
  assert.equal(helpers.filterLoadedInbox(rows, 'unread').map(r => r.id).join(','), 'b');
  assert.equal(helpers.filterLoadedInbox(rows, 'attention').map(r => r.id).join(','), 'c');
});
